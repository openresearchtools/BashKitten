#!/usr/bin/env python3
"""Assemble the complete Linux or native Termux package from CI component artifacts."""
import argparse
import configparser
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
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


def license_files(root):
    """Include retained legal texts whose names identify their license, not just LICENSE."""
    return sorted(path for path in root.rglob('*') if path.is_file() and
        (path.suffix.lower() in {'', '.txt', '.md', '.rst', '.lib', '.lesser'} or
         re.fullmatch(r'\.\d+', path.suffix)) and (
        re.match(r'^(?:licen[cs]e|copying|copyright|notice|third[_-]party)(?:$|[-._])', path.name, re.I)
        or any(part.lower() in {'licenses', 'licences', 'legal'}
               for part in path.relative_to(root).parts[:-1])))


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



def install_node(archive, app, platform, architecture):
    digest = checked_archive(archive)
    with tempfile.TemporaryDirectory(prefix='node-input-', dir=app.parent) as incoming:
        extract(archive, Path(incoming))
        require({p.name for p in Path(incoming).iterdir()} == {'node'}, 'Unexpected Node archive root')
        shutil.move(str(Path(incoming) / 'node'), app / 'node')
    root = app / 'node'
    metadata = read_json(root / 'manifest.json')
    require(metadata.get('schema') == 1 and metadata.get('platform') == platform and
            metadata.get('architecture') == architecture, 'Native Node target mismatch')
    for executable_name in ['node', 'npm', 'npx']:
        require(os.access(root / 'bin' / executable_name, os.X_OK), f'Missing private {executable_name}')
    with (root / 'bin/node').open('rb') as stream:
        require(stream.read(4) == b'\x7fELF', 'Bundled Node must be the actual native ELF, not a wrapper')
    require((root / 'etc/openssl.cnf').is_file(), 'Missing private Node OpenSSL configuration')
    package = read_json(root / 'lib/node_modules/npm/package.json')
    require(package.get('name') == 'npm' and package.get('version') == metadata.get('npm_version'), 'Bundled npm identity mismatch')
    pinned = read_json(ROOT / 'packaging/node/lock.json')[platform]
    require(metadata.get('node_version') == pinned['node_version'] and metadata.get('npm_version') == pinned['npm_version'],
            'Node/npm versions differ from the committed component lock')
    require((root / 'include/node/node.h').is_file() and (root / 'include/node/config.gypi').is_file(),
            'Bundled Node requires matching native-addon headers')
    for name in ['npm-cli.js', 'npx-cli.js']:
        require((root / 'lib/node_modules/npm/bin' / name).is_file(), f'Missing private {name}')
    require(isinstance(metadata.get('depends'), list), 'Node component must declare external OS dependencies')
    return {'archive': archive.name, 'sha256': digest, 'metadata': metadata}


