#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Optional compiler-object backup; compiled runtime releases remain immutable."""
import argparse
from datetime import datetime, timezone
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


def restore(engine, target, contract, directory, repository=None):
    repository, name, url = identity(engine, target, contract, repository)
    raw = store.read_url(url)
    if raw is None:
        return False
    try:
        metadata = json.loads(raw)
        if (metadata['schema'] != 1 or metadata['engine'] != engine or metadata['target'] != target
                or metadata['contract'] != contract or not metadata.get('parts')):
            raise ValueError('Compiler cache contract differs')
        directory = Path(directory); directory.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='compiler-cache-', dir=directory.parent) as temporary:
            temporary = Path(temporary)
            archive = temporary / 'objects.tar.zst'
            with archive.open('wb') as combined:
                for part in metadata['parts']:
                    if (Path(part['name']).name != part['name'] or not re.fullmatch('[a-f0-9]{64}', part['sha256'])
                            or not 0 < part['size'] <= store.PART_SIZE
                            or part['name'] != f"cache-{engine}-{target}-{part['sha256']}.tar.zst.part"):
                        raise ValueError('Invalid compiler cache part')
                    path = temporary / part['name']
                    store.download(f'https://github.com/{repository}/releases/download/{store.TAG}/{part["name"]}',
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
        return True
    except (ValueError, KeyError, TypeError, OSError, tarfile.TarError) as error:
        print('Optional compiler backup is unusable: ' + str(error), flush=True)
        return False


def save(engine, target, contract, directory, repository=None):
    repository, pointer, _ = identity(engine, target, contract, repository)
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise ValueError('Compiler backups are published only by their native GitHub builder')
    # A deliberate cross-repository export is permitted for the old Office
    # cache migration; it needs a token authorized for the destination repo.
    if os.environ.get('GITHUB_REPOSITORY', '').lower() != repository.lower() and os.environ.get('TASKARIAN_CACHE_MIGRATION') != '1':
        raise ValueError('Compiler cache publisher differs from its target builder')
    directory = Path(directory).resolve()
    if not directory.is_dir() or not any(directory.iterdir()):
        return False
    release = store.gh('api', f'repos/{repository}/releases/tags/{store.TAG}')
    if release is None:
        try:
            store.gh('release', 'create', store.TAG, '--repo', repository, '--title', 'Taskarian build components',
                     '--notes', store.NOTE, '--prerelease', '--latest=false')
        except store.StoreUnavailable:
            # Parallel architecture jobs may create their shared release first.
            if store.gh('api', f'repos/{repository}/releases/tags/{store.TAG}') is None:
                raise
        release = store.gh('api', f'repos/{repository}/releases/tags/{store.TAG}')
    uploaded = {item['name']: item for item in release_assets(repository, release['id'])}
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
                previous = uploaded.get(name)
                if previous:
                    if previous['size'] != size or previous.get('digest') != 'sha256:' + checksum:
                        raise ValueError('Immutable compiler cache part checksum differs: ' + name)
                else:
                    store.gh('release', 'upload', store.TAG, str(renamed), '--repo', repository)
                metadata['parts'].append({'name': name, 'size': size, 'sha256': checksum})
                renamed.unlink()
        # Only this cache pointer is mutable; immutable runtime manifests never are.
        file = temporary / pointer; file.write_bytes(store.canonical(metadata) + b'\n')
        store.gh('release', 'upload', store.TAG, str(file), '--repo', repository, '--clobber')
    cleanup(engine, target, repository)
    return True


def release_assets(repository, release_id):
    result, page = [], 1
    while True:
        batch = store.gh('api', f'repos/{repository}/releases/{release_id}/assets?per_page=100&page={page}')
        result.extend(batch)
        if len(batch) < 100:
            return result
        page += 1


def cleanup(engine, target, repository):
    """Keep two compiler contracts and a day for readers of replaced pointers."""
    try:
        release = store.gh('api', f'repos/{repository}/releases/tags/{store.TAG}')
        assets = release_assets(repository, release['id'])
        prefix = f'compiler-cache-{engine}-{target}-'
        pointers = [item for item in assets if re.fullmatch(re.escape(prefix) + r'[a-f0-9]{64}\.json', item['name'])]
        pointers.sort(key=lambda item: item['updated_at'], reverse=True)
        now = datetime.now(timezone.utc)
        def age(item):
            return (now - datetime.fromisoformat(item['updated_at'].replace('Z', '+00:00'))).total_seconds()
        protected, parts = set(), set()
        for index, item in enumerate(pointers):
            if index >= 2 and age(item) >= 86400:
                continue
            raw = store.read_url(f'https://github.com/{repository}/releases/download/{store.TAG}/{item["name"]}')
            if raw is None:
                raise ValueError('Compiler cache pointer changed during cleanup')
            metadata = json.loads(raw)
            _, expected, _ = identity(engine, target, metadata['contract'], repository)
            if metadata['schema'] != 1 or metadata['engine'] != engine or metadata['target'] != target or expected != item['name']:
                raise ValueError('Compiler cache pointer metadata differs')
            protected.add(item['name'])
            for part in metadata['parts']:
                if not re.fullmatch(re.escape(f'cache-{engine}-{target}-') + r'[a-f0-9]{64}\.tar\.zst\.part', part['name']):
                    raise ValueError('Compiler cache part leaves its target')
                parts.add(part['name'])
        removable = {item['name'] for item in pointers} - protected
        for item in assets:
            is_part = re.fullmatch(re.escape(f'cache-{engine}-{target}-') + r'[a-f0-9]{64}\.tar\.zst\.part', item['name'])
            if age(item) > 86400 and (item['name'] in removable or is_part and item['name'] not in parts):
                store.gh('api', f'repos/{repository}/releases/assets/{item["id"]}', '--method', 'DELETE')
    except (store.StoreUnavailable, ValueError, KeyError, TypeError) as error:
        print('Compiler backup published; old-cache cleanup deferred: ' + str(error), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['restore', 'save'])
    parser.add_argument('engine', choices=['ccache', 'sccache'])
    parser.add_argument('target')
    parser.add_argument('--contract', type=Path, required=True)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--repository', help='One-time old Office compiler cache migration owner')
    args = parser.parse_args()
    contract = json.loads(args.contract.read_text())
    result = globals()[args.command](args.engine, args.target, contract, args.directory, args.repository)
    print(json.dumps({'hit' if args.command == 'restore' else 'saved': result}))


if __name__ == '__main__':
    main()
