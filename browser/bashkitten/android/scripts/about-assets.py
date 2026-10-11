#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Assemble Android's offline About from this build's resolved license payloads."""
import argparse
import json
import importlib.util
import os
import re
from pathlib import Path
import subprocess

p = argparse.ArgumentParser()
p.add_argument('--native-notices', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--version', required=True)
a = p.parse_args()
root = Path(__file__).resolve().parents[4]
companion = Path(os.environ['BASHKITTEN_COMPANION_LICENSES'])
records = json.loads(companion.read_text())
if not isinstance(records, list) or not records:
    raise SystemExit('The companion package license inventory is empty')
# Native in-APK adaptations do not appear in Maven's dependency inventory.
def source_notice(name, directory, metadata, extra=()):
    paths = sorted(p for p in directory.rglob('*') if p.is_file() and
                   re.match(r'^(licen[cs]e|copying|notice|copyright|ftl|gpl)([._-]|$)', p.name, re.I))
    paths.extend(extra)
    if not paths:
        raise SystemExit('Missing full native module license: ' + name)
    text = '\n\n'.join(str(p.relative_to(root)) + '\n' + p.read_text() for p in paths)
    records.append({'name': name, 'license': 'See individual component licenses',
                    'text': json.dumps(metadata, indent=2) + '\n\n' + text})

phone = root / 'agent/native/phone-control'
source_notice('BashKitten Phone controls — adapted Android controls', phone,
              json.loads((phone / 'ORIGIN.json').read_text()))
phony = root / 'agent/vendor/phony'
source_notice('BashKitten Telephony — adapted Phony', phony,
              json.loads((phony / 'UPSTREAM.json').read_text()),
              [root / 'browser/mobile/android/bashkitten/telephony/NOTICE'])
x11 = root / 'browser/bashkitten/vendor/termux-x11'
x11_pin = json.loads((x11 / 'source.json').read_text())
records.append({'name': 'Termux:X11 — embedded native Display adaptation', 'license': 'GPL-3.0-only',
                'text': json.dumps(x11_pin, indent=2) + '\n\n' + (x11 / 'source/LICENSE').read_text()})
for dependency in x11_pin['dependencies']:
    source_notice('Embedded Display: ' + dependency['path'].rsplit('/', 1)[-1],
                  x11 / 'source' / dependency['path'], dependency)
remote = Path(os.environ['BASHKITTEN_REMOTE_CLIENT_DIR'])
remote_licenses = remote / 'share/licenses/remote-client'
remote_modules = json.loads((remote / 'share/metadata/remote-client-go-modules.json').read_text())
if not remote_modules:
    raise SystemExit('The native remote client license inventory is empty')
for dependency in remote_modules:
    text = '\n\n'.join((remote_licenses / name).read_text() for name in dependency['licenses'])
    if not text.strip():
        raise SystemExit('Missing remote client license: ' + dependency['name'])
    records.append({'name': 'Native remote client: ' + dependency['name'], 'version': dependency['version'],
                    'license': 'See full license text', 'text': text})
# Include separate NOTICE/PATENTS/provenance files as well as the license text.
extra_notices = '\n\n'.join(str(path.relative_to(remote_licenses)) + '\n' + path.read_text()
                            for path in sorted(remote_licenses.rglob('*')) if path.is_file())
records.append({'name': 'Native remote client attribution and Go runtime', 'version': '',
                'license': 'See individual component licenses', 'text': extra_notices})
apk_licenses = Path(os.environ['BASHKITTEN_APK_LICENSES'])
metadata = sorted(apk_licenses.rglob('third_party_license_metadata'))
if not metadata:
    raise SystemExit(f'The resolved Android dependency license inventory is missing: {apk_licenses}')
seen = set()
full_licenses = {'Java Native Access': (a.native_notices / 'JNA-NOTICES.txt').read_text().strip()}
for table in metadata:
    blob = (table.parent / 'third_party_licenses').read_bytes()
    for line in table.read_text().splitlines():
        position, name = line.split(' ', 1)
        start, count = map(int, position.split(':'))
        text = blob[start:start + count].decode('utf-8').strip()
        # Maven's JNA POM contains only license URLs; show its retained complete
        # release notices, including the JNI library's bundled libffi grant.
        if name in full_licenses:
            text = full_licenses[name]
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
