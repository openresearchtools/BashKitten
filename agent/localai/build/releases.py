#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Resolve stable upstream release tags; never select a branch or target_commitish."""
import argparse
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request

REPOSITORIES = {'llama': 'ggml-org/llama.cpp', 'whisper': 'ggml-org/whisper.cpp'}
SILERO_REPOSITORY = 'snakers4/silero-vad'
ROOT = Path(__file__).resolve().parent.parent


def api(path, missing=False):
    headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
               'User-Agent': 'Taskarian-release-watcher'}
    if os.environ.get('GH_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GH_TOKEN']
    try:
        with urllib.request.urlopen(urllib.request.Request('https://api.github.com/' + path, headers=headers), timeout=45) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if missing and error.code == 404:
            return None
        raise


def version(value):
    match = re.fullmatch(r'v?(\d+)\.(\d+)\.(\d+)', value)
    if not match:
        raise ValueError('Expected a stable semantic release version: ' + value)
    return tuple(map(int, match.groups()))


def resolve(repository, release):
    tag = release['tag_name']
    version(tag)
    if release['draft'] or release['prerelease']:
        raise ValueError('An upstream stable, published release is required')
    ref = api(f'repos/{repository}/git/ref/tags/{urllib.parse.quote(tag, safe="")}')['object']
    tag_object = ref['sha']
    seen = set()
    while ref['type'] == 'tag':
        if ref['sha'] in seen:
            raise ValueError('Cyclic annotated release tag')
        seen.add(ref['sha'])
        ref = api(f'repos/{repository}/git/tags/{ref["sha"]}')['object']
    if ref['type'] != 'commit' or not re.fullmatch('[0-9a-f]{40}', ref['sha']):
        raise ValueError('Release tag does not resolve to a commit')
    return {'repository': repository, 'version': tag, 'commit': ref['sha'],
            'releaseId': release['id'], 'releaseUrl': release['html_url'], 'tagObject': tag_object}


def verify(engine, pin):
    repository = REPOSITORIES[engine]
    if pin['repository'] != repository:
        raise ValueError('Unexpected upstream repository')
    release = api(f'repos/{repository}/releases/tags/{urllib.parse.quote(pin["version"], safe="")}')
    actual = resolve(repository, release)
    if any(pin.get(key) != value for key, value in actual.items()):
        raise ValueError(f'{engine}: pinned release/tag provenance changed; refusing to build')
    if type(pin.get('packageRevision')) is not int or pin['packageRevision'] < 1:
        raise ValueError('A positive packageRevision is required')


def verify_silero():
    from vad.verify import verify as verify_inputs
    source = verify_inputs(ROOT / 'build/vad')['silero']
    if source['repository'] != 'https://github.com/' + SILERO_REPOSITORY:
        raise ValueError('Unexpected Silero repository')
    release = api(f'repos/{SILERO_REPOSITORY}/releases/tags/{urllib.parse.quote(source["tag"], safe="")}')
    actual = resolve(SILERO_REPOSITORY, release)
    expected = {**source, 'version': source['tag'], 'repository': SILERO_REPOSITORY}
    if any(expected.get(key) != value for key, value in actual.items()):
        raise ValueError('Silero: pinned release/tag provenance changed; refusing to build')
    return actual


def check(pins, write):
    changed = []
    for engine, repository in REPOSITORIES.items():
        current = pins[engine]
        verify(engine, current)  # Detect a moved existing tag, even if latest is newer.
        latest = resolve(repository, api(f'repos/{repository}/releases/latest'))
        if version(latest['version']) <= version(current['version']):
            print(f'{engine}: no newer stable release ({latest["version"]}); no build')
            continue
        pins[engine] = {**latest, 'packageRevision': 1}
        changed.append(engine)
        print(f'{engine}: new stable release {latest["version"]} at {latest["commit"]}')
    current_silero = verify_silero()
    latest_silero = resolve(SILERO_REPOSITORY, api(f'repos/{SILERO_REPOSITORY}/releases/latest'))
    silero_changed = version(latest_silero['version']) > version(current_silero['version'])
    if silero_changed:
        print(f'Silero: new stable release {latest_silero["version"]} at {latest_silero["commit"]}')
        if write:
            from vad.update import update
            update(ROOT / 'build/vad', latest_silero)
        if 'whisper' not in changed:
            pins['whisper']['packageRevision'] += 1
            changed.append('whisper')
    else:
        print(f'Silero: no newer stable release ({latest_silero["version"]}); no build')
    if write and changed:
        (ROOT / 'upstreams.json').write_text(json.dumps(pins, indent=2) + '\n')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            print('engines=' + json.dumps(changed), file=output)
            print('changed=' + str(bool(changed)).lower(), file=output)
            print('silero_changed=' + str(silero_changed).lower(), file=output)
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify', choices=REPOSITORIES)
    parser.add_argument('--write', action='store_true', help='Update pins only for newer upstream releases')
    args = parser.parse_args()
    pins = json.loads((ROOT / 'upstreams.json').read_text())
    if args.verify:
        verify(args.verify, pins[args.verify])
        if args.verify == 'whisper':
            verify_silero()
        print(args.verify + ': exact stable release tag verified')
    else:
        check(pins, args.write)


if __name__ == '__main__':
    main()
