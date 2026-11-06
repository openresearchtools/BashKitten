#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Package existing component payloads and full licenses without their sources.

The original native archives remain byte-for-byte intact. The transport archive
adds the complete Taskarian license and carries every existing legal asset.
"""
import gzip
import hashlib
import io
from pathlib import Path
import re
import shutil
import tarfile
import tempfile

ROLES = {'runtime', 'legal', 'build-support', 'metadata'}
LICENSE_NAME = 'licenses/Taskarian/LICENSE'
SOURCE_ARCHIVE = re.compile(
    r'(?:^|[-_])(?:source|sources|provenance)(?:[-_][^.]*)?'
    r'\.(?:tar(?:\.(?:gz|xz|zst|bz2))?|zip|jar)$', re.IGNORECASE)


def effective_role(item):
    """Honor legacy source filenames without changing canonical manifests."""
    return 'source' if item['role'] == 'source' or SOURCE_ARCHIVE.search(item['name']) else item['role']


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate(descriptor):
    if (not isinstance(descriptor, dict) or descriptor.get('schema') != 1 or
            descriptor.get('kind') != 'taskarian-component-runtime' or
            not re.fullmatch('[0-9a-f]{64}', descriptor.get('inputSha256', ''))):
        raise ValueError('Invalid component runtime descriptor')
    archive = descriptor['archive']
    records = [archive, *descriptor['assets'], descriptor['license']]
    for item in records:
        if (type(item.get('size')) is not int or item['size'] < 0 or
                not re.fullmatch('[0-9a-f]{64}', item.get('sha256', ''))):
            raise ValueError('Invalid component runtime size/checksum')
    if (not archive['name'].endswith('.tar.gz') or
            Path(archive['name']).name != archive['name'] or
            descriptor['license']['name'] != LICENSE_NAME):
        raise ValueError('Invalid component runtime archive/license name')
    names = set()
    for item in descriptor['assets']:
        name = item['name']
        if (Path(name).name != name or name in ('', '.', '..') or
                name in names or effective_role(item) not in ROLES):
            raise ValueError('Invalid component runtime asset')
        names.add(name)
    if not names:
        raise ValueError('Component runtime archive is empty')
    return descriptor


def pack(manifest, directory, output, license_path):
    """Return a transport descriptor; never open any source/cache asset."""
    directory, output = Path(directory), Path(output)
    license_path = Path(license_path)
    license_bytes = license_path.read_bytes()
    if not license_bytes.strip():
        raise ValueError('The full Taskarian license is required')
    assets = [{key: item[key] for key in ('name', 'role', 'size', 'sha256')}
              for item in manifest['assets'] if effective_role(item) in ROLES]
    descriptor = {'schema': 1, 'kind': 'taskarian-component-runtime',
                  'component': manifest['component'], 'target': manifest['target'],
                  'version': manifest['version'], 'inputSha256': manifest['inputSha256'],
                  'archive': {'name': output.name, 'size': 0, 'sha256': '0' * 64},
                  'assets': assets,
                  'license': {'name': LICENSE_NAME, 'size': len(license_bytes),
                              'sha256': hashlib.sha256(license_bytes).hexdigest()}}
    validate(descriptor)
    for item in assets:
        path = directory / item['name']
        if (not path.is_file() or path.is_symlink() or
                path.stat().st_size != item['size'] or sha(path) != item['sha256']):
            raise ValueError('Original component payload differs: ' + item['name'])
        if path.resolve() == output.resolve():
            raise ValueError('Runtime transport cannot overwrite an original payload')
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + '.packing')
    try:
        with temporary.open('wb') as raw:
            with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0, compresslevel=1) as compressed:
                with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.PAX_FORMAT) as archive:
                    for item in sorted([*assets, descriptor['license']], key=lambda value: value['name']):
                        info = tarfile.TarInfo(item['name'])
                        info.size = item['size']; info.mode = 0o644
                        if item['name'] == LICENSE_NAME:
                            archive.addfile(info, io.BytesIO(license_bytes))
                        else:
                            with (directory / item['name']).open('rb') as source:
                                archive.addfile(info, source)
        descriptor['archive'].update(size=temporary.stat().st_size, sha256=sha(temporary))
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return descriptor


def unpack(archive, directory, descriptor):
    """Restore only checksum-verified original payloads and the full license."""
    validate(descriptor)
    archive, directory = Path(archive), Path(directory)
    expected_archive = descriptor['archive']
    if archive.stat().st_size != expected_archive['size'] or sha(archive) != expected_archive['sha256']:
        raise ValueError('Component runtime transport checksum differs')
    expected = {item['name']: item for item in [*descriptor['assets'], descriptor['license']]}
    directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.runtime-', dir=directory) as temporary:
        temporary = Path(temporary)
        seen = set()
        with tarfile.open(archive, mode='r|gz') as payload:
            for member in payload:
                item = expected.get(member.name)
                if item is None or member.name in seen or not member.isfile() or member.size != item['size']:
                    raise ValueError('Unexpected component runtime archive member: ' + member.name)
                seen.add(member.name)
                target = temporary / member.name
                target.parent.mkdir(parents=True, exist_ok=True)
                with payload.extractfile(member) as source, target.open('wb') as destination:
                    shutil.copyfileobj(source, destination, 8 * 1024 ** 2)
                if target.stat().st_size != item['size'] or sha(target) != item['sha256']:
                    raise ValueError('Component runtime member checksum differs: ' + member.name)
                target.chmod(0o644)
        if seen != set(expected):
            raise ValueError('Component runtime archive is incomplete')
        for name in sorted(expected):
            target = directory / name
            target.parent.mkdir(parents=True, exist_ok=True)
            # Do not follow an existing license-directory symlink.
            if not target.parent.resolve().is_relative_to(directory.resolve()):
                raise ValueError('Component runtime destination escapes its directory')
            (temporary / name).replace(target)
    return [directory / item['name'] for item in descriptor['assets']]
