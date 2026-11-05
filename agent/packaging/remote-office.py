#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Verify original Office artifacts for explicit migration; production uses four builders."""
import argparse
import base64
from functools import cache
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = 'openresearchtools/office-builds'
WORKFLOW = 'build.yml'
TARGETS = ['linux-amd64', 'linux-arm64', 'termux-aarch64', 'termux-x86_64']


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


# Keep GitHub transport and archive validation in their existing packaging owners.
native = module('native_component', Path(__file__).with_name('native-component.py'))
package = module('native_package', Path(__file__).with_name('build.py'))
applications = module('applications', Path(__file__).with_name('applications.py'))


def execution_inputs(workflow, component, target):
    """Retain toolchain/commands, excluding checkout, diagnostics and cache policy."""
    platforms = [json.loads(value) for value in re.findall(r"'(\[\{[^'\n]+\}\])'", workflow)]
    platform, architecture = target.split('-', 1)
    runners = [item for values in platforms for item in values
               if item.get('target') == platform and item.get('architecture') == architecture]
    if not runners or any(value != runners[0] for value in runners):
        raise ValueError('Unrecognized native Office runner contract')
    names = {'Prepare native build prerequisites', 'Build native engine and server from retained sources'}
    if component == 'files':
        names.add('Select the existing retained Go toolchain')
    if platform == 'termux':
        names.add('Prepare the existing pinned native Termux toolchain')
    steps = {}
    ignored = {'Require an immutable source commit', 'Restore a matching completed native component',
               'Materialize changed native component sources', 'Collect build diagnostics',
               'Select the existing retained Go toolchain', 'Prepare the existing pinned native Termux toolchain'}
    for block in re.split(r'^      - ', workflow, flags=re.M)[1:]:
        block = '        ' + block
        name = re.search(r'^        name: (.+)$', block, re.M)
        uses = re.search(r'^        uses: (.+)$', block, re.M)
        if name and name[1] in names:
            run = re.search(r'^        run: (.*?)(?=^        [a-z][\w-]*:|\Z)', block, re.M | re.S)
            env = re.search(r'^        env:\n((?:          .+\n)+)', block, re.M)
            if not run:
                raise ValueError('Missing native build command: ' + name[1])
            shell = re.search(r'^        shell: (.+)$', block, re.M)
            steps[name[1]] = {'run': run[1].strip(), 'env': env[1].strip() if env else '',
                             'shell': shell[1] if shell else None}
        elif uses and ('setup-node@' in uses[1] or component == 'files' and 'setup-go@' in uses[1]):
            settings = re.search(r'^        with:\n((?:          .+\n)+)', block, re.M)
            steps[uses[1]] = settings[1].strip() if settings else ''
        elif re.search(r'^        run:', block, re.M) and (not name or name[1] not in ignored):
            raise ValueError('Unrecognized native execution step')
        elif uses and not any(owner in uses[1] for owner in ('actions/checkout@', 'actions/cache', 'actions/upload-artifact@', 'actions/setup-go@')):
            raise ValueError('Unrecognized native build tool action')
    if (not names.issubset(steps) or not any('setup-node@' in name for name in steps)
            or component == 'files' and not any('setup-go@' in name for name in steps)):
        raise ValueError('Incomplete native Office toolchain contract')
    # New native flags in the job environment also invalidate the component.
    environment = re.search(r'^    env:\n((?:      .+\n)+)', workflow, re.M)
    env = [line.strip() for line in environment[1].splitlines() if not re.match(
        r'      (?:CCACHE_\w+|TASKARIAN_SOURCE_CACHE|GOTELEMETRY|DO_NOT_TRACK):', line)] if environment else []
    return {'runner': runners[0], 'runsOn': re.findall(r'^    runs-on: (.+)$', workflow, re.M),
            'steps': steps, 'env': env}