def install_machines(args, app, revision, version):
    require(args.machines_archive is not None, 'Linux desktop packages require --machines-archive')
    digest = checked_archive(args.machines_archive)
    with tempfile.TemporaryDirectory(prefix='machines-input-', dir=app.parent) as incoming:
        extract(args.machines_archive, Path(incoming))
        require({p.name for p in Path(incoming).iterdir()} == {'machines'}, 'Unexpected machine runtime archive root')
        shutil.move(str(Path(incoming) / 'machines'), app / 'machines')
    root = app / 'machines'; metadata = read_json(root / 'manifest.json')
    require(metadata.get('schema') == 1 and metadata.get('platform') == 'linux' and
            metadata.get('architecture') == args.architecture, 'Private Podman target mismatch')
    require(metadata.get('sourceCommit') == revision, 'Machine runtime must be prepared for this source revision')
    helpers = ['podman', 'rootlessport', 'crun', 'conmon', 'netavark', 'aardvark-dns',
               'pasta', 'passt', 'pesto', 'fusermount3', 'fuse-overlayfs', 'catatonit']
    if args.architecture == 'amd64': helpers += ['passt.avx2', 'pasta.avx2']
    for name in helpers:
        require(os.access(root / 'bin' / name, os.X_OK) and
                sha(root / 'bin' / name) == metadata['executables'].get(name), 'Missing/mismatched private helper: ' + name)
    require(metadata.get('libraries') and 'libfuse3.so.4' in metadata['libraries'],
            'Private FUSE library is required')
    for name, library_digest in metadata['libraries'].items():
        require(Path(name).name == name and sha(root / 'lib' / name) == library_digest,
                'Missing/mismatched private library: ' + name)
    require((root / 'licenses.json').is_file() and isinstance(metadata.get('depends'), list),
            'Machine runtime requires licenses and external dependency metadata')
    for name in ['image', 'libexec']:
        require((ROOT / 'machines' / name).is_dir(), 'Missing machine integration payload: ' + name)
        shutil.copytree(ROOT / 'machines' / name, root / name, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    for name in ['NOTICE', 'image-base.json']:
        shutil.copy2(ROOT / 'machines' / name, root / name)
    require(args.guest_packages is not None, 'Linux desktop packages require matching --guest-packages')
    packages = root / 'image/packages'; packages.mkdir(parents=True, exist_ok=True)
    expected = {'bashkitten-backend', 'bashkitten-os', 'bashkitten-machines-guest'}
    found = {}; records = []; guest_licenses = []
    for deb in sorted(args.guest_packages.rglob('*.deb')):
        fields = subprocess.check_output(['dpkg-deb', '-f', str(deb), 'Package', 'Version', 'Architecture'], text=True)
        info = dict(line.split(': ', 1) for line in fields.splitlines())
        name = info['Package']
        require(name in expected and name not in found, 'Unexpected or duplicate guest package: ' + name)
        require(info['Version'] == version and info['Architecture'] == args.architecture,
                'Guest package version/architecture mismatch: ' + name)
        provenance = read_json(Path(str(deb) + '.json'))
        require(provenance.get('revision', provenance.get('sourceCommit')) == revision,
                'Guest package source revision mismatch: ' + name)
        checksum = sha(deb)
        if provenance.get('sha256'):
            require(provenance['sha256'] == checksum, 'Guest package checksum mismatch: ' + name)
        else:
            require(Path(str(deb) + '.sha256').read_text().split()[0] == checksum,
                    'Guest package checksum mismatch: ' + name)
        shutil.copy2(deb, packages / deb.name); found[name] = deb.name
        records.append({'package': name, 'file': deb.name, 'sha256': checksum, 'provenance': provenance})
        if name != 'bashkitten-backend':
            with tempfile.TemporaryDirectory(prefix='guest-notices-', dir=app.parent) as extracted:
                run(['dpkg-deb', '-x', str(deb), extracted])
                notice_root = Path(extracted) / ('usr/share/bashkitten-os' if name == 'bashkitten-os'
                                                else 'usr/share/bashkitten-machines-guest')
                notices = license_files(notice_root)
                require(notices, 'Missing full guest package license texts: ' + name)
                guest_licenses.append({'name': name, 'version': version, 'source':
                    'https://github.com/openresearchtools/bashkitten/tree/' + revision,
                    'text': '\n\n'.join(str(p.relative_to(notice_root)) + '\n' + p.read_text() for p in notices)})
    require(set(found) == expected, 'Guest image needs backend, BashKitten OS and guest-service packages')
    write_json(packages / 'manifest.json', {'schema': 1, 'revision': revision,
               'architecture': args.architecture, 'version': version, 'packages': records})
    write_json(root / 'guest-licenses.json', guest_licenses)
    return {'archive': args.machines_archive.name, 'sha256': digest, 'metadata': metadata}


def install_display(args, app, revision):
    require(args.display_archive is not None, 'Linux desktop packages require --display-archive')
    digest = checked_archive(args.display_archive)
    with tempfile.TemporaryDirectory(prefix='display-input-', dir=app.parent) as incoming:
        extract(args.display_archive, Path(incoming))
        require({p.name for p in Path(incoming).iterdir()} == {'display'}, 'Unexpected Display archive root')
        shutil.move(str(Path(incoming) / 'display'), app / 'display')
    metadata = read_json(app / 'display/manifest.json')
    require(metadata.get('architecture') == args.architecture and metadata.get('sourceCommit') == revision,
            'Display component target/source revision mismatch')
    require(sha(app / 'display/bashkitten-display') == metadata.get('binarySha256'), 'Display executable checksum mismatch')
    require(isinstance(metadata.get('depends'), list), 'Display must declare native dependencies')
    (app / 'browser/runtime/display').symlink_to('../../display')
    return {'archive': args.display_archive.name, 'sha256': digest, 'metadata': metadata}


def install_machine_apparmor(stage, app):
    source = ROOT / 'packaging/linux/apparmor'
    upstream = read_json(source / 'upstream/source.json')
    for item in upstream['files']:
        require(Path(item['path']).name == item['path'] and
                sha(source / 'upstream' / item['path']) == item['sha256'],
                'Private Podman AppArmor source checksum mismatch')
    profile = stage / 'etc/apparmor.d/bashkitten-podman'
    profile.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source / 'bashkitten-podman', profile)
    # Keep policy source/provenance and the full license available offline.
    notices = app / 'machines/apparmor'
    shutil.copytree(source, notices)
    inventory = app / 'machines/licenses.json'
    records = read_json(inventory)
    records.append({'name': 'AppArmor — adapted private Podman profile',
                    'version': upstream['release'], 'license': 'GPL-2.0-or-later',
                    'source': upstream['repository'].removesuffix('.git') + '/-/tree/' + upstream['commit'],
                    'text': (notices / 'NOTICE').read_text() + '\n' + (notices / 'upstream/LICENSE').read_text()})
    write_json(inventory, records)


