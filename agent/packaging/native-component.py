#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Native input identity and verification for durable architecture components."""
import argparse
import ast
import base64
from functools import cache
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import posixpath
import re
import shutil
import struct
import subprocess
import tarfile
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = 'openresearchtools/Taskarian'
AUTH = ('authelia', 'caddy', 'tor', 'valkey', 'chisel', 'remote')
TARGETS = ('linux-amd64', 'linux-arm64', 'termux-aarch64', 'termux-x86_64')


def git(*args):
    try:
        return subprocess.check_output(['git', *args], cwd=ROOT, stderr=subprocess.PIPE).decode().strip()
    except subprocess.CalledProcessError as error:
        raise MetadataUnavailable('Native Git metadata/blob lookup failed; retry without rebuilding completed components') from error


class MetadataUnavailable(RuntimeError):
    """A transient lookup/download failure must not trigger native compilation."""


def github(command, **kwargs):
    for attempt in range(3):
        try:
            return subprocess.check_output(['gh', *command], stderr=subprocess.PIPE, **kwargs)
        except subprocess.CalledProcessError as error:
            detail = error.stderr.decode(errors='replace') if isinstance(error.stderr, bytes) else error.stderr or ''
            if error.returncode == 4:
                raise MetadataUnavailable('GitHub metadata authentication is unavailable; configure GH_TOKEN for this job and retry without rebuilding native components') from error
            if re.search(r'HTTP (?:404|410)\b', detail):
                raise
            if attempt == 2:
                raise MetadataUnavailable('GitHub artifact service is unavailable; retry this job after connectivity recovers') from error
            time.sleep(2 ** attempt)


def api(endpoint):
    return json.loads(github(['api', endpoint]))


@cache
def local(revision):
    return subprocess.run(['git', 'cat-file', '-e', revision + '^{commit}'], cwd=ROOT,
                          stderr=subprocess.DEVNULL).returncode == 0


@cache
def tree(sha):
    return {entry['path']: entry for entry in api(f'repos/{REPOSITORY}/git/trees/{sha}')['tree']}


@cache
def entry(revision, path):
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('Invalid native source revision')
    if local(revision):
        line = git('ls-tree', revision, '--', path)
        return line.split()[2] if line else None
    current = revision
    for part in path.split('/'):
        record = tree(current).get(part)
        if record is None:
            return None
        current = record['sha']
    return current


@cache
def content(revision, path):
    if local(revision):
        return git('show', revision + ':' + path)
    return base64.b64decode(api(f'repos/{REPOSITORY}/git/blobs/{entry(revision, path)}')['content']).decode()


def native_toolchain(component, target, revision):
    owner = ROOT / 'agent/packaging/native-tools.py'
    spec = importlib.util.spec_from_file_location('native_tools', owner)
    tools = importlib.util.module_from_spec(spec); spec.loader.exec_module(tools)
    value = tools.contract(component, target, lambda path: content(revision, path))
    value['owner'] = entry(revision, 'agent/packaging/native-tools.py')
    return value


def go_sources(revision, directory):
    """Follow committed local replace directives without resolving/downloading Go."""
    seen = set()
    pending = [directory]
    while pending:
        current = pending.pop()
        if current in seen:
            continue
        seen.add(current)
        if entry(revision, current + '/go.mod') is None:
            raise ValueError('Unproven native Go module input: ' + current)
        module = content(revision, current + '/go.mod')
        for destination in re.findall(r'=>\s+("(?:\\.|[^"\\])*"|`[^`]*`|[^\s]+)', module):
            if destination.startswith('"'):
                try:
                    destination = json.loads(destination)
                except ValueError as error:
                    raise ValueError('Unproven quoted native Go replacement') from error
            elif destination.startswith('`'):
                raise ValueError('Unproven quoted native Go replacement')
            if destination.startswith('/'):
                raise ValueError('Native Go replacement lies outside the committed repository')
            if destination.startswith(('./', '../')):
                path = posixpath.normpath(posixpath.join(current, destination))
                if path == '..' or path.startswith('../'):
                    raise ValueError('Native Go replacement escapes its source tree')
                pending.append(path)
    return sorted(seen)


