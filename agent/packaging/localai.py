#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Publish optional AI runtimes in their architecture builders, independently of apps."""
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

ROOT = Path(__file__).resolve().parents[2]
RECIPE = ROOT / 'agent/localai'
TARGETS = {'linux-amd64': ('linux', 'amd64'), 'linux-arm64': ('linux', 'arm64'),
           'termux-aarch64': ('android', 'arm64'), 'termux-x86_64': ('android', 'amd64')}
spec = importlib.util.spec_from_file_location('localai_store', Path(__file__).with_name('component-store.py'))
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def identity(engine, target, backend):
    system, architecture = TARGETS[target]
    if engine not in ('llama', 'whisper') or backend not in ('cuda', 'vulkan') or (system == 'android' and backend == 'cuda'):
        raise ValueError('Unsupported LocalAI variant')
    pin = json.loads((RECIPE / 'upstreams.json').read_text())[engine]
    if not re.fullmatch(r'v?\d+\.\d+\.\d+', pin['version']) or type(pin['packageRevision']) is not int or pin['packageRevision'] < 1:
        raise ValueError('LocalAI requires an official version and positive package revision')
    repository = store.repository(target)
    if os.environ.get('GITHUB_REPOSITORY') != repository or os.environ.get('GITHUB_ACTIONS') != 'true':
        raise ValueError('LocalAI builds and publication run only in their architecture builder')
    tag = f'localai-{engine}-{system}-{architecture}-{backend}-{pin["version"]}-r{pin["packageRevision"]}'
    return {'engine': engine, 'target': target, 'os': system, 'arch': architecture, 'backend': backend,
            'repository': repository, 'release': tag, 'pin': pin,
            'manifest': f'https://github.com/{repository}/releases/download/{tag}/manifest.json',
            'catalog': f'localai/{system}/{architecture}/{backend}/{engine}.json'}


def validate(manifest, plan):
    pin = plan['pin']
    upstream = {'tag': pin['version'], 'commit': pin['commit'], 'url': pin['releaseUrl'],
                'releaseId': pin['releaseId'], 'tagObject': pin['tagObject']}
    if (manifest.get('version') != 1 or manifest.get('release') != plan['release'] or
            manifest.get('engine') != plan['engine'] or manifest.get('sourceCommit') != pin['commit'] or
            manifest.get('upstreamVersion') != pin['version'] or manifest.get('upstreamRelease') != upstream or
            manifest.get('packageRevision') != pin['packageRevision'] or len(manifest.get('artifacts', [])) != 1):
        raise ValueError('LocalAI release differs from its pinned upstream and package revision')
    entry = manifest['artifacts'][0]
    if (any(entry.get(key) != plan[key] for key in ('engine', 'os', 'arch', 'backend')) or
            entry.get('sourceCommit') != pin['commit'] or entry.get('upstreamRelease') != upstream or
            entry.get('packageRevision') != pin['packageRevision'] or entry.get('capabilities', {}).get('cpu') is not True):
        raise ValueError('LocalAI runtime target/provenance differs')
    if plan['engine'] == 'llama' and not all(entry['capabilities'].get(key) is True for key in ('router', 'subprocess')):
        raise ValueError('The llama runtime must retain its native router and subprocess support')
    if plan['engine'] == 'whisper' and (entry['capabilities'].get('streamingVad') is not True or
                                       'taskarian-vad' not in entry.get('executables', [])):
        raise ValueError('The speech runtime must retain Parakeet and streaming VAD')
    for key in ('file', 'sourceFile'):
        if Path(entry.get(key, '')).name != entry.get(key) or not entry[key].endswith('.tar.gz'):
            raise ValueError('Invalid LocalAI archive filename')
    for key in ('sha256', 'sourceSHA256'):
        if not re.fullmatch('[a-f0-9]{64}', entry.get(key, '')):
            raise ValueError('Invalid LocalAI archive checksum')
    base = plan['manifest'].rsplit('/', 1)[0] + '/'
    if (entry.get('url') != base + entry['file'] or entry.get('sourceURL') != base + entry['sourceFile'] or
            type(entry.get('size')) is not int or entry['size'] <= 0):
        raise ValueError('LocalAI archive URLs or download size differ')
    if plan['backend'] == 'cuda' and (not entry.get('cudaRequirements', {}).get('toolkit', '').startswith('12.') or
            any(not re.fullmatch('[a-f0-9]{64}', entry['cudaRequirements'].get('bundled', {}).get(name, {}).get('sha256', ''))
                for name in ('libcudart.so.12', 'libcublas.so.12', 'libcublasLt.so.12'))):
        raise ValueError('CUDA runtime must include CUDA 12 cudart, cuBLAS and cuBLASLt')
    return entry


