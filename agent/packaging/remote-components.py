#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Coordinate the four builders; component/app downloads use direct release URLs."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import importlib.util
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


store = module('component-store')
application = module('application')
browser_release = module('browser-release')


def api(endpoint, body=None):
    command = ['gh', 'api', endpoint]
    if body is not None:
        command += ['--method', 'POST', '--input', '-']
    for attempt in range(4):
        result = subprocess.run(command, input=json.dumps(body) if body is not None else None,
                                text=True, capture_output=True, timeout=120)
        if result.returncode == 0:
            return json.loads(result.stdout) if result.stdout.strip() else None
        if attempt < 3:
            time.sleep(2 ** attempt)
    raise RuntimeError('Builder control service is unavailable; retry to reuse completed components: ' + result.stderr[-1200:])


def dispatch(builder_target, workflow, request, **inputs):
    repository = store.repository(builder_target)
    source = application.inputs(builder_target)['source']
    endpoint = f'repos/{repository}/actions/workflows/{workflow}'
    title_token = ' / ' + request
    def find():
        runs = api(endpoint + '/runs?event=workflow_dispatch&per_page=100')['workflow_runs']
        return next((run for run in runs if run['display_title'].endswith(title_token)), None)
    run = find()
    if run is None:
        api(endpoint + '/dispatches', {'ref': 'main', 'inputs': {
            'source_sha': source, 'request_id': request, **inputs}})
        print(f'Dispatched {workflow}: {repository}, {source}', flush=True)
    deadline = time.monotonic() + 8 * 3600
    linked = False
    while time.monotonic() < deadline:
        if run is None:
            run = find()
        else:
            run = api(f'repos/{repository}/actions/runs/{run["id"]}')
        if run:
            if not linked:
                print(run['html_url'], flush=True)
                summary = os.environ.get('GITHUB_STEP_SUMMARY')
                if summary:
                    with open(summary, 'a') as output:
                        output.write(f'- [{builder_target}: {workflow}]({run["html_url"]})\n')
                linked = True
            if run['status'] == 'completed':
                if run['conclusion'] != 'success':
                    raise RuntimeError(f'Builder ended {run["conclusion"]}; completed component outputs remain reusable: {run["html_url"]}')
                return run
        time.sleep(30)
    raise RuntimeError('Builder deadline reached; completed outputs remain reusable')


def build(target, *, force=False, native_only=False, linux_only=False, components='["all"]', warm_gkrust=False):
    request = f'{os.environ["GITHUB_RUN_ID"]}-{os.environ.get("GITHUB_RUN_ATTEMPT", "1")}-{target}'
    selected = json.loads(components)
    force_app = force and (selected == 'all' or 'all' in selected)
    def native_components():
        dispatch(target, 'components.yml', request + '-components', target=target,
                 components=components, force_rebuild=force)
        if target.startswith('termux-'):
            if force_app or not store.lookup('application', target, application.inputs(target)):
                dispatch(target, 'assemble.yml', request + '-application', target=target, force_rebuild=force_app)
    def browser():
        if target.startswith('linux-'):
            if not native_only and (force_app or not store.lookup('application', target, application.inputs(target))):
                build_browser(target, request, force=force_app, warm_gkrust=warm_gkrust)
        elif not native_only and not linux_only:
            android = 'android' if target == 'termux-aarch64' else 'android-x86_64'
            if force_app or not store.lookup('application', android, application.inputs(android)):
                build_browser(android, request, force=force_app)
    # Engine compilation/checkpoints can finish while services build. Only final
    # assembly waits for the required exact component manifests to be published.
    failures = []
    with ThreadPoolExecutor(max_workers=2) as workers:
        for future in as_completed([workers.submit(native_components), workers.submit(browser)]):
            try:
                future.result()
            except Exception as error:
                failures.append(error)
    if failures:
        raise RuntimeError('; '.join(map(str, failures)))


