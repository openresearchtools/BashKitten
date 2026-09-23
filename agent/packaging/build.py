#!/usr/bin/env python3
"""Assemble the complete Linux or native Termux package from CI component artifacts."""
import argparse
import configparser
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

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = ROOT.parent


def run(command, **kwargs):
    return subprocess.run(command, check=True, **kwargs)


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read_json(path):
    return json.loads(path.read_text())


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def checked_archive(path):
    require(path.is_file() and not path.is_symlink(), f'Missing component archive: {path}')
    sums = path.parent / 'SHA256SUMS'
    require(sums.is_file(), f'Missing component checksums: {sums}')
    expected = []
    for line in sums.read_text().splitlines():
        fields = line.split(maxsplit=1)
        if len(fields) == 2 and fields[1].lstrip('*').removeprefix('./') == path.name:
            expected.append(fields[0])
    digest = sha(path)
    require(expected == [digest], f'Component checksum mismatch: {path.name}')
    return digest


def extract(archive, destination):
    """Extract trusted, checksummed build inputs with tar's path/link restrictions."""
    destination.mkdir(parents=True, exist_ok=True)
    if archive.name.endswith('.zst'):
        with subprocess.Popen(['zstd', '-dc', '--', str(archive)], stdout=subprocess.PIPE) as decompressor:
            with tarfile.open(fileobj=decompressor.stdout, mode='r|') as contents:
                contents.extractall(destination, filter='data')
            require(decompressor.wait() == 0, f'Cannot decompress {archive}')
    else:
        with tarfile.open(archive) as contents:
            contents.extractall(destination, filter='data')


def key_values(path):
    return dict(line.split('=', 1) for line in path.read_text().splitlines()
                if '=' in line and not line.lstrip().startswith('#'))


def dependencies(*groups):
    result = []
    for group in groups:
        for item in group:
            require(isinstance(item, str) and item.strip() and '\n' not in item and '\r' not in item,
                    'Invalid dependency metadata')
            if item.strip() not in result:
                result.append(item.strip())
    return result


def elf_payload(root, architecture, termux):
    """Reject another CPU's native binaries and unaligned Android executable loads."""
    count = 0
    machine = 62 if architecture == 'amd64' else 183
    for path in root.rglob('*'):
        if path.is_symlink() or not path.is_file():
            continue
        with path.open('rb') as stream:
            header = stream.read(64)
            if not header.startswith(b'\x7fELF'):
                continue
            require(len(header) == 64 and header[4:6] == bytes([2, 1]), f'Unsupported ELF format: {path}')
            require(struct.unpack_from('<H', header, 18)[0] == machine, f'Wrong ELF architecture: {path}')
            count += 1
            if not termux:
                continue
            offset = struct.unpack_from('<Q', header, 32)[0]
            entry_size, entries = struct.unpack_from('<HH', header, 54)
            require(not entries or entry_size >= 56, f'Invalid ELF program headers: {path}')
            for index in range(entries):
                stream.seek(offset + index * entry_size)
                program = stream.read(56)
                require(len(program) == 56, f'Truncated ELF program header: {path}')
                if struct.unpack_from('<I', program)[0] == 1:
                    alignment = struct.unpack_from('<Q', program, 48)[0]
                    file_offset, virtual_address = struct.unpack_from('<QQ', program, 8)
                    require(alignment >= 16384 and (virtual_address - file_offset) % 16384 == 0,
                            f'Termux executable needs 16 KB page alignment: {path}')
    require(count > 0, 'Package contains no native component payload')
    return count


