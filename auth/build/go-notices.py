#!/usr/bin/env python3
"""Collect the source and license files for modules linked into a Go executable."""
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'agent/packaging'))
from source_cache import fetch

def toolchain_notices(go='go', env=None, cache=None, offline=False):
    """Read complete Go legal texts from the exact compiler's pinned release.

    Reused by native auth, Files and Machines packaging. The retained legal
    inventory is byte-checked against the original corresponding-source archive;
    a compiler update or missing/unreviewed notice fails before packaging.
    """
    retained = Path(__file__).resolve().parents[1] / 'dependencies/go-toolchain'
    pin = json.loads((retained / 'sources.json').read_text())
    version = subprocess.check_output([go, 'env', 'GOVERSION'], env=env, text=True).strip()
    if version != 'go' + pin['version']:
        raise ValueError('Go compiler does not match retained release source: ' + version)
    archive_path = fetch(pin, cache, local=retained / pin['file'], offline=offline)
    entries = pin['licenseFiles']
    if [entry['source'] for entry in entries] != pin['licenses']:
        raise ValueError('Go legal inventory differs from retained release source')
    files = {}
    with tarfile.open(archive_path) as archive:
        named_notices = {member.name for member in archive if member.isfile() and
                         re.match(r'^(licen[cs]e|copying|notice|copyright|patents)([.\-_]|$)',
                                  Path(member.name).name, re.I)}
        missing = named_notices - set(pin['licenses'])
        if missing:
            raise ValueError('Unreviewed Go release notices: ' + ', '.join(sorted(missing)))
        for entry in entries:
            relative = Path(entry['file'])
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('Invalid retained Go legal path')
            member = archive.getmember(entry['source'])
            if not member.isfile():
                raise ValueError('Go notice is not a regular file: ' + entry['source'])
            data = archive.extractfile(member).read()
            if not data.strip() or hashlib.sha256(data).hexdigest() != entry['sha256']:
                raise ValueError('Go release notice checksum mismatch: ' + entry['source'])
            if (retained / relative).read_bytes() != data:
                raise ValueError('Retained Go notice differs from release: ' + entry['source'])
            files[entry['source']] = data
    record = {'name': 'Go runtime and standard library', 'version': pin['version'],
              'source': pin['url'], 'license': 'BSD-3-Clause and included notices',
              'text': '\n\n'.join(name + '\n\n' + data.decode('utf-8') for name, data in files.items()),
              'distribution': 'bundled',
              'licenseFiles': [{'path': entry['source'], 'sha256': entry['sha256']} for entry in entries]}
    return {'pin': pin, 'archive': archive_path, 'files': files, 'record': record}


def write_toolchain_notices(toolchain, destination):
    """Keep original full texts alongside the merged offline About record."""
    destination = Path(destination)
    for name, data in toolchain['files'].items():
        target = destination / Path(name).relative_to('go')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    (destination / 'source.json').write_text(json.dumps(toolchain['pin'], indent=2) + '\n')


def main():
    source, output, component = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    command = {'authelia': ['./cmd/authelia'], 'caddy': ['./cmd/caddy'], 'chisel': ['.'],
               'remote': ['./cmd/bashkitten-remote'],
               'remote-client': ['github.com/openresearchtools/bashkitten/remote/mobile',
                                 'golang.org/x/mobile/bind/seq',
                                 'golang.org/x/mobile/internal/mobileinit']}[component]
    raw = subprocess.check_output(['go', 'list', '-mod=readonly', '-deps', '-json', *command], cwd=source, text=True)
    decoder, offset, modules = json.JSONDecoder(), 0, {}
    while offset < len(raw):
        while offset < len(raw) and raw[offset].isspace():
            offset += 1
        if offset == len(raw):
            break
        package, offset = decoder.raw_decode(raw, offset)
        module = package.get('Module')
        if module:
            # Keep the canonical module identity. Local replacement paths can contain
            # ../ and must never become output paths or erase the declared version.
            if module.get('Replace'):
                module = dict(module, Dir=module['Replace']['Dir'])
            modules[module['Path']] = module

    notices = output / 'share/licenses' / component
    metadata = output / 'share/metadata'
    source_output = output / 'share/source'
    for directory in (notices, metadata, source_output):
        directory.mkdir(parents=True, exist_ok=True)

    inventory = []
    with tempfile.TemporaryDirectory(prefix='bashkitten-go-source-') as temporary:
        bundle = Path(temporary)
        for name, module in sorted(modules.items()):
            directory = Path(module['Dir'])
            destination = name.replace('/', '__')
            # Modules can carry separately licensed embedded code below their
            # root (for example compression/hash implementations). Keep named
            # legal files recursively; unrelated frontend installs have their
            # own resolved production notice collector.
            files = []
            for current, directories, names in os.walk(directory):
                directories[:] = [name for name in directories if name not in
                                   ('.git', 'node_modules', '.bashkitten-frontend')]
                files.extend(Path(current) / name for name in names if
                             name.lower().startswith(('license', 'licence', 'unlicense', 'notice', 'copying',
                                                      'copyright', 'authors', 'patents'))
                             or name.lower().endswith('-license'))
            files.sort()
            license_files = [p for p in files if p.name.lower().startswith(('license', 'licence', 'unlicense', 'copying'))]
            if not license_files:
                raise SystemExit(f'Missing license text for Go module {name}: {directory}')
            (notices / destination).mkdir(parents=True, exist_ok=True)
            for path in files:
                target = notices / destination / path.relative_to(directory)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
            # The primary source is already published from the checked-in tree.
            if not module.get('Main'):
                shutil.copytree(directory, bundle / destination, ignore=shutil.ignore_patterns('.git'), symlinks=True)
            inventory.append({'name': name, 'version': module.get('Version', 'checked-in'), 'licenses': [f'{destination}/{p.relative_to(directory).as_posix()}' for p in license_files]})
        toolchain = toolchain_notices()
        shutil.copy2(toolchain['archive'], bundle / Path(toolchain['pin']['file']).name)
        write_toolchain_notices(toolchain, notices / 'go-toolchain')
        inventory.append(toolchain['record'])
        # Retain the original compiler release source as well as the native module
        # source closure. Runtime notices use the same verified release source.
        with tarfile.open(source_output / f'{component}-go.tar.gz', 'w:gz') as archive:
            for path in sorted(bundle.iterdir()):
                archive.add(path, arcname=path.name)
    (metadata / f'{component}-go-modules.json').write_text(json.dumps(inventory, indent=2) + '\n')
    shutil.copy2(source / 'go.mod', metadata / f'{component}.go.mod')
    shutil.copy2(source / 'go.sum', metadata / f'{component}.go.sum')


if __name__ == '__main__':
    main()
