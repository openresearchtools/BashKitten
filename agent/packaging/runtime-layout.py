#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Separate already-published dependency sources from native runtime payloads."""
import copy
import gzip
import hashlib
import io
from pathlib import Path, PurePosixPath
import shutil
import tarfile

RECIPE = 'agent/packaging/runtime-layout.py'
INPUT_KEY = 'runtimeLayout'
COMPONENTS = frozenset(('auth', 'auth-authelia', 'auth-caddy', 'auth-chisel',
                        'auth-remote', 'auth-cloudflared', 'android-remote'))


def sha(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def without_layout(value):
    """Recover the exact original compiler inputs, including aggregate leaves."""
    if isinstance(value, dict):
        return {key: without_layout(item) for key, item in value.items() if key != INPUT_KEY}
    if isinstance(value, list):
        return [without_layout(item) for item in value]
    return value


def member_path(member):
    path = PurePosixPath(member.name)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Native runtime member leaves its archive')
    return path.as_posix()


def is_source(component, name):
    return (name == 'share/source' or name.startswith('share/source/') or
            component == 'android-remote' and name == 'taskarian-remote-sources.jar')


class DigestReader:
    def __init__(self, source):
        self.source, self.digest = source, hashlib.sha256()

    def read(self, size=-1):
        block = self.source.read(size)
        self.digest.update(block)
        return block


def repack(component, archive, output, *, reference=None, source_commit=None):
    """Repack only; preserve every retained native file, mode and legal text."""
    if component not in COMPONENTS:
        raise ValueError('No source separation policy exists for this component')
    archive, output = Path(archive), Path(output)
    original = {'name': archive.name, 'size': archive.stat().st_size, 'sha256': sha(archive)}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + '.stripping')
    kept, removed, seen, checksums = [], [], set(), None
    try:
        with tarfile.open(archive, 'r|gz') as source, temporary.open('wb') as raw:
            with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0, compresslevel=1) as compressed:
                with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.PAX_FORMAT) as destination:
                    for member in source:
                        name = member_path(member)
                        if name in seen or not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                            raise ValueError('Unexpected or duplicate native runtime member: ' + name)
                        seen.add(name)
                        item = {'path': name, 'size': member.size, 'mode': member.mode,
                                'type': member.type.decode('ascii')}
                        if member.issym() or member.islnk():
                            item['linkname'] = member.linkname
                        data = DigestReader(source.extractfile(member)) if member.isfile() else None
                        if is_source(component, name):
                            if data:
                                while data.read(8 * 1024 ** 2):
                                    pass
                                item['sha256'] = data.digest.hexdigest()
                            removed.append(item)
                            continue
                        if name == 'SHA256SUMS':
                            if not member.isfile():
                                raise ValueError('Native runtime checksums must be an ordinary file')
                            while data.read(8 * 1024 ** 2):
                                pass
                            item['sha256'] = data.digest.hexdigest()
                            checksums = (copy.copy(member), item)
                            continue
                        info = copy.copy(member)
                        info.pax_headers = dict(member.pax_headers)
                        destination.addfile(info, data)
                        if data:
                            item['sha256'] = data.digest.hexdigest()
                        kept.append(item)
                    rewritten = None
                    if checksums:
                        info, previous = checksums
                        payload = ''.join(item['sha256'] + '  ' + item['path'] + '\n'
                                          for item in sorted(kept, key=lambda item: item['path'])
                                          if 'sha256' in item).encode()
                        info.size = len(payload)
                        info.pax_headers = dict(info.pax_headers)
                        info.pax_headers.pop('size', None)
                        destination.addfile(info, io.BytesIO(payload))
                        rewritten = {'path': 'SHA256SUMS', 'previousSha256': previous['sha256'],
                                     'sha256': hashlib.sha256(payload).hexdigest(), 'size': len(payload),
                                     'mode': info.mode, 'type': info.type.decode('ascii')}
        if sha(archive) != original['sha256']:
            raise ValueError('Original native runtime changed during repackaging')
        if not removed:
            # Already separated aggregates keep their exact canonical archive.
            shutil.copyfile(archive, temporary)
            if checksums:
                kept.append(checksums[1])
            rewritten = None
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return {'schema': 1, 'component': component, 'operation': 'separate-dependency-sources',
            'sourceReference': reference, 'producerSource': source_commit,
            'originalArchive': original,
            'runtimeArchive': {'name': output.name, 'size': output.stat().st_size, 'sha256': sha(output)},
            'removedMembers': removed, 'retainedMembers': kept, 'rewrittenChecksums': rewritten,
            'binaryMembers': [item for item in kept if item['path'].startswith('bin/') or
                              item['path'].endswith(('.aar', '.so'))]}