def build_browser(target, request, *, force=False, warm_gkrust=False):
    inputs = browser_release.inputs('gecko', target)
    native_key = store.identity('gecko', target, inputs)['inputSha256']
    options = {'warm_gkrust': warm_gkrust} if target.startswith('linux-') else {}
    if force or not store.lookup('gecko', target, inputs):
        dispatch(target, 'build.yml', request + '-engine', engine_only=True,
                 native_key=native_key, force_rebuild=force, **options)
    # Another request may have finished this exact app while its engine waited.
    if force or not store.lookup('application', target, application.inputs(target)):
        dispatch(target, 'build.yml', request + '-application', require_native=True,
                 native_key=native_key, force_rebuild=force, **options)


def reference(result):
    return {key: result[key] for key in ('repository', 'manifestName', 'manifestSha256', 'tag') if key in result}


def read_reference(ref):
    url = store.manifest_url(ref)
    raw = store.read_url(url) if url else None
    if raw is None or hashlib.sha256(raw).hexdigest() != ref['manifestSha256']:
        raise ValueError('Pinned component manifest is unavailable or differs: ' + ref['manifestName'])
    manifest = json.loads(raw)
    ident = store.validate(manifest)
    if ref['repository'] != ident['repository'] or ref['manifestName'] != ident['manifest']:
        raise ValueError('Pinned component identity differs')
    return {'manifest': manifest, **ref, 'tag': url.rsplit('/', 2)[-2], 'url': url}


def source_index(roots, revision):
    pending, components, seen = list(roots), [], set()
    while pending:
        ref = pending.pop()
        key = (ref['repository'], ref['manifestName'], ref['manifestSha256'])
        if key in seen:
            continue
        seen.add(key)
        result = read_reference(ref)
        manifest = result['manifest']
        base = result['url'].rsplit('/', 1)[0] + '/'
        assets = [{**item, 'role': 'source' if '-source_' in item['name'] else item['role'], 'parts': [{**part, 'url': base + part['asset']} for part in item['parts']]}
                  for item in manifest['assets'] if item['role'] in ('source', 'legal') or '-source_' in item['name']]
        components.append({'component': manifest['component'], 'target': manifest['target'],
                           'version': manifest['version'], 'sourceCommit': manifest['sourceCommit'],
                           'inputSha256': manifest['inputSha256'], 'manifest': {**reference(result), 'url': result['url']},
                           'assets': assets})
        pending.extend(manifest.get('dependencies', []))
    if not any(item['component'] == 'corresponding-source' and item['sourceCommit'] == revision for item in components):
        raise ValueError('Exact repository corresponding-source component is required')
    return {'schema': 1, 'sourceCommit': revision, 'components': sorted(components, key=lambda x: (x['target'], x['component'], x['inputSha256']))}


def wanted_inputs(target, revision=None):
    wanted = application.inputs(target)
    if revision:
        if not re.fullmatch('[0-9a-f]{40}', revision):
            raise ValueError('Storage verification requires an exact source commit')
        wanted['source'] = revision
        wanted['productVersion'] = subprocess.check_output(
            ['git', 'show', revision + ':browser/taskarian/config/version.txt'], cwd=ROOT, text=True).strip()
    return wanted


def collect(directory, targets=None, *, revision=None):
    """Create a small pinned plan; binaries, source and caches stay in builders."""
    wanted = wanted_inputs('linux-amd64', revision)
    applications = []
    for target in targets or ('linux-amd64', 'linux-arm64', 'termux-aarch64', 'termux-x86_64', 'android', 'android-x86_64'):
        result = store.lookup('application', target, {**wanted, 'target': target})
        if not result:
            raise ValueError('Missing exact application output: ' + target)
        applications.append({'target': target, **reference(result)})
    sources = store.lookup('corresponding-source', 'linux-amd64', wanted)
    if not sources:
        raise ValueError('Matching corresponding-source metadata is missing')
    plan = {'schema': 1, 'sourceCommit': wanted['source'], 'version': wanted['productVersion'],
            'applications': applications,
            'sourceIndex': source_index([*applications, reference(sources)], wanted['source'])}
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'candidate-plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    print('Pinned release plan created; no binaries, sources or compiler caches downloaded', flush=True)