def go_pins(revision, sources):
    retained = json.loads(content(revision, 'auth/dependencies/go/sources.json'))
    locks, modules = {}, set()
    for directory in sources:
        path = directory + '/go.sum'
        if entry(revision, path) is None:
            continue
        text = content(revision, path)
        locks[path] = entry(revision, path)
        for line in text.splitlines():
            name, version, _ = line.split()
            modules.add((name, version.removesuffix('/go.mod')))
    # The shared manifest records which component lock actually selected each
    # source. Its other components and union lock digest are not native inputs.
    selected = [{key: value for key, value in item.items() if key != 'locks'}
                for item in retained['modules'] if (item['name'], item['version']) in modules]
    metadata = [item for item in retained['moduleMetadata'] if (item['name'], item['version']) in modules]
    return {'locks': locks, 'modules': selected, 'moduleMetadata': metadata}


@cache
def inputs(component, target, revision):
    if target not in TARGETS:
        raise ValueError('Unsupported native target')
    paths = ['LICENSE', 'agent/packaging/source_cache.py']
    records = {}
    if component == 'auth' or component.startswith('auth-'):
        job = 'assemble' if component == 'auth' else 'component'
        names = ('Assemble private runtime, notices and source',) if component == 'auth' else ('Native build prerequisites', 'Build tracked source for the target ABI')
        if component == 'auth':
            paths += ['auth/upstreams.lock.json', 'auth/build/assemble.py', 'agent/packaging/native-components.py',
                      'agent/packaging/native-worker.py']
            records['guard'] = inputs('runtime-guard', target, revision)
            # An aggregate may contain independently restored native components.
            records['components'] = {name: inputs('auth-' + name, target, revision) for name in AUTH}
        else:
            name = component.removeprefix('auth-')
            if name not in AUTH:
                raise ValueError('Unsupported authentication component')
            paths += ['agent/native/remote' if name == 'remote' else 'auth/' + name,
                      'auth/build/' + name + '.sh', 'auth/build/' + name + '-notices.py',
                      'auth/build/retained-sources.py', 'auth/build/TORKITTEN-LICENSE']
            lock = json.loads(content(revision, 'auth/upstreams.lock.json'))
            records['upstream'] = lock.get(name)
            if name in ('authelia', 'caddy', 'chisel', 'remote'):
                sources = go_sources(revision, 'agent/native/remote' if name == 'remote' else 'auth/' + name)
                paths += sources
                records['goPins'] = go_pins(revision, sources)
                paths += ['auth/build/go-env.sh', 'auth/build/go-notices.py', 'auth/dependencies/go-toolchain']
            if name == 'authelia':
                paths += ['auth/build/authelia-go.sh', 'auth/build/authelia-mobile-otp.patch', 'auth/build/frontend-notices.py',
                          'auth/dependencies/frontend']
            if target.startswith('termux-'):
                paths += ['auth/' + name + '-termux', 'auth/build/termux-component.sh', 'auth/build/termux-toolchain.json',
                          'auth/build/termux-go-version.patch']
                toolchain = json.loads(content(revision, 'auth/build/termux-toolchain.json'))
                retained = json.loads(content(revision, 'auth/dependencies/termux/sources.json'))
                records['termuxFramework'] = [{key: value for key, value in item.items() if key not in ('lock', 'lockSha256')}
                    for item in retained['components'] if item['sourceCommit'] == toolchain['commit']]
    elif component == 'runtime-guard':
        paths += ['agent/src/server/access/runtime-guard.c', 'agent/packaging/native-components.py']
        if target.startswith('termux-'):
            paths += ['agent/packaging/termux/native_toolchain.py', 'agent/vendor/node/libcxx']
            records['ndk'] = json.loads(content(revision, 'agent/packaging/node/lock.json'))['termux']['dependency_sources']['libc++']
    elif component == 'search-primp':
        if not target.startswith('termux-'):
            raise ValueError('Linux primp uses the pinned upstream wheel')
        lock = json.loads(content(revision, 'agent/search/runtime-lock.json'))
        package = next(item for item in lock['packages'] if item['name'] == 'primp')
        records.update(package=package['source'], version=package['version'], python=lock['python'][target],
                       framework={key: lock['termuxPackages'][key] for key in ('commit', 'builderImage', 'patches')}, rust=lock['rustRuntimeVersions'][target])
        retained = json.loads(content(revision, 'agent/search/vendor/sources/sources.json'))
        records['crates'] = [{key: item[key] for key in ('filename', 'sha256')} for item in retained['components'] if item['filename'].endswith('.crate')]
        paths += ['agent/packaging/native-components.py', 'agent/packaging/termux/search/python-primp',
                  'agent/search/build/termux-inputs.py', 'auth/build/retained-sources.py']
    elif component == 'search':
        paths += ['agent/search', 'agent/packaging/machines/build.py', 'auth/build/go-notices.py']
        job = 'termux' if target.startswith('termux-') else 'linux'
        if job == 'termux':
            paths += ['agent/packaging/termux/search', 'auth/build/retained-sources.py', 'auth/dependencies/termux']
        # All native commands and pinned Python setup are part of this owner.
        names = ('Extract retained Termux framework', 'Build Android/Bionic primp using the upstream Termux build system',
                 'Assemble Termux payload with private native binding', 'Assemble locked native runtime and source')
    elif component.startswith('machines-'):
        name = component.removeprefix('machines-')
        if name not in ('podman', 'crun', 'conmon', 'netavark', 'aardvark-dns', 'passt', 'libfuse', 'fuse-overlayfs', 'catatonit'):
            raise ValueError('Unsupported machine source unit')
        records['buildOwner'] = entry(revision, 'agent/packaging/machines/build.py')
        paths += ['agent/machines/vendor/' + name,
                  'agent/machines/patches/' + name, 'agent/machines/NOTICE',
                  'agent/machines/license-supplements']
        if name in ('netavark', 'aardvark-dns'):
            paths += ['agent/machines/rust-toolchain']
        if name == 'podman':
            paths += ['auth/build/go-notices.py', 'auth/dependencies/go-toolchain']
        if name == 'fuse-overlayfs':
            records['libfuse'] = inputs('machines-libfuse', target, revision)
    elif component in ('machines', 'display'):
        paths += (['agent/packaging/machines', 'agent/packaging/native-components.py', 'agent/machines/vendor', 'agent/machines/patches', 'agent/machines/license-supplements',
                   'agent/machines/rust-toolchain', 'agent/machines/NOTICE', 'auth/build/go-notices.py', 'auth/dependencies/go-toolchain']
                  if component == 'machines' else ['browser/taskarian/display', 'agent/packaging/machines/build.py',
                                                  'agent/machines/rust-toolchain', 'auth/build/go-notices.py'])
        if component == 'machines':
            paths.append('agent/packaging/native-worker.py')
    elif component in ('guest-sudo', 'guest-fusermount'):
        paths += ['agent/machines/build-guest-native.py', 'agent/packaging/machines/build.py',
                  'agent/machines/image-base.json', 'auth/build/go-notices.py']
        paths += (['agent/machines/guest/sudo-bridge', 'agent/machines/rust-toolchain'] if component == 'guest-sudo'
                  else ['agent/machines/vendor/libfuse'])
    elif component == 'guest':
        records['native'] = {name: inputs(name, target, revision) for name in ('guest-sudo', 'guest-fusermount')}
        records['os'] = inputs('os', target, revision)
        paths += ['os', 'agent/machines/guest', 'agent/machines/build-guest.py', 'agent/machines/vendor/libfuse',
                  'agent/machines/upstream/buzzard-runtime', 'agent/machines/NOTICE', 'agent/packaging/machines/build.py',
                  'agent/machines/rust-toolchain', 'agent/machines/image-base.json', 'auth/build/go-notices.py']
    elif component.startswith('os-'):
        unit = component[3:]
        names = {'dbusmenu': 'libdbusmenu', 'windowing': 'libxfce4windowing', 'panel': 'xfce4-panel'}
        if unit not in names or (unit == 'dbusmenu' and target.startswith('linux-')):
            raise ValueError('Unsupported native OS source unit for target')
        records['upstream'] = {key: value for key, value in next(item for item in json.loads(content(revision, 'os/upstream/sources.json')) if item['name'] == names[unit]).items() if key != 'files'}
        paths += ['os/upstream/' + names[unit], 'os/packaging/native.py',
                  'os/packaging/termux/build.sh', 'os/licenses']
        paths += ['os/patches/libdbusmenu'] if unit == 'dbusmenu' else ['os/patches'] if unit == 'panel' else []
        if target.startswith('linux-'):
            paths += ['agent/machines/image-base.json']
        else:
            lock = json.loads(content(revision, 'agent/packaging/node/lock.json'))['termux']
            records['framework'] = lock['recipes']; records['ndk'] = lock['dependency_sources']['libc++']
            paths += ['agent/packaging/termux/os.py']
        if unit == 'panel':
            records['windowing'] = inputs('os-windowing', target, revision)
            if target.startswith('termux-'):
                records['dbusmenu'] = inputs('os-dbusmenu', target, revision)
    elif component == 'os':
        paths += ['os', 'agent/packaging/termux/os.py', 'agent/packaging/native-components.py', 'auth/build/termux-toolchain.json']
        paths += ['browser/taskarian/browser/branding/assets/taskarian-logo-glasses-original.png']
        paths += [f'browser/taskarian/browser/branding/default{size}.png' for size in (48, 64, 128, 256)]
        records['native'] = {unit: inputs('os-' + unit, target, revision) for unit in
                             (('windowing', 'panel') if target.startswith('linux-') else ('dbusmenu', 'windowing', 'panel'))}
        if target.startswith('linux-'):
            paths += ['agent/machines/image-base.json']
        if target.startswith('termux-'):
            lock = json.loads(content(revision, 'agent/packaging/node/lock.json'))['termux']
            records['framework'] = lock['recipes']
            records['ndk'] = lock['dependency_sources']['libc++']
    elif component == 'loader':
        paths += ['browser/mobile/android/taskarian/display/loader',
                  'browser/mobile/android/taskarian/display/src/main/java/com/taskarian/display/DisplayProtocol.java',
                  'browser/taskarian/vendor/termux-x11/source.json',
                  'browser/taskarian/vendor/termux-x11/source/LICENSE']
        release = ast.parse(content(revision, 'agent/packaging/release.py'))
        certificate = next(ast.literal_eval(node.value) for node in release.body if isinstance(node, ast.Assign) and any(isinstance(value, ast.Name) and value.id == 'CERT' for value in node.targets))
        records['pairing'] = {'package': 'com.taskarian', 'publisherCertificateSha256': certificate,
                              'sdk': 37, 'buildTools': '37.0.0', 'java': 17}
    else:
        raise ValueError('Unsupported native component: ' + component)
    return {'schema': 1, 'component': component, 'target': target,
            'files': {path: entry(revision, path) for path in paths}, 'records': records,
            'recipe': native_toolchain(component, target, revision)}


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inventory(directory):
    result = {}
    paths = directory.glob('*') if (directory / 'SHA256SUMS').exists() else directory.rglob('*')
    for path in sorted(paths):
        if path.is_symlink():
            raise ValueError('Unexpected symlink in Actions component payload')
        if path.is_file() and not path.name.startswith('native-input-equivalence-'):
            if (directory / 'SHA256SUMS').exists() and path.parent != directory:
                continue
            result[str(path.relative_to(directory))] = sha(path)
    if not result:
        raise ValueError('Empty native component payload')
    return result


