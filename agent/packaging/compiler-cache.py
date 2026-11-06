#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Optional compiler-object backup; compiled runtime releases remain immutable."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile

spec = importlib.util.spec_from_file_location('compiler_component_store', Path(__file__).with_name('component-store.py'))
store = importlib.util.module_from_spec(spec); spec.loader.exec_module(store)


def has_objects(directory):
    """Stop at the first native cache entry; ignore empty/statistics-only caches."""
    for parent, directories, files in os.walk(directory):
        directories[:] = [name for name in directories if name not in ('tmp', 'preprocessor')]
        for name in files:
            # Both caches use digest names; ccache also adds its entry suffix.
            # Its compact digest alphabet extends beyond hexadecimal.
            if not re.fullmatch(r'[0-9a-z]{16,}[MRW]?', name):
                continue
            path = Path(parent) / name
            if not path.is_symlink() and path.is_file() and path.stat().st_size:
                return True
    return False


def identity(engine, target, contract, repository=None):
    if engine not in ('ccache', 'sccache'):
        raise ValueError('Unsupported native compiler cache')
    checksum = hashlib.sha256(store.canonical(contract)).hexdigest()
    name = f'compiler-cache-{engine}-{target}-{checksum}.json'
    expected = store.repository(target)
    repository = repository or expected
    if repository not in (expected, 'openresearchtools/office-builds'):
        raise ValueError('Compiler cache repository is outside its native owners')
    return repository, name, f'https://github.com/{repository}/releases/download/{store.TAG}/{name}'


def index_identity(engine, target, contract, repository=None):
    repository, name, _ = identity(engine, target, contract, repository)
    digest = hashlib.sha256(store.canonical(contract)).hexdigest()
    path = f'compiler-caches/{engine}/{target}/{digest}.json'
    return repository, name, digest, path


def validate_metadata(raw, engine, target, contract):
    metadata = json.loads(raw)
    if (metadata['schema'] != 1 or metadata['engine'] != engine or metadata['target'] != target
            or metadata['contract'] != contract or not metadata.get('parts')
            or len(metadata['parts']) >= store.ASSET_LIMIT
            or not re.fullmatch('[a-f0-9]{64}', metadata['sha256'])):
        raise ValueError('Compiler cache contract differs')
    for part in metadata['parts']:
        if (Path(part['name']).name != part['name']
                or not re.fullmatch('[a-f0-9]{64}', part['sha256'])
                or type(part['size']) is not int or not 0 < part['size'] <= store.PART_SIZE
                or part['name'] != f"cache-{engine}-{target}-{part['sha256']}.tar.zst.part"):
            raise ValueError('Invalid compiler cache part')
    return metadata


def cache_index(engine, target, contract, repository=None):
    repository, name, digest, path = index_identity(engine, target, contract, repository)
    raw = store.read_url(store.lookup_url(repository, path))
    index = json.loads(raw) if raw else {'schema': 1, 'engine': engine, 'target': target,
                                       'contractSha256': digest, 'snapshot': None}
    if (index['schema'] != 1 or index['engine'] != engine or index['target'] != target
            or index['contractSha256'] != digest):
        raise ValueError('Compiler cache index differs')
    return repository, name, digest, path, index


def resolve(engine, target, contract, repository=None):
    repository, name, digest, _, index = cache_index(engine, target, contract, repository)
    entry = index['snapshot']
    if entry:
        tag = entry['tag']
        if (not re.fullmatch(re.escape(f'compiler-cache-{engine}-{target}-{digest[:16]}-') + '[a-f0-9]{64}', tag)
                or not re.fullmatch('[a-f0-9]{64}', entry['metadataSha256'])):
            raise ValueError('Invalid compiler cache snapshot reference')
        raw = store.read_url(f'https://github.com/{repository}/releases/download/{tag}/{name}')
        if raw is None or hashlib.sha256(raw).hexdigest() != entry['metadataSha256']:
            raise ValueError('Immutable compiler cache metadata differs')
        metadata = validate_metadata(raw, engine, target, contract)
        if not tag.endswith('-' + metadata['sha256']):
            raise ValueError('Compiler cache archive identity differs')
        return repository, tag, raw, metadata
    # Read-only migration fallback. New saves never grow the old shared release.
    _, _, url = identity(engine, target, contract, repository)
    raw = store.read_url(url)
    if raw is None:
        return None
    return repository, store.TAG, raw, validate_metadata(raw, engine, target, contract)


