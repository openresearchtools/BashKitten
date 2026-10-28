#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Archive every Git blob, including donor files marked export-ignore.

Source imports preserve upstream attributes unchanged. Those attributes must not
remove required corresponding source from the product's release source bundle.
"""
import gzip
from pathlib import Path
import subprocess
import tarfile


def archive_revision(repository, revision, destination, prefix='bashkitten/'):
    repository = Path(repository)
    commit = subprocess.check_output(['git', 'rev-parse', revision + '^{commit}'], cwd=repository, text=True).strip()
    timestamp = int(subprocess.check_output(['git', 'show', '-s', '--format=%ct', commit], cwd=repository, text=True))
    entries = subprocess.check_output(['git', 'ls-tree', '-r', '-z', commit], cwd=repository).split(b'\0')
    objects = subprocess.Popen(['git', 'cat-file', '--batch'], cwd=repository,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    try:
        with Path(destination).open('wb') as output, gzip.GzipFile(fileobj=output, mode='wb', filename='', mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.PAX_FORMAT) as archive:
                for entry in entries:
                    if not entry:
                        continue
                    metadata, raw_name = entry.split(b'\t', 1)
                    mode, kind, oid = metadata.split()
                    if kind != b'blob':
                        raise ValueError('Unmaterialized Git object in release source: ' + raw_name.decode())
                    objects.stdin.write(oid + b'\n'); objects.stdin.flush()
                    actual_oid, actual_kind, size = objects.stdout.readline().split()
                    if actual_oid != oid or actual_kind != b'blob':
                        raise ValueError('Unexpected Git object while collecting source')
                    member = tarfile.TarInfo(prefix + raw_name.decode('utf-8', 'surrogateescape'))
                    member.mtime = timestamp
                    member.mode = 0o755 if mode == b'100755' else 0o644
                    if mode == b'120000':
                        member.type = tarfile.SYMTYPE
                        member.linkname = objects.stdout.read(int(size)).decode('utf-8', 'surrogateescape')
                        member.mode = 0o777
                        archive.addfile(member)
                    else:
                        member.size = int(size)
                        archive.addfile(member, objects.stdout)
                    if objects.stdout.read(1) != b'\n':
                        raise ValueError('Truncated Git object while collecting source')
        objects.stdin.close()
        if objects.wait() != 0:
            raise RuntimeError('Git source collection failed')
    finally:
        if objects.poll() is None:
            objects.terminate(); objects.wait()
        objects.stdout.close()