def advance(plan, raw):
    """Publish the small pointer last; late older builds must never downgrade it."""
    repo, path = plan['repository'], plan['catalog']
    previous = store.read_url(store.lookup_url(repo, path, store.builder_head(repo, refresh=True)))
    if previous:
        pointer = json.loads(previous)
        old = store.read_url(pointer['manifest'])
        if old is None or hashlib.sha256(old).hexdigest() != pointer['manifestSHA256']:
            raise ValueError('Existing LocalAI catalog manifest is unavailable or differs')
        old = json.loads(old)
        order = lambda manifest: (tuple(map(int, manifest['upstreamVersion'].lstrip('v').split('.'))), manifest['packageRevision'])
        if order(old) > order(json.loads(raw)):
            print('A newer runtime is already advertised; preserving its catalog entry', flush=True)
            return
    store.put_lookup(repo, path, {'version': 1, 'repository': repo, 'release': plan['release'],
                                 'manifest': plan['manifest'], 'manifestSHA256': hashlib.sha256(raw).hexdigest()})


def plan_build(engine, target, backend, directory):
    plan = identity(engine, target, backend)
    raw = store.read_url(plan['manifest'])
    if raw is None:
        # Recover a finished upload whose final manifest/pointer write was
        # interrupted. Never compile again just to redo publication metadata.
        pin = plan['pin']
        name = f'{engine}-{pin["version"]}-r{pin["packageRevision"]}-{plan["os"]}-{plan["arch"]}-{backend}'
        base = plan['manifest'].rsplit('/', 1)[0] + '/'
        release = store.gh('api', f'repos/{plan["repository"]}/releases/tags/{plan["release"]}')
        assets = ({item['name']: item for item in store.release_assets(plan['repository'], release['id'])}
                  if release else {})
        record = store.read_url(base + name + '.json')
        if record is None and release and release['draft'] and name + '.json' in assets:
            with tempfile.TemporaryDirectory(prefix='localai-recovery-') as temporary:
                store.gh('release', 'download', plan['release'], '--repo', plan['repository'],
                         '--pattern', name + '.json', '--dir', temporary)
                record = (Path(temporary) / (name + '.json')).read_bytes()
        if record:
            entry = json.loads(record)
            candidate = {'version': 1, 'engine': engine, 'release': plan['release'],
                         'upstreamVersion': pin['version'], 'sourceCommit': pin['commit'],
                         'upstreamRelease': entry['upstreamRelease'], 'packageRevision': pin['packageRevision'],
                         'artifacts': [entry]}
            validate(candidate, plan)
            if (all(assets.get(entry[key], {}).get('digest') == 'sha256:' + entry[digest]
                    for key, digest in (('file', 'sha256'), ('sourceFile', 'sourceSHA256')))
                    and {'SOURCES.md', 'SHA256SUMS'} <= assets.keys()):
                with tempfile.TemporaryDirectory(prefix='localai-publication-') as temporary:
                    path = Path(temporary) / 'manifest.json'
                    write(path, candidate)
                    store._RELEASE_IDS[plan['repository'], plan['release']] = release['id']
                    store.upload_file(plan['repository'], plan['release'], path, assets)
                    if release['draft']:
                        store.gh('api', f'repos/{plan["repository"]}/releases/{release["id"]}', '--method', 'PATCH',
                                 data={'draft': False, 'prerelease': True, 'make_latest': 'false'})
                    raw = path.read_bytes()
    if raw:
        validate(json.loads(raw), plan)
        advance(plan, raw)
        print('Reusing the published runtime; no compilation, source or cache downloads', flush=True)
    plan['build'] = raw is None
    directory.mkdir(parents=True, exist_ok=True)
    write(directory / 'plan.json', plan)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            values = {'build': str(plan['build']).lower(), 'commit': plan['pin']['commit'],
                      'upstream_repository': plan['pin']['repository'], 'version': plan['pin']['version'],
                      'recipe_release': f'{engine}-{plan["pin"]["version"]}-r{plan["pin"]["packageRevision"]}',
                      'release': plan['release'], 'os': plan['os'], 'arch': plan['arch']}
            for name, value in values.items():
                output.write(f'{name}={value}\n')
    return plan