def install_termux_display(args, app, revision, bin_dir):
    require(args.termux_display_dir is not None, 'Termux requires the paired --termux-display-dir component')
    source = args.termux_display_dir
    metadata = read_json(source / 'manifest.json')
    require(metadata.get('sourceCommit') == revision and metadata.get('package') == 'com.bashkitten',
            'Termux Display loader package/source revision mismatch')
    # The same publisher certificate is enforced against final APKs by release.py.
    from release import CERT
    signer = CERT
    if args.development_signing:
        development = read_json(args.development_signing)
        require(development.get('publisher_signed') is False and re.fullmatch('[a-f0-9]{64}', development.get('certificate_sha256', '')),
                'Development pairing requires the explicit local signing receipt')
        signer = development['certificate_sha256']
    require(metadata.get('signerSha256') == signer, 'Termux Display loader is paired with a different APK signer')
    for name in ['bashkitten-x11', 'bashkitten-x11-loader.jar']:
        require(sha(source / name) == metadata['sha256'].get(name), 'Display loader checksum mismatch: ' + name)
    display = app / 'display'; display.mkdir(exist_ok=True)
    loader = display / 'bashkitten-x11-loader.jar'
    shutil.copy2(source / 'bashkitten-x11-loader.jar', loader)
    # Non-root dpkg reopens .dpkg-new for writeback after applying archive modes.
    # Like the donor package, make the installed loader read-only in postinst.
    loader.chmod(0o600)
    shutil.copytree(source / 'licenses', display / 'licenses')
    shutil.copy2(source / 'manifest.json', display / 'manifest.json')
    bin_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source / 'bashkitten-x11', bin_dir / 'bashkitten-x11')
    return {'metadata': metadata, 'developmentOnly': bool(args.development_signing)}