@cache
def native_inputs(component, target, revision):
    if component not in ('office', 'files') or target not in TARGETS:
        raise ValueError('Unsupported native Office component/target')
    if not isinstance(revision, str) or not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('Invalid native producer source')
    paths = ['LICENSE', 'agent/packaging/source_cache.py', 'agent/packaging/office/prepare-runner.sh']
    if component == 'office':
        # Tree identities cover the complete pinned engine/dependency closure;
        # integration JS/extension code is assembled fresh and is not compiled here.
        paths += ['office/upstream', 'office/patches', 'office/branding', 'files/patches/collabora']
        recipe = 'agent/packaging/office'
        if native.local(revision):
            entries = [line.split('\t', 1)[1] for line in native.git('ls-tree', revision + ':' + recipe).splitlines()]
        else:
            entries = list(native.tree(native.entry(revision, recipe)))
        paths += [recipe + '/' + name for name in entries if name.endswith(('.py', '.sh'))]
        branding = json.loads(native.content(revision, 'office/branding/online/branding-sources.json'))
        paths += [branding[key]['path'] for key in ('artwork', 'wordmark')]
        paths += [row['source'] for row in branding['legal'].values()]
    else:
        paths += ['files/vendor', 'files/patches/quantum', 'files/patches/go-ffmpeg',
                  'files/adapters', 'files/addon', 'files/runtime-go.json', 'files/build.py',
                  'files/go_runtime.py', 'files/notices.py', 'auth/dependencies/go-toolchain',
                  'auth/build/go-notices.py']
        notices = json.loads(native.content(revision, 'files/vendor/dependencies/notice-sources.json'))
        for row in notices['components'].values():
            paths += row.get('provenanceFiles', [])
            paths += [source['file'] for source in row['sources'] if 'file' in source]
    if target.startswith('termux-'):
        paths += ['agent/packaging/termux/native_toolchain.py', 'agent/packaging/node/lock.json',
                  'agent/packaging/node/build.py', 'agent/vendor/node/libcxx', 'agent/vendor/node/sources.json']
        if component == 'files':
            paths.append('files/termux.py')
    files = {path: native.entry(revision, path) for path in sorted(set(paths))}
    if any(value is None for value in files.values()):
        raise ValueError('Missing pinned native component input')
    return {'schema': 1, 'component': component, 'target': target, 'files': files,
            'recipe': execution_inputs(native.content(revision, '.github/builders/office.yml'), component, target)}


def receipt_path(directory, component, target):
    return directory / f'native-input-equivalence-{component}-{target}.json'


def payload_files(directory, component, target):
    archive = f'{component}-{target}.' + ('tar.xz' if component == 'office' else 'tar.gz')
    names = [archive, 'SHA256SUMS'] + ([archive + '.json'] if component == 'office' else [])
    return {name: package.sha(directory / name) for name in names}


def verify_receipt(directory, component, target, requested, producer, digest, manifest_digest):
    value = json.loads(receipt_path(directory, component, target).read_text())
    if not isinstance(value, dict) or not isinstance(value.get('producer'), dict):
        raise ValueError('Invalid native Office producer receipt')
    expected = native_inputs(component, target, requested)
    origin = value['producer']
    if (value.get('schema') != 1 or value.get('component') != component or value.get('target') != target
            or value.get('repository') != REPOSITORY or value.get('requestedSource') != requested
            or value.get('producerSource') != producer or value.get('inputs') != expected
            or native_inputs(component, target, producer) != expected
            or value.get('files') != payload_files(directory, component, target)
            or value.get('sha256') != digest or value.get('manifestSha256') != manifest_digest
            or not isinstance(origin.get('runId'), int) or not isinstance(origin.get('artifactId'), int)
            or not isinstance(origin.get('jobId'), int)
            or origin.get('artifactName') != f'{component}-{target}-{producer}'
            or not re.fullmatch('[0-9a-f]{40}', origin.get('workflowCommit', ''))
            or len(origin.get('steps', [])) != 1
            or origin['steps'][0].get('name') != 'Build native engine and server from retained sources'
            or origin['steps'][0].get('conclusion') != 'success'):
        raise ValueError('Native Office producer inputs or immutable artifact differ from the requested build')
    return value


