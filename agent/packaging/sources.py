#!/usr/bin/env python3
"""Collect unmodified npm source/distribution archives and BashKitten release source.

Locked tarballs retain their original license/notice payloads. No package scripts
execute; GitHub publishing is a separate step.
"""
import argparse
import base64
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import shutil
from build import checked_archive
from android_native_sources import collect as collect_android_native
import subprocess
import tarfile
import zipfile

AGENT = Path(__file__).resolve().parents[1]
ROOT = AGENT.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
parser.add_argument('--revision', default='HEAD')
parser.add_argument('--node-sources', type=Path, required=True)
parser.add_argument('--cache', type=Path)
args = parser.parse_args()
revision = subprocess.check_output(['git', 'rev-parse', args.revision], cwd=ROOT, text=True).strip()
def tracked(name): return subprocess.check_output(['git', 'show', revision + ':' + name], cwd=ROOT)
lock = json.loads(tracked('agent/package-lock.json'))
cache_root = args.cache or (args.output.resolve().parent / 'bashkitten-source-cache')
cache = cache_root / 'npm'; cache.mkdir(parents=True, exist_ok=True)
args.output.mkdir(parents=True, exist_ok=True)
records = {}
for location, value in lock['packages'].items():
    if not location or value.get('dev') or not value.get('resolved'): continue
    url = value['resolved']
    assert url.startswith('https://registry.npmjs.org/') or url == 'file:vendor/sheetjs/xlsx-0.20.3.tgz'
    records.setdefault(url, {**value, 'name': value.get('name') or location.rsplit('node_modules/', 1)[-1]})

npm_sources = {item['url']: item for item in json.loads(tracked('agent/vendor/npm/sources.json'))['components']}
def collect(item):
    url, value = item
    file = cache / (hashlib.sha256(url.encode()).hexdigest()[:20] + '.tgz')
    if url.startswith('file:'):
        payload = tracked('agent/' + url[5:])
    else:
        source = npm_sources[url]
        assert source['integrity'] == value['integrity']
        payload = tracked('agent/vendor/npm/' + source['file'])
        assert hashlib.sha256(payload).hexdigest() == source['sha256']
    file.write_bytes(payload)
    algorithm, encoded = value['integrity'].split()[0].split('-', 1)
    assert algorithm in ('sha512', 'sha256', 'sha1')
    with file.open('rb') as stream: actual = hashlib.file_digest(stream, algorithm).digest()
    assert actual == base64.b64decode(encoded), 'npm integrity mismatch: ' + value['name']
    with tarfile.open(file) as archive:
        # Older npm publishers (including @types/node) used their package name
        # as the tar root. Read metadata without extracting any archive paths.
        roots = [member for member in archive if member.name.count('/') == 1 and member.name.endswith('/package.json')]
        assert len(roots) == 1, 'Ambiguous npm metadata: ' + value['name']
        package = json.load(archive.extractfile(roots[0]))
        assert package['name'] == value['name'] and package['version'] == value['version'], 'npm package identity mismatch: ' + value['name']
        notices = [member.name for member in archive if re.search(r'(^|/)(licen[cs]e|copying|notice)([./-]|$)', member.name, re.I)]
    return {'name': value['name'], 'version': value['version'], 'license': package.get('license'), 'repository': package.get('repository'), 'url': url, 'integrity': value['integrity'], 'file': file.name, 'notices': notices}

with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool: components = list(pool.map(collect, records.items()))
pi_commit = re.search(rb'Commit: `([a-f0-9]{40})`', tracked('agent/PI_UPSTREAM.md'))[1].decode()
pi_source = cache / ('pi-' + pi_commit + '.tar.gz')
pi_record = json.loads(tracked('agent/vendor/pi/source.json'))
assert pi_record['commit'] == pi_commit
pi_payload = tracked('agent/vendor/pi/' + pi_record['file'])
assert hashlib.sha256(pi_payload).hexdigest() == pi_record['sha256']
pi_source.write_bytes(pi_payload)
with pi_source.open('rb') as stream: pi_sha = hashlib.file_digest(stream, 'sha256').hexdigest()
manifest = {'sourceCommit': revision, 'pi': {'commit': pi_commit, 'file': pi_source.name, 'sha256': pi_sha}, 'components': components}
manifest_path = args.output / 'components.json'; manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
# These retained inputs are included by git archive. Verify the exact committed
# revision before producing a release source bundle; a checkout cache is not
# authority for either dependency identity or lock freshness.
def check_file(base, record):
    relative = Path(record['file'])
    assert not relative.is_absolute() and '..' not in relative.parts
    assert hashlib.sha256(tracked(base + '/' + str(relative))).hexdigest() == record['sha256'], 'Retained source mismatch: ' + str(relative)

go_base = 'auth/dependencies/go'
go = json.loads(tracked(go_base + '/sources.json'))
for name, digest in go['locks'].items():
    assert hashlib.sha256(tracked(name)).hexdigest() == digest, 'Stale Go source lock: ' + name
for module in go['modules']:
    for record in module['files'].values(): check_file(go_base, record)