def receipt_name(component, target):
    return f'native-input-equivalence-{component}-{target}.json'


def embedded_sources(directory):
    """Producer revisions recorded by the native owners stay in their own files."""
    sources = set()
    for path in directory.glob('*.json'):
        if path.name.startswith('native-input-equivalence-'):
            continue
        data = json.loads(path.read_text())
        if isinstance(data, dict):
            sources.update(data[key] for key in ('sourceCommit', 'revision') if key in data)
    return sources


def verify_payload(directory, component, target):
    files = inventory(directory)
    for sums in directory.glob('SHA256SUMS'):
        seen = set()
        for line in sums.read_text().splitlines():
            digest, name = line.split('  ', 1)
            relative = Path(name.removeprefix('./'))
            if relative.is_absolute() or '..' in relative.parts or name in seen or files.get(str(relative)) != digest:
                raise ValueError('Invalid native component checksum: ' + name)
            seen.add(name)
    name = artifact_name(component, target)
    if component in ('auth', 'search'):
        suffix = 'tar.gz' if component == 'auth' else 'tar.zst'
        prefix = 'auth' if component == 'auth' else 'search-runtime'
        required = {f'{prefix}-{target}.{suffix}', f'{component}-source-{target}.{suffix}' if component == 'search' else f'auth-{target}-source.tar.gz', 'SHA256SUMS'}
    elif component.startswith('auth-'):
        required = {'component.tar.gz'}
    elif component.startswith('machines-'):
        name = component.removeprefix('machines-')
        if name not in ('podman', 'crun', 'conmon', 'netavark', 'aardvark-dns', 'passt', 'libfuse', 'fuse-overlayfs', 'catatonit'):
            raise ValueError('Unsupported machine source unit')
        required = {f'machines-{name}-{target}.tar.gz', 'SHA256SUMS'}
    elif component in ('machines', 'display'):
        required = {name + '.tar.gz', 'SHA256SUMS'}
    elif component == 'loader':
        required = {'taskarian-x11', 'taskarian-x11-loader.jar', 'manifest.json'}
    else:
        packages = list(directory.glob('*.deb'))
        if len(packages) != (2 if component == 'guest' else 1):
            raise ValueError('Incomplete native package artifact')
        required = {p.name for p in packages} | {p.name + '.json' for p in packages}
    if not required.issubset(files):
        raise ValueError('Incomplete native artifact inventory: ' + name)
    architecture = target.split('-', 1)[1]
    machine = 62 if architecture in ('amd64', 'x86_64') else 183
    archive_metadata = []
    for path in directory.glob('*.tar.*'):
        if '-source' in path.name:
            continue
        unpacked = None
        if path.name.endswith('.zst'):
            unpacked = tempfile.TemporaryFile()
            subprocess.run(['zstd', '-dc', str(path)], stdout=unpacked, stderr=subprocess.PIPE, check=True)
            unpacked.seek(0)
        with tarfile.open(fileobj=unpacked, name=None if unpacked else path, mode='r:*') as archive:
            members = {item.name.removeprefix('./'): item for item in archive.getmembers()}
            for name, item in members.items():
                if name in ('machines/manifest.json', 'display/manifest.json', 'search/runtime/manifest.json', 'share/metadata/runtime.json') and item.isfile():
                    value = json.load(archive.extractfile(item))
                    if isinstance(value, dict) and ('sourceCommit' in value or 'target' in value or 'architecture' in value):
                        archive_metadata.append(value)
            if component.startswith('auth-'):
                executable = {'remote': 'taskarian-remote', 'valkey': 'valkey-server'}.get(component[5:], component[5:])
                binary = members.get('bin/' + executable)
                if not binary or not binary.mode & 0o111:
                    raise ValueError('Missing native authentication executable')
                header = archive.extractfile(binary).read(20)
                if header[:6] != b'\x7fELF\x02\x01' or struct.unpack('<H', header[18:20])[0] != machine:
                    raise ValueError('Native authentication ELF target mismatch')
                if not any(name.startswith('share/licenses/') and member.isfile() and member.size
                           for name, member in members.items()):
                    raise ValueError('Missing native component licenses')
        if unpacked:
            unpacked.close()
    for metadata in archive_metadata:
        if metadata.get('target', target) != target or metadata.get('architecture', architecture) != architecture:
            raise ValueError('Native component target mismatch')
    for deb in directory.glob('*.deb'):
        metadata = json.loads(Path(str(deb) + '.json').read_text())
        fields = subprocess.check_output(['dpkg-deb', '-f', str(deb), 'Architecture'], text=True).strip()
        if fields != architecture or metadata.get('architecture', architecture) != architecture:
            raise ValueError('Native Debian package architecture mismatch')
        if metadata.get('sha256', sha(deb)) != sha(deb):
            raise ValueError('Native Debian package checksum mismatch')
    return files, embedded_sources(directory) | {data['sourceCommit'] for data in archive_metadata if 'sourceCommit' in data}


