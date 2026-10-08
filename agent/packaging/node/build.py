#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Assemble pinned upstream Node LTS distributions into private native components."""
import argparse
import concurrent.futures
import contextlib
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
LOCK = json.loads((HERE / 'lock.json').read_text())
ANDROID_SYSTEM = {'libc.so', 'libm.so', 'libdl.so', 'liblog.so', 'libandroid.so'}


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def fetch(record, cache):
    name = record['url'].rsplit('/', 1)[-1]
    result = cache / (record['sha256'] + '-' + name)
    if result.exists() and sha256(result) == record['sha256']:
        return result
    print('Downloading ' + record['url'], flush=True)
    with tempfile.NamedTemporaryFile(dir=cache, delete=False) as temporary:
        incoming = Path(temporary.name)
        try:
            request = urllib.request.Request(record['url'], headers={'User-Agent': 'BashKitten-Node-Builder/1'})
            with urllib.request.urlopen(request, timeout=120) as response:
                shutil.copyfileobj(response, temporary)
            temporary.flush()
            if sha256(incoming) != record['sha256']:
                raise RuntimeError('SHA256 mismatch: ' + record['url'])
            incoming.replace(result)
        finally:
            incoming.unlink(missing_ok=True)
    return result


def extract(archive, destination):
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as source:
        source.extractall(destination, filter='data')


def archive(root, output):
    """Stable metadata and ordering; source artifacts retain original archives."""
    with output.open('wb') as raw:
        with gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0, compresslevel=1) as compressed:
            with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.PAX_FORMAT) as target:
                for path in [root, *sorted(root.rglob('*'))]:
                    member = target.gettarinfo(str(path), str(path.relative_to(root.parent)))
                    member.uid = member.gid = member.mtime = 0
                    member.uname = member.gname = ''
                    with path.open('rb') if member.isfile() else contextlib.nullcontext() as contents:
                        target.addfile(member, contents)


def notice(name, version, license_name, text, source):
    if not text.strip():
        raise RuntimeError('Empty license notice: ' + name)
    return {'name': name, 'version': version, 'license': license_name, 'text': text, 'source': source}


def npm_dependency_notices(npm):
    """Collect the exact vendored package inventory, including nested/scoped packages."""
    notices = {}
    for package_json in sorted(npm.rglob('package.json')):
        package = package_json.parent
        parts = package.relative_to(npm).parts
        if 'node_modules' not in parts:
            continue
        last_modules = max(i for i, value in enumerate(parts) if value == 'node_modules')
        tail = parts[last_modules + 1:]
        if len(tail) != (2 if tail[0].startswith('@') else 1):
            continue
        metadata = json.loads(package_json.read_text())
        identity = metadata['name'] + '@' + metadata['version']
        texts = []
        for path in sorted(package.rglob('*')):
            if (path.is_file() and 'node_modules' not in path.relative_to(package).parts
                    and re.match(r'^(licen[cs]e|notice|copying)([-.].*)?$', path.name, re.I)):
                texts.append(str(path.relative_to(package)) + '\n\n' + path.read_text(errors='replace'))
        supplements = LOCK.get('npm_license_supplements', {}).get(identity, [])
        if not texts and not supplements:
            raise RuntimeError('Vendored npm dependency lacks a pinned license notice: ' + identity)
        for supplement in supplements:
            path = HERE / supplement['file']
            if sha256(path) != supplement['sha256']:
                raise RuntimeError('License supplement checksum mismatch: ' + str(path))
            texts.append('Supplemental license text from ' + supplement['url'] + '\n\n' + path.read_text())
        attribution = '\n'.join(f'{key}: {json.dumps(metadata[key], ensure_ascii=False)}'
                                for key in ('name', 'version', 'author', 'contributors', 'license') if key in metadata)
        text = attribution + '\n\n' + '\n\n'.join(texts)
        entry = notice(metadata['name'], metadata['version'], metadata.get('license', 'See notice'),
                       text, 'https://registry.npmjs.org/' + metadata['name'] + '/' + metadata['version'])
        if identity in notices and notices[identity]['text'] != text:
            raise RuntimeError('Conflicting vendored notices for ' + identity)
        notices[identity] = entry
    return list(notices.values())


