#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Reuse complete Node components only when their committed assembly inputs match."""
import argparse
import base64
from functools import cache
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = 'openresearchtools/bashkitten'
WORKFLOW = '.github/workflows/node-native.yml'
TREES = ('agent/packaging/node', 'agent/vendor/node')
SHARED_RECIPE = 'agent/packaging/source_cache.py'
ASSEMBLE = 'Assemble pinned private runtime and corresponding source'
RESTORE = 'Restore a matching completed Node component'
VERIFY = 'Verify Node runtime, corresponding source and provenance'


def api(endpoint):
    return json.loads(subprocess.check_output(['gh', 'api', endpoint], text=True))


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def assembly_recipe(workflow):
    # Only execution inputs belong in this identity, not artifact/cache policy.
    # The workflow deliberately keeps the runner and two assembly commands as
    # single-line values. Refuse a new syntax until its input handling is updated.
    runner = re.findall(r'^    runs-on: (.+)$', workflow, re.M)
    if len(runner) != 1:
        raise ValueError('Expected one Node assembly runner')
    recipe = {'runner': runner[0]}
    for name in ('Install component assembly tools', ASSEMBLE):
        blocks = re.findall(r'^    - name: ' + re.escape(name) + r'\n((?:      .+\n)+)', workflow, re.M)
        if len(blocks) != 1:
            raise ValueError('Missing Node assembly step: ' + name)
        commands = re.findall(r'^      run: (.+)$', blocks[0], re.M)
        if len(commands) != 1 or commands[0] in ('|', '>'):
            raise ValueError('Expected a single-line Node assembly command')
        recipe[name] = commands[0]
    return recipe


@cache
def inputs(revision):
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('Invalid Node producer revision')
    local = subprocess.run(['git', 'cat-file', '-e', revision + '^{commit}'], cwd=ROOT,
                           stderr=subprocess.DEVNULL).returncode == 0
    if local:
        trees = {path: git('rev-parse', revision + ':' + path).decode().strip() for path in TREES}
        shared_entry = git('ls-tree', revision, '--', SHARED_RECIPE).decode().split()
        shared = shared_entry[2] if shared_entry else None
        workflow = git('show', revision + ':' + WORKFLOW).decode()
    else:
        trees = {}
        for path in TREES:
            parent, name = path.rsplit('/', 1)
            entries = api(f'repos/{REPOSITORY}/contents/{parent}?ref={revision}')
            trees[path] = next(item['sha'] for item in entries if item['name'] == name and item['type'] == 'dir')
        parent, name = SHARED_RECIPE.rsplit('/', 1)
        entries = api(f'repos/{REPOSITORY}/contents/{parent}?ref={revision}')
        shared = next((item['sha'] for item in entries if item['name'] == name and item['type'] == 'file'), None)
        entry = api(f'repos/{REPOSITORY}/contents/{WORKFLOW}?ref={revision}')
        workflow = base64.b64decode(entry['content']).decode()
    return {'trees': trees, 'sharedRecipe': {SHARED_RECIPE: shared},
            'assembly': assembly_recipe(workflow)}


def files(directory):
    return {str(path.relative_to(directory)): ('link', os.readlink(path)) if path.is_symlink()
            else ('file', sha(path)) for path in directory.rglob('*')
            if '__pycache__' not in path.parts and (path.is_file() or path.is_symlink())}


