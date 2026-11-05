#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Retain the existing complete source gate in the AMD64 architecture builder."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


def main():
    store, application, native = module('component-store'), module('application'), module('native-components')
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_REPOSITORY') != store.repository('linux-amd64'):
        raise ValueError('Complete source assembly belongs to the AMD64 builder')
    wanted = application.inputs('linux-amd64')
    if store.lookup('corresponding-source', 'linux-amd64', wanted):
        print('Matching complete sources are already published')
        return
    temporary = Path(os.environ['RUNNER_TEMP'])
    destination = temporary / 'corresponding-source'
    destination.mkdir(parents=True, exist_ok=True)
    references = []
    for target in ('linux-amd64', 'linux-arm64', 'termux-aarch64', 'termux-x86_64'):
        directory = temporary / 'node-source-inputs' / target
        deadline = time.monotonic() + 90 * 60
        while True:
            result = native.restore_component('node', target, directory, roles=('source', 'metadata'))
            if result:
                break
            if time.monotonic() >= deadline:
                raise ValueError('Required Node source component has not finished: ' + target)
            time.sleep(30)
        references.append({key: result[key] for key in ('repository', 'manifestName', 'manifestSha256')})
        name = 'node-source-' + target + '.tar.gz'
        provenance = {'schema': 1, 'target': target, 'producerSource': result['manifest']['sourceCommit'],
                      'producer': result['manifest']['producer'], 'inputs': result['manifest']['inputs'],
                      'archives': {name: store.sha(directory / name)}, 'store': references[-1]}
        (directory / ('node-provenance-' + target + '.json')).write_text(json.dumps(provenance, indent=2) + '\n')
        (directory / 'SHA256SUMS').write_text(''.join(store.sha(path) + '  ' + path.name + '\n'
            for path in sorted(directory.iterdir()) if path.is_file() and path.name != 'SHA256SUMS'))
    subprocess.run(['python3', str(HERE / 'sources.py'), str(destination), '--node-sources',
                    str(temporary / 'node-source-inputs'), '--cache', str(temporary / 'source-cache')], check=True)
    subprocess.run(['python3', '-I', '-B', str(ROOT / 'browser/taskarian/scripts/blocker_asset_provenance.py'), 'build',
                    '--repository', str(ROOT / 'browser'), '--cache-dir', str(temporary / 'blocker-source-cache'),
                    '--output', str(destination / 'taskarian-blocker-assets-source.tar.xz'), '--skip-reproduction-check'], check=True)
    for target in ('linux-amd64', 'linux-arm64', 'termux-aarch64', 'termux-x86_64'):
        for component in ('auth', 'search'):
            directory = temporary / 'native-source-inputs' / target / component
            deadline = time.monotonic() + 90 * 60
            while True:
                result = native.restore_component(component, target, directory, roles=('source',))
                if result:
                    break
                if time.monotonic() >= deadline:
                    raise ValueError('Required corresponding source has not finished: ' + component + '/' + target)
                time.sleep(30)
            references.append({key: result[key] for key in ('repository', 'manifestName', 'manifestSha256')})
            for asset in result['manifest']['assets']:
                if asset['role'] == 'source':
                    shutil.copy2(directory / asset['name'], destination / asset['name'])
    application.publish('linux-amd64', destination, component='corresponding-source', dependencies=references)


if __name__ == '__main__':
    main()
