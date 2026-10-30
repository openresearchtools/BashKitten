#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Read downloadable source pins from the selected product revision's owners."""
import json
import hashlib
import importlib.util
from pathlib import Path, PurePosixPath
from android_native_sources import download_pin


def records(read):
    result = []

    def document(name):
        return json.loads(read(name))

    def add(manifest, record, paths, url=None):
        for path in paths:
            if PurePosixPath(path).is_absolute() or '..' in PurePosixPath(path).parts:
                raise ValueError('Invalid source inventory path: ' + path)
        if 'member' in record or 'sourceArchiveSha256' in record:
            pin = download_pin(record)
            for path in paths:
                if hashlib.sha256(read(path)).hexdigest() != record['sha256']:
                    raise ValueError('Retained license checksum mismatch: ' + path)
            # The full notice is ordinary tracked source. The original archive
            # has its own digest and no removed working-tree archive path.
            result.append({**pin, 'manifest': manifest, 'paths': []})
            return
        url = url or record.get('url') or record.get('sourceUrl') or record.get('archiveURL')
        if not url and record.get('repository', '').startswith('https://github.com/'):
            url = 'https://codeload.github.com/' + record['repository'].removeprefix('https://github.com/').removesuffix('.git') + '/tar.gz/' + record['commit']
        if not url:
            # Full license texts remain ordinary tracked source, not purged
            # downloadable archives. Keep their existing exact-byte check.
            if not paths or not all(path.endswith('.txt') for path in paths):
                raise ValueError('Missing pinned source download URL: ' + str(paths))
            for path in paths:
                if hashlib.sha256(read(path)).hexdigest() != record['sha256']:
                    raise ValueError('Retained license checksum mismatch: ' + path)
            return
        pin = {'url': url, 'sha256': record['sha256']}
        if 'size' in record:
            pin['size'] = record['size']
        result.append({**pin, 'manifest': manifest, 'paths': paths})

    for base in ('agent/vendor/npm', 'references/vendor/npm', 'office/vendor/npm',
                 'agent/vendor/node', 'auth/dependencies/frontend', 'auth/dependencies/termux',
                 'agent/search/vendor/sources', 'office/upstream/dependencies/native-termux'):
        manifest = base + '/sources.json'
        for row in document(manifest)['components']:
            add(manifest, row, [base + '/' + row['file']])
            for notice in row.get('licenseFiles', []):
                add(manifest, notice, [notice.get('retainedPath', base + '/' + notice['file'])])

    manifest = 'office/upstream/dependencies/sources.json'
    for row in document(manifest)['components']:
        paths = [part['file'] for part in row.get('parts', [])]
        if row.get('file'):
            paths.append(row['file'])
        add(manifest, row, ['office/upstream/dependencies/' + path for path in paths])

    owner = Path(__file__).resolve().parents[2] / 'files/go_runtime.py'
    spec = importlib.util.spec_from_file_location('files_source_selection', owner)
    go_runtime = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(go_runtime)
    graph = document('files/vendor/dependencies/sources.json')
    selected = go_runtime.select(graph, read=lambda name: read('files/' + name))
    original = {(r['ecosystem'], r['name'], r['version']) for r in graph['components']}
    for name, rows in [('sources.json', selected['components']),
                       ('native-sources.json', document('files/vendor/dependencies/native-sources.json')['components'])]:
        manifest = 'files/vendor/dependencies/' + name
        for row in rows:
            source_manifest = manifest
            if name == 'sources.json' and (row['ecosystem'], row['name'], row['version']) not in original:
                source_manifest = 'files/' + go_runtime.configuration(read=lambda name: read('files/' + name))['additionalSources']
            for field, url in [('archive', row['url']),
                               ('info', row['url'].removesuffix('.zip') + '.info'),
                               ('goMod', row['url'].removesuffix('.zip') + '.mod')]:
                if field in row:
                    item = row[field]
                    add(source_manifest, item, ['files/vendor/dependencies/' + p['file'] for p in item['parts']], url)

    manifest = 'references/connector/vendor/npm/SOURCES.json'
    for row in document(manifest)['archives']:
        add(manifest, row, ['references/connector/vendor/npm/' + row['archive']])
    for name in ('zotero', 'translate', 'utilities', 'translators', 'schema', 'styles',
                 'locales', 'translation-server', 'wicked-good-xpath'):
        base = 'references/vendor/' + name
        manifest = base + '/source.json'
        add(manifest, document(manifest), [base + '/upstream.tar.gz'])

    for base in ('agent/vendor/pi', 'auth/dependencies/go-toolchain', 'agent/machines/rust-toolchain'):
        manifest = base + ('/source.json' if base.endswith('/pi') else '/sources.json')
        row = document(manifest)
        add(manifest, row, [base + '/' + row['file']])
    manifest = 'auth/dependencies/go/sources.json'
    go = document(manifest)
    for row in [r for module in go['modules'] for r in module['files'].values()] + go['moduleMetadata']:
        if not row['file'].startswith('proxy/'):
            raise ValueError('Invalid pinned Go proxy path')
        add(manifest, row, ['auth/dependencies/go/' + row['file']],
            'https://proxy.golang.org/' + row['file'].removeprefix('proxy/'))

    for manifest in ('agent/licenses/source-archives.json', 'agent/vendor/native/android-sources.json'):
        for row in document(manifest):
            add(manifest, row, [row.get('retainedPath', 'agent/vendor/native/' + row['file'])])
            for notice in row.get('licenseFiles', []):
                add(manifest, notice, [notice.get('retainedPath', 'agent/vendor/native/' + notice['file'])])
    for name in ('netavark', 'aardvark-dns'):
        base = 'agent/machines/vendor/' + name
        manifest = base + '/source.json'
        row = document(manifest)['vendor']
        add(manifest, row, [base + '/' + row['file']])
    manifest = 'browser/bashkitten/vendor/termux-x11/source.json'
    # The pristine tree is tracked; also deliver its original corresponding-source
    # archive from the same external checksum cache as all downloaded sources.
    archive = document(manifest).get('sourceArchive')
    if archive:
        add(manifest, archive, [])
    return result