def verify_store_receipt(directory, component, target, requested, expected, producer=None):
    path = Path(directory) / receipt_name(component, target)
    value = json.loads(path.read_text())
    spec = importlib.util.spec_from_file_location('native_store', ROOT / 'agent/packaging/component-store.py')
    store = importlib.util.module_from_spec(spec); spec.loader.exec_module(store)
    record = value['store']; manifest = record['manifest']
    ident = store.identity(component, target, expected); store.validate(manifest, ident)
    digest = __import__('hashlib').sha256(store.canonical(manifest) + b'\n').hexdigest()
    if (value.get('requestedSource') != requested or value.get('inputs') != expected or
            value.get('producerSource') != manifest['sourceCommit'] or
            record.get('repository') != ident['repository'] or record.get('manifestName') != ident['manifest'] or
            record.get('manifestSha256') != digest or not value.get('files')):
        raise ValueError('Native durable component receipt does not match requested inputs')
    selected = {asset['name']: asset['sha256'] for asset in manifest['assets']}
    if any(selected.get(name) != checksum or sha(Path(directory) / name) != checksum
           for name, checksum in value['files'].items()):
        raise ValueError('Native durable component bytes do not match their original manifest')
    if producer is not None and producer != manifest['sourceCommit']:
        # Guest packaging includes an independently retained OS package. Its
        # native owner, not this aggregate's assembly revision, produced it.
        owned = False
        if component == 'guest':
            for name in value['files']:
                if not name.endswith('.deb.json'):
                    continue
                metadata = json.loads((Path(directory) / name).read_text())
                package = name.removesuffix('.json')
                package_sha = metadata.get('sha256')
                sidecar = package + '.sha256'
                if package_sha is None and sidecar in value['files']:
                    parts = (Path(directory) / sidecar).read_text().strip().split('  ', 1)
                    if len(parts) == 2 and parts[1] == package:
                        package_sha = parts[0]
                if (metadata.get('revision', metadata.get('sourceCommit')) == producer and
                        metadata.get('file', package) == package and
                        package in value['files'] and package_sha == value['files'][package]):
                    owned = True
                    break
        if not owned:
            raise ValueError('Native producer is not recorded by the checked component payload')
    return value