def source_revision():
    return subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()


def api(endpoint, body=None):
    if body is None:
        return native.api(endpoint)
    result = native.github(['api', endpoint, '--method', 'POST', '--input', '-'], input=json.dumps(body).encode())
    return json.loads(result) if result.strip() else None


def verify_workflow(revision, source=None):
    record = api(f'repos/{REPOSITORY}/contents/.github/workflows/{WORKFLOW}?ref={revision}')
    expected = native.content(source, '.github/builders/office.yml') if source else (ROOT / '.github/builders/office.yml').read_text()
    if base64.b64decode(record['content']).decode().strip() != expected.strip():
        raise ValueError('Office builder workflow differs from this source revision')


def verify_run(run, source, request):
    if (run['event'] != 'workflow_dispatch' or run['head_branch'] != 'main'
            or run['path'] != '.github/workflows/' + WORKFLOW
            or run['display_title'] != f'Office {source} / {request}'
            or run['repository']['full_name'].lower() != REPOSITORY.lower()):
        raise ValueError('Office build does not match the exact collection request')


def dispatch(request, force):
    # The old repository remains a historical artifact/cache source only.
    raise ValueError('Office production moved to build-components.yml and the four architecture builders')


def verify_artifact(directory, target, source, component='office', requested=None):
    platform, architecture = target.split('-', 1)
    extension = 'tar.xz' if component == 'office' else 'tar.gz'
    archive = directory / f'{component}-{target}.{extension}'
    digest = package.checked_archive(archive)
    sidecar = archive.with_name(archive.name + '.json')
    if component == 'office':
        package.checked_archive(sidecar)
    with tempfile.TemporaryDirectory(prefix='office-verify-', dir=directory.parent) as temporary:
        incoming = Path(temporary)
        package.extract(archive, incoming)
        if component == 'office' and {path.name for path in incoming.iterdir()} != {'runtime'}:
            raise ValueError('Unexpected Office artifact root')
        if component == 'files' and not {path.name for path in incoming.iterdir()}.issubset(
                {'bin', 'lib', 'share', 'legal', 'sources', 'manifest.json', 'licenses.json'}):
            raise ValueError('Unexpected Files artifact boundary')
        runtime = incoming / 'runtime' if component == 'office' else incoming
        manifest_digest = package.sha(runtime / 'manifest.json')
        metadata = json.loads((runtime / 'manifest.json').read_text())
        if (not isinstance(metadata, dict) or metadata.get('schema') != 1 or metadata.get('target') != platform
                or metadata.get('architecture') != architecture
                or metadata.get('sourceCommit') != source or metadata.get('development')):
            raise ValueError('Office artifact source/target provenance mismatch')
        if component == 'office' and json.loads(sidecar.read_text()) != {key: value for key, value in metadata.items() if key != 'files'}:
            raise ValueError('Office archive and provenance receipt differ')
        if not isinstance(metadata.get('files'), dict) or not metadata['files']:
            raise ValueError('Native component lacks its complete file inventory')
        applications.verify_files(runtime, metadata['files'])
        if (not isinstance(metadata.get('depends'), list) or not (runtime / 'licenses.json').is_file()
                or not json.loads((runtime / 'licenses.json').read_text())):
            raise ValueError('Office artifact lacks native dependency or legal metadata')
    if requested and requested != source:
        verify_receipt(directory, component, target, requested, source, digest, manifest_digest)
    return digest, metadata, manifest_digest


