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

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
parser.add_argument('--revision', default='HEAD')
args = parser.parse_args()
revision = subprocess.check_output(['git', 'rev-parse', args.revision], cwd=ROOT, text=True).strip()
def tracked(name): return subprocess.check_output(['git', 'show', revision + ':' + name], cwd=ROOT)
lock = json.loads(tracked('package-lock.json'))
cache = ROOT / 'work/sources'; cache.mkdir(parents=True, exist_ok=True)
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
pi_commit = re.search(rb'Commit: `([a-f0-9]{40})`', tracked('PI_UPSTREAM.md'))[1].decode()
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
print('Collected', len(components), 'integrity-verified dependency archives, Pi upstream source and BashKitten source at', revision)
