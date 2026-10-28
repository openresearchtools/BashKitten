#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Collect exact native Office artifacts through ordinary GitHub Actions."""
import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = 'openresearchtools/office-builds'
WORKFLOW = 'build.yml'
TARGETS = ['linux-amd64', 'linux-arm64', 'termux-aarch64', 'termux-x86_64']


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


# Keep GitHub transport and archive validation in their existing packaging owners.
remote = module('remote_browser', Path(__file__).with_name('remote-browser.py'))
package = module('native_package', Path(__file__).with_name('build.py'))
applications = module('applications', Path(__file__).with_name('applications.py'))


def source_revision():
    return subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()


def verify_workflow(revision):
    record = remote.api(f'repos/{REPOSITORY}/contents/.github/workflows/{WORKFLOW}?ref={revision}')
    if base64.b64decode(record['content']) != (ROOT / '.github/builders/office.yml').read_bytes():
        raise ValueError('Office builder workflow differs from this source revision')


def verify_run(run, source, request):
    if (run['event'] != 'workflow_dispatch' or run['head_branch'] != 'main'
            or run['display_title'] != f'Office {source} / {request}'
            or run['repository']['full_name'].lower() != REPOSITORY):
        raise ValueError('Office build does not match the exact collection request')


def dispatch(request):
    source = source_revision()
    verify_workflow('main')
    endpoint = f'repos/{REPOSITORY}/actions/workflows/{WORKFLOW}'
    title = f'Office {source} / {request}'
    runs = remote.api(endpoint + '/runs?event=workflow_dispatch&per_page=100')['workflow_runs']
    run = next((value for value in runs if value['display_title'] == title), None)
    if run is None:
        remote.api(endpoint + '/dispatches', {'ref': 'main', 'inputs': {'source_sha': source, 'request_id': request}})
    deadline = time.monotonic() + 300
    while run is None:
        if time.monotonic() >= deadline:
            raise TimeoutError('Office workflow did not appear within five minutes')
        time.sleep(10)
        runs = remote.api(endpoint + '/runs?event=workflow_dispatch&per_page=100')['workflow_runs']
        run = next((value for value in runs if value['display_title'] == title), None)
    verify_run(run, source, request)
    verify_workflow(run['head_sha'])
    print(run['html_url'], flush=True)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('run=' + str(run['id']) + '\n')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
            summary.write(f'- [Native Office builds and artifacts]({run["html_url"]})\n')


def verify_artifact(directory, target, source):
    platform, architecture = target.split('-', 1)
    archive = directory / f'office-{target}.tar.xz'
    digest = package.checked_archive(archive)
    sidecar = archive.with_name(archive.name + '.json')
    package.checked_archive(sidecar)
    with tempfile.TemporaryDirectory(prefix='office-verify-', dir=directory.parent) as temporary:
        incoming = Path(temporary)
        package.extract(archive, incoming)
        if {path.name for path in incoming.iterdir()} != {'runtime'}:
            raise ValueError('Unexpected Office artifact root')
        runtime = incoming / 'runtime'
        metadata = json.loads((runtime / 'manifest.json').read_text())
        if (metadata.get('schema') != 1 or metadata.get('target') != platform
                or metadata.get('architecture') != architecture
                or metadata.get('sourceCommit') != source or metadata.get('development')):
            raise ValueError('Office artifact source/target provenance mismatch')
        if json.loads(sidecar.read_text()) != {key: value for key, value in metadata.items() if key != 'files'}:
            raise ValueError('Office archive and provenance receipt differ')
        applications.verify_files(runtime, metadata['files'])
        if not isinstance(metadata.get('depends'), list) or not (runtime / 'licenses.json').is_file():
            raise ValueError('Office artifact lacks native dependency or legal metadata')
    return digest


def collect(run_id, request, target, directory):
    source = source_revision()
    endpoint = f'repos/{REPOSITORY}/actions/runs/{run_id}'
    run = remote.api(endpoint)
    verify_run(run, source, request)
    verify_workflow(run['head_sha'])
    name = f'office-{target}-{source}'
    deadline = time.monotonic() + 6 * 60 * 60
    while time.monotonic() < deadline:
        artifacts = remote.api(endpoint + '/artifacts?per_page=100')['artifacts']
        artifact = next((value for value in artifacts if value['name'] == name and not value['expired']), None)
        if artifact:
            directory.mkdir(parents=True, exist_ok=True)
            subprocess.run(['gh', 'run', 'download', str(run_id), '--repo', REPOSITORY,
                            '--name', name, '--dir', str(directory)], check=True)
            digest = verify_artifact(directory, target, source)
            (directory / 'builder-provenance.json').write_text(json.dumps({
                'repository': REPOSITORY, 'run': run_id, 'artifact': artifact['id'],
                'source': source, 'workflowCommit': run['head_sha'], 'sha256': digest,
                'url': run['html_url']}, indent=2) + '\n')
            print(f'Collected verified {target} Office component from {run["html_url"]}', flush=True)
            return
        run = remote.api(endpoint)
        if run['status'] == 'completed':
            raise RuntimeError(f'Office build ended with {run["conclusion"]} without {target}: {run["html_url"]}')
        time.sleep(30)
    raise TimeoutError('Office artifact did not arrive within six hours')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['dispatch', 'collect'])
    parser.add_argument('--request', required=True)
    parser.add_argument('--run', type=int)
    parser.add_argument('--target', choices=TARGETS)
    parser.add_argument('--directory', type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', args.request):
        parser.error('Collection request must be a simple stable identifier')
    if args.action == 'dispatch':
        dispatch(args.request)
    else:
        if not args.run or not args.target or not args.directory:
            parser.error('collect requires --run, --target and --directory')
        collect(args.run, args.request, args.target, args.directory.resolve())


if __name__ == '__main__':
    main()