def publish(plan, directory):
    pin = plan['pin']
    entries = [json.loads(path.read_text()) for path in directory.glob('*.json') if path.name != 'manifest.json']
    if len(entries) != 1:
        raise ValueError('Exactly one native runtime record is required per builder/backend')
    manifest = {'version': 1, 'engine': plan['engine'], 'release': plan['release'],
                'upstreamVersion': pin['version'], 'sourceCommit': pin['commit'],
                'upstreamRelease': entries[0]['upstreamRelease'], 'packageRevision': pin['packageRevision'],
                'artifacts': entries}
    entry = validate(manifest, plan)
    for name, checksum in ((entry['file'], entry['sha256']), (entry['sourceFile'], entry['sourceSHA256'])):
        if store.sha(directory / name) != checksum:
            raise ValueError('LocalAI runtime/source checksum differs: ' + name)
        if (directory / name).stat().st_size >= 2 * 1024 ** 3:
            raise ValueError('LocalAI archive exceeds the GitHub asset limit; split source delivery before publication')
    raw = (json.dumps(manifest, indent=2) + '\n').encode()
    write(directory / 'manifest.json', manifest)
    source_url = plan['manifest'].rsplit('/', 1)[0] + '/' + entry['sourceFile']
    (directory / 'SOURCES.md').write_text(
        f'# {plan["engine"]} {pin["version"]} sources\n\n'
        f'[Complete matching engine, dependency and build sources]({source_url})\n\n'
        f'SHA-256: `{entry["sourceSHA256"]}`\n\n'
        f'Official upstream: [{pin["version"]}]({pin["releaseUrl"]}), commit `{pin["commit"]}`.\n\n'
        'The runtime archive includes its full license notices. NVIDIA components retain their '
        'NVIDIA license; their proprietary implementation source is unavailable. Exact versions '
        'and retained source-available inputs are recorded in the source archive.\n')
    with (directory / 'SHA256SUMS').open('w') as output:
        for path in sorted(directory.iterdir()):
            if path.is_file() and path.name != 'SHA256SUMS':
                output.write(store.sha(path) + '  ' + path.name + '\n')
    repository, tag = plan['repository'], plan['release']
    endpoint = f'repos/{repository}/releases'
    release = store.gh('api', endpoint + '/tags/' + tag)
    if release is None:
        release = store.gh('api', endpoint, '--method', 'POST', data={
            'tag_name': tag, 'target_commitish': 'main', 'name': tag, 'body': store.NOTE,
            'draft': True, 'prerelease': True, 'make_latest': 'false'})
    if not release['draft']:
        previous = store.read_url(plan['manifest'])
        if previous is None:
            raise ValueError('Published runtime has no final manifest; inspect before replacing any published bytes')
        validate(json.loads(previous), plan)
        advance(plan, previous)
        return
    uploaded = {item['name']: item for item in store.release_assets(plan['repository'], release['id'])}
    # Draft assets may be replaced after an interrupted upload. Publishing the
    # final manifest seals the release; completed releases are never overwritten.
    store._RELEASE_IDS[repository, tag] = release['id']
    def upload(path):
        previous = uploaded.get(path.name)
        if previous and (previous['size'] != path.stat().st_size or previous.get('digest') != 'sha256:' + store.sha(path)):
            store.gh('release', 'upload', tag, str(path), '--repo', repository, '--clobber')
            return
        store.upload_file(repository, tag, path, uploaded)
    paths = sorted(directory.iterdir(), key=lambda path: (path.suffix != '.json', path.name != entry['sourceFile'], path.name))
    for path in paths:
        if path.is_file() and path.name != 'manifest.json':
            upload(path)
    upload(directory / 'manifest.json')
    store.gh('api', endpoint + '/' + str(release['id']), '--method', 'PATCH',
             data={'draft': False, 'prerelease': True, 'make_latest': 'false'})
    advance(plan, raw)


