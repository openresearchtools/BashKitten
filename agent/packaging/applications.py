#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Install independently versioned Files, Office and References modules."""
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def copy_file(source, root, destination):
    if source.is_symlink() or not source.resolve().is_relative_to(root.resolve()):
        raise ValueError('Runtime source leaves its component: ' + str(source))
    target = destination / source.relative_to(root)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    return target


def copy_patterns(root, destination, patterns):
    for pattern in patterns:
        if Path(pattern).is_absolute() or '..' in Path(pattern).parts:
            raise ValueError('Invalid component payload pattern')
        matches = [path for path in root.glob(pattern) if path.is_file()]
        if not matches:
            raise ValueError('Empty component payload pattern: ' + str(root / pattern))
        for source in matches:
            if '__pycache__' not in source.parts and source.suffix != '.pyc':
                copy_file(source, root, destination)


def references(destination, cache, target, architecture, *, source_cache=None, offline=False):
    source = ROOT / 'references'
    payload = json.loads((source / 'runtime-payload.json').read_text())
    if payload['schema'] != 1:
        raise ValueError('Unknown References runtime payload format')
    copy_patterns(source, destination, payload['files'])
    if payload.get('stripTranslatorTests'):
        for path in (destination / 'vendor/translators/source').glob('*.js'):
            text = path.read_text()
            marker = '/** BEGIN TEST CASES **/'
            if marker in text:
                path.write_text(text.split(marker, 1)[0].rstrip() + '\n')
    records = []
    for item in payload['legal']:
        provenance = source / item['source']
        copy_file(provenance, source, destination)
        metadata = json.loads(provenance.read_text())
        texts = []
        for relative in item['files']:
            path = source / relative
            copy_file(path, source, destination)
            texts.append(relative + '\n' + path.read_text(errors='replace'))
        if item['name'] == 'translators':
            for path in sorted((destination / 'vendor/translators/source').glob('*.js')):
                comments = re.findall(r'/\*[\s\S]*?\*/', path.read_text())
                notices = [comment for comment in comments if re.search(r'copyright|licen[cs]e', comment, re.I)]
                if notices:
                    texts.append(path.name + '\n' + '\n'.join(notices))
        if not texts:
            raise ValueError('Missing References legal text: ' + item['name'])
        records.append({'name': item['name'], 'version': item['version'], 'license': item['license'],
                        'source': metadata.get('repository') or metadata.get('archiveURL'),
                        'text': '\n\n'.join(texts)})
    (destination / 'source-licenses.json').write_text(json.dumps(records, indent=2) + '\n')
    install_npm(source, destination, cache, target, architecture,
                source_cache=source_cache, offline=offline)


def install_npm(source, destination, cache, target, architecture, *, source_cache=None, offline=False):
    cache = Path(cache).resolve()
    source_api = runpy.run_path(str(ROOT / 'agent/packaging/npm-sources.py'))
    # Original downloads live in the shared checksum cache, not the runtime or
    # necessarily the checkout. Keep that separate from npm's offline install cache.
    archives = source_api['locked_archives'](root=source, cache=source_cache, offline=offline)
    subprocess.run(['npm', 'cache', 'add', '--cache', str(cache), '--ignore-scripts', '--no-audit', '--no-fund',
                    *map(str, archives)], check=True)
    subprocess.run(['npm', 'ci', '--prefix', str(destination), '--cache', str(cache), '--offline',
                    '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund',
                    '--os=' + ('android' if target == 'termux' else 'linux'),
                    '--cpu=' + ('x64' if architecture in ['amd64', 'x86_64'] else 'arm64')], check=True)
    packages = json.loads((source / 'package-lock.json').read_text())['packages']
    retain_native_package_files(destination, cache, packages)
    # Local tarball inputs remain in the complete corresponding-source bundle.
    # Installed runtime code and full legal texts live in node_modules.
    for package in packages.values():
        resolved = package.get('resolved', '')
        if resolved.startswith('file:'):
            (destination / resolved.removeprefix('file:')).unlink(missing_ok=True)


def retain_native_package_files(destination, cache, packages):
    # A pinned original Git archive is complete source, unlike an npm registry
    # tarball. Reuse npm's own declared-files selection for the installed payload;
    # never trim the pristine source tree or verified original archive.
    for location, package in packages.items():
        if not package.get('resolved', '').startswith('https://codeload.github.com/'):
            continue
        relative = Path(location)
        if not relative.parts or relative.is_absolute() or '..' in relative.parts or relative.parts[0] != 'node_modules':
            raise ValueError('Invalid installed npm package path')
        folder = destination / relative
        if not folder.is_dir():  # An omitted optional/platform package.
            continue
        if folder.is_symlink() or not folder.resolve().is_relative_to(destination.resolve()):
            raise ValueError('Installed npm package leaves its runtime')
        metadata = json.loads((folder / 'package.json').read_text())
        if not isinstance(metadata.get('files'), list):
            continue
        records = json.loads(subprocess.check_output([
            'npm', 'pack', '--dry-run', '--json', '--ignore-scripts', '--offline',
            '--cache', str(cache)], cwd=folder, text=True))
        if len(records) != 1 or records[0]['name'] != metadata['name'] or records[0]['version'] != package['version']:
            raise ValueError('Native npm package selection identity mismatch')
        selected = set()
        for item in records[0]['files']:
            path = Path(item['path'])
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('Invalid native npm package selection path')
            selected.add(path.as_posix())
        if 'package.json' not in selected:
            raise ValueError('Native npm package selection omits runtime metadata')
        paths = list(folder.rglob('*'))
        for path in paths:
            relative = path.relative_to(folder)
            # npm selects this package's files; nested installed dependencies
            # remain under their own lock/installation owner.
            if relative.parts[0] == 'node_modules':
                continue
            if (path.is_file() or path.is_symlink()) and relative.as_posix() not in selected:
                path.unlink()
        for path in sorted(paths, key=lambda value: len(value.parts), reverse=True):
            if path.is_dir() and not path.is_symlink() and not any(path.iterdir()):
                path.rmdir()


