#!/usr/bin/env python3
"""Collect offline notices and exact source jars for the resolved APK libraries."""
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
from urllib.error import HTTPError
from urllib.request import urlopen
import xml.etree.ElementTree as ET
import zipfile

root = Path(__file__).resolve().parents[2]
report, output = map(Path, sys.argv[1:])
output.mkdir(parents=True, exist_ok=True)
cache = report.parent / 'license-sources'
cache.mkdir(exist_ok=True)
records = []
legal_name = re.compile(r'(?i)(^|/)(license|licence|notice|copying|copyright)([._/-]|$)')

def notices(data):
    found = set()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for name in archive.namelist():
            if name.endswith('/'):
                continue
            if legal_name.search(name):
                found.add(archive.read(name).decode('utf-8', errors='replace').strip())
            elif name == 'classes.jar':
                found.update(notices(archive.read(name)))
    return found

for item in json.loads(report.read_text()):
    group, name, version = item['group'], item['name'], item['version']
    print('Collecting', group, name, version, flush=True)
    repository = 'https://dl.google.com/dl/android/maven2/' if group.startswith('androidx.') else 'https://repo.maven.apache.org/maven2/'
    base = repository + group.replace('.', '/') + '/' + name + '/' + version + '/' + name + '-' + version
    pom = urlopen(base + '.pom', timeout=60).read()
    pom_file = cache / (group + '.' + name + '-' + version + '.pom')
    pom_file.write_bytes(pom)
    tree = ET.fromstring(pom)
    labels = [e.text for e in tree.findall('.//{*}licenses/{*}license/{*}name')]
    while not labels:
        parent = tree.find('{*}parent')
        if parent is None:
            break
        pg, pn, pv = (parent.findtext('{*}' + field) for field in ('groupId', 'artifactId', 'version'))
        parent_url = repository + pg.replace('.', '/') + '/' + pn + '/' + pv + '/' + pn + '-' + pv + '.pom'
        parent_data = urlopen(parent_url, timeout=60).read()
        (cache / (pg + '.' + pn + '-' + pv + '.pom')).write_bytes(parent_data)
        tree = ET.fromstring(parent_data)
        labels = [e.text for e in tree.findall('.//{*}licenses/{*}license/{*}name')]

    texts = notices(Path(item['file']).read_bytes())
    sources = cache / (group + '.' + name + '-' + version + '-sources.jar')
    sources.write_bytes(urlopen(base + '-sources.jar', timeout=60).read())
    texts.update(notices(sources.read_bytes()))
    # AndroidX source jars generally put the attribution in source headers.
    copyrights = set()
    with zipfile.ZipFile(sources) as archive:
        for entry in archive.namelist():
            if entry.endswith(('.java', '.kt')):
                head = archive.read(entry)[:4096].decode('utf-8', errors='replace')
                copyrights.update(line.strip(' /*\t') for line in head.splitlines() if re.search(r'(?i)copyright', line))
    if not texts:
        assert labels and all('apache' in label.lower() and '2' in label for label in labels), f'Unreviewed license: {group}:{name}:{version}: {labels}'
        texts.add((root / 'licenses/Apache-2.0.txt').read_text())
    records.append({'name': group + ':' + name, 'version': version, 'license': ', '.join(labels),
                    'source': base + '-sources.jar', 'sourceSha256': hashlib.sha256(sources.read_bytes()).hexdigest(),
                    'text': '\n\n'.join(sorted(copyrights)) + '\n\n' + '\n\n'.join(sorted(texts))})

unique = {}
for record in records:
    key = record['name'], record['version']
    if key in unique:
        if record['text'] != unique[key]['text']:
            unique[key]['text'] += '\n\n' + record['text']
    else:
        unique[key] = record
records = list(unique.values())
records.insert(0, {'name': 'BashKitten', 'version': json.loads((root / 'package.json').read_text())['version'],
                  'license': 'GPL-3.0-only', 'source': 'https://github.com/openresearchtools/bashkitten',
                  'text': (root / 'LICENSE').read_text()})
assets = root / 'src/android/app/src/main/assets'
records.append({'name': 'Termux app icons', 'version': '', 'license': 'Original project licenses',
                'source': 'https://github.com/openresearchtools/termux-suite',
                'text': '\n\n'.join(p.name + '\n\n' + p.read_text() for p in sorted(assets.glob('termux-*')))})
records.append({'name': 'WildBuzzard logo', 'version': '', 'license': 'AGPL-3.0-or-later',
                'source': 'https://github.com/openresearchtools/wildbuzzard-android',
                'text': (assets / 'wildbuzzard-notice.txt').read_text() + '\n' + (assets / 'wildbuzzard-license.txt').read_text()})
# The companion server is part of the app even though Termux installs it
# separately. Include its release notices here so they need no server or login.
server = report.parent / 'server-notices'
server.mkdir(exist_ok=True)
for name in ['package.json', 'package-lock.json', 'LICENSE']:
    shutil.copy2(root / name, server / name)
shutil.copytree(root / 'licenses', server / 'licenses', dirs_exist_ok=True)
subprocess.run(['npm', 'ci', '--prefix', str(server), '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--os=android', '--cpu=arm64'], check=True)
subprocess.run(['node', str(root / 'src/server/updates/platform-packages.mjs'), str(server), 'android', 'arm64'], check=True)
subprocess.run(['node', str(root / 'src/server/licenses.mjs'), str(server)], check=True)
records.extend(entry for entry in json.loads((server / 'licenses.json').read_text()) if entry['name'] != 'BashKitten')
(output / 'licenses.json').write_text(json.dumps(records, ensure_ascii=False) + '\n')
subprocess.run(['python3', str(root / 'packaging/about.py'), 'android', str(output / 'licenses.json'), str(output / 'about.html')], check=True)
(cache / 'components.json').write_text(json.dumps(records, indent=2, ensure_ascii=False) + '\n')
with tarfile.open(report.parent / 'android-dependency-sources.tar.gz', 'w:gz') as archive:
    for file in sorted(cache.iterdir()):
        archive.add(file, arcname='android-dependencies/' + file.name)
print('Packaged', len(records), 'APK and companion-server notice records')