def cache_tag(plan):
    return f'localai-cache-{plan["engine"]}-{plan["os"]}-{plan["arch"]}-{plan["backend"]}'


def cache_restore(plan, directory):
    """Optional disk-backed compiler objects, with no Actions cache allocation."""
    base = f'https://github.com/{plan["repository"]}/releases/download/{cache_tag(plan)}/'
    try:
        raw = store.read_url(base + 'compiler-cache.json')
        if not raw:
            print('No archived LocalAI compiler objects yet', flush=True)
            return
        record = json.loads(raw)
        if record.get('variant') != [plan[key] for key in ('engine', 'os', 'arch', 'backend')]:
            raise ValueError('LocalAI compiler cache variant differs')
        directory.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=directory.parent, prefix='localai-cache-') as temporary:
            temporary = Path(temporary)
            archive = temporary / 'compiler-cache.tar.zst'
            with archive.open('wb') as combined:
                for part in record['parts']:
                    if Path(part['name']).name != part['name'] or not part['name'].startswith('compiler-cache.tar.zst'):
                        raise ValueError('Invalid compiler cache asset')
                    path = temporary / part['name']
                    store.download(base + part['name'], path, part['size'], part['sha256'])
                    with path.open('rb') as source:
                        shutil.copyfileobj(source, combined)
                    path.unlink()
            if store.sha(archive) != record['sha256']:
                raise ValueError('LocalAI compiler cache checksum differs')
            with subprocess.Popen(['zstd', '-d', '-q', '-c', str(archive)], stdout=subprocess.PIPE) as decoder:
                with tarfile.open(fileobj=decoder.stdout, mode='r|') as source:
                    source.extractall(directory, filter='data')
                if decoder.wait():
                    raise ValueError('LocalAI compiler cache decompression failed')
    except (store.StoreUnavailable, OSError, ValueError, KeyError, tarfile.TarError) as error:
        print('Optional LocalAI compiler cache unavailable: ' + str(error), flush=True)


def cache_save(plan, directory):
    directories = [name for name in ('ccache', 'build', 'npm') if (directory / name).is_dir()]
    if not directories:
        return
    try:
        with tempfile.TemporaryDirectory(dir=directory.parent, prefix='localai-cache-') as temporary:
            temporary = Path(temporary)
            archive = temporary / 'compiler-cache.tar.zst'
            subprocess.run(['tar', '-I', 'zstd -T2 -3', '-cf', str(archive), '-C', str(directory), *directories], check=True)
            checksum = store.sha(archive)
            parts = []
            # Keep small archives whole. Split only files approaching the 2 GiB limit.
            maximum = 1900 * 1024 ** 2
            if archive.stat().st_size <= maximum:
                paths = [archive]
            else:
                paths = []
                with archive.open('rb') as source:
                    while True:
                        path = temporary / f'compiler-cache.tar.zst.part{len(paths):03d}'
                        with path.open('wb') as output:
                            remaining = maximum
                            while remaining:
                                block = source.read(min(8 * 1024 ** 2, remaining))
                                if not block:
                                    break
                                output.write(block)
                                remaining -= len(block)
                        if not path.stat().st_size:
                            path.unlink()
                            break
                        paths.append(path)
            tag = cache_tag(plan)
            release = store.ensure_release(plan['repository'], tag, tag)
            notices = directory / 'payload' / '-'.join(plan[key] for key in ('engine', 'os', 'arch', 'backend')) / 'LICENSES.txt'
            if not notices.is_file():
                raise ValueError('Compiler backup requires the successful runtime license notices')
            store.gh('release', 'upload', tag, str(notices), '--repo', plan['repository'], '--clobber')
            for path in paths:
                store.gh('release', 'upload', tag, str(path), '--repo', plan['repository'], '--clobber')
                parts.append({'name': path.name, 'size': path.stat().st_size, 'sha256': store.sha(path)})
            record = {'version': 1, 'variant': [plan[key] for key in ('engine', 'os', 'arch', 'backend')],
                      'sourceRelease': plan['manifest'], 'sha256': checksum, 'parts': parts}
            write(temporary / 'compiler-cache.json', record)
            store.gh('release', 'upload', tag, str(temporary / 'compiler-cache.json'), '--repo', plan['repository'], '--clobber')
            # Only replace disposable cache assets; permanent runtime/source releases stay intact.
            current = {path.name for path in paths} | {'compiler-cache.json'}
            for asset in store.release_assets(plan['repository'], release['id']):
                if asset['name'].startswith('compiler-cache.') and asset['name'] not in current:
                    store.gh('release', 'delete-asset', tag, asset['name'], '--repo', plan['repository'], '--yes')
    except (store.StoreUnavailable, OSError, subprocess.CalledProcessError, ValueError) as error:
        print('Optional LocalAI cache backup failed; published runtime remains usable: ' + str(error), flush=True)


