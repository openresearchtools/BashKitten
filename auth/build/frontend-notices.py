#!/usr/bin/env python3
"""Retain production dependency licenses and source from pnpm's resolved inventory."""
import json
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile

record, output = Path(sys.argv[1]), Path(sys.argv[2])
packages = {}

def collect(value):
    if isinstance(value, dict):
        if value.get('name') and value.get('path'):
            packages[str(Path(value['path']).resolve())] = value
        elif value.get('name') and value.get('paths'):
            for path, version in zip(value['paths'], value['versions'], strict=True):
                if path:
                    packages[str(Path(path).resolve())] = dict(value, path=path, version=version)
        for child in value.values():
            collect(child)
    elif isinstance(value, list):
        for child in value:
            collect(child)

collect(json.loads(record.read_text()))
if not packages:
    raise SystemExit('pnpm returned no production dependency license inventory')
notices = output / 'share/licenses/authelia-web'
metadata = output / 'share/metadata'
sources = output / 'share/source'
for directory in (notices, metadata, sources):
    directory.mkdir(parents=True, exist_ok=True)
inventory = []
with tempfile.TemporaryDirectory(prefix='bashkitten-web-source-') as temporary:
    bundle = Path(temporary)
    for directory_name, package in sorted(packages.items()):
        directory = Path(directory_name)
        name = package['name'] + '@' + package.get('version', 'unknown')
        destination = name.replace('/', '__')
        if (bundle / destination).exists():
            continue
        files = [p for p in directory.iterdir() if p.is_file() and p.name.lower().startswith(('license', 'licence', 'notice', 'copying', 'copyright', 'authors'))]
        license_files = [p for p in files if p.name.lower().startswith(('license', 'licence', 'copying'))]
        # Some npm authors (including agent-base 6) publish their complete MIT
        # grant and copyright in README, without a separate LICENSE file.
        if not license_files:
            for path in directory.glob('*'):
                if path.is_file() and path.name.lower().startswith('readme'):
                    text = path.read_text(errors='replace')
                    if 'permission is hereby granted, free of charge' in text.lower() and 'the software is provided' in text.lower() and 'copyright' in text.lower():
                        files.append(path)
                        license_files.append(path)
        if not license_files:
            raise SystemExit(f'Missing production frontend license text for {name}')
        (notices / destination).mkdir(parents=True, exist_ok=True)
        for path in files:
            shutil.copy2(path, notices / destination / path.name)
        shutil.copytree(directory, bundle / destination, ignore=shutil.ignore_patterns('node_modules', '.git'), symlinks=True)
        inventory.append({'name': package['name'], 'version': package.get('version'), 'license': package.get('license'), 'texts': [f'{destination}/{p.name}' for p in license_files]})
    with tarfile.open(sources / 'authelia-web.tar.gz', 'w:gz') as archive:
        for path in sorted(bundle.iterdir()):
            archive.add(path, arcname=path.name)
(metadata / 'authelia-web.json').write_text(json.dumps(inventory, indent=2) + '\n')
