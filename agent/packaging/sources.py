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
import subprocess
import tarfile

AGENT = Path(__file__).resolve().parents[1]
ROOT = AGENT.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
parser.add_argument('--revision', default='HEAD')
args = parser.parse_args()
revision = subprocess.check_output(['git', 'rev-parse', args.revision], cwd=ROOT, text=True).strip()
def tracked(name): return subprocess.check_output(['git', 'show', revision + ':' + name], cwd=ROOT)
lock = json.loads(tracked('agent/package-lock.json'))
cache = AGENT / 'work/sources'; cache.mkdir(parents=True, exist_ok=True)
args.output.mkdir(parents=True, exist_ok=True)
records = {}
for location, value in lock['packages'].items():
    if not location or value.get('dev') or not value.get('resolved'): continue
    url = value['resolved']; assert url.startswith('https://registry.npmjs.org/')
    records.setdefault(url, {**value, 'name': value.get('name') or location.rsplit('node_modules/', 1)[-1]})

def collect(item):
    url, value = item
    file = cache / (hashlib.sha256(url.encode()).hexdigest()[:20] + '.tgz')
    if not file.exists():
        temporary = file.with_suffix('.part')
        subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location', '--retry', '3', '--max-time', '300', '--proto', '=https', '--proto-redir', '=https', url, '-o', str(temporary)], check=True)
        temporary.replace(file)
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
if not pi_source.exists():
    subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location', '--retry', '3', '--proto', '=https', '--proto-redir', '=https', 'https://codeload.github.com/earendil-works/pi/tar.gz/' + pi_commit, '-o', str(pi_source)], check=True)
with pi_source.open('rb') as stream: pi_sha = hashlib.file_digest(stream, 'sha256').hexdigest()
manifest = {'sourceCommit': revision, 'pi': {'commit': pi_commit, 'file': pi_source.name, 'sha256': pi_sha}, 'components': components}
manifest_path = args.output / 'components.json'; manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
source = args.output / ('bashkitten-source-' + revision[:12] + '.tar.gz')
subprocess.run(['git', 'archive', '--format=tar.gz', '--prefix=bashkitten/', '-o', str(source.resolve()), revision], cwd=ROOT, check=True)
with tarfile.open(args.output / ('bashkitten-dependency-source-' + revision[:12] + '.tar'), 'w') as archive:
    archive.add(manifest_path, arcname='dependencies/components.json')
    archive.add(pi_source, arcname='dependencies/' + pi_source.name)
    for component in components: archive.add(cache / component['file'], arcname='dependencies/' + component['file'])
# Native sources and license supplements omitted from npm distributions.
extra_cache = AGENT / 'work/license-sources'
with tarfile.open(args.output / ('bashkitten-native-dependency-source-' + revision[:12] + '.tar'), 'w') as archive:
    for value in json.loads(tracked('agent/licenses/source-archives.json')):
        file = extra_cache / value['file']
        file.parent.mkdir(parents=True, exist_ok=True)
        if not file.exists():
            subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location', '--retry', '3', '--proto', '=https', '--proto-redir', '=https', value['url'], '-o', str(file)], check=True)
        with file.open('rb') as stream: actual = hashlib.file_digest(stream, 'sha256').hexdigest()
        assert actual == value['sha256'], 'Native source checksum mismatch: ' + value['file']
        archive.add(file, arcname='native-dependencies/' + value['file'])
# Android's Tor/JNI and retained assets use pinned source outside Gecko itself.
android_records = json.loads(tracked('browser/bashkitten/android/notices/sources.json'))
android_archives = {}
for record in android_records:
    repository = record['repository']
    commit = record['commit']
    assert re.fullmatch(r'https://github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository)
    assert re.fullmatch(r'[a-f0-9]{40}', commit)
    key = (repository, commit)
    if key not in android_archives:
        name = repository.rsplit('/', 1)[-1] + '-' + commit + '.tar.gz'
        archive = extra_cache / name
        if not archive.exists():
            url = 'https://codeload.github.com/' + repository.removeprefix('https://github.com/') + '/tar.gz/' + commit
            subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location', '--retry', '3', '--proto', '=https', '--proto-redir', '=https', url, '-o', str(archive)], check=True)
        android_archives[key] = archive
    with tarfile.open(android_archives[key]) as upstream:
        matches = [entry for entry in upstream if entry.name.partition('/')[2] == record['licensePath']]
        assert len(matches) == 1, 'Missing pinned Android license source: ' + record['name']
        assert hashlib.sha256(upstream.extractfile(matches[0]).read()).hexdigest() == record['sha256'], 'Android license source mismatch: ' + record['name']
android_manifest = []
with tarfile.open(args.output / ('bashkitten-android-dependency-source-' + revision[:12] + '.tar'), 'w') as archive:
    for (repository, commit), file in sorted(android_archives.items()):
        archive.add(file, arcname='android-dependencies/' + file.name)
        with file.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        android_manifest.append({'repository': repository, 'commit': commit, 'file': file.name, 'sha256': digest})
    android_inventory = args.output / 'android-source-components.json'
    android_inventory.write_text(json.dumps(android_manifest, indent=2) + '\n')
    archive.add(android_inventory, arcname='android-dependencies/components.json')
print('Collected', len(components), 'integrity-verified dependency archives, Pi upstream source and BashKitten source at', revision)
