#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Coordinate the four builders; component/app downloads use direct release URLs."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import importlib.util
import json
import os
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
    def native_components():
        dispatch(target, 'components.yml', request + '-components', target=target,
                 components=components, force_rebuild=force)
        if target.startswith('termux-'):
            if force or not store.lookup('application', target, application.inputs(target)):
                dispatch(target, 'assemble.yml', request + '-application', target=target, force_rebuild=force)
    def browser():
        if target.startswith('linux-'):
            if not native_only and (force or not store.lookup('application', target, application.inputs(target))):
                build_browser(target, request, force=force, warm_gkrust=warm_gkrust)
        elif not native_only and not linux_only:
            android = 'android' if target == 'termux-aarch64' else 'android-x86_64'
            if force or not store.lookup('application', android, application.inputs(android)):
                build_browser(android, request, force=force)
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


def collect(directory, targets=None):
    packages = {}
    for target in targets or ('linux-amd64', 'linux-arm64', 'termux-aarch64', 'termux-x86_64', 'android', 'android-x86_64'):
        destination = directory / ('taskarian-' + target + '-candidate')
        if not application.restore(target, destination):
            raise ValueError('Missing exact application output: ' + target)
        # Android carries the exact companion packages too. Retain one copy of
        # identical packages; a differing companion is a release pairing error.
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
    if not application.restore('linux-amd64', directory / 'taskarian-corresponding-source', component='corresponding-source'):
        raise ValueError('Matching complete corresponding-source output is missing')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('build', 'components', 'sources', 'collect'))
    parser.add_argument('target', nargs='?')
    parser.add_argument('--directory', type=Path)
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
    else:
        collect(args.directory)


if __name__ == '__main__':
    main()