def verify_files(root, records):
    actual = {str(path.relative_to(root)) for path in root.rglob('*') if path.is_file() or path.is_symlink()}
    if actual != set(records) | {'manifest.json'}:
        raise ValueError('Native component archive differs from its complete file inventory')
    for name, item in records.items():
        path = root / name
        if Path(name).is_absolute() or '..' in Path(name).parts:
            raise ValueError('Invalid native component inventory path')
        if 'symlink' in item:
            if not path.is_symlink() or os.readlink(path) != item['symlink']:
                raise ValueError('Native component symlink mismatch: ' + name)
        else:
            mode = item.get('mode')
            if isinstance(mode, str):
                mode = int(mode, 8)
            if path.is_symlink() or not isinstance(mode, int):
                raise ValueError('Native component file type/mode mismatch: ' + name)
            member = tarfile.TarInfo(name)
            member.mode = mode
            # The existing extraction owner uses the standard data filter,
            # which removes group/other write and unsafe executable bits.
            expected_mode = tarfile.data_filter(member, root).mode
            if path.stat().st_mode & 0o777 != expected_mode:
                raise ValueError('Native component file mode mismatch: ' + name)
            with path.open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != item['sha256']:
                    raise ValueError('Native component file checksum mismatch: ' + name)


def install(args, app, revision, cache, checked_archive, extract):
    copy_patterns(ROOT / 'files', app / 'files', ['*.mjs', 'web/**/*'])
    office_source = ROOT / 'office'
    office_package = json.loads((office_source / 'package.json').read_text())
    declared = ['package.json', 'package-lock.json', *office_package['files']]
    copy_patterns(office_source, app / 'office',
                  [name + '/**/*' if (office_source / name).is_dir() else name for name in declared])
    install_npm(ROOT / 'office', app / 'office', cache, args.target, args.architecture)
    references(app / 'references', cache, args.target, args.architecture)
    result = {}
    for component in ['files', 'office']:
        archive = getattr(args, component + '_archive', None)
        if archive is None:
            if not getattr(args, 'integration_iteration', False):
                raise ValueError('A complete package requires --' + component + '-archive')
            result[component] = {'available': False, 'reason': 'Native component not included in this browser integration iteration'}
            continue
        digest = checked_archive(archive)
        with tempfile.TemporaryDirectory(prefix=component + '-input-', dir=app.parent) as temporary:
            incoming = Path(temporary)
            extract(archive, incoming)
            root = incoming / 'runtime' if component == 'office' else incoming
            if component == 'office' and {path.name for path in incoming.iterdir()} != {'runtime'}:
                raise ValueError('Office archive may only replace its native runtime')
            if component == 'files' and not {path.name for path in incoming.iterdir()}.issubset(
                    {'bin', 'lib', 'share', 'legal', 'sources', 'manifest.json', 'licenses.json'}):
                raise ValueError('Files archive contains files outside its native component boundary')
            metadata = json.loads((root / 'manifest.json').read_text())
            if (metadata.get('schema') != 1 or metadata.get('target') != args.target
                    or metadata.get('architecture') != args.architecture or metadata.get('sourceCommit') != revision):
                raise ValueError('Native ' + component + ' artifact target/source mismatch')
            if metadata.get('development') and not getattr(args, 'integration_iteration', False):
                raise ValueError('Uncommitted native ' + component + ' build inputs cannot enter a release package')
            if not isinstance(metadata.get('depends'), list) or not (root / 'licenses.json').is_file():
                raise ValueError('Native ' + component + ' artifact lacks dependency/legal metadata')
            if not metadata.get('files'):
                raise ValueError('Native ' + component + ' artifact lacks file checksums')
            verify_files(root, metadata['files'])
            destination = app / component / 'runtime' if component == 'office' else app / component
            shutil.copytree(root, destination, dirs_exist_ok=True, symlinks=True)
        result[component] = {'available': True, 'archive': archive.name, 'sha256': digest, 'metadata': metadata}
    if result['office']['available']:
        result['office']['extension'] = office_extension(app / 'office/runtime')
    return result


def office_extension(runtime):
    archive = runtime / 'share/bashkitten/org.bashkitten.references.zip'
    archive.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='references-office-extension-', dir=runtime.parent) as temporary:
        destination = Path(temporary)
        subprocess.run(['node', str(ROOT / 'office/package-extension.mjs'), str(destination)], check=True)
        legal = destination / 'legal'; legal.mkdir(exist_ok=True)
        for source, name in [(ROOT / 'agent/LICENSE', 'BashKitten-LICENSE'),
                             (ROOT / 'references/THIRD_PARTY_NOTICES.md', 'References-NOTICE'),
                             (ROOT / 'references/vendor/classic-dialog/source/COPYING', 'Classic-dialog-LICENSE')]:
            shutil.copy2(source, legal / name)
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
            for path in sorted(destination.rglob('*')):
                if not path.is_file():
                    continue
                entry = zipfile.ZipInfo(str(path.relative_to(destination)), (1980, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                output.writestr(entry, path.read_bytes())
    return {'file': str(archive.relative_to(runtime)),
            'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}