def dispatch(engine, target, backend):
    owner = importlib.util.spec_from_file_location('localai_coordinator', Path(__file__).with_name('remote-components.py'))
    coordinator = importlib.util.module_from_spec(owner)
    owner.loader.exec_module(coordinator)
    request = f'{os.environ["GITHUB_RUN_ID"]}-{os.environ.get("GITHUB_RUN_ATTEMPT", "1")}-{engine}-{target}-{backend}'
    # Existing coordinator handles resilient control requests and success/failure polling.
    coordinator.dispatch(target, 'localai.yml', request, engine=engine, backend=backend)


def select(engine, target, backend):
    engines = ('llama', 'whisper') if engine == 'all' else (engine,)
    targets = tuple(TARGETS) if target == 'all' else (target,)
    variants = []
    heads = {}
    pins = json.loads((RECIPE / 'upstreams.json').read_text())
    for item in engines:
        pin = pins[item]
        for native in targets:
            system, architecture = TARGETS[native]
            repo = store.repository(native)
            for gpu in ('cuda', 'vulkan'):
                if backend not in ('all', gpu) or system == 'android' and gpu == 'cuda':
                    continue
                tag = f'localai-{item}-{system}-{architecture}-{gpu}-{pin["version"]}-r{pin["packageRevision"]}'
                # Scheduled checks retry missing/failed variants too, even when an
                # upstream version has not changed since yesterday's attempt.
                if os.environ.get('GITHUB_EVENT_NAME') == 'schedule':
                    if repo not in heads:
                        heads[repo] = store.builder_head(repo)
                    path = f'localai/{system}/{architecture}/{gpu}/{item}.json'
                    raw = store.read_url(store.lookup_url(repo, path, heads[repo]))
                    if raw and json.loads(raw).get('release') == tag:
                        continue
                variants.append({'engine': item, 'target': native, 'backend': gpu})
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('source=' + subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() + '\n')
            output.write('matrix=' + json.dumps({'include': variants}) + '\n')
            output.write('build=' + str(bool(variants)).lower() + '\n')
    print(json.dumps({'include': variants}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('plan', 'publish', 'cache-restore', 'cache-save', 'dispatch', 'select'))
    parser.add_argument('--engine', choices=('all', 'llama', 'whisper'), required=True)
    parser.add_argument('--target', choices=('all', *TARGETS), required=True)
    parser.add_argument('--backend', choices=('all', 'cuda', 'vulkan'), required=True)
    parser.add_argument('--directory', type=Path, required=True)
    args = parser.parse_args()
    if args.action == 'select':
        select(args.engine, args.target, args.backend)
    elif 'all' in (args.engine, args.target, args.backend):
        parser.error('Only select accepts all; a builder handles one variant')
    elif args.action == 'dispatch':
        dispatch(args.engine, args.target, args.backend)
    elif args.action == 'plan':
        plan_build(args.engine, args.target, args.backend, args.directory)
    else:
        plan = identity(args.engine, args.target, args.backend)
        {'publish': publish, 'cache-restore': cache_restore, 'cache-save': cache_save}[args.action](plan, args.directory)


if __name__ == '__main__':
    main()