def read_license(archive_path, suffixes):
    if zipfile.is_zipfile(archive_path):
        with zipfile.ZipFile(archive_path) as source:
            for suffix in suffixes:
                matching = [name for name in source.namelist() if name.endswith(suffix)]
                if matching:
                    return source.read(sorted(matching, key=len)[0]).decode('utf-8', errors='replace')
    else:
        with tarfile.open(archive_path) as source:
            for suffix in suffixes:
                matching = [member for member in source if member.isfile() and member.name.endswith(suffix)]
                if matching:
                    return source.extractfile(sorted(matching, key=lambda m: len(m.name))[0]).read().decode('utf-8', errors='replace')
    raise RuntimeError('License missing from ' + str(archive_path))


def npm_wrappers(root, platform):
    shell = '/system/bin/sh' if platform == 'termux' else '/bin/sh'
    native_exec = '''if [ "${TERMUX_EXEC__SYSTEM_LINKER_EXEC__MODE:-}" != disable ]; then
  export TERMUX_EXEC__SYSTEM_LINKER_EXEC__MODE=disable
  exec /system/bin/sh "$0" "$@"
fi
''' if platform == 'termux' else ''
    for command in ['npm', 'npx']:
        wrapper = root / 'bin' / command
        wrapper.unlink(missing_ok=True)
        wrapper.write_text(f'''#!{shell}
set -eu
{native_exec}node_bin=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PATH="$node_bin:$PATH"
export OPENSSL_CONF="$node_bin/../etc/openssl.cnf"
exec "$node_bin/node" "$node_bin/../lib/node_modules/npm/bin/{command}-cli.js" "$@"
''')
        wrapper.chmod(0o755)


def validate_elf(path, architecture):
    with path.open('rb') as stream:
        header = stream.read(64)
    if header[:6] != b'\x7fELF\x02\x01':
        raise RuntimeError('Not a native little-endian ELF64: ' + str(path))
    expected = 62 if architecture in ('amd64', 'x86_64') else 183
    if struct.unpack_from('<H', header, 18)[0] != expected:
        raise RuntimeError('Wrong CPU architecture: ' + str(path))