for record in go['moduleMetadata']: check_file(go_base, record)
for base, lock_file in [('auth/dependencies/frontend', 'auth/authelia/web/pnpm-lock.yaml'),
                        ('agent/search/vendor/sources', 'agent/search/runtime-lock.json')]:
    inventory = json.loads(tracked(base + '/sources.json'))
    assert hashlib.sha256(tracked(lock_file)).hexdigest() == inventory['lockSha256'], 'Stale source lock: ' + lock_file
    for record in inventory['components']:
        check_file(base, record)
        for notice in record.get('licenseFiles', []): check_file(base, notice)
base = 'auth/dependencies/termux'
for record in json.loads(tracked(base + '/sources.json'))['components']:
    assert hashlib.sha256(tracked(record['lock'])).hexdigest() == record['lockSha256']
    check_file(base, record)
base = 'auth/dependencies/go-toolchain'
check_file(base, json.loads(tracked(base + '/sources.json')))

source = args.output / ('bashkitten-source-' + revision[:12] + '.tar.gz')
subprocess.run(['git', 'archive', '--format=tar.gz', '--prefix=bashkitten/', '-o', str(source.resolve()), revision], cwd=ROOT, check=True)
with tarfile.open(args.output / ('bashkitten-dependency-source-' + revision[:12] + '.tar'), 'w') as archive:
    archive.add(manifest_path, arcname='dependencies/components.json')
    archive.add(pi_source, arcname='dependencies/' + pi_source.name)
    for component in components: archive.add(cache / component['file'], arcname='dependencies/' + component['file'])
# Native sources and license supplements omitted from npm distributions.
extra_cache = cache_root / 'native'
extra_cache.mkdir(parents=True, exist_ok=True)
with tarfile.open(args.output / ('bashkitten-native-dependency-source-' + revision[:12] + '.tar'), 'w') as archive:
    for value in json.loads(tracked('agent/licenses/source-archives.json')):
        file = extra_cache / value['file']
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(tracked('agent/vendor/native/' + value['file']))
        with file.open('rb') as stream: actual = hashlib.file_digest(stream, 'sha256').hexdigest()
        assert actual == value['sha256'], 'Native source checksum mismatch: ' + value['file']
        archive.add(file, arcname='native-dependencies/' + value['file'])
# Android's Tor/JNI and retained assets use pinned source outside Gecko itself.
android_records = json.loads(tracked('browser/bashkitten/android/notices/sources.json'))
android_archives = {}
android_pins = {item['file']: item for item in json.loads(tracked('agent/vendor/native/android-sources.json'))}
for record in android_records:
    repository = record['repository']
    commit = record['commit']
    assert re.fullmatch(r'https://github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository)
    assert re.fullmatch(r'[a-f0-9]{40}', commit)
    key = (repository, commit)
    if key not in android_archives:
        name = record.get('sourceArchive') or repository.rsplit('/', 1)[-1] + '-' + commit + '.tar.gz'
        assert Path(name).name == name, 'Invalid Android source archive name'
        archive = extra_cache / name
        pin = android_pins[name]
        assert pin['repository'] == repository and pin['commit'] == commit
        payload = tracked('agent/vendor/native/' + name)
        assert hashlib.sha256(payload).hexdigest() == pin['sha256']
        archive.write_bytes(payload)
        android_archives[key] = archive
    if android_archives[key].suffix == '.zip':
        with zipfile.ZipFile(android_archives[key]) as upstream:
            assert upstream.namelist().count(record['licensePath']) == 1, 'Missing pinned Android license source: ' + record['name']
            license_bytes = upstream.read(record['licensePath'])
    else:
        with tarfile.open(android_archives[key]) as upstream:
            matches = [entry for entry in upstream if entry.name.partition('/')[2] == record['licensePath']]
            assert len(matches) == 1, 'Missing pinned Android license source: ' + record['name']
            license_bytes = upstream.extractfile(matches[0]).read()
    assert hashlib.sha256(license_bytes).hexdigest() == record['sha256'], 'Android license source mismatch: ' + record['name']
android_manifest = []
with tarfile.open(args.output / ('bashkitten-android-dependency-source-' + revision[:12] + '.tar'), 'w') as archive:
    collect_android_native(tracked, archive)
    for (repository, commit), file in sorted(android_archives.items()):
        archive.add(file, arcname='android-dependencies/' + file.name)
        with file.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        android_manifest.append({'repository': repository, 'commit': commit, 'file': file.name, 'sha256': digest})
    android_inventory = args.output / 'android-source-components.json'
    android_inventory.write_text(json.dumps(android_manifest, indent=2) + '\n')
    archive.add(android_inventory, arcname='android-dependencies/components.json')
print('Collected', len(components), 'integrity-verified dependency archives, Pi upstream source and BashKitten source at', revision)

# These source bundles come from the same pinned Node component jobs as the
# runtime payloads. Retain all four targets, including native Termux libraries.
node_sources = []
for target in ['linux-amd64', 'linux-arm64', 'termux-aarch64', 'termux-x86_64']:
    name = 'node-source-' + target + '.tar.gz'
    matches = list(args.node_sources.rglob(name))
    if len(matches) != 1:
        raise ValueError('Missing or ambiguous private Node source: ' + target)
    file = matches[0]
    digest = checked_archive(file)
    shutil.copy2(file, args.output / name)
    node_sources.append({'target': target, 'file': name, 'sha256': digest})
(args.output / 'node-source-components.json').write_text(json.dumps(node_sources, indent=2) + '\n')
