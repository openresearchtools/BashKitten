#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Prepare checksum-pinned source inputs before allowing an offline resolver."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import tarfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'agent/packaging'))
from source_cache import fetch, default_cache

def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def checked(directory, record):
    relative = Path(record['file'])
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('Invalid retained source path')
    path = directory / relative
    if record.get('url'):
        return fetch(record, local=path)
    if relative.parts[0] == 'proxy' and relative.suffix == '.zip':
        return fetch({**record, 'url': 'https://proxy.golang.org/' + relative.relative_to('proxy').as_posix()}, local=path)
    if sha(path) != record['sha256']:
        raise ValueError('Retained source checksum mismatch: ' + str(path))
    return path

def stage_file(source, destination, expected):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if sha(destination) != expected:
            raise ValueError('Prepared source checksum mismatch: ' + str(destination))
        return
    with tempfile.NamedTemporaryFile(dir=destination.parent, prefix='.source-', delete=False) as output:
        temporary = Path(output.name)
        try:
            with source.open('rb') as stream:
                shutil.copyfileobj(stream, output)
            output.flush()
            temporary.chmod(0o644)
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=['go', 'frontend', 'termux'])
    parser.add_argument('--lock', type=Path)
    parser.add_argument('--commit')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    directory = ROOT / 'auth/dependencies' / args.kind
    manifest = json.loads((directory / 'sources.json').read_text())
    if args.kind == 'termux':
        record = next((item for item in manifest['components'] if item['sourceCommit'] == args.commit), None)
        if not record or not args.output:
            raise ValueError('A retained Termux commit and output are required')
        if sha(ROOT / record['lock']) != record['lockSha256']:
            raise ValueError('Termux source inventory does not match its lock')
        archive = checked(directory, record)
        args.output.mkdir(parents=True, exist_ok=True)
        with tarfile.open(archive) as source:
            prefix = source.getmembers()[0].name.split('/')[0] + '/'
            for member in source:
                if not member.name.startswith(prefix): continue
                member.name = member.name[len(prefix):]
                if member.name: source.extract(member, args.output, filter='data')
        return
    if args.kind == 'go':
        for name, digest in manifest['locks'].items():
            if sha(ROOT / name) != digest:
                raise ValueError('Go source inventory is stale: ' + name)
        proxy = default_cache() / 'auth-go-proxy' / sha(directory / 'sources.json')
        records = [record for module in manifest['modules'] for record in module['files'].values()] + manifest['moduleMetadata']
        for record in records:
            source = checked(directory, record)
            relative = Path(record['file']).relative_to('proxy')
            stage_file(source, proxy / relative, record['sha256'])
        print(proxy.resolve().as_uri())
    else:
        if sha(directory / manifest['lock']) != manifest['lockSha256']:
            raise ValueError('Frontend source inventory does not match pnpm lock')
        archives = [checked(directory, record) for record in manifest['components']]
        for record in manifest['components']:
            for notice in record.get('licenseFiles', []): checked(directory, notice)
        if args.lock:
            import yaml
            if sha(args.lock) != manifest['lockSha256']:
                raise ValueError('Build copy must start with the unmodified upstream lock')
            lock = yaml.safe_load(args.lock.read_text())
            pins = {record['name'] + '@' + record['version']: record for record in manifest['components']}
            for name, package in lock['packages'].items():
                pin = pins[name]
                if package['resolution'].get('integrity') != pin['integrity']:
                    raise ValueError('Frontend package integrity changed: ' + name)
                package['resolution']['tarball'] = 'file:' + str(checked(directory, pin).resolve())
            args.lock.write_text(yaml.safe_dump(lock, sort_keys=False, allow_unicode=True))
        print('Verified', len(archives), 'frontend source archives')

if __name__ == '__main__':
    main()