def verify_equivalence(directory, component, target, requested, producer=None):
    """Assembly accepts a different revision only with independently checked inputs."""
    if producer == requested:
        return None
    path = directory / receipt_name(component, target)
    value = json.loads(path.read_text())
    if value.get('store'):
        return verify_store_receipt(directory, component, target, requested, inputs(component, target, requested), producer)
    actual = inventory(directory)
    # Other components (notably the current backend guest .deb) may be merged
    # beside this artifact. Check exactly the original producer inventory.
    expected_files = value.get('files', {})
    if not expected_files or any(actual.get(name) != digest for name, digest in expected_files.items()):
        raise ValueError('Native equivalence receipt does not cover its producer bytes')
    original, requested_inputs = value.get('producerSource', ''), inputs(component, target, requested)
    if (value.get('schema') != 1 or value.get('component') != component or value.get('target') != target or
            value.get('requestedSource') != requested or value.get('repository') != REPOSITORY or
            (producer is not None and producer != original) or
            value.get('inputs') != requested_inputs or inputs(component, target, original) != requested_inputs):
        raise ValueError('Native producer and requested build inputs are different')
    return value


def artifact_name(component, target):
    if component.startswith('auth-'):
        return f'auth-component-{component[5:]}-{target}'
    return {'auth': 'auth-' + target, 'search': 'search-runtime-' + target,
            'machines': 'machines-runtime-' + target, 'display': 'display-runtime-' + target,
            'guest': 'guest-packages-' + target, 'os': 'os-' + target,
            'loader': 'display-loader-termux'}[component]


