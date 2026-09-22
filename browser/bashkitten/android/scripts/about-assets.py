#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Assemble Android's offline About from this build's resolved license payloads."""
import argparse
import json
import importlib.util
import os
from pathlib import Path
import subprocess

p = argparse.ArgumentParser()
p.add_argument('--app-build', type=Path, required=True)
p.add_argument('--native-notices', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--version', required=True)
a = p.parse_args()
root = Path(__file__).resolve().parents[4]
companion = Path(os.environ['BASHKITTEN_COMPANION_LICENSES'])
records = json.loads(companion.read_text())
if not isinstance(records, list) or not records:
    raise SystemExit('The companion package license inventory is empty')
metadata = sorted(a.app_build.glob('generated/third_party_licenses/**/third_party_license_metadata'))
if not metadata:
    raise SystemExit('The resolved Android dependency license inventory is missing')
seen = set()
for table in metadata:
    blob = (table.parent / 'third_party_licenses').read_bytes()
    for line in table.read_text().splitlines():
        position, name = line.split(' ', 1)
        start, count = map(int, position.split(':'))
        text = blob[start:start + count].decode('utf-8').strip()
        if not text:
            raise SystemExit(f'Missing license text: {name}')
        if (name, text) in seen:
            continue
        seen.add((name, text))
        records.append({'name': name, 'version': '', 'license': 'See full license text', 'text': text})
notices = sorted(a.native_notices.glob('*NOTICES.txt'))
if not notices:
    raise SystemExit('The native browser license notices are missing')
for notice in notices:
    text = notice.read_text().strip()
    if not text:
        raise SystemExit(f'Empty native notices: {notice}')
    records.append({'name': notice.stem.replace('-', ' ').title(), 'version': '', 'license': 'See individual component licenses', 'text': text})
source = root / 'browser/bashkitten/scripts/generate-third-party-notices.py'
spec = importlib.util.spec_from_file_location('browser_notices', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
obj = Path(os.environ['BASHKITTEN_ANDROID_OBJDIR'])
archives = list((obj / 'dist').rglob('omni.ja'))
for archive in archives:
    try:
        records.extend(module.packaged_inventory(archive.parent))
        break
    except module.ValidationError:
        continue
else:
    raise SystemExit('The built Gecko component license inventory is missing')
a.output.mkdir(parents=True, exist_ok=True)
licenses = a.output / 'licenses.json'
licenses.write_text(json.dumps(records, ensure_ascii=False))
subprocess.run(['python3', str(root / 'agent/packaging/about.py'), 'android', str(licenses), str(a.output / 'about.html'), '--version', a.version], check=True)
