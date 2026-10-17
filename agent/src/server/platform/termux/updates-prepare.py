# SPDX-License-Identifier: AGPL-3.0-only
"""Acquire the APK-matched bundled Node when upgrading a pre-bundle installation.

Python is an existing Termux package dependency. It only prepares our runtime;
the APK's normal updater still owns package installation and its idle boundary.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

PREFIX = Path('/data/data/com.termux/files/usr')
APP = PREFIX / 'lib/bashkitten'
DATA = Path(os.environ.get('BASHKITTEN_DATA_DIR', str(Path.home() / '.local/share/bashkitten-pi')))
DIRECTORY = DATA / 'updates/apk-bootstrap'
JOBS = DATA / 'updates/apk-jobs'
STATE = DIRECTORY / 'state.json'
OUTPUT = DIRECTORY / 'output.log'
CANCEL = DIRECTORY / 'cancel.json'
APT = ['apt-get', '-o', 'APT::Get::AllowUnauthenticated=false',
       '-o', 'Acquire::AllowInsecureRepositories=false', '-o', 'APT::Update::Error-Mode=any',
       '-o', 'Acquire::https::Timeout=30', '-o', 'Acquire::Retries=3']


def read(file):
    try:
        return json.loads(file.read_text())
    except FileNotFoundError:
        return None


def write(file, value):
    with tempfile.NamedTemporaryFile(mode='w', dir=file.parent, delete=False) as stream:
        json.dump(value, stream)
    os.replace(stream.name, file)


def process_start(pid):
    try:
        fields = Path(f'/proc/{int(pid)}/stat').read_text().rsplit(')', 1)[1].split()
        return None if fields[0] in ('Z', 'X') else fields[19]
    except (OSError, TypeError, ValueError):
        return None


def node_environment(node):
    environment = {key: value for key, value in os.environ.items() if key not in ('NODE_OPTIONS', 'NODE_PATH')}
    environment.update(OPENSSL_CONF=str(node.parent.parent / 'etc/openssl.cnf'),
                       TERMUX_EXEC__SYSTEM_LINKER_EXEC__MODE='disable', BASHKITTEN_EXECUTION_ROLE='termux')
    return environment


def execute(node, module, request):
    # Keep the existing stdin-only request contract when replacing this process.
    with tempfile.TemporaryFile() as stream:
        stream.write(json.dumps(request).encode())
        stream.seek(0)
        os.dup2(stream.fileno(), 0)
        os.execve(node, [str(node), str(module)], node_environment(node))


def snapshot(state):
    result = {'matched': False}
    if state:
        job = dict(state['job'])
        if cancelled(state):
            job['cancelRequested'] = True
        try:
            job['log'] = OUTPUT.read_text(errors='replace')[-32000:]
            if (read(JOBS / 'job.json') or {}).get('id') == job['id']:
                job['log'] = (job['log'] + (JOBS / 'output.log').read_text(errors='replace'))[-32000:]
        except FileNotFoundError:
            pass
        result['job'] = job
    return result


def staged_node(state):
    stage = Path(state['stage']) if state and state.get('stage') else None
    if stage and stage.parent == DIRECTORY and stage.name.startswith('runtime-'):
        return stage / 'payload' / str(APP).lstrip('/') / 'node/bin/node'
    return None


def cleanup(state):
    node = staged_node(state)
    if node:
        if Path(state['stage']).exists():
            shutil.rmtree(state['stage'])
        state.pop('stage', None)
        state.pop('pid', None)
        state.pop('started', None)


def cancelled(state):
    return (read(CANCEL) or {}).get('id') == state['job']['id']


def prepare(module, request, state):
    child = None
    try:
        stage = Path(tempfile.mkdtemp(prefix='runtime-', dir=DIRECTORY))
        state['stage'] = str(stage)
        target = request['target']
        backend = next(item for item in target['packages'] if item['name'] == 'bashkitten')

        def phase(message):
            if cancelled(state):
                raise InterruptedError('Cancelled before package installation.')
            state['job']['phase'] = message
            write(STATE, state)

        with OUTPUT.open('ab', buffering=0) as output:
            def command(arguments, **options):
                output.write(('\n$ ' + ' '.join(map(str, arguments)) + '\n').encode())
                subprocess.run(arguments, stdout=output, stderr=output, check=True, **options)

            phase('Refreshing signed repositories for the matching bundled runtime')
            command([*APT, 'update'])
            phase('Downloading the matching bundled runtime')
            command([*APT, 'download', 'bashkitten=' + backend['version']], cwd=stage)
            archives = list(stage.glob('*.deb'))
            if len(archives) != 1:
                raise ValueError('APT did not return one matching backend archive.')
            archive = archives[0]
            fields = subprocess.check_output(['dpkg-deb', '-f', archive, 'Package', 'Version', 'Architecture'], text=True)
            metadata = dict(line.split(': ', 1) for line in fields.splitlines())
            if metadata != {'Package': 'bashkitten', 'Version': backend['version'], 'Architecture': target['architecture']}:
                raise ValueError('The signed APT archive does not match this app.')
            if backend.get('sha256'):
                with archive.open('rb') as stream:
                    if hashlib.file_digest(stream, 'sha256').hexdigest() != backend['sha256']:
                        raise ValueError('The backend archive checksum does not match this app.')
            # Check release provenance before extracting or executing any code.
            with subprocess.Popen(['dpkg-deb', '--fsys-tarfile', archive], stdout=subprocess.PIPE, stderr=output) as unpack:
                build = subprocess.run(['tar', '-xOf', '-', '.' + str(APP / 'build-platform.json')],
                                       stdin=unpack.stdout, stdout=subprocess.PIPE, stderr=output, check=True)
                unpack.stdout.close()
                if unpack.wait() != 0:
                    raise ValueError('The signed APT backend archive could not be read.')
            build = json.loads(build.stdout)
            if (build.get('revision') != backend['sourceCommit'] or build.get('packageVersion') != backend['version']
                    or build.get('architecture') != target['architecture']):
                raise ValueError('The signed APT backend source release does not match this app.')
            phase('Preparing the matching bundled runtime')
            payload = stage / 'payload'
            payload.mkdir(mode=0o700)
            with subprocess.Popen(['dpkg-deb', '--fsys-tarfile', archive], stdout=subprocess.PIPE, stderr=output) as unpack:
                subprocess.run(['tar', '-xf', '-', '-C', payload, '.' + str(APP / 'node')],
                               stdin=unpack.stdout, stdout=output, stderr=output, check=True)
                unpack.stdout.close()
                if unpack.wait() != 0:
                    raise ValueError('The bundled runtime could not be extracted.')
            archive.unlink()
            node = staged_node(state)
            if not os.access(node, os.X_OK):
                raise ValueError('The matching backend has no bundled Node runtime.')
            phase('Starting the matching package update')
            # Run the normal updater owner directly so staging outlives its job.
            child = subprocess.Popen([node, module, '--bootstrap-runtime'], stdin=subprocess.PIPE,
                                     stdout=output, stderr=output, env=node_environment(node))
            child.stdin.write(json.dumps(request).encode())
            child.stdin.close()
            state.update(pid=child.pid, started=process_start(child.pid))
            write(STATE, state)
            while child.poll() is None:
                owner, job = read(JOBS / 'owner.json'), read(JOBS / 'job.json')
                if cancelled(state) and owner and owner['pid'] == child.pid and job:
                    write(JOBS / 'cancel.json', {'id': job['id']})
                time.sleep(0.25)
            job = read(JOBS / 'job.json')
            if child.returncode or not job or job.get('startedAt', 0) < state['job']['startedAt']:
                raise ValueError('The package updater could not start; see package output.')
            state['job'] = job
    except Exception as error:
        state['job'].update(status='cancelled' if isinstance(error, InterruptedError) else 'failed', error=str(error))
    finally:
        # Never remove an executing runtime. Normal cancellation is a safe-step
        # request to the existing updater, not a kill of APT/dpkg.
        if child is None or child.poll() is not None:
            cleanup(state)
        write(STATE, state)


def main():
    request = json.load(sys.stdin)
    module = Path(sys.argv[1])
    node = APP / 'node/bin/node'
    installed = os.access(node, os.X_OK)
    if installed and not STATE.exists():
        execute(node, module, request)
    if os.environ.get('PREFIX') != str(PREFIX):
        raise ValueError('Run package preparation inside Termux.')
    target = request['target']
    backend = next(item for item in target['packages'] if item['name'] == 'bashkitten')
    if (not re.fullmatch(r'[0-9][0-9A-Za-z.+:~_-]*', backend['version'])
            or not re.fullmatch(r'[a-f0-9]{40}', backend['sourceCommit'])
            or backend['version'] != target['productVersion'] or backend['sourceCommit'] != target['sourceCommit']
            or backend['architecture'] != target['architecture']
            or target['architecture'] != subprocess.check_output(['dpkg', '--print-architecture'], text=True).strip()
            or hashlib.sha256(module.read_bytes()).hexdigest() != target['bootstrapSha256']):
        raise ValueError('The APK runtime requirements do not match this installation.')
    DIRECTORY.mkdir(mode=0o700, parents=True, exist_ok=True)
    DIRECTORY.chmod(0o700)
    with (DIRECTORY / 'prepare.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except BlockingIOError:
            acquired = False
        state = read(STATE)
        alive = state and state.get('started') and process_start(state.get('pid')) == state['started']
        if not acquired or alive:
            if installed:
                execute(node, module, request)
            if state and (state['job']['input']['target'] != target or state['job']['input']['channel'] != request['channel']):
                raise ValueError('Wait for the previous app package update to finish.')
            owner = read(JOBS / 'owner.json')
            if alive and owner and owner['pid'] == state['pid'] and owner['started'] == state['started']:
                execute(staged_node(state), module, request)
            if request['mode'] == 'cancel' and state:
                write(CANCEL, {'id': state['job']['id']})
                state['job']['cancelRequested'] = True
            elif request['mode'] == 'start' and state and request['kind'] != state['job']['kind']:
                raise ValueError('Another package operation is running.')
            elif request['mode'] not in ('start', 'status'):
                raise ValueError('Wait for the matching bundled runtime to finish downloading.')
            return snapshot(state)
        if state and state.get('stage'):
            cleanup(state)
            state['job'].update(status='interrupted', error='Runtime preparation stopped. Retry the package update.')
            write(STATE, state)
        if installed:
            for file in (STATE, OUTPUT, CANCEL):
                file.unlink(missing_ok=True)
            execute(node, module, request)
        if request['mode'] in ('status', 'cancel'):
            return snapshot(state)
        if request['mode'] != 'start' or request.get('kind') not in ('match-packages', 'update-packages', 'recover-packages'):
            raise ValueError('Retry the matching package update before other package operations.')
        state = {'job': {'id': str(uuid.uuid4()), 'kind': request['kind'], 'input': {'target': target, 'channel': request['channel']},
                         'status': 'running', 'phase': 'Preparing the matching bundled runtime', 'startedAt': int(time.time() * 1000)}}
        OUTPUT.write_text('')
        write(STATE, state)
        if os.fork() == 0:
            os.setsid()
            with open(os.devnull, 'r+b') as stream:
                for descriptor in (0, 1, 2):
                    os.dup2(stream.fileno(), descriptor)
            prepare(module, request, state)
            os._exit(0)
        return snapshot(state)


if __name__ == '__main__':
    os.umask(0o077)
    try:
        print(json.dumps(main()))
    except Exception as failure:
        print(json.dumps({'error': str(failure)}), file=sys.stderr)
        sys.exit(1)