def executable(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    path.chmod(0o755)


def package_browser(args, app, stage, version, auth):
    require(args.browser_dir is not None, 'Linux packages require --browser-dir')
    directory = args.browser_dir.resolve()
    manifest = directory / 'browser-artifact-manifest.txt'
    metadata = key_values(manifest)
    require(metadata.get('architecture') == args.architecture, 'Browser architecture mismatch')
    require(metadata.get('product_version') == version, 'Browser product version mismatch')
    archives = [p for p in directory.glob('bashkitten*.tar.*') if p.is_file()]
    require(len(archives) == 1, 'Expected one BashKitten browser archive')
    archive = archives[0]
    digest = checked_archive(archive)
    checked_archive(manifest)
    extracted = stage.parent / 'browser-input'
    extract(archive, extracted)
    require({p.name for p in extracted.iterdir()} == {'bashkitten'}, 'Browser archive must contain one bashkitten directory')
    browser = extracted / 'bashkitten'
    require((browser / 'bashkitten').is_file(), 'Browser archive has no BashKitten executable')
    ini = configparser.ConfigParser()
    ini.read(browser / 'application.ini')
    require(ini.get('App', 'Version', fallback='') in {version, metadata.get('firefox_version')},
            'Browser application.ini version differs from component metadata')
    for obsolete in ['runtime/torrent', 'runtime/jackett-mini', 'runtime/search', 'runtime/pi-web']:
        require(not (browser / obsolete).exists(), f'Obsolete component remains in browser: {obsolete}')
    shutil.move(str(browser), app / 'browser')
    browser = app / 'browser'
    tor = browser / 'runtime/tor'
    require(not tor.exists(), 'Browser archive must defer Tor payload to final assembly')
    tor.mkdir(parents=True)
    (tor / 'tor').symlink_to('../../../auth/bin/tor')
    # The browser client and backend publisher use distinct processes/configuration.
    auth_metadata = read_json(auth / 'share/metadata/runtime.json')
    tor_metadata = next(item for item in auth_metadata['components'] if item['name'] == 'tor')
    require(tor_metadata['sha256'] == sha(auth / 'bin/tor'), 'Tor runtime provenance does not match its binary')
    write_json(tor / 'tor.json', {**tor_metadata, 'target': auth_metadata['target'],
                                'architecture': auth_metadata['architecture']})
    executable(stage / 'usr/bin/bashkitten', '#!/bin/sh\nexec /usr/lib/bashkitten/browser/bashkitten "$@"\n')
    desktop = stage / 'usr/share/applications/com.bashkitten.desktop'
    desktop.parent.mkdir(parents=True, exist_ok=True)
    desktop.write_text('[Desktop Entry]\nName=BashKitten\nComment=Browser and native Pi coding agent\n'
                       'Exec=bashkitten %u\nIcon=com.bashkitten\nTerminal=false\nType=Application\n'
                       'Categories=Network;WebBrowser;Development;\nStartupNotify=true\n'
                       'MimeType=text/html;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;\n')
    for size in (16, 22, 24, 32, 48, 64, 128, 256, 512):
        icon = REPOSITORY / f'browser/bashkitten/browser/branding/default{size}.png'
        require(icon.is_file(), 'Missing BashKitten desktop icon')
        installed_icon = stage / f'usr/share/icons/hicolor/{size}x{size}/apps/com.bashkitten.png'
        installed_icon.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(icon, installed_icon)
    provenance = app / 'components/browser'
    provenance.mkdir(parents=True)
    for name in ['browser-artifact-manifest.txt', 'browser-build-manifest.txt', 'SHA256SUMS']:
        require((directory / name).is_file(), f'Missing browser provenance: {name}')
        shutil.copy2(directory / name, provenance / name)
    run(['python3', str(REPOSITORY / 'browser/bashkitten/scripts/generate-third-party-notices.py'),
         '--browser-dir', str(browser), '--json-output', str(browser / 'notices/licenses.json')])
    return {'archive': archive.name, 'sha256': digest, **metadata}


def assemble(args):
    termux = args.target == 'termux'
    require(args.architecture in (['aarch64'] if termux else ['amd64', 'arm64']), 'Architecture does not match target')
    require(not termux or args.browser_dir is None, 'The Termux package does not include an Android browser')
    target = args.target + '-' + args.architecture
    prefix = '/data/data/com.termux/files/usr' if termux else '/usr'
    shell = prefix + '/bin/sh' if termux else '/bin/sh'
    version = (REPOSITORY / 'browser/bashkitten/config/version.txt').read_text().strip()
    require(re.fullmatch(r'\d+\.\d+(?:\.\d+)?', version), 'Invalid Firefox-aligned product version')
    package = read_json(ROOT / 'package.json')
    lock = read_json(ROOT / 'package-lock.json')
    npm_version = version if version.count('.') == 2 else version + '.0'
    require(package['version'] == lock['version'] == lock['packages']['']['version'] == npm_version,
            'Product and Agent package versions must agree')
    lock_hash = sha(ROOT / 'package-lock.json')
    pi_version = package['dependencies']['@earendil-works/pi-coding-agent']
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPOSITORY, text=True).strip()
    epoch = subprocess.check_output(['git', 'log', '-1', '--format=%ct'], cwd=REPOSITORY, text=True).strip()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    stage_parent = args.stage_dir.resolve() if args.stage_dir else output
    stage_parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='bashkitten-package-', dir=stage_parent) as temporary:
        stage = Path(temporary) / 'root'
        app = stage / prefix.lstrip('/') / 'lib/bashkitten'
        app.mkdir(parents=True)
        for folder in ['src/server', 'src/web', 'reference', 'licenses', 'pi']:
            require((ROOT / folder).is_dir(), f'Missing product payload: {folder}')
            shutil.copytree(ROOT / folder, app / folder, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        for folder in ['src', 'third_party']:
            shutil.copytree(ROOT / 'search' / folder, app / 'search' / folder,
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        for name in ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'pyproject.toml', 'runtime-lock.json', 'bashkitten-search']:
            source = ROOT / 'search' / name
            require(source.is_file(), f'Missing search payload: {name}')
            shutil.copy2(source, app / 'search' / name)
        for name in ['package.json', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'PI_UPSTREAM.md']:
            shutil.copy2(ROOT / name, app / name)
        command = ['npm', 'ci', '--prefix', str(app), '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund',
                   '--os=' + ('android' if termux else 'linux'), '--cpu=' + ('x64' if args.architecture == 'amd64' else 'arm64')]
        require(int(subprocess.check_output(['npm', '--version'], text=True).split('.')[0]) >= 10,
                'Use npm >=10 for explicit target dependency selection')
        run(command)
        run(['node', str(ROOT / 'src/server/updates/platform-packages.mjs'), str(app),
             'android' if termux else 'linux', 'x64' if args.architecture == 'amd64' else 'arm64'])
        auth_hash = checked_archive(args.auth_archive)
        auth = app / 'auth'
        extract(args.auth_archive, auth)
        auth_meta = read_json(auth / 'share/metadata/runtime.json')
        require(auth_meta['target'] == target and auth_meta['architecture'] == args.architecture, 'Native auth target mismatch')
        for executable_name in ['authelia', 'caddy', 'tor', 'valkey-server', 'runtime-guard']:
            require(os.access(auth / 'bin' / executable_name, os.X_OK), f'Missing native {executable_name}')
        search_hash = checked_archive(args.search_archive)
        with tempfile.TemporaryDirectory(prefix='search-input-', dir=temporary) as incoming:
            extract(args.search_archive, Path(incoming))
            require({p.name for p in Path(incoming).iterdir()} == {'search'}, 'Unexpected search archive root')
            search = Path(incoming) / 'search'
            require({p.name for p in search.iterdir()} == {'runtime'}, 'Search archive may only replace its native runtime')
            shutil.move(str(search / 'runtime'), app / 'search/runtime')
        search_meta = read_json(app / 'search/runtime/manifest.json')
        require(search_meta['target'] == target, 'Native search target mismatch')
        components = {
            'auth': {'archive': args.auth_archive.name, 'sha256': auth_hash, 'metadata': auth_meta},
            'search': {'archive': args.search_archive.name, 'sha256': search_hash, 'metadata': search_meta},
        }
        if not termux:
            components['browser'] = package_browser(args, app, stage, version, auth)
        collector = ['node', str(ROOT / 'packaging/licenses.mjs'), str(app), '--target', args.target, '--version', version]
        if not termux:
            collector += ['--browser', str(app / 'browser')]
        run(collector)
        run(['python3', str(ROOT / 'packaging/about.py'), args.target,
             str(app / 'licenses.json'), str(app / 'about.html'), '--version', version])
        # Per-user Pi integration registration happens at controller startup, never as root.
        installation = (prefix + '/var/lib' if termux else '/var/lib') + '/bashkitten/installed.json'
        runtime = (prefix + '/var/lib' if termux else '/var/lib') + '/bashkitten/runtimes/' + pi_version + '-' + lock_hash[:12]
        stamp = {'format': 2, 'platform': 'android' if termux else 'linux', 'architecture': args.architecture,
                 'version': version, 'lockSha256': lock_hash, 'piVersion': pi_version,
                 'installationStamp': installation, 'revision': revision, 'components': components}
        write_json(app / 'build-platform.json', stamp)
        write_json(app / 'runtime-default.json', {'root': runtime, 'version': pi_version})
        bin_dir = stage / prefix.lstrip('/') / 'bin'
        node = prefix + '/bin/node'
        installed_app = prefix + '/lib/bashkitten'
        for name, script, extra in [('bashkittenctl', 'control.mjs', ''), ('bashkitten-web', 'control.mjs', 'start'),
                                    ('bashkitten-pi', 'rpc/launcher.mjs', '')]:
            executable(bin_dir / name, f'#!{shell}\nexec {node} {installed_app}/src/server/{script} {extra} "$@"\n')
        executable(bin_dir / 'bashkitten-manager', f'#!{shell}\nexport BASHKITTEN_ATTACHED_MANAGER=1\n'
                   f'while :; do\n  {node} {installed_app}/src/server/control.mjs serve\n  code=$?\n'
                   '  [ "$code" -eq 75 ] || exit "$code"\n  sleep 1\ndone\n')
        (bin_dir / 'bashkitten-search').symlink_to('../lib/bashkitten/search/bashkitten-search')
        search_launcher = app / 'search/bashkitten-search'
        executable(search_launcher, f'#!{prefix}/bin/{"python" if termux else "python3"}\n' + search_launcher.read_text().split('\n', 1)[1])
        control = stage / 'DEBIAN'
        control.mkdir()
        managed = json.dumps({'owner': 'bashkitten', 'version': pi_version, 'lockSha256': lock_hash})
        executable(control / 'postinst', f'''#!{shell}
set -e
umask 022
runtime='{runtime}'
if [ ! -f "$runtime/ready" ]; then
  mkdir -p "$runtime"
  cp -a '{installed_app}/node_modules' "$runtime/"
  cp '{installed_app}/package.json' '{installed_app}/package-lock.json' "$runtime/"
  touch "$runtime/ready"
fi
printf '%s\\n' '{managed}' > "$runtime/managed.json"
if ! command -v pi >/dev/null 2>&1 && [ ! -e '{prefix}/bin/pi' ] && [ ! -L '{prefix}/bin/pi' ]; then
  ln -s bashkitten-pi '{prefix}/bin/pi'
fi
mkdir -p '{Path(installation).parent}'
cp '{installed_app}/build-platform.json' '{installation}.tmp'
chmod 644 '{installation}.tmp'
mv '{installation}.tmp' '{installation}'
''')
        executable(control / 'postrm', f'''#!{shell}
if [ "$1" = remove ] || [ "$1" = purge ]; then
  if [ "$(readlink '{prefix}/bin/pi')" = bashkitten-pi ]; then rm '{prefix}/bin/pi'; fi
fi
# Preserve user data, native Pi sessions/credentials and retained runtimes.
''')
        if termux:
            profile = stage / prefix.lstrip('/') / 'etc/profile.d/bashkitten-privacy.sh'
            profile.parent.mkdir(parents=True)
            profile.write_text('export PI_TELEMETRY=0 PI_OFFLINE=1 GH_TELEMETRY=0 DO_NOT_TRACK=1\n'
                               'export GH_NO_UPDATE_NOTIFIER=1 GH_NO_EXTENSION_UPDATE_NOTIFIER=1\n')
        base_deps = (['nodejs-lts (>= 22.19)', 'python', 'git', 'gh', 'ripgrep', 'fd', 'ca-certificates', 'curl', 'coreutils', 'unzip', 'zip', 'tar'] if termux else
                     ['nodejs (>= 22.19)', 'npm', 'python3', 'git', 'gh', 'ripgrep', 'fd-find', 'ca-certificates', 'curl', 'unzip', 'zip', 'tar',
                      'libasound2t64 | libasound2', 'libdbus-glib-1-2', 'libgtk-3-0t64 | libgtk-3-0', 'libx11-xcb1'])
        depends = dependencies(base_deps, auth_meta['dependencies'], search_meta['depends'])
        replacements = '' if termux else 'Replaces: bashkitten-desktop\nBreaks: bashkitten-desktop\nProvides: bashkitten-desktop\n'
        doc = stage / prefix.lstrip('/') / 'share/doc/bashkitten'
        doc.mkdir(parents=True)
        for name in ['LICENSE', 'PI_UPSTREAM.md', 'THIRD_PARTY_NOTICES.md', 'licenses.json', 'build-platform.json']:
            shutil.copy2(app / name, doc / name)
        stamp['nativeElfCount'] = elf_payload(app, args.architecture, termux)
        write_json(app / 'build-platform.json', stamp)
        shutil.copy2(app / 'build-platform.json', doc / 'build-platform.json')
        size = sum(p.stat().st_size for p in stage.rglob('*') if p.is_file() and not p.is_symlink()) // 1024
        (control / 'control').write_text(f'Package: bashkitten\nVersion: {version}\nArchitecture: {args.architecture}\n'
            'Maintainer: Open Research Tools <openresearchtools@users.noreply.github.com>\n'
            f'Depends: {", ".join(depends)}\nInstalled-Size: {size}\n{replacements}Section: web\nPriority: optional\n'
            'Homepage: https://bashkitten.com\nDescription: BashKitten browser and native Pi agent\n'
            + (' Native Termux backend, search, authentication and browser controls.\n' if termux else
               ' Firefox-based browser, native Pi backend, search and authentication.\n'))
        asset = output / f'bashkitten_{version}_{args.architecture}.deb'
        run(['dpkg-deb', '--root-owner-group', '-Zzstd', '-z10', '--build', str(stage), str(asset)],
            env={**os.environ, 'SOURCE_DATE_EPOCH': epoch})
        write_json(output / (asset.name + '.json'), {**stamp, 'asset': asset.name, 'sha256': sha(asset), 'depends': depends})
        print(asset)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', choices=['linux', 'termux'])
    parser.add_argument('--architecture', required=True, choices=['amd64', 'arm64', 'aarch64'])
    parser.add_argument('--browser-dir', type=Path)
    parser.add_argument('--auth-archive', type=Path, required=True)
    parser.add_argument('--search-archive', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--stage-dir', type=Path)
    args = parser.parse_args()
    try:
        assemble(args)
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Package assembly failed: {error}\n')


if __name__ == '__main__':
    main()
