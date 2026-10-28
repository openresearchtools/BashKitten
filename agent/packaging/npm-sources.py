#!/usr/bin/env python3
"""Fetch exactly pinned npm sources and prepare npm's offline content cache."""
# SPDX-License-Identifier: AGPL-3.0-only
import argparse
import base64
import hashlib
import json
from pathlib import Path
import runpy
import subprocess
import tarfile

AGENT = Path(__file__).resolve().parents[1]
fetch_source = runpy.run_path(str(Path(__file__).with_name('source_cache.py')))['fetch']


def locked_archives(root=AGENT, cache=None, *, offline=False):
    root = Path(root)
    lock = json.loads((root / 'package-lock.json').read_text())
    index = json.loads((root / 'vendor/npm/sources.json').read_text())
    records = {item['url']: item for item in index['components']}
    result = {}
    for location, item in lock['packages'].items():
        if not location or item.get('dev') or not item.get('resolved'):
            continue
        url = item['resolved']
        if url.startswith('file:'):
            relative = Path(url[5:])
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('Invalid local npm source path')
            archive = root / relative
        else:
            record = records.get(url)
            if not record or record['integrity'] != item['integrity']:
                raise ValueError('Missing pinned npm source metadata: ' + location)
            relative = Path(record['file'])
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('Invalid npm source seed path')
            # Existing whole archives are optional seeds. The committed URL and
            # SHA256 select the bytes; npm's original SRI and identity checks below
            # still run for both downloaded and cached sources.
            archive = fetch_source(record, cache, local=root / 'vendor/npm' / relative,
                                   offline=offline)
        algorithm, digest = item['integrity'].split()[0].split('-', 1)
        if algorithm not in ('sha512', 'sha256', 'sha1'):
            raise ValueError('Unsupported npm integrity algorithm')
        with archive.open('rb') as stream:
            if hashlib.file_digest(stream, algorithm).digest() != base64.b64decode(digest):
                raise ValueError('Locked npm integrity mismatch: ' + location)
        with tarfile.open(archive) as package:
            roots = [entry for entry in package if entry.name.count('/') == 1 and entry.name.endswith('/package.json')]
            if len(roots) != 1:
                raise ValueError('Ambiguous npm source metadata')
            metadata = json.load(package.extractfile(roots[0]))
            name = item.get('name') or location.rsplit('node_modules/', 1)[-1]
            if metadata['name'] != name or metadata['version'] != item['version']:
                raise ValueError('Locked npm source identity mismatch: ' + name)
        result[url] = archive
    return list(result.values())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, help='Seed this native npm content cache')
    parser.add_argument('--source-cache', type=Path, help='Override BASHKITTEN_SOURCE_CACHE for original archives')
    parser.add_argument('--offline', action='store_true', help='Use only verified cached archives or local seeds')
    args = parser.parse_args()
    sources = locked_archives(cache=args.source_cache, offline=args.offline)
    if args.cache:
        args.cache.mkdir(parents=True, exist_ok=True)
        subprocess.run(['npm', 'cache', 'add', '--cache', str(args.cache), '--ignore-scripts',
                        '--no-audit', '--no-fund', *map(str, sources)], check=True)
    print('Verified', len(sources), 'locked npm source archives')
