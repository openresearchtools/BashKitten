# SPDX-License-Identifier: AGPL-3.0-only
"""Verify and package native sources missing from Android Maven source JARs."""
import hashlib
import io
import json
from pathlib import PurePosixPath
import re
import tarfile
import tomllib

BASE = 'agent/vendor/native'
INVENTORY = BASE + '/android-sources.json'


def retained_path(record):
    path = record.get('retainedPath', BASE + '/' + record['file'])
    if PurePosixPath(path).is_absolute() or '..' in PurePosixPath(path).parts:
        raise ValueError('Invalid retained Android source path: ' + path)
    return path


def download_pin(record):
    url = record.get('url') or record.get('sourceUrl')
    if not url:
        repository, commit = record.get('repository', ''), record.get('commit', '')
        if not re.fullmatch(r'https://github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository) or not re.fullmatch(r'[a-f0-9]{40}', commit):
            raise ValueError('Missing immutable native source URL')
        url = 'https://codeload.github.com/' + repository.removeprefix('https://github.com/') + '/tar.gz/' + commit
    return {'url': url, 'sha256': record['sha256'],
            **({'size': record['size']} if 'size' in record else {})}


def collect(read, archive, *, source_manifest=None, apk=None, fetch_source=None):
    """Use one inventory for committed release source and the actual APK output.

    ``read`` reads either a committed revision or the build checkout. No source
    dependency resolution is permitted. Optional preparation fetches only the
    exact original archives selected by this revision's checksum pins.
    """
    records = [r for r in json.loads(read(INVENTORY)) if r.get('nativeSource')]
    if not records:
        raise ValueError('Missing Android native source inventory')
    registry = {(r['name'], r['version'], r['cargoSource']): r for r in records
                if r.get('cargoSource', '').startswith('registry+')}
    git = {r['cargoSource']: r for r in records if r.get('cargoSource', '').startswith('git+')}
    files = {r['file'] for r in records}
    roots = []
    written = set()

    def add(record):
        path = retained_path(record)
        downloadable = record.get('url') or record.get('sourceUrl') or record.get('repository')
        payload = fetch_source(record, path).read_bytes() if fetch_source and downloadable else read(path)
        if hashlib.sha256(payload).hexdigest() != record['sha256']:
            raise ValueError('Android native source checksum mismatch: ' + path)
        if path not in written:
            info = tarfile.TarInfo('android-native-sources/' + path)
            info.size = len(payload)
            info.mode = 0o644
            archive.addfile(info, io.BytesIO(payload))
            written.add(path)
        return payload

    for record in records:
        payload = add(record)
        for notice in record.get('licenseFiles', []):
            add(notice)
        with tarfile.open(fileobj=io.BytesIO(payload)) as upstream:
            prefix = record.get('archiveRoot', '')
            prefix = prefix + '/' if prefix else ''
            if not record.get('licensePaths') and not record.get('licenseFiles'):
                raise ValueError('Missing native source license: ' + record['file'])
            for name in record.get('licensePaths', []):
                member = upstream.extractfile(prefix + name)
                if member is None or not member.read().strip():
                    raise ValueError('Missing native source license: ' + name)
            for name in record.get('requiredFiles', []):
                if not upstream.extractfile(prefix + name).read():
                    raise ValueError('Missing native build metadata: ' + name)
            for revision in record.get('revisions', []):
                metadata = upstream.extractfile(revision['archiveMetadata']).read().decode()
                if ('node: ' + revision['commit'] + '\n' not in metadata or
                        'tag: ' + revision['release'] + '\n' not in metadata):
                    raise ValueError('Native release revision mismatch: ' + revision['repository'])
            if 'cargoLock' not in record:
                continue
            roots.append(record)
            lock = upstream.extractfile(prefix + record['cargoLock']).read()
            if hashlib.sha256(lock).hexdigest() != record['cargoLockSha256']:
                raise ValueError('Native Cargo lock mismatch: ' + record['file'])
            for package in tomllib.loads(lock.decode())['package']:
                source = package.get('source', '')
                if source.startswith('registry+'):
                    dependency = registry.get((package['name'], package['version'], source))
                    if not dependency or dependency['sha256'] != package['checksum']:
                        raise ValueError('Missing locked Android crate: ' + repr(package))
                elif source.startswith('git+'):
                    dependency = git.get(source)
                    identity = {'name': package['name'], 'version': package['version']}
                    if (not dependency or identity not in dependency['cargoPackages'] or
                            dependency['commit'] != source.rsplit('#', 1)[-1]):
                        raise ValueError('Missing locked Android Git source: ' + source)
                elif source:
                    raise ValueError('Unsupported Android Cargo source: ' + source)
            for name in record.get('requiredSources', []):
                if name not in files:
                    raise ValueError('Missing Android native build input: ' + name)
            version_pin = record['versionPin']
            match = re.search(version_pin['pattern'], read(version_pin['file']).decode())
            if not match or match[1] != record['mavenCoordinate'].rsplit(':', 1)[1]:
                raise ValueError('Android Maven/native source version mismatch: ' + record['mavenCoordinate'])

    if source_manifest is not None:
        actual = {r['component'] for r in source_manifest}
        for record in roots:
            coordinate = record['mavenCoordinate']
            selected = {value for value in actual if value.rsplit(':', 1)[0] == coordinate.rsplit(':', 1)[0]}
            if selected != {coordinate}:
                raise ValueError('Native source differs from resolved Maven dependency: ' + record['mavenCoordinate'])
    if apk is not None:
        for record in roots:
            expected = record['nativeLibraries']
            matched = set(expected).intersection(apk.namelist())
            if expected and not matched:
                raise ValueError('Native source has no corresponding APK library: ' + record['mavenCoordinate'])
            for name in matched:
                if hashlib.sha256(apk.read(name)).hexdigest() != expected[name]:
                    raise ValueError('APK native library differs from pinned Maven release: ' + name)
    manifest = json.dumps(records, indent=2).encode() + b'\n'
    info = tarfile.TarInfo('android-native-sources/sources.json')
    info.size = len(manifest)
    info.mode = 0o644
    archive.addfile(info, io.BytesIO(manifest))
    return [{'component': r['mavenCoordinate'], 'commit': r['commit'],
             'source_sha256': r['sha256'], 'maven_artifact_sha256': r['mavenArtifactSha256']}
            for r in roots]
