#!/usr/bin/env python3
"""Reuse verified browser artifacts without consuming the compiler-cache quota."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def fingerprint(target):
    paths = ['browser', 'agent/packaging/browser-component.py']
    if target == 'android':
        paths += ['.github/builders/android.yml', 'auth',
                  'agent/packaging/android-notices.py', 'agent/packaging/build.py',
                  'agent/packaging/licenses.mjs', 'agent/packaging/termux/search',
                  'agent/src/server/licenses.mjs',
                  'agent/package.json', 'agent/package-lock.json', 'agent/LICENSE',
                  'agent/PI_UPSTREAM.md', 'agent/THIRD_PARTY_NOTICES.md',
                  'agent/licenses', 'agent/pi/package.json', 'agent/pi/LICENSE',
                  'agent/pi/NOTICE', 'agent/search',
                  'agent/src/server/access/NOTICE', 'agent/src/server/access/TORKITTEN-LICENSE',
                  'agent/src/server/models/third_party', 'agent/src/server/updates/platform-packages.mjs',
                  '.github/workflows/auth-native.yml', '.github/workflows/search-native.yml']
    else:
        paths += ['.github/builders/linux.yml', 'agent/packaging/linux/prepare-runner.sh',
                  ':(exclude)browser/mobile/android', ':(exclude)browser/bashkitten/android']
    listing = subprocess.check_output(['git', 'ls-files', '--stage', '-z', '--', *paths], cwd=ROOT)
    return hashlib.sha256(target.encode() + b'\0' + listing).hexdigest()


def artifact_name(target, digest):
    return f'bashkitten-browser-{target}-{digest}'


def api(endpoint):
    return json.loads(subprocess.check_output(['gh', 'api', endpoint], text=True))


def verify(directory, target, digest):
    directory = Path(directory)
    checked = set()
    for line in (directory / 'SHA256SUMS').read_text().splitlines():
        expected, name = line.split('  ', 1)
        if Path(name).name != name or not re.fullmatch('[0-9a-f]{64}', expected):
            raise ValueError('Invalid component checksum entry')
        with (directory / name).open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
                raise ValueError('Component checksum mismatch: ' + name)
        checked.add(name)
    payload = {item.name for item in directory.iterdir() if item.is_file() and item.name != 'SHA256SUMS'}
    if not checked or checked != payload:
        raise ValueError('Component checksums must cover the complete artifact')
    if target == 'android':
        manifest = json.loads((directory / 'build-manifest.json').read_text())
        if manifest.get('browser_input_sha256') != digest or manifest.get('architecture') != 'arm64-v8a':
            raise ValueError('Android component inputs do not match this source')
        if not re.fullmatch('[0-9a-f]{40}', manifest.get('source', '')):
            raise ValueError('Android component has no producing source revision')
        apks = list(directory.glob('*.apk'))
        if len(apks) != 1 or manifest.get('apks', {}).get(apks[0].name) is None:
            raise ValueError('Expected one recorded production APK')
    else:
        manifest = dict(line.split('=', 1) for line in (directory / 'browser-artifact-manifest.txt').read_text().splitlines())
        if manifest.get('browser_input_sha256') != digest or manifest.get('architecture') != target.removeprefix('linux-'):
            raise ValueError('Linux component inputs do not match this source')


def verify_package(directory, target, source, digest):
    directory = Path(directory)
    packages = list(directory.glob('*.deb'))
    if len(packages) != 1:
        raise ValueError('Expected one complete Linux package')
    package = packages[0]
    manifest = json.loads(package.with_name(package.name + '.json').read_text())
    if manifest.get('revision') != source or manifest.get('architecture') != target.removeprefix('linux-'):
        raise ValueError('Package source or architecture mismatch')
    if manifest.get('components', {}).get('browser', {}).get('browser_input_sha256') != digest:
        raise ValueError('Package browser inputs do not match this source')
    with package.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != manifest.get('sha256'):
            raise ValueError('Package checksum mismatch')


def restore(directory, target, digest):
    repository = os.environ['GITHUB_REPOSITORY']
    expected = 'openresearchtools/bashkitten-build-' + target.removeprefix('linux-')
    if repository != expected:
        raise ValueError('Component restoration must run in the matching build repository')
    name = artifact_name(target, digest)
    page = 1
    while True:
        artifacts = api(f'repos/{repository}/actions/artifacts?name={name}&per_page=100&page={page}')['artifacts']
        for artifact in artifacts:
            if artifact['expired']:
                continue
            run = api(f'repos/{repository}/actions/runs/{artifact["workflow_run"]["id"]}')
            if run['conclusion'] != 'success' or run['event'] != 'workflow_dispatch' or run['head_branch'] != 'main':
                continue
            if run['path'] != '.github/workflows/build.yml':
                continue
            subprocess.run(['gh', 'run', 'download', str(run['id']), '--repo', repository,
                            '--name', name, '--dir', str(directory)], check=True)
            verify(directory, target, digest)
            print(f'Reused verified {target} browser from {run["html_url"]}', flush=True)
            return True
        if len(artifacts) < 100:
            return False
        page += 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['fingerprint', 'restore', 'verify'])
    parser.add_argument('target', choices=['linux-arm64', 'linux-amd64', 'android'])
    parser.add_argument('--directory', type=Path)
    args = parser.parse_args()
    digest = fingerprint(args.target)
    name = artifact_name(args.target, digest)
    if args.action == 'fingerprint':
        print(digest)
        return
    if args.directory is None:
        parser.error('--directory is required')
    if args.action == 'verify':
        verify(args.directory, args.target, digest)
        return
    args.directory.mkdir(parents=True, exist_ok=True)
    if any(args.directory.iterdir()):
        raise ValueError('Restore destination must be empty')
    hit = restore(args.directory, args.target, digest)
    with Path(os.environ['GITHUB_OUTPUT']).open('a') as output:
        output.write(f'hit={str(hit).lower()}\ndigest={digest}\nartifact={name}\n')
    print('Matching completed browser artifact found' if hit else 'Compiling changed browser inputs')


if __name__ == '__main__':
    main()