def restore(directory, component, target, requested, selected=None):
    spec = importlib.util.spec_from_file_location('native_component_owner', ROOT / 'agent/packaging/native-components.py')
    owner = importlib.util.module_from_spec(spec); spec.loader.exec_module(owner)
    return owner.restore_component(component, target, directory) is not None


def output(name, value):
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            stream.write(f'{name}={value}\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['restore', 'plan-auth', 'verify', 'materialize'])
    parser.add_argument('component')
    parser.add_argument('target')
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--force', default='false')
    parser.add_argument('--artifact', type=int)
    parser.add_argument('--output-name', default='hit')
    args = parser.parse_args()
    revision = git('rev-parse', 'HEAD')
    if args.action == 'materialize':
        try:
            paths = set(inputs(args.component, args.target, revision)['files'])
        except ValueError:
            # Unknown optional input syntax cannot block the established build.
            subprocess.run(['git', 'sparse-checkout', 'set', 'auth', 'agent/native/remote',
                            'agent/packaging', 'agent/src/server/access'], cwd=ROOT,
                           env={**os.environ, 'GIT_LFS_SKIP_SMUDGE': '1'}, check=True)
            return
        paths.update(('agent/packaging', '.github/workflows', 'auth/upstreams.lock.json'))
        if args.component.startswith('auth-'):
            name = args.component[5:]
            if name in ('authelia', 'caddy', 'chisel', 'remote'):
                retained = json.loads(content(revision, 'auth/dependencies/go/sources.json'))
                paths.update(retained['locks'])
                paths.add('auth/dependencies/go')
            if name == 'authelia':
                paths.add('auth/dependencies/frontend')
            if args.target.startswith('termux-'):
                paths.add('auth/dependencies/termux')
        # Non-cone patterns select individual shared lock files without checking
        # out every unrelated source tree below their common parent directory.
        patterns = ['/*', '!/*/']
        patterns += ['/' + path for path in sorted(paths) if entry(revision, path) is not None]
        subprocess.run(['git', 'sparse-checkout', 'set', '--no-cone', '--stdin'], cwd=ROOT,
                       input='\n'.join(patterns) + '\n', text=True,
                       env={**os.environ, 'GIT_LFS_SKIP_SMUDGE': '1'}, check=True)
    elif args.action == 'plan-auth':
        targets = TARGETS if args.target == 'all' else (args.target,)
        components = AUTH if args.component == 'all' else (args.component,)
        missing, restores = [], []
        for target in targets:
            candidate = None
            if args.component == 'all' and args.force != 'true':
                try:
                    spec = importlib.util.spec_from_file_location('native_plan_owner', ROOT / 'agent/packaging/native-components.py')
                    owner = importlib.util.module_from_spec(spec); spec.loader.exec_module(owner)
                    candidate = owner.store.lookup('auth', target, owner.inputs('auth', target))
                except (subprocess.CalledProcessError, ValueError, KeyError) as error:
                    print(f'No provable auth artifact: {error}; building normally', flush=True)
            if candidate:
                restores.append({'target': target})
            else:
                missing.append(target)
        output('targets', json.dumps(missing, separators=(',', ':')))
        output('restores', json.dumps({'include': restores}, separators=(',', ':')))
        output('restore', str(bool(restores)).lower())
        output('matrix', json.dumps({'include': [{'component': component, 'target': target}
                    for target in missing for component in components]}, separators=(',', ':')))
        output('build', str(bool(missing)).lower())
    elif args.action == 'restore':
        hit = False
        if args.force != 'true':
            try:
                hit = restore(args.directory, args.component, args.target, revision, args.artifact)
            except (subprocess.CalledProcessError, ValueError, KeyError) as error:
                print(f'No provable native artifact: {error}; building normally', flush=True)
        output(args.output_name, str(hit).lower())
    elif args.action == 'verify':
        verify_payload(args.directory, args.component, args.target)
        verify_equivalence(args.directory, args.component, args.target, revision)


if __name__ == '__main__':
    main()
