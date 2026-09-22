#!/usr/bin/env python3
"""Assemble one private native payload and its complete corresponding source."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tarfile

root, stage, target, artifacts = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4])
architecture = {'linux-amd64': 'amd64', 'linux-arm64': 'arm64', 'termux-aarch64': 'aarch64'}[target]
artifacts.mkdir(parents=True, exist_ok=True)
metadata = stage / 'share/metadata'
metadata.mkdir(parents=True, exist_ok=True)
components = []
for component in ('authelia', 'caddy', 'tor'):
    binary = stage / 'bin' / component
    if not binary.is_file():
        raise SystemExit(f'Missing binary: {binary}')
    record = root / 'auth/upstreams.lock.json'
    details = json.loads(record.read_text())[component]
    components.append(dict(name=component, version=details['version'], source=details['repository'], commit=details['commit'], sha256=hashlib.sha256(binary.read_bytes()).hexdigest()))
dependencies = set()
for path in metadata.glob('*.dependencies'):
    dependencies.update(value.strip() for value in path.read_text().split(',') if value.strip())
if not dependencies:
    raise SystemExit('Native dependency declarations are missing')
(stage / '.dependencies').write_text(', '.join(sorted(dependencies)) + '\n')
(metadata / 'runtime.json').write_text(json.dumps({'target': target, 'architecture': architecture, 'components': components, 'dependencies': sorted(dependencies)}, indent=2) + '\n')

licenses = []
license_root = stage / 'share/licenses'
for path in sorted(license_root.rglob('*')):
    if not path.is_file():
        continue
    text = path.read_text(errors='replace').strip()
    if not text:
        raise SystemExit(f'Empty license file: {path}')
    relative = path.relative_to(license_root)
    name = relative.parts[0]
    details = next((item for item in components if item['name'] == name), {})
    licenses.append({'name': str(relative), 'version': details.get('version', ''), 'license': 'See included license text', 'source': details.get('source', ''), 'text': text})
if not licenses:
    raise SystemExit('Native dependency license texts are missing')
(stage / 'licenses.json').write_text(json.dumps(licenses, ensure_ascii=False) + '\n')

source_file = artifacts / f'auth-{target}-source.tar.gz'
with tarfile.open(source_file, 'w:gz') as archive:
    archive.add(root / 'auth', arcname='auth')
    archive.add(root / 'agent/src/server/access/runtime-guard.c', arcname='agent/src/server/access/runtime-guard.c')
    archive.add(root / 'LICENSE', arcname='LICENSE')
    dependencies_source = stage / 'share/source'
    if dependencies_source.exists():
        archive.add(dependencies_source, arcname='dependencies')
        shutil.rmtree(dependencies_source)
    archive.add(metadata, arcname='build-metadata')
payload = artifacts / f'auth-{target}.tar.gz'
with tarfile.open(payload, 'w:gz') as archive:
    for path in sorted(stage.iterdir()):
        archive.add(path, arcname=path.name)
(artifacts / 'SHA256SUMS').write_text(''.join(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n' for path in (payload, source_file)))