def restore(engine, target, contract, directory, repository=None):
    try:
        snapshot = resolve(engine, target, contract, repository)
        if snapshot is None:
            return False
        repository, tag, _, metadata = snapshot
        directory = Path(directory); directory.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='compiler-cache-', dir=directory.parent) as temporary:
            temporary = Path(temporary)
            archive = temporary / 'objects.tar.zst'
            with archive.open('wb') as combined:
                for part in metadata['parts']:
                    path = temporary / part['name']
                    store.download(f'https://github.com/{repository}/releases/download/{tag}/{part["name"]}',
                                   path, part['size'], part['sha256'])
                    with path.open('rb') as source:
                        shutil.copyfileobj(source, combined, 8 * 1024 ** 2)
                    path.unlink()
            if store.sha(archive) != metadata['sha256']:
                raise ValueError('Compiler backup checksum differs')
            with subprocess.Popen(['zstd', '-q', '-d', '-c', archive], stdout=subprocess.PIPE) as decoder:
                with tarfile.open(fileobj=decoder.stdout, mode='r|') as bundle:
                    for member in bundle:
                        if not member.isfile() and not member.isdir():
                            raise ValueError('Compiler backups contain ordinary objects only')
                        bundle.extract(member, directory, filter='data')
                if decoder.wait():
                    raise ValueError('Compiler backup decompression failed')
        return has_objects(directory)
    except (store.StoreUnavailable, ValueError, KeyError, TypeError, OSError, tarfile.TarError) as error:
        print('Optional compiler backup is unusable: ' + str(error), flush=True)
        return False


def require_publisher(repository):
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise ValueError('Compiler backups are published only by their native GitHub builder')
    # A deliberate cross-repository export is permitted for the old Office
    # cache migration; it needs a token authorized for the destination repo.
    if os.environ.get('GITHUB_REPOSITORY', '').lower() != repository.lower() and os.environ.get('TASKARIAN_CACHE_MIGRATION') != '1':
        raise ValueError('Compiler cache publisher differs from its target builder')


def publish_snapshot(engine, target, contract, raw, directory, repository=None, *, archive=None, source=None):
    repository, pointer, digest, index_path, index = cache_index(engine, target, contract, repository)
    require_publisher(repository)
    metadata = validate_metadata(raw, engine, target, contract)
    tag = f'compiler-cache-{engine}-{target}-{digest[:16]}-{metadata["sha256"]}'
    release = store.ensure_release(repository, tag, f'{engine} compiler objects · {target}')
    uploaded = {item['name']: item for item in store.release_assets(repository, release['id'])}
    directory = Path(directory)
    archive_sha = hashlib.sha256()
    offset = 0
    for part in metadata['parts']:
        file = directory / part['name']
        generated = not file.exists()
        if generated:
            if archive:
                with Path(archive).open('rb') as origin, file.open('wb') as output:
                    origin.seek(offset)
                    remaining = part['size']
                    while remaining:
                        block = origin.read(min(remaining, 8 * 1024 ** 2))
                        if not block:
                            raise ValueError('Compiler cache archive changed')
                        output.write(block); remaining -= len(block)
            elif source:
                source_repository, source_tag = source
                store.download(f'https://github.com/{source_repository}/releases/download/{source_tag}/{part["name"]}',
                               file, part['size'], part['sha256'])
        if not file.is_file() or file.stat().st_size != part['size'] or store.sha(file) != part['sha256']:
            raise ValueError('Compiler cache changed before publication')
        with file.open('rb') as stream:
            while block := stream.read(8 * 1024 ** 2):
                archive_sha.update(block)
        previous = uploaded.get(part['name'])
        if previous:
            if previous['size'] != part['size'] or previous.get('digest') != 'sha256:' + part['sha256']:
                raise ValueError('Immutable compiler cache part checksum differs: ' + part['name'])
        else:
            store.gh('release', 'upload', tag, str(file), '--repo', repository)
            uploaded[part['name']] = {'size': part['size'], 'digest': 'sha256:' + part['sha256']}
        if generated:
            file.unlink()
        offset += part['size']
    if archive_sha.hexdigest() != metadata['sha256']:
        raise ValueError('Compiler cache archive checksum differs before publication')
    checksum = hashlib.sha256(raw).hexdigest()
    previous = uploaded.get(pointer)
    if previous:
        # A repeated archive can have different run metadata. Keep its original
        # immutable producer rather than replacing a published snapshot.
        previous_raw = store.read_url(f'https://github.com/{repository}/releases/download/{tag}/{pointer}')
        if previous_raw is None:
            raise ValueError('Published compiler cache metadata disappeared')
        previous_metadata = validate_metadata(previous_raw, engine, target, contract)
        if previous_metadata['parts'] != metadata['parts'] or previous_metadata['sha256'] != metadata['sha256']:
            raise ValueError('Immutable compiler cache snapshot differs')
        checksum = hashlib.sha256(previous_raw).hexdigest()
    else:
        file = directory / pointer; file.write_bytes(raw)
        store.gh('release', 'upload', tag, str(file), '--repo', repository)
    # Each contract owns one small Git file. Concurrent unrelated contracts
    # never replace one another; successful snapshots themselves stay immutable.
    index['snapshot'] = {'tag': tag, 'metadataSha256': checksum}
    store.put_lookup(repository, index_path, index)
    return True


