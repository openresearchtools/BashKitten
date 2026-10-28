#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Verify Collabora source and cache the native graph's pinned original archives.

Download preparation never resolves versions or substitutes build libraries.
"""
import argparse
import base64
import concurrent.futures
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

sys.path.append(str(Path(__file__).resolve().parents[1]))
import source_cache

ROOT = Path(__file__).resolve().parents[3]
UPSTREAM = ROOT / 'office/upstream'
SOURCE = UPSTREAM / 'online/source'
DEPENDENCIES = UPSTREAM / 'dependencies'
PART_SIZE = 90 * 1024 * 1024


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def git_object(kind, payload):
    return hashlib.sha1(kind.encode() + b' ' + str(len(payload)).encode() + b'\0' + payload).digest()


def git_tree(root):
    entries = []
    for path in root.iterdir():
        name = os.fsencode(path.name)
        if path.is_symlink():
            mode, value, key = b'120000', git_object('blob', os.fsencode(os.readlink(path))), name
        elif path.is_dir():
            if path.name == '.git':
                raise ValueError('Nested Git repository is not a source input')
            mode, value, key = b'40000', git_tree(path), name + b'/'
        else:
            mode = b'100755' if path.stat().st_mode & 0o111 else b'100644'
            value, key = git_object('blob', path.read_bytes()), name
        entries.append((key, mode + b' ' + name + b'\0' + value))
    return git_object('tree', b''.join(value for _, value in sorted(entries)))


def verify_source():
    pin = json.loads((UPSTREAM / 'online/source.json').read_text())
    if git_tree(SOURCE).hex() != pin['tree']:
        raise ValueError('Pristine Collabora Git tree differs from the recorded upstream release')
    for relative in pin['licenseFiles'] + pin['externalSourceLocks']:
        if not (SOURCE / relative).is_file() or not (SOURCE / relative).stat().st_size:
            raise ValueError('Missing source/license input: ' + relative)
    lock = json.loads((SOURCE / 'browser/npm-shrinkwrap.json.in').read_text())
    archives = set()
    for value in lock['packages'].values():
        if not value.get('resolved'):
            continue
        relative = value['resolved']
        if not relative.startswith('file:node_shrinkpack/'):
            raise ValueError('Frontend input is not retained offline: ' + relative)
        path = SOURCE / 'browser' / relative.removeprefix('file:')
        if not path.resolve().is_relative_to((SOURCE / 'browser/node_shrinkpack').resolve()):
            raise ValueError('Frontend archive leaves its retained directory')
        payload = path.read_bytes()
        if not any(hashlib.new(algorithm, payload).digest() == base64.b64decode(encoded)
                   for algorithm, encoded in (item.split('-', 1) for item in value['integrity'].split())):
            raise ValueError('Frontend integrity mismatch: ' + relative)
        archives.add(relative)
    return {'tree': pin['tree'], 'engineTree': pin['engineTree'], 'frontendArchives': len(archives)}


def engine_inputs(config=None):
    """Evaluate released Makefile.fetch; use configured BUILD_TYPE when provided."""
    prefix = 'DO_FETCH_TARBALLS := ALL\n'
    if config:
        text = config.read_text()
        original = re.search(r'^export SRC_ROOT=(.+)$', text, re.M)
        if not original:
            raise ValueError('Expected native generated config_host.mk')
        # A configure run inside the existing builder sees the same source
        # under /workspace. Relocate its literal include paths for this read.
        prefix = 'gb_Side := host\n' + text.replace(original.group(1), str(config.resolve().parent)) + '\n'
    recipe = prefix + f'''include {SOURCE / 'engine/download.lst'}
include {SOURCE / 'engine/Makefile.fetch'}
.PHONY: manifest
manifest:
\t$(foreach item,$(fetch_SRC_TARBALLS),$(info $(item)|$($(item))|$($(call fetch_Download__subst_var,$(item)))|https://gerrit.collaboraoffice.com/src))
\t$(foreach item,$(fetch_EXTERN_TARBALLS),$(info $(item)|$($(item))|$($(call fetch_Download__subst_var,$(item)))|https://gerrit.collaboraoffice.com/extern))
\t@true
'''
    result = subprocess.run(['make', '--no-builtin-rules', '--no-builtin-variables', '-f', '-', 'manifest'],
                            input=recipe, check=True, text=True, capture_output=True)
    records = []
    for line in result.stdout.splitlines():
        variable, name, expected, base = line.split('|')
        if len(expected) != 64 or any(c not in '0123456789abcdef' for c in expected):
            raise ValueError('Unpinned upstream archive: ' + variable)
        if Path(name).name != name:
            raise ValueError('Invalid upstream archive name')
        records.append({'variable': variable, 'name': name, 'url': base + '/' + name, 'sha256': expected})
    if not records:
        raise ValueError('Empty native dependency graph')
    return records


def retained_files(record):
    if 'parts' in record:
        return record['parts']
    return [{'file': record['file'], 'sha256': record['sha256']}]


def dependency_manifest():
    manifest = json.loads((DEPENDENCIES / 'sources.json').read_text())
    if manifest['downloadListSha256'] != digest(SOURCE / 'engine/download.lst'):
        raise ValueError('Native dependency manifest has a stale download.lst')
    if manifest['fetchRecipeSha256'] != digest(SOURCE / 'engine/Makefile.fetch'):
        raise ValueError('Native dependency manifest has a stale fetch recipe')
    return manifest


def dependency_file(record, cache=None, *, offline=False, local=None):
    """Resolve the original archive; old tracked parts are optional cache seeds."""
    try:
        return source_cache.fetch(record, cache, offline=True)
    except FileNotFoundError:
        pass
    if local is not None and Path(local).is_file():
        return source_cache.fetch(record, cache, local=local, offline=offline)
    parts = retained_files(record) if 'parts' in record or 'file' in record else []
    paths = []
    for part in parts:
        relative = Path(part['file'])
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Source archive leaves the retained directory')
        paths.append(DEPENDENCIES / relative)
    if paths and all(path.is_file() for path in paths):
        for part, path in zip(parts, paths):
            if digest(path) != part['sha256']:
                raise ValueError('Original source part checksum mismatch: ' + str(path))
        if len(paths) == 1:
            return source_cache.fetch(record, cache, local=paths[0], offline=offline)
        directory = Path(cache) if cache is not None else source_cache.default_cache()
        directory.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.office-source-', dir=directory) as temporary:
            joined = Path(temporary) / record['name']
            with joined.open('wb') as output:
                for path in paths:
                    with path.open('rb') as source:
                        shutil.copyfileobj(source, output)
            return source_cache.fetch(record, cache, local=joined, offline=offline)
    return source_cache.fetch(record, cache, offline=offline)


def verify_dependencies(cache=None, *, offline=False):
    manifest = dependency_manifest()
    for record in manifest['components']:
        dependency_file(record, cache, offline=offline)
    return manifest


def import_dependencies(config, cache):
    records = engine_inputs(config)
    def collect(record):
        path = source_cache.fetch(record, cache)
        return {**record, 'size': path.stat().st_size}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        materialized = list(pool.map(collect, records))
    manifest = {'schema': 1, 'downloadListSha256': digest(SOURCE / 'engine/download.lst'),
                'fetchRecipeSha256': digest(SOURCE / 'engine/Makefile.fetch'),
                'configuration': config.name if config else 'all released source archive inputs',
                'components': materialized}
    (DEPENDENCIES / 'sources.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return verify_dependencies(cache)


def prepare_cache(destination):
    manifest = dependency_manifest()
    destination.mkdir(parents=True, exist_ok=True)
    for record in manifest['components']:
        target = destination / record['name']
        original = dependency_file(record, local=target)
        if target.exists():
            if digest(target) != record['sha256']:
                raise ValueError('Native source cache checksum mismatch: ' + str(target))
            continue
        with tempfile.NamedTemporaryFile(dir=destination, delete=False) as output:
            temporary = Path(output.name)
            try:
                with original.open('rb') as source:
                    shutil.copyfileobj(source, output)
                output.flush()
                if digest(temporary) != record['sha256']:
                    raise ValueError('Native source cache copy changed: ' + record['name'])
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
    return len(manifest['components'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('verify-source')
    sub.add_parser('verify-dependencies')
    inspect = sub.add_parser('inspect-engine'); inspect.add_argument('--config', type=Path)
    collect = sub.add_parser('import-dependencies'); collect.add_argument('--config', type=Path)
    collect.add_argument('--cache', required=True, type=Path)
    prepare = sub.add_parser('prepare-cache'); prepare.add_argument('destination', type=Path)
    args = parser.parse_args()
    if args.command == 'verify-source': print(json.dumps(verify_source()))
    elif args.command == 'inspect-engine': print(json.dumps(engine_inputs(args.config), indent=2))
    elif args.command == 'import-dependencies': print('Verified', len(import_dependencies(args.config, args.cache)['components']), 'archives')
    elif args.command == 'verify-dependencies': print('Verified', len(verify_dependencies()['components']), 'archives')
    elif args.command == 'prepare-cache': print('Prepared', prepare_cache(args.destination), 'archives')


if __name__ == '__main__':
    main()
