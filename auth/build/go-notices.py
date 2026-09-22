#!/usr/bin/env python3
"""Collect the source and license files for modules linked into a Go executable."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile

source, output, component = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
command = ['./cmd/authelia'] if component == 'authelia' else ['./cmd/caddy']
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
        module = module.get('Replace', module)
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
        files = [p for p in directory.iterdir() if p.is_file() and p.name.lower().startswith(('license', 'licence', 'notice', 'copying', 'copyright', 'authors'))]
        license_files = [p for p in files if p.name.lower().startswith(('license', 'licence', 'copying'))]
        if not license_files:
            raise SystemExit(f'Missing license text for Go module {name}: {directory}')
        (notices / destination).mkdir(parents=True, exist_ok=True)
        for path in files:
            shutil.copy2(path, notices / destination / path.name)
        # The primary source is already published from the checked-in tree.
        if not module.get('Main'):
            shutil.copytree(directory, bundle / destination, ignore=shutil.ignore_patterns('.git'), symlinks=True)
        inventory.append({'name': name, 'version': module.get('Version', 'checked-in'), 'licenses': [f'{destination}/{p.name}' for p in license_files]})
    goroot = Path(subprocess.check_output(['go', 'env', 'GOROOT'], text=True).strip())
    shutil.copy2(goroot / 'LICENSE', notices / 'Go-LICENSE')
    # The exact compiler's standard library is part of the linked payload.
    shutil.copytree(goroot / 'src', bundle / 'go-standard-library', symlinks=True)
    shutil.copy2(goroot / 'LICENSE', bundle / 'Go-LICENSE')
    with tarfile.open(source_output / f'{component}-go.tar.gz', 'w:gz') as archive:
        for path in sorted(bundle.iterdir()):
            archive.add(path, arcname=path.name)
(metadata / f'{component}-go-modules.json').write_text(json.dumps(inventory, indent=2) + '\n')
shutil.copy2(source / 'go.mod', metadata / f'{component}.go.mod')
shutil.copy2(source / 'go.sum', metadata / f'{component}.go.sum')