def save(engine, target, contract, directory, repository=None):
    repository, _, _ = identity(engine, target, contract, repository)
    require_publisher(repository)
    directory = Path(directory).resolve()
    if not has_objects(directory):
        return False
    with tempfile.TemporaryDirectory(prefix='compiler-cache-publish-', dir=directory.parent) as temporary:
        temporary = Path(temporary)
        archive = temporary / 'objects.tar.zst'
        run = subprocess.run(['tar', '-I', 'zstd -T0 -1', '-cf', str(archive), '-C', str(directory), '.'])
        if run.returncode:
            raise ValueError('Compiler cache changed during backup')
        metadata = {'schema': 1, 'engine': engine, 'target': target, 'contract': contract,
                    'sha256': store.sha(archive), 'parts': [],
                    'producer': {'repository': os.environ.get('GITHUB_REPOSITORY'),
                                 'runId': os.environ.get('GITHUB_RUN_ID')}}
        with archive.open('rb') as source:
            while True:
                part = temporary / 'part'
                remaining = store.PART_SIZE
                with part.open('wb') as output:
                    while remaining:
                        block = source.read(min(remaining, 8 * 1024 ** 2))
                        if not block:
                            break
                        output.write(block); remaining -= len(block)
                size = part.stat().st_size
                if not size:
                    part.unlink(); break
                checksum = store.sha(part)
                name = f'cache-{engine}-{target}-{checksum}.tar.zst.part'
                renamed = temporary / name; part.rename(renamed)
                metadata['parts'].append({'name': name, 'size': size, 'sha256': checksum})
                renamed.unlink()
        return publish_snapshot(engine, target, contract, store.canonical(metadata) + b'\n', temporary,
                                repository, archive=archive)


def migrate(engine, target, contract, directory, repository=None):
    """Copy an existing backup into permanent storage without compiling objects."""
    destination = store.repository(target)
    require_publisher(destination)
    snapshot = resolve(engine, target, contract, repository)
    if snapshot is None:
        return False
    repository, tag, raw, metadata = snapshot
    if repository == destination and tag != store.TAG:
        return True
    directory = Path(directory); directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='compiler-cache-migrate-', dir=directory) as temporary:
        temporary = Path(temporary)
        return publish_snapshot(engine, target, contract, raw, temporary, destination, source=(repository, tag))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['restore', 'save', 'migrate', 'available'])
    parser.add_argument('engine', nargs='?', choices=['ccache', 'sccache'])
    parser.add_argument('target', nargs='?')
    parser.add_argument('--contract', type=Path)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--repository', help='One-time old Office compiler cache migration owner')
    args = parser.parse_args()
    if args.command == 'available':
        available = has_objects(args.directory)
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
                output.write('available=' + str(available).lower() + '\n')
        print(json.dumps({'available': available}))
        return
    if not args.engine or not args.target or not args.contract:
        parser.error('restore/save/migrate require engine, target and --contract')
    contract = json.loads(args.contract.read_text())
    result = globals()[args.command](args.engine, args.target, contract, args.directory, args.repository)
    print(json.dumps({'hit' if args.command == 'restore' else 'saved': result}))


if __name__ == '__main__':
    main()