def producer_job(run, component, target, restored=False):
    platform, architecture = target.split('-', 1)
    source = re.fullmatch(r'Office ([0-9a-f]{40}) / [A-Za-z0-9_.-]+', run['display_title'])[1]
    runner = native_inputs(component, target, source)['recipe']['runner']['runner']
    jobs = api(f'repos/{REPOSITORY}/actions/runs/{run["id"]}/jobs?per_page=100')['jobs']
    job = next((item for item in jobs if item['name'] == f'build ({component}, {platform}, {architecture}, {runner})'), None)
    if not job:
        raise ValueError('No matching native producer job')
    required = 'Restore a matching completed native component' if restored else 'Build native engine and server from retained sources'
    steps = [item for item in job['steps'] if item['name'] == required and item.get('conclusion') == 'success']
    if len(steps) != 1:
        raise ValueError('The native producer did not complete this component')
    return {'jobId': job['id'], 'steps': steps}


def download(artifact, directory):
    with tempfile.TemporaryFile() as stream:
        for attempt in range(3):
            stream.seek(0); stream.truncate()
            result = subprocess.run(['gh', 'api', f'repos/{REPOSITORY}/actions/artifacts/{artifact["id"]}/zip'],
                                    stdout=stream, stderr=subprocess.PIPE)
            if result.returncode == 0:
                break
            detail = result.stderr.decode(errors='replace')
            if re.search(r'HTTP (?:404|410)\b', detail):
                raise subprocess.CalledProcessError(result.returncode, result.args, stderr=detail)
            if attempt == 2:
                raise native.MetadataUnavailable('Office artifact download is unavailable; retry this job')
            time.sleep(2 ** attempt)
        stream.seek(0)
        if artifact.get('digest') and artifact['digest'] != 'sha256:' + hashlib.file_digest(stream, 'sha256').hexdigest():
            raise ValueError('Actions Office artifact digest mismatch')
        stream.seek(0)
        with zipfile.ZipFile(stream) as payload:
            for member in payload.infolist():
                path = Path(member.filename)
                if path.is_absolute() or '..' in path.parts or (member.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError('Unsafe native artifact member')
            payload.extractall(directory)


def restore(directory, component, target, requested):
    expected = native_inputs(component, target, requested)
    prefix = f'{component}-{target}-'
    for page in range(1, 11):
        artifacts = api(f'repos/{REPOSITORY}/actions/artifacts?per_page=100&page={page}')['artifacts']
        for artifact in artifacts:
            source = artifact['name'].removeprefix(prefix)
            if artifact['expired'] or not artifact['name'].startswith(prefix) or not re.fullmatch('[0-9a-f]{40}', source):
                continue
            run_id = artifact['workflow_run']['id']
            if run_id == int(os.environ.get('GITHUB_RUN_ID', '0')):
                continue
            try:
                if native_inputs(component, target, source) != expected:
                    continue
                run = api(f'repos/{REPOSITORY}/actions/runs/{run_id}')
                title = re.fullmatch(r'Office ([0-9a-f]{40}) / ([A-Za-z0-9_.-]+)', run['display_title'])
                if not title or title[1] != source:
                    continue
                if artifact['workflow_run']['head_sha'] != run['head_sha']:
                    raise ValueError('Artifact and workflow producer revisions differ')
                verify_run(run, source, title[2])
                verify_workflow(run['head_sha'], source)
                with tempfile.TemporaryDirectory(prefix='restore-office-') as temporary:
                    incoming = Path(temporary)
                    download(artifact, incoming)
                    prior = receipt_path(incoming, component, target)
                    original, producer = source, {'runId': run_id, 'artifactId': artifact['id'],
                                                 'artifactName': artifact['name'], 'workflowCommit': run['head_sha']}
                    if prior.exists():
                        value = json.loads(prior.read_text())
                        if not isinstance(value, dict):
                            raise ValueError('Invalid native producer receipt')
                        original, producer = value['producerSource'], value['producer']
                    digest, metadata, manifest_digest = verify_artifact(incoming, target, original, component, source)
                    if prior.exists():
                        verify_receipt(incoming, component, target, source, original, digest, manifest_digest)
                    job = producer_job(run, component, target, restored=prior.exists())
                    if native_inputs(component, target, original) != expected:
                        raise ValueError('Original native producer inputs differ')
                    if not prior.exists():
                        producer.update(job)
                    # Preserve the immutable archive and its producer; only this
                    # outside receipt describes the current assembly request.
                    value = {'schema': 1, 'component': component, 'target': target, 'repository': REPOSITORY,
                             'producerSource': original, 'requestedSource': requested, 'inputs': expected,
                             'producer': producer, 'files': payload_files(incoming, component, target),
                             'sha256': digest, 'manifestSha256': manifest_digest}
                    prior.write_text(json.dumps(value, indent=2) + '\n')
                    directory.mkdir(parents=True, exist_ok=True)
                    shutil.copytree(incoming, directory, dirs_exist_ok=True)
                print(f'Reused verified {component} {target} from original source {original}: {run["html_url"]}', flush=True)
                return True
            except (subprocess.CalledProcessError, OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
                print(f'Cannot prove optional {component} artifact {artifact["id"]}: {error}; checking another producer', flush=True)
        if len(artifacts) < 100:
            break
    return False


def collect(run_id, request, target, directory, component):
    source = source_revision()
    endpoint = f'repos/{REPOSITORY}/actions/runs/{run_id}'
    run = api(endpoint)
    verify_run(run, source, request)
    verify_workflow(run['head_sha'])
    name = f'{component}-{target}-{source}'
    deadline = time.monotonic() + 6 * 60 * 60
    while time.monotonic() < deadline:
        artifacts = api(endpoint + '/artifacts?per_page=100')['artifacts']
        artifact = next((value for value in artifacts if value['name'] == name and not value['expired']), None)
        if artifact:
            directory.mkdir(parents=True, exist_ok=True)
            download(artifact, directory)
            receipt = receipt_path(directory, component, target)
            producer = json.loads(receipt.read_text())['producerSource'] if receipt.exists() else source
            digest, metadata, _ = verify_artifact(directory, target, producer, component, source)
            (directory / 'builder-provenance.json').write_text(json.dumps({
                'repository': REPOSITORY, 'run': run_id, 'artifact': artifact['id'],
                'source': metadata['sourceCommit'], 'requestedSource': source,
                'workflowCommit': run['head_sha'], 'sha256': digest,
                'url': run['html_url']}, indent=2) + '\n')
            print(f'Collected verified {target} {component} component from {run["html_url"]}', flush=True)
            return
        run = api(endpoint)
        if run['status'] == 'completed':
            raise RuntimeError(f'Office build ended with {run["conclusion"]} without {target}: {run["html_url"]}')
        time.sleep(30)
    raise TimeoutError('Office artifact did not arrive within six hours')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['dispatch', 'collect', 'restore'])
    parser.add_argument('--request')
    parser.add_argument('--run', type=int)
    parser.add_argument('--target', choices=TARGETS)
    parser.add_argument('--component', choices=['office', 'files'], default='office')
    parser.add_argument('--directory', type=Path)
    parser.add_argument('--force', choices=['true', 'false'], default='false')
    args = parser.parse_args()
    if args.action != 'restore' and (not args.request or not re.fullmatch(r'[A-Za-z0-9_.-]+', args.request)):
        parser.error('Collection request must be a simple stable identifier')
    if args.action == 'dispatch':
        dispatch(args.request, args.force)
    elif args.action == 'restore':
        if not args.target or not args.directory:
            parser.error('restore requires --target and --directory')
        hit = False
        if args.force != 'true':
            try:
                hit = restore(args.directory.resolve(), args.component, args.target, source_revision())
            except (subprocess.CalledProcessError, ValueError, KeyError) as error:
                print(f'No provable {args.component} component: {error}; building normally', flush=True)
        native.output('hit', str(hit).lower())
    else:
        if not args.run or not args.target or not args.directory:
            parser.error('collect requires --run, --target and --directory')
        collect(args.run, args.request, args.target, args.directory.resolve(), args.component)


if __name__ == '__main__':
    main()
