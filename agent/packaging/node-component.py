#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Reuse complete Node components only when their committed assembly inputs match."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = 'openresearchtools/Taskarian'
TREES = ('agent/packaging/node', 'agent/vendor/node')
SHARED_RECIPE = 'agent/packaging/source_cache.py'


class MetadataUnavailable(RuntimeError):
    """Optional GitHub cache metadata remained unavailable after retries."""


def git(*args):
    try:
        return subprocess.check_output(['git', *args], cwd=ROOT, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as error:
        raise MetadataUnavailable('Node Git input lookup failed; retry without rebuilding') from error


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


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
    durable = directory / ('native-input-equivalence-node-' + target + '.json')
    durable_record = None
    if durable.exists():
        spec = importlib.util.spec_from_file_location('node_native_owner', ROOT / 'agent/packaging/native-components.py')
        owner = importlib.util.module_from_spec(spec); spec.loader.exec_module(owner)
        durable_record = owner.native.verify_store_receipt(directory, 'node', target, owner.head(), owner.inputs('node', target))
    allowed = set(checksums) | {'SHA256SUMS', '.checksums.lock'} | {name + '.sha256' for name in names}
    if durable_record:
        allowed |= set(durable_record['files']) | {durable.name}
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
        if durable_record:
            if provenance.get('target') != target or provenance.get('archives') != {name: checksums[name] for name in names}:
                raise ValueError('Durable Node source/runtime pairing differs')
            return {name: checksums[name] for name in names}
        current = git('rev-parse', 'HEAD').decode().strip()
        if provenance.get('schema') == 2:
            spec = importlib.util.spec_from_file_location('node_current_owner', ROOT / 'agent/packaging/native-components.py')
            owner = importlib.util.module_from_spec(spec); spec.loader.exec_module(owner)
            if (provenance.get('target') != target or provenance.get('producerSource') != current or
                    provenance.get('inputs') != owner.inputs('node', target) or
                    provenance.get('archives') != {name: checksums[name] for name in names}):
                raise ValueError('Fresh native Node provenance differs from its actual inputs')
            return {name: checksums[name] for name in names}
        raise ValueError('Node provenance must come from its current native publisher')
    return {name: checksums[name] for name in names}


def restore(directory, target):
    spec = importlib.util.spec_from_file_location('node_store_owner', ROOT / 'agent/packaging/native-components.py')
    owner = importlib.util.module_from_spec(spec); spec.loader.exec_module(owner)
    return owner.restore_component('node', target, directory) is not None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['restore', 'verify'])
    parser.add_argument('target', choices=['linux-amd64', 'linux-arm64', 'termux-aarch64', 'termux-x86_64'])
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--force', default='false')
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    if args.action == 'restore':
        if any(args.directory.iterdir()):
            raise ValueError('Node restore destination must be empty')
        hit = False if args.force == 'true' else restore(args.directory, args.target)
        with Path(os.environ['GITHUB_OUTPUT']).open('a') as output:
            output.write(f'hit={str(hit).lower()}\n')
        print('Matching complete Node component found' if hit else 'Assembling changed Node inputs')
    else:
        archives = verify(args.directory, args.target)
        if not (args.directory / f'node-provenance-{args.target}.json').exists():
            raise ValueError('Node provenance must come from its native component publisher')
        print('Verified Node runtime, complete corresponding source, notices and original producer')


if __name__ == '__main__':
    main()