def collect_termux_os(deb, app, revision, architecture, version):
    require(deb is not None and deb.is_file(), 'Termux requires matching --os-package')
    fields = subprocess.check_output(['dpkg-deb', '-f', str(deb), 'Package', 'Version', 'Architecture'], text=True)
    info = dict(line.split(': ', 1) for line in fields.splitlines())
    require(info == {'Package': 'bashkitten-os', 'Version': version + '-1', 'Architecture': architecture},
            'Termux OS package target/version mismatch')
    metadata = read_json(Path(str(deb) + '.json'))
    require(metadata.get('sourceCommit') == revision and metadata.get('sha256') == sha(deb),
            'Termux OS package source/hash mismatch')
    with tempfile.TemporaryDirectory(prefix='termux-os-notices-', dir=app.parent) as temporary:
        run(['dpkg-deb', '-x', str(deb), temporary])
        root = Path(temporary) / 'data/data/com.termux/files/usr/share/bashkitten-os'
        paths = license_files(root)
        require(paths, 'Termux OS package lacks full license texts')
        write_json(app / 'os-licenses.json', [{'name': 'BashKitten OS', 'version': version + '-1',
            'text': '\n\n'.join(str(p.relative_to(root)) + '\n' + p.read_text() for p in paths)}])
    return metadata

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
    machine = 62 if architecture in {'amd64', 'x86_64'} else 183
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
    component = runpy.run_path(str(ROOT / 'packaging/browser-component.py'))
    compile_digest = component['fingerprint']('linux-' + args.architecture)
    component['verify'](directory, 'linux-' + args.architecture, compile_digest)
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
                       'StartupWMClass=com.bashkitten\n'
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
    equivalence = directory / component['EQUIVALENCE']
    if equivalence.exists():
        shutil.copy2(equivalence, provenance / equivalence.name)
        metadata['input_equivalence'] = read_json(equivalence)
        metadata['producer_browser_input_sha256'] = metadata['browser_input_sha256']
        metadata['browser_input_sha256'] = compile_digest
    run(['python3', str(REPOSITORY / 'browser/bashkitten/scripts/generate-third-party-notices.py'),
         '--browser-dir', str(browser), '--json-output', str(browser / 'notices/licenses.json')])
    return {'archive': archive.name, 'sha256': digest, **metadata}


