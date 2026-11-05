#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Exact native component assets in the architecture repository's rolling release.

Build owners supply their scoped input map and verify their native payload. This
module only transports immutable files; it never resolves dependencies or builds.
"""
import argparse
import hashlib
import http.client
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

TAG = 'components'
NOTE = 'Build components for Taskarian. Get the main app at https://github.com/openresearchtools/Taskarian.'
PART_SIZE = 1024 ** 3
ROLES = {'runtime', 'source', 'legal', 'build-support', 'metadata'}


class StoreUnavailable(RuntimeError):
    """Transport failed: retry without recompiling finished components."""


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def repository(target):
    suffix = {'linux-amd64': 'amd64', 'linux-arm64': 'arm64',
              'termux-aarch64': 'android', 'termux-x86_64': 'android-x86_64',
              'android': 'android', 'android-aarch64': 'android',
              'android-arm64': 'android', 'android-arm64-v8a': 'android',
              'android-x86_64': 'android-x86_64'}.get(target)
    if suffix is None:
        raise ValueError('Unsupported component target: ' + target)
    return 'openresearchtools/taskarian-build-' + suffix


def identity(component, target, inputs):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]*', component):
        raise ValueError('Invalid component identifier')
    digest = hashlib.sha256(canonical(inputs)).hexdigest()
    name = f'component-{component}-{target}-{digest}.json'
    repo = repository(target)
    return {'repository': repo, 'tag': TAG, 'component': component, 'target': target,
            'inputSha256': digest, 'manifest': name,
            'url': f'https://github.com/{repo}/releases/download/{TAG}/{name}'}


def read_url(url):
    """No Actions API/cache search. A proven 404 is the only absent manifest."""
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'Taskarian-Component-Builder/1'})
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code in (404, 410):
                return None
            if error.code not in (408, 429) and error.code < 500:
                raise StoreUnavailable(f'Component download refused ({error.code}): {url}') from error
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, ConnectionError, OSError):
            pass
        if attempt < 2:
            time.sleep(2 ** attempt)
    raise StoreUnavailable('Component release is unavailable; retry without rebuilding: ' + url)


def download(url, destination, size, checksum):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file() and destination.stat().st_size == size and sha(destination) == checksum:
        return
    partial = destination.with_name(destination.name + '.partial')
    for attempt in range(3):
        offset = partial.stat().st_size if partial.exists() else 0
        if offset > size or (offset == size and sha(partial) != checksum):
            partial.unlink(); offset = 0
        headers = {'User-Agent': 'Taskarian-Component-Builder/1'}
        if offset:
            headers['Range'] = f'bytes={offset}-'
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=180) as response:
                append = offset and response.status == 206
                if append and not response.headers.get('Content-Range', '').startswith(f'bytes {offset}-'):
                    raise ValueError('Invalid component download range')
                with partial.open('ab' if append else 'wb') as output:
                    shutil.copyfileobj(response, output, 8 * 1024 ** 2)
            if partial.stat().st_size != size or sha(partial) != checksum:
                partial.unlink(missing_ok=True)
                raise ValueError('Component asset checksum/size mismatch: ' + destination.name)
            partial.replace(destination)
            return
        except urllib.error.HTTPError as error:
            if error.code == 416 and partial.exists() and partial.stat().st_size == size and sha(partial) == checksum:
                partial.replace(destination); return
            if error.code in (404, 410):
                raise ValueError('Published component asset is missing: ' + url) from error
        except ValueError:
            raise
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, ConnectionError, OSError):
            pass
        if attempt < 2:
            time.sleep(2 ** attempt)
    raise StoreUnavailable('Component asset download interrupted; retry without rebuilding: ' + url)


def validate(manifest, expected=None):
    if not isinstance(manifest, dict) or manifest.get('schema') != 1:
        raise ValueError('Invalid component manifest')
    ident = identity(manifest['component'], manifest['target'], manifest['inputs'])
    if (manifest.get('inputSha256') != ident['inputSha256'] or
            not isinstance(manifest.get('version'), str) or not manifest['version'] or
            not re.fullmatch('[0-9a-f]{40}', manifest.get('sourceCommit', '')) or
            not isinstance(manifest.get('producer'), dict) or not manifest.get('assets')):
        raise ValueError('Component identity/provenance is incomplete')
    if expected and any(manifest.get(key) != expected[key] for key in ('component', 'target', 'inputSha256')):
        raise ValueError('Component effective inputs do not match')
    seen = set()
    for item in manifest['assets']:
        name = item['name']
        if (Path(name).name != name or name in seen or item.get('role') not in ROLES or
                type(item.get('size')) is not int or item['size'] < 0 or
                not re.fullmatch('[0-9a-f]{64}', item.get('sha256', '')) or not item.get('parts')):
            raise ValueError('Invalid component asset inventory')
        seen.add(name)
        if sum(part['size'] for part in item['parts']) != item['size']:
            raise ValueError('Invalid component part sizes')
        for part in item['parts']:
            if (Path(part['asset']).name != part['asset'] or not part['asset'].startswith(ident['manifest'][:-5] + '--') or
                    type(part.get('size')) is not int or not 0 <= part['size'] <= PART_SIZE or
                    not re.fullmatch('[0-9a-f]{64}', part.get('sha256', ''))):
                raise ValueError('Invalid immutable component part')
    for dependency in manifest.get('dependencies', []):
        if (not re.fullmatch(r'openresearchtools/taskarian-build-[a-z0-9-]+', dependency.get('repository', '')) or
                Path(dependency.get('manifestName', '')).name != dependency.get('manifestName') or
                not re.fullmatch('[0-9a-f]{64}', dependency.get('manifestSha256', ''))):
            raise ValueError('Invalid component dependency reference')
    return ident


def lookup(component, target, inputs):
    ident = identity(component, target, inputs)
    raw = read_url(ident['url'])
    if raw is None:
        return None
    manifest = json.loads(raw)
    validate(manifest, ident)
    return {'manifest': manifest, 'repository': ident['repository'], 'manifestName': ident['manifest'],
            'manifestSha256': hashlib.sha256(raw).hexdigest(), 'url': ident['url']}


def fetch(reference, directory, roles=None):
    repo, name = reference['repository'], reference['manifestName']
    if not re.fullmatch(r'openresearchtools/taskarian-build-[a-z0-9-]+', repo) or Path(name).name != name:
        raise ValueError('Unsafe component reference')
    url = f'https://github.com/{repo}/releases/download/{TAG}/{name}'
    raw = read_url(url)
    if raw is None:
        return None
    if reference.get('manifestSha256') and hashlib.sha256(raw).hexdigest() != reference['manifestSha256']:
        raise ValueError('Pinned component manifest checksum differs')
    manifest = json.loads(raw); ident = validate(manifest)
    if repo != ident['repository'] or name != ident['manifest']:
        raise ValueError('Component reference identity differs')
    directory = Path(directory); directory.mkdir(parents=True, exist_ok=True)
    wanted = ROLES if roles is None else set(roles)
    for item in manifest['assets']:
        if item['role'] not in wanted:
            continue
        destination = directory / item['name']
        if destination.is_file() and destination.stat().st_size == item['size'] and sha(destination) == item['sha256']:
            continue
        parts = []
        for part in item['parts']:
            path = directory / '.parts' / part['asset']
            download(f'https://github.com/{repo}/releases/download/{TAG}/{part["asset"]}', path, part['size'], part['sha256'])
            parts.append(path)
        temporary = destination.with_name(destination.name + '.assembling')
        with temporary.open('wb') as output:
            for part in parts:
                with part.open('rb') as source:
                    shutil.copyfileobj(source, output, 8 * 1024 ** 2)
        if temporary.stat().st_size != item['size'] or sha(temporary) != item['sha256']:
            temporary.unlink(); raise ValueError('Reconstructed component differs')
        temporary.replace(destination)
        for part in parts:
            part.unlink()
    parts_directory = directory / '.parts'
    if parts_directory.is_dir() and not any(parts_directory.iterdir()):
        parts_directory.rmdir()
    return {'manifest': manifest, 'repository': repo, 'manifestName': name,
            'manifestSha256': hashlib.sha256(raw).hexdigest(), 'url': url, 'directory': str(directory)}


def restore(component, target, inputs, directory, *, roles=None, requested_source=None):
    try:
        result = lookup(component, target, inputs)
        if result is None:
            return None
        result = fetch(result, directory, roles)
        if result is not None and requested_source:
            result['requestedSource'] = requested_source
        return result
    except (ValueError, KeyError, TypeError, UnicodeError) as error:
        print(f'Unusable optional component {component}/{target}: {error}', flush=True)
        return None


def gh(*arguments, data=None):
    command = ['gh', *arguments]
    if data is not None:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json') as stream:
            json.dump(data, stream); stream.flush()
            return gh(*arguments, '--input', stream.name)
    for attempt in range(3):
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if result.returncode == 0:
            return json.loads(result.stdout) if result.stdout.strip().startswith(('{', '[')) else result.stdout
        if re.search(r'HTTP (?:404|410)\b', result.stderr) and arguments and arguments[0] == 'api' and '--method' not in arguments:
            return None
        if 'HTTP 422' in result.stderr and '--method' in arguments and 'POST' in arguments:
            raise FileExistsError(result.stderr)
        if attempt < 2:
            time.sleep(2 ** attempt)
    raise StoreUnavailable('Component publication interrupted; retry this job: ' + result.stderr[-1200:])


def publish(component, target, version, inputs, directory, *, assets, source_commit, producer=None, dependencies=()):
    ident = identity(component, target, inputs); directory = Path(directory)
    if (os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_REPOSITORY') != ident['repository']):
        raise ValueError('Components publish only from their architecture builder')
    if not isinstance(version, str) or not version:
        raise ValueError('Use the real upstream/product version')
    existing = lookup(component, target, inputs)
    if existing:
        if (existing['manifest']['version'] != version or
                any(sha(directory / item['name']) != item['sha256'] for item in existing['manifest']['assets'])):
            raise ValueError('An immutable component already exists with different producer bytes')
        return existing
    publisher = {'repository': ident['repository'], 'run': os.environ.get('GITHUB_RUN_ID'),
                 'attempt': os.environ.get('GITHUB_RUN_ATTEMPT'), 'job': os.environ.get('GITHUB_JOB'),
                 'workflowCommit': os.environ.get('GITHUB_SHA')}
    manifest = {'schema': 1, 'component': component, 'target': target, 'version': version,
                'inputSha256': ident['inputSha256'], 'inputs': inputs, 'sourceCommit': source_commit,
                'producer': producer or publisher, 'publisher': publisher, 'dependencies': list(dependencies), 'assets': []}
    endpoint = f'repos/{ident["repository"]}/releases'
    release = gh('api', endpoint + '/tags/' + TAG)
    if release is None:
        try:
            release = gh('api', endpoint, '--method', 'POST', data={'tag_name': TAG,
                'target_commitish': os.environ['GITHUB_SHA'], 'name': 'Build components', 'body': NOTE,
                'draft': False, 'prerelease': True, 'make_latest': 'false'})
        except FileExistsError:
            release = gh('api', endpoint + '/tags/' + TAG)
            if release is None:
                raise StoreUnavailable('Concurrent component release creation is not yet available; retry publication')
    if release['body'] != NOTE or not release['prerelease']:
        gh('api', endpoint + '/' + str(release['id']), '--method', 'PATCH',
           data={'body': NOTE, 'prerelease': True, 'make_latest': 'false'})
    uploaded = {item['name']: item for item in release['assets']}
    with tempfile.TemporaryDirectory(prefix='taskarian-component-publish-') as temporary:
        temporary = Path(temporary)
        for name, role in sorted(assets.items()):
            if Path(name).name != name or role not in ROLES:
                raise ValueError('Component assets must have flat names and declared roles')
            file = directory / name
            if not file.is_file() or file.is_symlink():
                raise ValueError('Missing component asset: ' + name)
            item = {'name': name, 'role': role, 'size': file.stat().st_size, 'sha256': sha(file), 'parts': []}
            with file.open('rb') as source:
                for index, offset in enumerate(range(0, max(item['size'], 1), PART_SIZE), 1):
                    part_name = ident['manifest'][:-5] + '--' + name + (f'.part{index:04d}' if item['size'] > PART_SIZE else '')
                    part = temporary / part_name
                    remaining = min(PART_SIZE, item['size'] - offset)
                    with part.open('wb') as output:
                        while remaining:
                            block = source.read(min(8 * 1024 ** 2, remaining))
                            if not block:
                                raise ValueError('Component changed during publication')
                            output.write(block); remaining -= len(block)
                    record = {'asset': part_name, 'size': part.stat().st_size, 'sha256': sha(part)}
                    previous = uploaded.get(part_name)
                    if previous:
                        if previous['size'] != record['size'] or previous.get('digest') != 'sha256:' + record['sha256']:
                            raise ValueError('Immutable component asset collision: ' + part_name)
                    else:
                        gh('release', 'upload', TAG, str(part), '--repo', ident['repository'])
                    item['parts'].append(record)
                    part.unlink()
            manifest['assets'].append(item)
        validate(manifest, ident)
        encoded = canonical(manifest) + b'\n'
        file = temporary / ident['manifest']; file.write_bytes(encoded)
        # This immutable manifest is the completion marker; never a global index.
        gh('release', 'upload', TAG, str(file), '--repo', ident['repository'])
    cleanup(ident['repository'], component, target)
    return {'manifest': manifest, 'repository': ident['repository'], 'manifestName': ident['manifest'],
            'manifestSha256': hashlib.sha256(encoded).hexdigest(), 'url': ident['url'], 'directory': str(directory)}


def cleanup(repo, component, target):
    """Retain active generations and dependency pins; only publishers use the API."""
    try:
        release = gh('api', f'repos/{repo}/releases/tags/{TAG}')
        if release is None:
            return
        assets = []
        page = 1
        while True:
            batch = gh('api', f'repos/{repo}/releases/{release["id"]}/assets?per_page=100&page={page}')
            assets.extend(batch)
            if len(batch) < 100:
                break
            page += 1
        groups = {}
        pattern = r'component-(.+)-(linux-amd64|linux-arm64|termux-aarch64|termux-x86_64|android(?:-x86_64)?)-[0-9a-f]{64}\.json'
        for item in assets:
            match = re.fullmatch(pattern, item['name'])
            if match:
                groups.setdefault(match.groups(), []).append(item)
        protected = set()
        pending = []
        now = datetime.now(timezone.utc)
        for members in groups.values():
            members.sort(key=lambda item: item['created_at'], reverse=True)
            for index, item in enumerate(members):
                age = (now - datetime.fromisoformat(item['created_at'].replace('Z', '+00:00'))).total_seconds()
                if index < 2 or age < 24 * 60 * 60:
                    pending.append(item['name'])
        while pending:
            name = pending.pop()
            if name in protected:
                continue
            protected.add(name)
            raw = read_url(f'https://github.com/{repo}/releases/download/{TAG}/{name}')
            if raw is None:
                return  # An incomplete view cannot justify deletion.
            record = json.loads(raw); validate(record)
            pending.extend(dep['manifestName'] for dep in record.get('dependencies', []) if dep['repository'] == repo)
        for item in groups.get((component, target), []):
            if item['name'] in protected:
                continue
            raw = read_url(f'https://github.com/{repo}/releases/download/{TAG}/{item["name"]}')
            if raw is None:
                continue
            record = json.loads(raw); validate(record)
            doomed = {part['asset'] for asset in record['assets'] for part in asset['parts']} | {item['name']}
            for asset in assets:
                if asset['name'] in doomed:
                    gh('api', f'repos/{repo}/releases/assets/{asset["id"]}', '--method', 'DELETE')
    except (StoreUnavailable, ValueError, KeyError, TypeError) as error:
        print('Published component retained; old-generation cleanup deferred:', error, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['identity', 'restore', 'publish'])
    parser.add_argument('component'); parser.add_argument('target')
    parser.add_argument('--inputs', type=Path, required=True)
    parser.add_argument('--directory', type=Path)
    parser.add_argument('--spec', type=Path)
    args = parser.parse_args(); inputs = json.loads(args.inputs.read_text())
    if args.action == 'identity':
        result = identity(args.component, args.target, inputs)
    elif args.action == 'restore':
        result = restore(args.component, args.target, inputs, args.directory)
    else:
        spec = json.loads(args.spec.read_text())
        result = publish(args.component, args.target, inputs=inputs, directory=args.directory, **spec)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
