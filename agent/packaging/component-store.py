#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Exact native component assets in permanent architecture-owned releases.

Build owners supply their scoped input map and verify their native payload. This
module only transports immutable files; it never resolves dependencies or builds.
"""
import argparse
import base64
import hashlib
import importlib.util
import http.client
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
REPOSITORIES = {'openresearchtools/taskarian-build-' + suffix
                for suffix in ('amd64', 'arm64', 'android', 'android-x86_64')}
ASSET_LIMIT = 1000
MAIN_REPOSITORY = 'openresearchtools/Taskarian'
_RELEASE_IDS = {}
MANIFEST = re.compile(r'component-(.+)-(linux-amd64|linux-arm64|termux-aarch64|termux-x86_64|android(?:-x86_64)?)-[0-9a-f]{64}\.json')


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
    path = lookup_path(component, target, digest)
    return {'repository': repo, 'tag': None, 'component': component, 'target': target,
            'inputSha256': digest, 'manifest': name,
            'url': lookup_url(repo, path)}


def index_tag(component, target):
    repository(target)
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]*', component):
        raise ValueError('Invalid component identifier')
    return f'component-index-{component}-{target}'


def release_tag(component, target, version, revision):
    index_tag(component, target)
    version = re.sub(r'[^A-Za-z0-9._-]+', '-', version).strip('-')
    if not version or not re.fullmatch(r'[0-9a-f]{64}', revision):
        raise ValueError('Invalid component version/build revision')
    return f'component-{component}-{target}-{version}-build-{revision[:16]}'


def reference_identity(reference):
    name = reference['manifestName']
    match = MANIFEST.fullmatch(name)
    if not match or reference['repository'] != repository(match[2]):
        raise ValueError('Invalid component reference target')
    return match[1], match[2], name[-69:-5]


def lookup_path(component, target, digest):
    index_tag(component, target)
    if not re.fullmatch(r'[0-9a-f]{64}', digest):
        raise ValueError('Invalid component input revision')
    return f'components/{component}/{target}/{digest}.json'


def lookup_url(repo, path):
    if repo not in REPOSITORIES or not re.fullmatch(r'[A-Za-z0-9._/-]+', path) or '..' in path.split('/'):
        raise ValueError('Invalid build lookup path')
    return f'https://raw.githubusercontent.com/{repo}/main/{path}'


def read_revision(repo, component, target, digest):
    raw = read_url(lookup_url(repo, lookup_path(component, target, digest)))
    if raw is None:
        return None
    record = json.loads(raw)
    if (record.get('schema') != 1 or record.get('component') != component or
            record.get('target') != target or record.get('inputSha256') != digest):
        raise StoreUnavailable('Invalid component version lookup; retry without rebuilding')
    return record


def put_lookup(repo, path, record, *, immutable=False):
    """Independent Git files avoid lost whole-index updates and release caps."""
    lookup_url(repo, path)
    encoded = canonical(record) + b'\n'
    endpoint = f'repos/{repo}/contents/{path}'
    for attempt in range(4):
        existing = gh('api', endpoint)
        if existing:
            previous = base64.b64decode(existing['content'])
            if previous == encoded:
                return
            if immutable:
                raise ValueError('Immutable build lookup already exists with different bytes: ' + path)
        body = {'message': 'Record reusable build output ' + path,
                'content': base64.b64encode(encoded).decode(), 'branch': 'main'}
        if existing:
            body['sha'] = existing['sha']
        try:
            gh('api', endpoint, '--method', 'PUT', data=body)
            return
        except StoreUnavailable:
            if attempt == 3:
                raise
            # Concurrent independent files/another cache snapshot can advance
            # the branch; re-read the affected file instead of a global index.
            time.sleep(2 ** attempt)


def reference_tag(reference):
    component, target, digest = reference_identity(reference)
    if reference.get('tag'):
        tag = reference['tag']
        if not re.fullmatch(r'[A-Za-z0-9._-]+', tag):
            raise ValueError('Invalid component release tag')
        return tag
    record = read_revision(reference['repository'], component, target, digest)
    if record is None:
        return None
    if (record.get('manifestName') != reference['manifestName'] or
            reference.get('manifestSha256') and record.get('manifestSha256') != reference['manifestSha256']):
        raise ValueError('Component index differs from pinned reference')
    expected = release_tag(component, target, record['version'], digest)
    if record.get('tag') != expected:
        raise ValueError('Invalid permanent component release tag')
    return expected


def manifest_url(reference):
    tag = reference_tag(reference)
    if tag is None:
        return None
    return f'https://github.com/{reference["repository"]}/releases/download/{tag}/{reference["manifestName"]}'


def runtime_owner():
    spec = importlib.util.spec_from_file_location('component_runtime_bundle', Path(__file__).with_name('component-runtime.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


def read_url(url):
    """No Actions API/cache search. A proven 404 is the only absent manifest."""
    for attempt in range(3):
        try:
            # An earlier absent-generation lookup can leave a cached 404 just
            # after its manifest is uploaded. Refresh only these small direct
            # manifest requests; immutable binary downloads remain resumable.
            fresh = url + ('&' if '?' in url else '?') + 'taskarian_component=' + str(time.time_ns())
            request = urllib.request.Request(fresh, headers={'User-Agent': 'Taskarian-Component-Builder/1',
                                                            'Cache-Control': 'no-cache'})
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
    problem = 'download interrupted'
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
                    raise http.client.HTTPException('Invalid component download range')
                with partial.open('ab' if append else 'wb') as output:
                    shutil.copyfileobj(response, output, 8 * 1024 ** 2)
            if partial.stat().st_size != size or sha(partial) != checksum:
                partial.unlink(missing_ok=True)
                raise http.client.HTTPException('Component asset checksum/size mismatch: ' + destination.name)
            partial.replace(destination)
            return
        except urllib.error.HTTPError as error:
            if error.code == 416 and partial.exists() and partial.stat().st_size == size and sha(partial) == checksum:
                partial.replace(destination); return
            if error.code in (404, 410):
                problem = 'published asset is temporarily missing (' + str(error.code) + ')'
            else:
                problem = 'HTTP ' + str(error.code)
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, ConnectionError, OSError) as error:
            problem = str(error)
        if attempt < 2:
            time.sleep(2 ** attempt)
    raise StoreUnavailable('Component asset download unavailable; retry without rebuilding: ' + url + ' (' + problem + ')')


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
        if (dependency.get('repository') not in REPOSITORIES or
                Path(dependency.get('manifestName', '')).name != dependency.get('manifestName') or
                not re.fullmatch('[0-9a-f]{64}', dependency.get('manifestSha256', ''))):
            raise ValueError('Invalid component dependency reference')
    return ident


def lookup(component, target, inputs):
    ident = identity(component, target, inputs)
    record = read_revision(ident['repository'], component, target, ident['inputSha256'])
    if record is None:
        return None
    reference = {'repository': ident['repository'], 'manifestName': ident['manifest'],
                 'manifestSha256': record['manifestSha256']}
    tag = release_tag(component, target, record['version'], ident['inputSha256'])
    if record.get('tag') != tag or record.get('manifestName') != ident['manifest']:
        raise StoreUnavailable('Published component version lookup differs; retry without rebuilding')
    url = f'https://github.com/{ident["repository"]}/releases/download/{tag}/{ident["manifest"]}'
    raw = read_url(url)
    if raw is None:
        raise StoreUnavailable('Indexed component manifest is missing; retry without rebuilding: ' + url)
    try:
        manifest = json.loads(raw)
        validate(manifest, ident)
        if hashlib.sha256(raw).hexdigest() != record['manifestSha256']:
            raise ValueError('Component index checksum differs')
    except (ValueError, KeyError, TypeError, UnicodeError) as error:
        raise StoreUnavailable(f'Published component manifest is invalid for {component}/{target}; retry without rebuilding') from error
    return {'manifest': manifest, **reference, 'tag': tag, 'url': url}


def fetch_asset(repo, tag, item, directory):
    if (Path(item['name']).name != item['name'] or item['name'] in ('', '.', '..') or
            type(item.get('size')) is not int or item['size'] < 0 or
            not re.fullmatch('[0-9a-f]{64}', item.get('sha256', '')) or not item.get('parts') or
            sum(part['size'] for part in item['parts']) != item['size']):
        raise ValueError('Invalid component transport archive')
    for part in item['parts']:
        if (Path(part['asset']).name != part['asset'] or part['asset'] in ('', '.', '..') or
                type(part.get('size')) is not int or not 0 <= part['size'] <= PART_SIZE or
                not re.fullmatch('[0-9a-f]{64}', part.get('sha256', ''))):
            raise ValueError('Invalid component transport part')
    destination = Path(directory) / item['name']
    if destination.is_file() and destination.stat().st_size == item['size'] and sha(destination) == item['sha256']:
        return destination
    parts = []
    for part in item['parts']:
        path = Path(directory) / '.parts' / part['asset']
        download(f'https://github.com/{repo}/releases/download/{tag}/{part["asset"]}', path, part['size'], part['sha256'])
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
    return destination


def fetch(reference, directory, roles=None, names=None):
    repo, name = reference['repository'], reference['manifestName']
    reference_identity(reference)
    tag = reference_tag(reference)
    if tag is None:
        return None
    url = f'https://github.com/{repo}/releases/download/{tag}/{name}'
    raw = read_url(url)
    if raw is None:
        raise StoreUnavailable('Indexed component manifest is missing: ' + url)
    if reference.get('manifestSha256') and hashlib.sha256(raw).hexdigest() != reference['manifestSha256']:
        raise ValueError('Pinned component manifest checksum differs')
    manifest = json.loads(raw); ident = validate(manifest)
    if repo != ident['repository'] or name != ident['manifest']:
        raise ValueError('Component reference identity differs')
    directory = Path(directory); directory.mkdir(parents=True, exist_ok=True)
    wanted = ROLES if roles is None else set(roles)
    role = runtime_owner().effective_role
    if names is not None and not set(names) <= {item['name'] for item in manifest['assets']}:
        raise ValueError('Requested component filenames are absent')
    selected = [item for item in manifest['assets'] if role(item) in wanted and (names is None or item['name'] in names)]
    missing = [item for item in selected if not (directory / item['name']).is_file() or
               (directory / item['name']).stat().st_size != item['size'] or sha(directory / item['name']) != item['sha256']]
    use_bundle = names is None and manifest['component'] not in ('application', 'corresponding-source') and any(role(item) in ('runtime', 'build-support') for item in missing)
    runtime_missing = [item for item in missing if role(item) != 'source'] if use_bundle else []
    if runtime_missing:
        descriptor_raw = read_url(f'https://github.com/{repo}/releases/download/{tag}/{name[:-5]}.runtime.json')
        if descriptor_raw is None:
            raise StoreUnavailable('Permanent component runtime/license bundle is missing; retry without rebuilding')
        descriptor = runtime_owner().validate(json.loads(descriptor_raw))
        record = read_revision(repo, manifest['component'], manifest['target'], manifest['inputSha256'])
        if not record or hashlib.sha256(descriptor_raw).hexdigest() != record.get('runtimeSha256'):
            raise ValueError('Component runtime descriptor checksum differs')
        expected = [{key: item[key] for key in ('name', 'role', 'size', 'sha256')}
                    for item in manifest['assets'] if role(item) != 'source']
        if (any(descriptor.get(key) != manifest[key] for key in ('component', 'target', 'version', 'inputSha256')) or
                descriptor.get('assets') != expected):
            raise ValueError('Component runtime descriptor differs from canonical manifest')
        archive = fetch_asset(repo, tag, descriptor['archive'], directory)
        runtime_owner().unpack(archive, directory, descriptor)
        archive.unlink()
    for item in missing:
        if role(item) == 'source' or not use_bundle:
            fetch_asset(repo, tag, item, directory)
    for item in selected:
        destination = directory / item['name']
        if not destination.is_file() or destination.stat().st_size != item['size'] or sha(destination) != item['sha256']:
            raise ValueError('Restored component member differs: ' + item['name'])
    parts_directory = directory / '.parts'
    if parts_directory.is_dir() and not any(parts_directory.iterdir()):
        parts_directory.rmdir()
    reference = {'repository': repo, 'tag': tag, 'manifestName': name,
                 'manifestSha256': hashlib.sha256(raw).hexdigest(), 'url': url}
    (directory / '.component-reference.json').write_bytes(canonical(reference) + b'\n')
    return {'manifest': manifest, **reference, 'directory': str(directory)}


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
        raise StoreUnavailable(f'Published component {component}/{target} cannot be restored; retry without rebuilding: {error}') from error


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


def ensure_release(repo, tag, title):
    if repo not in REPOSITORIES:
        raise ValueError('Release publisher is outside the four architecture builders')
    endpoint = f'repos/{repo}/releases'
    release = gh('api', endpoint + '/tags/' + tag)
    if release is None:
        try:
            release = gh('api', endpoint, '--method', 'POST', data={'tag_name': tag,
                'target_commitish': os.environ['GITHUB_SHA'], 'name': title, 'body': NOTE,
                'draft': False, 'prerelease': True, 'make_latest': 'false'})
        except FileExistsError:
            release = gh('api', endpoint + '/tags/' + tag)
    if release is None:
        raise StoreUnavailable('Concurrent component release creation is not yet available; retry publication')
    if release.get('body') != NOTE or not release.get('prerelease'):
        gh('api', endpoint + '/' + str(release['id']), '--method', 'PATCH',
           data={'body': NOTE, 'prerelease': True, 'make_latest': 'false'})
    _RELEASE_IDS[repo, tag] = release['id']
    return release


def release_assets(repo, release_id):
    assets, page = [], 1
    while True:
        batch = gh('api', f'repos/{repo}/releases/{release_id}/assets?per_page=100&page={page}')
        if batch is None:
            raise StoreUnavailable('Component release asset inventory disappeared; retry publication')
        assets.extend(batch)
        if len(batch) < 100:
            return assets
        page += 1


def upload_file(repo, tag, path, uploaded):
    path = Path(path)
    checksum = sha(path)
    previous = uploaded.get(path.name)
    if previous:
        if previous['size'] != path.stat().st_size or previous.get('digest') != 'sha256:' + checksum:
            raise ValueError('Immutable component asset collision: ' + path.name)
        return
    if len(uploaded) >= ASSET_LIMIT:
        raise ValueError('Component release exceeds the GitHub asset limit')
    release_id = _RELEASE_IDS.get((repo, tag))
    if release_id is None:
        release_id = ensure_release(repo, tag, tag)['id']
    # The release is already known. Upload directly instead of an extra API
    # lookup for each archive part (hundreds during the one-time migration).
    url = f'https://uploads.github.com/repos/{repo}/releases/{release_id}/assets?name=' + urllib.parse.quote(path.name, safe='')
    result = gh('api', url, '--method', 'POST', '-H', 'Content-Type: application/octet-stream', '--input', str(path))
    if result.get('size') != path.stat().st_size or result.get('digest') != 'sha256:' + checksum:
        raise StoreUnavailable('Uploaded component checksum is not yet available; retry publication')
    uploaded[path.name] = {'size': path.stat().st_size, 'digest': 'sha256:' + checksum}


def upload_payload(repo, tag, file, stem, uploaded, temporary):
    file = Path(file)
    item = {'name': file.name, 'size': file.stat().st_size, 'sha256': sha(file), 'parts': []}
    with file.open('rb') as source:
        while True:
            part = temporary / 'part'
            remaining = PART_SIZE
            with part.open('wb') as output:
                while remaining:
                    block = source.read(min(8 * 1024 ** 2, remaining))
                    if not block:
                        break
                    output.write(block); remaining -= len(block)
            if not part.stat().st_size and item['parts']:
                part.unlink(); break
            checksum = sha(part)
            named = temporary / (stem + '--' + checksum + '.part')
            part.rename(named)
            upload_file(repo, tag, named, uploaded)
            item['parts'].append({'asset': named.name, 'size': named.stat().st_size, 'sha256': checksum})
            size = named.stat().st_size; named.unlink()
            if size < PART_SIZE:
                break
    return item


def publish_index(manifest, manifest_sha, runtime_sha, tag):
    repo = repository(manifest['target'])
    component, target, digest = (manifest[key] for key in ('component', 'target', 'inputSha256'))
    name = identity(component, target, manifest['inputs'])['manifest']
    record = {'schema': 1, 'component': component, 'target': target, 'inputSha256': digest,
              'version': manifest['version'], 'tag': tag, 'manifestName': name,
              'manifestSha256': manifest_sha, 'runtimeSha256': runtime_sha}
    put_lookup(repo, lookup_path(component, target, digest), record, immutable=True)


def publish_runtime(manifest, directory, tag, uploaded, temporary):
    if manifest['component'] in ('application', 'corresponding-source'):
        return None
    ident = validate(manifest)
    archive = temporary / (ident['manifest'][:-5] + '.runtime.tar.gz')
    descriptor = runtime_owner().pack(manifest, directory, archive, Path(__file__).resolve().parents[2] / 'LICENSE')
    descriptor['archive'] = upload_payload(ident['repository'], tag, archive, ident['manifest'][:-5] + '-runtime', uploaded, temporary)
    file = temporary / (ident['manifest'][:-5] + '.runtime.json')
    file.write_bytes(canonical(descriptor) + b'\n')
    upload_file(ident['repository'], tag, file, uploaded)
    archive.unlink()
    return sha(file)


def publish(component, target, version, inputs, directory, *, assets, source_commit, producer=None, dependencies=(), validation_only=False):
    ident = identity(component, target, inputs); directory = Path(directory)
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_REPOSITORY') != ident['repository']:
        raise ValueError('Components publish only from their architecture builder')
    if not isinstance(version, str) or not version:
        raise ValueError('Use the real upstream/product version')
    existing = lookup(component, target, inputs)
    if existing:
        if validation_only:
            for name in assets:
                (directory / name).unlink(missing_ok=True)
            result = fetch(existing, directory)
            if result is None:
                raise StoreUnavailable('Canonical component disappeared during validation; retry restoration')
            print(f'Fresh native-owner validation completed for {component}/{target}; retained canonical producer ' + existing['manifest']['sourceCommit'], flush=True)
            return result
        if existing['manifest']['version'] != version or any(sha(directory / item['name']) != item['sha256'] for item in existing['manifest']['assets']):
            raise ValueError('An immutable component already exists with different producer bytes')
        return existing
    publisher = {'repository': ident['repository'], 'run': os.environ.get('GITHUB_RUN_ID'),
                 'attempt': os.environ.get('GITHUB_RUN_ATTEMPT'), 'job': os.environ.get('GITHUB_JOB'),
                 'workflowCommit': os.environ.get('GITHUB_SHA')}
    manifest = {'schema': 1, 'component': component, 'target': target, 'version': version,
                'inputSha256': ident['inputSha256'], 'inputs': inputs, 'sourceCommit': source_commit,
                'producer': producer or publisher, 'publisher': publisher, 'dependencies': list(dependencies), 'assets': []}
    tag = release_tag(component, target, version, ident['inputSha256'])
    release = ensure_release(ident['repository'], tag, f'{component} {version} / {target}')
    uploaded = {item['name']: item for item in release_assets(ident['repository'], release['id'])}
    with tempfile.TemporaryDirectory(prefix='taskarian-component-publish-') as temporary:
        temporary = Path(temporary)
        for name, role in sorted(assets.items()):
            if Path(name).name != name or role not in ROLES:
                raise ValueError('Component assets must have flat names and declared roles')
            file = directory / name
            if not file.is_file() or file.is_symlink():
                raise ValueError('Missing component asset: ' + name)
            manifest['assets'].append({**upload_payload(ident['repository'], tag, file, ident['manifest'][:-5], uploaded, temporary), 'role': role})
        validate(manifest, ident)
        runtime_sha = publish_runtime(manifest, directory, tag, uploaded, temporary)
        encoded = canonical(manifest) + b'\n'
        file = temporary / ident['manifest']; file.write_bytes(encoded)
        upload_file(ident['repository'], tag, file, uploaded)
        publish_index(manifest, hashlib.sha256(encoded).hexdigest(), runtime_sha, tag)
    return {'manifest': manifest, 'repository': ident['repository'], 'tag': tag, 'manifestName': ident['manifest'],
            'manifestSha256': hashlib.sha256(encoded).hexdigest(),
            'url': f'https://github.com/{ident["repository"]}/releases/download/{tag}/{ident["manifest"]}', 'directory': str(directory)}


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