def assemble(args):
    termux = args.target == 'termux'
    require(not termux or not args.backend_only, '--backend-only is a native Linux guest package')
    require(args.architecture in (['aarch64', 'x86_64'] if termux else ['amd64', 'arm64']), 'Architecture does not match target')
    require(not termux or args.browser_dir is None, 'The Termux package does not include an Android browser')
    target = args.target + '-' + args.architecture
    prefix = '/data/data/com.termux/files/usr' if termux else '/usr'
    shell = prefix + '/bin/sh' if termux else '/bin/sh'
    version = (REPOSITORY / 'browser/bashkitten/config/version.txt').read_text().strip()
    require(re.fullmatch(r'\d+\.\d+(?:\.\d+)?', version), 'Invalid Firefox-aligned product version')
    package_version = version
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
        for folder in ['src/server', 'src/web', 'src/phone', 'reference', 'licenses', 'pi']:
            require((ROOT / folder).is_dir(), f'Missing product payload: {folder}')
            shutil.copytree(ROOT / folder, app / folder,
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc', 'pillama', 'pi-codex-usage') if folder == 'pi'
                            else shutil.ignore_patterns('__pycache__', '*.pyc'))
        # The reviewer is an independently versioned Pi package. Its parser
        # dependencies are part of the same verified root npm closure.
        reviewer = ROOT / 'systematic-reviewer'
        reviewer_meta = read_json(reviewer / 'package.json')
        for name in ['package.json', *reviewer_meta['files']]:
            source = reviewer / name
            require(source.exists() and source.resolve().is_relative_to(reviewer.resolve()),
                    f'Invalid reviewer runtime file: {name}')
            destination = app / 'systematic-reviewer' / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                shutil.copytree(source, destination, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
            else:
                shutil.copy2(source, destination)
        run(['python3', str(ROOT / 'packaging/pi-skills.py'), str(app / 'pi'), args.target])
        usage_notice = app / 'pi/vendor/pi-codex-usage/LICENSE'
        usage_notice.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / 'pi/vendor/pi-codex-usage/LICENSE', usage_notice)
        for role in ['termux-use', 'computer-use']:
            guide = app / 'pi/desktop-guides' / role / 'SKILL.md'
            guide.parent.mkdir(parents=True, exist_ok=True)
            original = (REPOSITORY / 'os/skills/desktop-use/SKILL.md').read_text()
            guide.write_text(original.replace('name: desktop-use', 'name: ' + role))
        # Keep the complete upstream tree in source releases; install only its
        # declared runtime files, without upstream tests or development tools.
        pillama = ROOT / 'pi/vendor/pillama'
        for name in [*read_json(pillama / 'package.json')['files'], 'package.json', 'NOTICE']:
            source = pillama / name
            require(source.is_file() and source.resolve().is_relative_to(pillama.resolve()),
                    f'Invalid pillama runtime file: {name}')
            destination = app / 'pi/vendor/pillama' / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
        for folder in ['src', 'third_party']:
            shutil.copytree(ROOT / 'search' / folder, app / 'search' / folder,
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        for name in ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'pyproject.toml', 'runtime-lock.json', 'bashkitten-search']:
            source = ROOT / 'search' / name
            require(source.is_file(), f'Missing search payload: {name}')
            shutil.copy2(source, app / 'search' / name)
        for name in ['package.json', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'PI_UPSTREAM.md']:
            shutil.copy2(ROOT / name, app / name)
        npm_cache = Path(temporary) / 'npm-cache'
        run(['python3', str(ROOT / 'packaging/npm-sources.py'), '--cache', str(npm_cache)])
        command = ['npm', 'ci', '--prefix', str(app), '--cache', str(npm_cache), '--offline',
                   '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund',
                   '--os=' + ('android' if termux else 'linux'), '--cpu=' + ('x64' if args.architecture in {'amd64', 'x86_64'} else 'arm64')]
        require(int(subprocess.check_output(['npm', '--version'], text=True).split('.')[0]) >= 10,
                'Use npm >=10 for explicit target dependency selection')
        run(command)
        from applications import install as install_applications
        application_components = install_applications(args, app, revision, npm_cache, checked_archive, extract)
        run(['node', str(ROOT / 'src/server/updates/platform-packages.mjs'), str(app),
             'android' if termux else 'linux', 'x64' if args.architecture in {'amd64', 'x86_64'} else 'arm64'])
        auth_hash = checked_archive(args.auth_archive)
        auth = app / 'auth'
        extract(args.auth_archive, auth)
        auth_meta = read_json(auth / 'share/metadata/runtime.json')
        require(auth_meta['target'] == target and auth_meta['architecture'] == args.architecture, 'Native auth target mismatch')
        for executable_name in ['authelia', 'caddy', 'tor', 'valkey-server', 'chisel', 'bashkitten-remote', 'runtime-guard']:
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
            **application_components,
            'node': install_node(args.node_archive, app, args.target, args.architecture),
            'auth': {'archive': args.auth_archive.name, 'sha256': auth_hash, 'metadata': auth_meta},
            'search': {'archive': args.search_archive.name, 'sha256': search_hash, 'metadata': search_meta},
        }
        if termux:
            components['display'] = install_termux_display(args, app, revision, stage / prefix.lstrip('/') / 'bin')
            components['os'] = collect_termux_os(args.os_package, app, revision, args.architecture, version)
        if not termux:
            components['browser'] = package_browser(args, app, stage, version, auth)
        if not termux and not args.backend_only:
            components['machines'] = install_machines(args, app, revision, version)
            install_machine_apparmor(stage, app)
            components['display'] = install_display(args, app, revision)
        collector = ['node', str(ROOT / 'packaging/licenses.mjs'), str(app), '--target', args.target, '--version', version]
        if args.backend_only:
            collector += ['--backend-only']
        if not termux:
            collector += ['--browser', str(app / 'browser')]
        run(collector)
        run(['python3', str(ROOT / 'packaging/about.py'), args.target,
             str(app / 'licenses.json'), str(app / 'about.html'), '--version', version])
        # Per-user Pi integration registration happens at controller startup, never as root.
        installation = (prefix + '/var/lib' if termux else '/var/lib') + '/bashkitten/installed.json'
        runtime = (prefix + '/var/lib' if termux else '/var/lib') + '/bashkitten/runtimes/' + pi_version + '-' + lock_hash[:12]
        stamp = {'format': 2, 'platform': 'android' if termux else 'linux', 'architecture': args.architecture,
                 'version': version, 'packageVersion': package_version, 'lockSha256': lock_hash, 'piVersion': pi_version,
                 'installationStamp': installation, 'revision': revision, 'components': components,
                 'integrationIteration': args.integration_iteration}
        write_json(app / 'build-platform.json', stamp)
        write_json(app / 'runtime-default.json', {'root': runtime, 'version': pi_version})
        bin_dir = stage / prefix.lstrip('/') / 'bin'
        installed_app = prefix + '/lib/bashkitten'
        node = installed_app + '/node/bin/node'
        node_environment = f'unset NODE_OPTIONS NODE_PATH\nexport OPENSSL_CONF={installed_app}/node/etc/openssl.cnf\n'
        if termux:
            # Node, native guards and child_process must see the real ELF in
            # /proc/self/exe. Keep termux-exec's shebang handling, but use its
            # supported direct execution mode in GitHub/F-Droid Termux (SDK 28).
            # termux-exec caches this decision per process. Re-exec a system
            # shell once so an inherited forced-linker setting cannot survive
            # the export in an already-preloaded shell. Preserve its shebang
            # support instead of stripping LD_PRELOAD from the environment.
            node_environment += ('if [ "${TERMUX_EXEC__SYSTEM_LINKER_EXEC__MODE:-}" != disable ]; then\n'
                                 '  export TERMUX_EXEC__SYSTEM_LINKER_EXEC__MODE=disable\n'
                                 '  exec /system/bin/sh "$0" "$@"\nfi\n')
            node_environment += 'export BASHKITTEN_EXECUTION_ROLE=termux\n'
        elif args.backend_only:
            node_environment += 'export BASHKITTEN_EXECUTION_ROLE=container\n'
        else:
            node_environment += 'unset BASHKITTEN_EXECUTION_ROLE\n'
        executable(app / 'node/bin/pi', f'#!{shell}\n{node_environment}exec {node} {installed_app}/src/server/rpc/launcher.mjs "$@"\n')
        executable(bin_dir / 'office-diff', f'#!{shell}\n{node_environment}exec {node} {installed_app}/office/cli/office-diff.mjs "$@"\n')
        for name, script, extra in [('bashkittenctl', 'control.mjs', ''), ('bashkitten-web', 'control.mjs', 'start'),
                                    ('bashkitten-pi', 'rpc/launcher.mjs', '')]:
            executable(bin_dir / name, f'#!{shell}\n{node_environment}exec {node} {installed_app}/src/server/{script} {extra} "$@"\n')
        if termux:
            executable(bin_dir / 'bashkitten-display', f'#!{shell}\n{node_environment}exec {node} {installed_app}/src/server/platform/termux/display.mjs "$@"\n')
            executable(bin_dir / 'phoneuse', f'#!{shell}\n{node_environment}exec {node} {installed_app}/src/phone/phoneuse.mjs "$@"\n')
        executable(bin_dir / 'bashkitten-manager', f'#!{shell}\n{node_environment}export BASHKITTEN_ATTACHED_MANAGER=1\n'
                   f'while :; do\n  {node} {installed_app}/src/server/control.mjs serve\n  code=$?\n'
                   '  [ "$code" -eq 75 ] || exit "$code"\n  sleep 1\ndone\n')
        (bin_dir / 'bashkitten-search').symlink_to('../lib/bashkitten/search/bashkitten-search')
        search_launcher = app / 'search/bashkitten-search'
        executable(search_launcher, f'#!{prefix}/bin/{"python" if termux else "python3"}\n' + search_launcher.read_text().split('\n', 1)[1])
        control = stage / 'DEBIAN'
        control.mkdir()
        managed = json.dumps({'owner': 'bashkitten', 'version': pi_version, 'lockSha256': lock_hash})
        display_postinst = f"chmod 400 '{installed_app}/display/bashkitten-x11-loader.jar'\n" if termux else ''
        apparmor_postinst = apparmor_postrm = ''
        if not termux and not args.backend_only:
            (control / 'conffiles').write_text('/etc/apparmor.d/bashkitten-podman\n')
            apparmor_postinst = (ROOT / 'packaging/linux/apparmor/postinst').read_text()
            apparmor_postrm = (ROOT / 'packaging/linux/apparmor/postrm').read_text()
        executable(control / 'postinst', f'''#!{shell}
set -e
umask 022
{apparmor_postinst}{display_postinst}runtime='{runtime}'
if [ ! -f "$runtime/ready" ]; then
  mkdir -p "$runtime"
  cp -a '{installed_app}/node_modules' "$runtime/"
  cp '{installed_app}/package.json' '{installed_app}/package-lock.json' "$runtime/"
  touch "$runtime/ready"
fi
printf '%s\\n' '{managed}' > "$runtime/managed.json"
# Retire only the exact global alias created by older BashKitten packages.
# Private agent shells use node/bin/pi; never replace an independent Pi.
if [ "$(readlink '{prefix}/bin/pi')" = bashkitten-pi ]; then rm '{prefix}/bin/pi'; fi
mkdir -p '{Path(installation).parent}'
cp '{installed_app}/build-platform.json' '{installation}.tmp'
chmod 644 '{installation}.tmp'
mv '{installation}.tmp' '{installation}'
''')
        executable(control / 'postrm', f'''#!{shell}
{apparmor_postrm}if [ "$1" = remove ] || [ "$1" = purge ]; then
  if [ "$(readlink '{prefix}/bin/pi')" = bashkitten-pi ]; then rm '{prefix}/bin/pi'; fi
fi
# Preserve user data, native Pi sessions/credentials and retained runtimes.
''')
        if termux:
            profile = stage / prefix.lstrip('/') / 'etc/profile.d/bashkitten-privacy.sh'
            profile.parent.mkdir(parents=True)
            profile.write_text('export PI_TELEMETRY=0 PI_OFFLINE=1 GH_TELEMETRY=0 DO_NOT_TRACK=1\n'
                               'export GH_NO_UPDATE_NOTIFIER=1 GH_NO_EXTENSION_UPDATE_NOTIFIER=1\n')
        base_deps = (['python', 'git', 'gh', 'ripgrep', 'fd', 'ca-certificates', 'curl', 'coreutils', 'unzip', 'zip', 'tar',
                      'x11-repo', 'xkeyboard-config', 'xorg-server-xvfb', 'xorg-xprop', 'xdotool', 'xfce4', 'mesa', 'gtk3', 'dbus', 'ttf-dejavu'] if termux else
                     ['python3', 'git', 'gh', 'ripgrep', 'fd-find', 'ca-certificates', 'curl', 'unzip', 'zip', 'tar',
                      'libasound2t64 | libasound2', 'libdbus-glib-1-2', 'libgtk-3-0t64 | libgtk-3-0', 'libx11-xcb1', 'libdbusmenu-glib4', 'libdbusmenu-gtk3-4', 'libgomp1', 'libstdc++6', 'libvulkan1',
                      'fonts-dejavu-core'])
        depends = dependencies(base_deps, auth_meta['dependencies'], search_meta['depends'], components['node']['metadata']['depends'],
                               components.get('machines', {}).get('metadata', {}).get('depends', []),
                               components.get('display', {}).get('metadata', {}).get('depends', []),
                               components.get('files', {}).get('metadata', {}).get('depends', []),
                               components.get('office', {}).get('metadata', {}).get('depends', []),
                               [f'bashkitten-os (= {version}-1)'] if termux else [])
        replacements = '' if termux or args.backend_only else 'Replaces: bashkitten-desktop\nBreaks: bashkitten-desktop\nProvides: bashkitten-desktop\n'
        doc = stage / prefix.lstrip('/') / 'share/doc/bashkitten'
        doc.mkdir(parents=True)
        for name in ['LICENSE', 'PI_UPSTREAM.md', 'THIRD_PARTY_NOTICES.md', 'licenses.json', 'build-platform.json']:
            shutil.copy2(app / name, doc / name)
        stamp['nativeElfCount'] = elf_payload(app, args.architecture, termux)
        write_json(app / 'build-platform.json', stamp)
        shutil.copy2(app / 'build-platform.json', doc / 'build-platform.json')
        size = sum(p.stat().st_size for p in stage.rglob('*') if p.is_file() and not p.is_symlink()) // 1024
        package_name = 'bashkitten-backend' if args.backend_only else 'bashkitten'
        (control / 'control').write_text(f'Package: {package_name}\nVersion: {package_version}\nArchitecture: {args.architecture}\n'
            'Maintainer: openresearchtools <openresearchtools@gmail.com>\n'
            f'Depends: {", ".join(depends)}\nInstalled-Size: {size}\n{replacements}Section: web\nPriority: optional\n'
            'Homepage: https://bashkitten.com\nDescription: BashKitten browser and native Pi agent\n'
            + (' Native Termux backend, search, authentication and browser controls.\n' if termux else
               ' Firefox-based browser, native Pi backend, search and authentication.\n'))
        asset = output / f'{package_name}_{package_version}_{args.architecture}.deb'
        run(['dpkg-deb', '--root-owner-group', '-Zzstd', '-z10', '--build', str(stage), str(asset)],
            env={**os.environ, 'SOURCE_DATE_EPOCH': epoch})
        write_json(output / (asset.name + '.json'), {**stamp, 'asset': asset.name, 'sha256': sha(asset), 'depends': depends})
        print(asset)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', choices=['linux', 'termux'])
    parser.add_argument('--architecture', required=True, choices=['amd64', 'arm64', 'aarch64', 'x86_64'])
    parser.add_argument('--browser-dir', type=Path)
    parser.add_argument('--auth-archive', type=Path, required=True)
    parser.add_argument('--search-archive', type=Path, required=True)
    parser.add_argument('--node-archive', type=Path, required=True)
    parser.add_argument('--files-archive', type=Path)
    parser.add_argument('--office-archive', type=Path)
    parser.add_argument('--integration-iteration', action='store_true',
                        help='Authorized browser integration iteration only; permits unavailable native Files/Office components')
    parser.add_argument('--machines-archive', type=Path)
    parser.add_argument('--display-archive', type=Path)
    parser.add_argument('--termux-display-dir', type=Path)
    parser.add_argument('--os-package', type=Path)
    parser.add_argument('--development-signing', type=Path, help='Local acceptance only: explicit APK signing receipt; release rejects this pairing')
    parser.add_argument('--guest-packages', type=Path)
    parser.add_argument('--backend-only', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--stage-dir', type=Path)
    args = parser.parse_args()
    try:
        assemble(args)
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Package assembly failed: {error}\n')


if __name__ == '__main__':
    main()
