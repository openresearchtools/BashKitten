#!/usr/bin/env python3
"""Dispatch one builder and collect its artifact immediately after upload."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('browser_component', Path(__file__).with_name('browser-component.py'))
component = importlib.util.module_from_spec(spec)
spec.loader.exec_module(component)


def api(endpoint, body=None):
    command = ['gh', 'api', endpoint]
    if body is not None:
        command += ['--method', 'POST', '--input', '-']
    result = subprocess.run(command, input=json.dumps(body) if body is not None else None,
                            text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'GitHub API request failed')
    return json.loads(result.stdout) if result.stdout.strip() else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', choices=['linux-arm64', 'linux-amd64', 'android'])
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--auth-run', default=os.environ.get('GITHUB_RUN_ID', ''))
    parser.add_argument('--search-run', default=os.environ.get('GITHUB_RUN_ID', ''))
    parser.add_argument('--warm-gkrust', choices=['true', 'false'], default='false')
    args = parser.parse_args()
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    repository = 'openresearchtools/bashkitten-build-' + args.target.removeprefix('linux-')
    request = f'{os.environ["GITHUB_RUN_ID"]}-{os.environ.get("GITHUB_RUN_ATTEMPT", "1")}-{args.target}'
    title = f'BashKitten {source} / {request}'
    inputs = {'source_sha': source, 'request_id': request}
    for run in (args.auth_run, args.search_run):
        if not re.fullmatch('[0-9]+', run):
            raise ValueError('Build requires the source component run IDs')
    inputs.update(auth_run=args.auth_run, search_run=args.search_run)
    if args.target != 'android':
        inputs['warm_gkrust'] = args.warm_gkrust
    endpoint = f'repos/{repository}/actions/workflows/build.yml'
    runs = api(endpoint + '/runs?event=workflow_dispatch&per_page=100')['workflow_runs']
    run = next((item for item in runs if item['display_title'] == title), None)
    if run is None:
        api(endpoint + '/dispatches', {'ref': 'main', 'inputs': inputs})
        print(f'Started {args.target} for source {source} in {repository}', flush=True)
    digest = component.fingerprint(args.target)
    name = (component.artifact_name(args.target, digest) if args.target == 'android'
            else f'bashkitten-{args.target}-candidate')
    linked = False
    while True:
        if run is None:
            runs = api(endpoint + '/runs?event=workflow_dispatch&per_page=100')['workflow_runs']
            run = next((item for item in runs if item['display_title'] == title), None)
        if run is not None:
            if not linked:
                print(run['html_url'], flush=True)
                with Path(os.environ['GITHUB_STEP_SUMMARY']).open('a') as summary:
                    summary.write(f'- [{args.target} build and downloadable artifacts]({run["html_url"]})\n')
                linked = True
            artifacts = api(f'repos/{repository}/actions/runs/{run["id"]}/artifacts?per_page=100')['artifacts']
            artifact = next((item for item in artifacts if item['name'] == name and not item['expired']), None)
            if artifact:
                subprocess.run(['gh', 'run', 'download', str(run['id']), '--repo', repository,
                                '--name', name, '--dir', str(args.directory)], check=True)
                if args.target == 'android':
                    component.verify(args.directory, args.target, digest)
                else:
                    component.verify_package(args.directory, args.target, source, digest)
                receipt = {'repository': repository, 'run': run['id'], 'artifact': artifact['id'],
                           'requestedSource': source, 'inputDigest': digest, 'url': run['html_url']}
                Path(os.environ['RUNNER_TEMP'], f'builder-{args.target}.json').write_text(json.dumps(receipt, indent=2) + '\n')
                print(f'Collected verified {args.target} artifact; other targets may still be compiling.', flush=True)
                return
            run = api(f'repos/{repository}/actions/runs/{run["id"]}')
            if run['status'] == 'completed':
                raise RuntimeError(f'{args.target} ended with {run["conclusion"]} without its required artifact: {run["html_url"]}')
        time.sleep(30)


if __name__ == '__main__':
    main()