def verify(directory, target):
    platform, architecture = target.split('-', 1)
    names = [f'node-{kind}-{target}.tar.gz' for kind in ('runtime', 'source')]
    receipt_name = f'node-provenance-{target}.json'
    checksums = {}
    for line in (directory / 'SHA256SUMS').read_text().splitlines():
        digest, name = line.split('  ', 1)
        if (name in checksums or Path(name).name != name or
                not re.fullmatch('[0-9a-f]{64}', digest) or sha(directory / name) != digest):
            raise ValueError('Invalid Node artifact checksum: ' + name)
        checksums[name] = digest
    if set(checksums) not in (set(names), set(names + [receipt_name])):
        raise ValueError('Node checksums must cover the runtime, source and any provenance receipt')
    allowed = set(checksums) | {'SHA256SUMS', '.checksums.lock'} | {name + '.sha256' for name in names}
    if any(path.name not in allowed or not path.is_file() for path in directory.iterdir()):
        raise ValueError('Unexpected Node component payload')
    for name in names:
        if (directory / (name + '.sha256')).read_text() != checksums[name] + '  ' + name + '\n':
            raise ValueError('Node checksum sidecar differs: ' + name)
    specification = importlib.util.spec_from_file_location('node_assembly', ROOT / TREES[0] / 'build.py')
    assembly = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(assembly)
    record = assembly.LOCK[platform]
    expected_inputs = [record['archives'][architecture]] if platform == 'linux' else record['architectures'][architecture]['packages']
    sources = [record['source']]
    if platform == 'termux':
        sources += [*record['dependency_sources'].values(), record['recipes']]
    with tempfile.TemporaryDirectory(prefix='verify-node-') as temporary:
        temporary = Path(temporary)
        for name in names:
            with tarfile.open(directory / name) as archive:
                archive.extractall(temporary, filter='data')
        runtime, source = temporary / 'node', temporary / 'node-source'
        metadata = json.loads((runtime / 'manifest.json').read_text())
        if metadata != json.loads((source / 'component.json').read_text()):
            raise ValueError('Node runtime and corresponding source identities differ')
        expected = {'schema': 1, 'platform': platform, 'architecture': architecture,
                    'node_version': record['node_version'], 'npm_version': record['npm_version'],
                    'inputs': expected_inputs, 'recipe_commit': record.get('recipe_commit')}
        if any(metadata.get(key) != value for key, value in expected.items()):
            raise ValueError('Node artifact does not match the committed lock')
        assembly.validate_elf(runtime / 'bin/node', architecture)
        if files(source / 'recipe') != files(ROOT / TREES[0]):
            raise ValueError('Node corresponding source has a different assembly recipe')
        if sha(source / 'source_cache.py') != sha(ROOT / SHARED_RECIPE):
            raise ValueError('Node corresponding source has a different source-cache helper')
        if json.loads((source / 'sources.json').read_text()) != sources:
            raise ValueError('Incomplete Node corresponding-source inventory')
        archives = {}
        for item in sources:
            if platform == 'termux' and item == record['dependency_sources']['libc++']:
                ndk = source / 'libcxx-ndk-input'
                provenance = json.loads((ndk / 'provenance.json').read_text())
                if any(provenance.get(key) != value for key, value in item.items()):
                    raise ValueError('Node NDK provenance differs from the lock')
                triple = 'x86_64-linux-android' if architecture == 'x86_64' else 'aarch64-linux-android'
                member = 'android-ndk-r30/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib/' + triple + '/libc++_shared.so'
                if (provenance.get('archive_member') != member or
                        sha(ndk / 'libc++_shared.so') != provenance.get('member_sha256')):
                    raise ValueError('Node NDK retained runtime differs from its provenance')
                for name in ('NOTICE', 'LLVM-NOTICE'):
                    if not (ndk / name).read_text().strip():
                        raise ValueError('Missing full NDK notice')
                if files(source / 'libcxx-corresponding-source') != files(ROOT / TREES[1] / 'libcxx'):
                    raise ValueError('Node libc++ corresponding source is incomplete')
                continue
            name = item['sha256'] + '-' + item['url'].rsplit('/', 1)[-1]
            archives[name] = ('file', item['sha256'])
        if files(source / 'archives') != archives:
            raise ValueError('Node source archive checksum or inventory mismatch')
        npm = runtime / 'lib/node_modules/npm'
        if files(npm) != files(source / 'npm'):
            raise ValueError('Node npm corresponding source is incomplete')
        if json.loads((npm / 'package.json').read_text())['version'] != record['npm_version']:
            raise ValueError('Node npm version differs from the lock')
        notices = json.loads((runtime / 'licenses.json').read_text())
        packages = [{key: entry[key] for key in ('name', 'version', 'license', 'source')} for entry in notices]
        if metadata.get('packages') != packages:
            raise ValueError('Node notice inventory differs from the runtime manifest')
        dependencies = assembly.npm_dependency_notices(npm)
        native_names = ['Node.js']
        if platform == 'termux':
            native_names += ['Termux packaging'] + [item['name'] for item in expected_inputs if item['name'] not in ('nodejs-lts', 'npm')]
        if [entry['name'] for entry in notices] != native_names + ['npm'] + [entry['name'] for entry in dependencies]:
            raise ValueError('Incomplete Node native/npm notice inventory')
        if notices[len(native_names) + 1:] != dependencies:
            raise ValueError('Node npm notices differ from their complete source')
        for index, entry in enumerate(notices):
            assembly.notice(entry['name'], entry['version'], entry['license'], entry['text'], entry['source'])
            if (runtime / 'licenses' / f'{index:02d}.txt').read_text() != entry['text']:
                raise ValueError('Node full notice differs from its inventory')
    receipt = directory / receipt_name
    if receipt.exists():
        provenance = json.loads(receipt.read_text())
        current = git('rev-parse', 'HEAD').decode().strip()
        if (provenance.get('schema') != 1 or provenance.get('target') != target or
                provenance.get('repository') != REPOSITORY or provenance.get('inputs') != inputs(current) or
                not re.fullmatch('[0-9a-f]{40}', provenance.get('producerSource', '')) or
                not isinstance(provenance.get('producerRun'), int) or
                provenance.get('archives') != {name: checksums[name] for name in names}):
            raise ValueError('Node producer receipt does not match this component')
    return {name: checksums[name] for name in names}