def termux_runtime(root, selected, architecture, cache, temporary):
    prefixes = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        downloads = list(pool.map(lambda record: fetch(record, cache), selected))
    for package, downloaded in zip(selected, downloads):
        unpacked = temporary / ('deb-' + package['name'])
        subprocess.run(['dpkg-deb', '-x', str(downloaded), str(unpacked)], check=True)
        prefixes[package['name']] = unpacked / 'data/data/com.termux/files/usr'
    shutil.copy2(prefixes['nodejs-lts'] / 'bin/node', root / 'bin/node')
    shutil.copytree(prefixes['nodejs-lts'] / 'include', root / 'include', symlinks=True)
    shutil.copytree(prefixes['npm'] / 'lib/node_modules/npm', root / 'lib/node_modules/npm', symlinks=True)
    # Copy only Node's recursive DT_NEEDED closure, preserving upstream SONAME links.
    available = {}
    for prefix in prefixes.values():
        library_dir = prefix / 'lib'
        if library_dir.exists():
            for candidate in library_dir.glob('*.so*'):
                available[candidate.name] = candidate
    pending = [root / 'bin/node']
    visited = set()
    while pending:
        path = pending.pop()
        if path in visited:
            continue
        visited.add(path)
        validate_elf(path, architecture)
        needed = subprocess.check_output(['patchelf', '--print-needed', str(path)], text=True).splitlines()
        for name in needed:
            if name in ANDROID_SYSTEM:
                continue
            if name not in available:
                raise RuntimeError(f'Unbundled Android dependency {name} required by {path}')
            source = available[name]
            real = source.resolve()
            target = root / 'lib' / real.name
            if not target.exists():
                shutil.copy2(real, target)
                pending.append(target)
            alias = root / 'lib' / name
            if alias != target and not alias.exists():
                alias.symlink_to(target.name)
        # Android resolves each object's own RUNPATH; never contaminate child programs.
        subprocess.run(['patchelf', '--page-size', '16384', '--set-rpath',
                        '$ORIGIN/../lib' if path.name == 'node' else '$ORIGIN', str(path)], check=True)
    return prefixes, downloads


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform', choices=['linux', 'termux'], required=True)
    parser.add_argument('--architecture', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    record = LOCK[args.platform]
    choices = record['archives'] if args.platform == 'linux' else record['architectures']
    if args.architecture not in choices:
        parser.error('architecture must be one of ' + ', '.join(choices))
    cache = Path(os.environ.get('BASHKITTEN_NODE_CACHE', '~/.cache/bashkitten-node')).expanduser()
    cache.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    identity = f'{args.platform}-{args.architecture}'
    with tempfile.TemporaryDirectory(prefix='node-build-', dir=cache) as directory:
        temporary = Path(directory)
        root = temporary / 'node'
        (root / 'bin').mkdir(parents=True)
        (root / 'lib').mkdir()
        (root / 'etc').mkdir()
        # Explicitly use OpenSSL's built-in default provider. A private file prevents
        # Termux's compiled global prefix from deciding this application's config.
        (root / 'etc/openssl.cnf').write_text('openssl_conf = openssl_init\n'
            '[openssl_init]\nproviders = providers\n[providers]\ndefault = default\n'
            '[default]\nactivate = 1\n')
        source = temporary / 'node-source'
        source.mkdir()
        shutil.copytree(HERE, source / 'recipe', ignore=shutil.ignore_patterns('__pycache__'))
        sources = [record['source']]
        notices = []
        packages = []
        if args.platform == 'linux':
            runtime_archive = fetch(choices[args.architecture], cache)
            extract(runtime_archive, temporary / 'upstream')
            upstream = next((temporary / 'upstream').iterdir())
            shutil.copy2(upstream / 'bin/node', root / 'bin/node')
            shutil.copytree(upstream / 'include', root / 'include', symlinks=True)
            shutil.copytree(upstream / 'lib/node_modules/npm', root / 'lib/node_modules/npm', symlinks=True)
            notices.append(notice('Node.js', record['node_version'], 'MIT',
                                  (upstream / 'LICENSE').read_text(), record['source']['url']))
            depends = ['libc6 (>= 2.28)', 'libstdc++6', 'libgcc-s1']
            inputs = [choices[args.architecture]]
        else:
            selected = choices[args.architecture]['packages']
            prefixes, downloads = termux_runtime(root, selected, args.architecture, cache, temporary)
            notices.append(notice('Node.js', record['node_version'], 'MIT',
                (prefixes['nodejs-lts'] / 'share/doc/nodejs-lts/copyright').read_text(), record['source']['url']))
            sources.extend(record['dependency_sources'].values())
            sources.append(record['recipes'])
            recipe_license = (HERE / 'licenses/Termux-packages-LICENSE.md').read_text()
            recipe_license += '\n\n' + (HERE / 'licenses/Apache-2.0.txt').read_text()
            notices.append(notice('Termux packaging', record['recipe_commit'],
                'Apache-2.0 AND package-specific', recipe_license, record['recipes']['url']))
            depends = ['ca-certificates', 'resolv-conf']
            inputs = selected
            for package in selected:
                if package['name'] in ('nodejs-lts', 'npm'):
                    continue
                dependency = record['dependency_sources'][package['name']]
                local_notice = {
                    'c-ares': 'share/doc/c-ares/copyright', 'libicu': 'share/doc/libicu/LICENSE',
                    'zlib': 'share/doc/zlib/copyright',
                }.get(package['name'])
                if local_notice:
                    license_text = (prefixes[package['name']] / local_notice).read_text()
                elif package['name'] == 'libsqlite':
                    # The public-domain dedication is also retained in the complete source archive.
                    license_text = read_license(fetch(dependency, cache), ['/LICENSE.md'])
                else:
                    suffixes = ['/NOTICE'] if package['name'] == 'libc++' else ['/LICENSE.txt']
                    license_text = read_license(fetch(dependency, cache), suffixes)
                notices.append(notice(package['name'], package['version'], dependency['license'],
                                      license_text, dependency['url']))
        npm = root / 'lib/node_modules/npm'
        npm_metadata = json.loads((npm / 'package.json').read_text())
        if npm_metadata['version'] != record['npm_version']:
            raise RuntimeError('npm version differs from lock')
        notices.append(notice('npm', record['npm_version'], 'Artistic-2.0',
                              (npm / 'LICENSE').read_text(), 'https://github.com/npm/cli'))
        notices.extend(npm_dependency_notices(npm))
        # npm carries its complete dependency source and notices in the runtime and source archive.
        shutil.copytree(npm, source / 'npm', symlinks=True)
        npm_wrappers(root, args.platform)
        validate_elf(root / 'bin/node', args.architecture)
        (root / 'licenses').mkdir()
        for index, entry in enumerate(notices):
            (root / 'licenses' / f'{index:02d}.txt').write_text(entry['text'])
            packages.append({key: entry[key] for key in ('name', 'version', 'license', 'source')})
        metadata = {'schema': 1, 'platform': args.platform, 'architecture': args.architecture,
                    'node_version': record['node_version'], 'npm_version': record['npm_version'],
                    'packages': packages, 'depends': depends, 'inputs': inputs,
                    'recipe_commit': record.get('recipe_commit'),
                    'android_system_libraries': sorted(ANDROID_SYSTEM) if args.platform == 'termux' else []}
        (root / 'manifest.json').write_text(json.dumps(metadata, indent=2) + '\n')
        (root / 'licenses.json').write_text(json.dumps(notices, indent=2) + '\n')
        runtime_output = args.output / f'node-runtime-{identity}.tar.gz'
        archive(root, runtime_output)
        print('Runtime ready: ' + str(runtime_output), flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            downloads = list(pool.map(lambda item: fetch(item, cache), sources))
        (source / 'archives').mkdir()
        for item, downloaded in zip(sources, downloads):
            if args.platform == 'termux' and item == record['dependency_sources']['libc++']:
                # Preserve only the permissive runtime input we redistribute, not
                # unrelated NDK host tools with their own source obligations.
                ndk = source / 'libcxx-ndk-input'
                ndk.mkdir()
                triple = 'x86_64-linux-android' if args.architecture == 'x86_64' else 'aarch64-linux-android'
                member = 'android-ndk-r30/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib/' + triple + '/libc++_shared.so'
                with zipfile.ZipFile(downloaded) as contents:
                    (ndk / 'libc++_shared.so').write_bytes(contents.read(member))
                    (ndk / 'NOTICE').write_bytes(contents.read('android-ndk-r30/NOTICE'))
                    (ndk / 'LLVM-NOTICE').write_bytes(contents.read('android-ndk-r30/toolchains/llvm/prebuilt/linux-x86_64/NOTICE'))
                (ndk / 'provenance.json').write_text(json.dumps({**item, 'archive_member': member,
                    'member_sha256': sha256(ndk / 'libc++_shared.so')}, indent=2) + '\n')
                continue
            # Content-addressed filenames avoid collisions and preserve upstream compressed inputs.
            os.link(downloaded, source / 'archives' / downloaded.name)
        (source / 'sources.json').write_text(json.dumps(sources, indent=2) + '\n')
        (source / 'component.json').write_text(json.dumps(metadata, indent=2) + '\n')
        source_output = args.output / f'node-source-{identity}.tar.gz'
        archive(source, source_output)
        # Per-artifact sidecars support concurrent matrix builders; merge when assembling release.
        checksums = [(output.name, sha256(output)) for output in (runtime_output, source_output)]
        with (args.output / '.checksums.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            for name, digest in checksums:
                (args.output / (name + '.sha256')).write_text(digest + '  ' + name + '\n')
            checksum_files = sorted(args.output.glob('node-*.tar.gz.sha256'))
            checksum_text = ''.join(path.read_text() for path in checksum_files)
            sums_temporary = args.output / ('SHA256SUMS.' + identity)
            sums_temporary.write_text(checksum_text)
            sums_temporary.replace(args.output / 'SHA256SUMS')
        print('Source ready: ' + str(source_output), flush=True)


if __name__ == '__main__':
    main()