def materialize(plan_file, directory, *, revision=None):
    """Fetch each shipped installer once, retaining all existing release checks."""
    plan = json.loads(plan_file.read_text())
    current = wanted_inputs('linux-amd64', revision)
    if (plan.get('schema') != 1 or plan.get('sourceCommit') != current['source']
            or plan.get('version') != current['productVersion']):
        raise ValueError('Candidate plan differs from checked-out product source/version')
    expected = {'linux-amd64', 'linux-arm64', 'termux-aarch64', 'termux-x86_64', 'android', 'android-x86_64'}
    if {item['target'] for item in plan['applications']} != expected or len(plan['applications']) != len(expected):
        raise ValueError('Candidate plan must name all six applications exactly once')
    actual_index = source_index(plan['applications'] + [item['manifest'] for item in plan['sourceIndex']['components']
                                if item['component'] == 'corresponding-source' and item['sourceCommit'] == current['source']], current['source'])
    if actual_index != plan['sourceIndex']:
        raise ValueError('Candidate source/license index differs from pinned manifests')
    packages = {}
    for ref in plan['applications']:
        destination = directory / ('taskarian-' + ref['target'] + '-candidate')
        manifest = read_reference(ref)['manifest']
        selected = [item['name'] for item in manifest['assets']
                    if item['name'].endswith(('.apk', '.deb', '.deb.json', '.deb.sha256'))
                    or item['name'] == 'build-manifest.json'
                    or item['name'].startswith('native-input-equivalence-') and item['name'].endswith('.json')]
        result = store.fetch(ref, destination, roles=('runtime', 'metadata', 'legal'), names=selected)
        if not result or result['manifest']['inputs'] != {**current, 'target': ref['target']}:
            raise ValueError('Application inputs differ from candidate plan')
        for path in destination.glob('*.deb*'):
            if not path.is_file():
                continue
            digest = store.sha(path)
            if path.name in packages:
                if packages[path.name] != digest:
                    raise ValueError('Companion package differs between builders: ' + path.name)
                path.unlink()
            else:
                packages[path.name] = digest
    (directory / 'component-sources.json').write_text(json.dumps(actual_index, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('build', 'components', 'sources', 'collect', 'materialize'))
    parser.add_argument('target', nargs='?')
    parser.add_argument('--directory', type=Path)
    parser.add_argument('--plan', type=Path)
    parser.add_argument('--source', help='Existing app source for storage-only verification')
    parser.add_argument('--components', default='["all"]')
    parser.add_argument('--force-rebuild', action='store_true')
    parser.add_argument('--native-only', action='store_true')
    parser.add_argument('--linux-only', action='store_true')
    parser.add_argument('--warm-gkrust', action='store_true')
    args = parser.parse_args()
    if args.action == 'build':
        build(args.target, force=args.force_rebuild, native_only=args.native_only,
              linux_only=args.linux_only, components=args.components, warm_gkrust=args.warm_gkrust)
    elif args.action == 'components':
        request = f'{os.environ["GITHUB_RUN_ID"]}-{os.environ.get("GITHUB_RUN_ATTEMPT", "1")}-{args.target}-components'
        dispatch(args.target, 'components.yml', request, target=args.target,
                 components=args.components, force_rebuild=args.force_rebuild)
    elif args.action == 'sources':
        request = f'{os.environ["GITHUB_RUN_ID"]}-{os.environ.get("GITHUB_RUN_ATTEMPT", "1")}-sources'
        if not store.lookup('corresponding-source', 'linux-amd64', application.inputs('linux-amd64')):
            dispatch('linux-amd64', 'sources.yml', request)
    elif args.action == 'collect':
        collect(args.directory, revision=args.source)
    else:
        materialize(args.plan, args.directory, revision=args.source)


if __name__ == '__main__':
    main()