def completed_producer(run, target):
    if (run['status'] != 'completed' or run['conclusion'] not in ('success', 'failure') or
            run['event'] != 'workflow_dispatch' or run['head_branch'] != 'main' or
            run['path'] not in (WORKFLOW, '.github/workflows/packages.yml')):
        return None
    platform, architecture = target.split('-', 1)
    suffix = f'node ({platform}, {architecture})'
    page = 1
    while True:
        jobs = api(f'repos/{REPOSITORY}/actions/runs/{run["id"]}/jobs?per_page=100&page={page}')['jobs']
        for job in jobs:
            if job['conclusion'] != 'success' or job['name'].split(' / ')[-1] != suffix:
                continue
            steps = {step['name']: step for step in job['steps']}
            built = steps.get(ASSEMBLE, {}).get('conclusion') == 'success'
            restored = (steps.get(ASSEMBLE, {}).get('conclusion') == 'skipped' and
                        all(steps.get(name, {}).get('conclusion') == 'success' for name in (RESTORE, VERIFY)))
            upload = next((step for step in job['steps'] if step['name'].startswith('Run actions/upload-artifact@')
                           and step['conclusion'] == 'success'), None)
            if upload and (built or restored):
                return {'job': job['id'], 'assembled': built, 'steps': job['steps']}
        if len(jobs) < 100:
            return None
        page += 1


def write_receipt(directory, target, provenance):
    name = f'node-provenance-{target}.json'
    path = directory / name
    path.write_text(json.dumps(provenance, indent=2) + '\n')
    with (directory / 'SHA256SUMS').open('a') as output:
        output.write(sha(path) + '  ' + name + '\n')


def restore(directory, target):
    current = inputs(git('rev-parse', 'HEAD').decode().strip())
    page = 1
    while True:
        artifacts = api(f'repos/{REPOSITORY}/actions/artifacts?name=node-runtime-{target}&per_page=100&page={page}')['artifacts']
        for artifact in artifacts:
            if artifact['expired'] or artifact['name'] != f'node-runtime-{target}':
                continue
            run = api(f'repos/{REPOSITORY}/actions/runs/{artifact["workflow_run"]["id"]}')
            if run['id'] == int(os.environ.get('GITHUB_RUN_ID', '0')):
                continue
            evidence = completed_producer(run, target)
            if not evidence or inputs(run['head_sha']) != current:
                continue
            subprocess.run(['gh', 'run', 'download', str(run['id']), '--repo', REPOSITORY,
                            '--name', artifact['name'], '--dir', str(directory)], check=True)
            archives = verify(directory, target)
            receipt = directory / f'node-provenance-{target}.json'
            if not receipt.exists():
                if not evidence['assembled']:
                    raise ValueError('Restored Node component lacks its original producer receipt')
                write_receipt(directory, target, {'schema': 1, 'target': target, 'repository': REPOSITORY,
                    'producerSource': run['head_sha'], 'producerRun': run['id'],
                    'producerArtifact': artifact['id'], 'producerEvidence': evidence,
                    'inputs': current, 'archives': archives})
            elif evidence['assembled']:
                provenance = json.loads(receipt.read_text())
                if provenance['producerSource'] != run['head_sha'] or provenance['producerRun'] != run['id']:
                    raise ValueError('Assembled Node artifact misidentifies its producer')
            print(f'Reused verified {target} runtime and corresponding source from {run["html_url"]}', flush=True)
            return True
        if len(artifacts) < 100:
            return False
        page += 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['restore', 'verify'])
    parser.add_argument('target', choices=['linux-amd64', 'linux-arm64', 'termux-aarch64', 'termux-x86_64'])
    parser.add_argument('--directory', type=Path, required=True)
    args = parser.parse_args()
    if os.environ.get('GITHUB_REPOSITORY', REPOSITORY).lower() != REPOSITORY:
        raise ValueError('Node component reuse requires the product repository')
    args.directory.mkdir(parents=True, exist_ok=True)
    if args.action == 'restore':
        if any(args.directory.iterdir()):
            raise ValueError('Node restore destination must be empty')
        hit = restore(args.directory, args.target)
        with Path(os.environ['GITHUB_OUTPUT']).open('a') as output:
            output.write(f'hit={str(hit).lower()}\n')
        print('Matching complete Node component found' if hit else 'Assembling changed Node inputs')
    else:
        archives = verify(args.directory, args.target)
        if not (args.directory / f'node-provenance-{args.target}.json').exists():
            revision = git('rev-parse', 'HEAD').decode().strip()
            write_receipt(args.directory, args.target, {'schema': 1, 'target': args.target,
                'repository': REPOSITORY, 'producerSource': revision, 'producerRun': int(os.environ['GITHUB_RUN_ID']),
                'inputs': inputs(revision), 'archives': archives})
        print('Verified Node runtime, complete corresponding source, notices and original producer')


if __name__ == '__main__':
    main()
