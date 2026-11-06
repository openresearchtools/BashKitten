#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Native Primp recipe using the pinned upstream Termux build framework."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[4]


def run(command, **kwargs):
    subprocess.run([str(value) for value in command], check=True, cwd=kwargs.pop('cwd', ROOT), **kwargs)


def pack(directory, archive, root=None):
    with tarfile.open(archive, 'w:gz', compresslevel=1) as output:
        if root:
            output.add(directory, arcname=root)
        else:
            for file in sorted(Path(directory).iterdir()):
                output.add(file, arcname=file.name)


def build_primp(target, work):
    architecture = target.split('-')[1]
    framework = Path(work) / 'termux-packages'
    lock = json.loads((ROOT / 'agent/search/runtime-lock.json').read_text())['termuxPackages']
    run(['python3', 'auth/build/retained-sources.py', 'termux', '--commit', lock['commit'], '--output', framework])
    shutil.copytree(ROOT / 'agent/packaging/termux/search/python-primp', framework / 'packages/python-primp')
    env = {**os.environ, 'TERMUX_BUILDER_IMAGE_NAME': lock['builderImage'],
           'TERMUX_DOCKER_RUN_EXTRA_ARGS': '--volume ' + str(ROOT) + ':/taskarian:ro',
           'TERMUX_DOCKER_EXEC_EXTRA_ARGS': '--env TASKARIAN_SOURCE_ROOT=/taskarian'}
    run(['scripts/run-docker.sh', './build-package.sh', '-I', '-a', architecture, 'python-primp'], cwd=framework, env=env)
    stage = Path(work) / 'native'
    debs = list((framework / 'output').glob('python-primp_*_' + architecture + '.deb'))
    if len(debs) != 1:
        raise ValueError('Expected one native primp package')
    run(['dpkg-deb', '-x', debs[0], stage])
    return stage / 'data/data/com.termux/files/usr/lib/taskarian/search/runtime/site-packages'


def build_primp_component(target, work, output):
    native_path = build_primp(target, work)
    verified = Path(work) / 'verified-runtime'
    run(['python3', 'agent/search/build/runtime.py', target, '--output', verified, '--termux-native', native_path])
    payload = Path(work) / 'payload'; payload.mkdir()
    shutil.copy2(native_path / 'primp.abi3.so', payload / 'primp.abi3.so')
    # Reuse the actual runtime owner's complete source/legal collector.
    with subprocess.Popen(['zstd', '-dc', str(verified / f'search-runtime-{target}.tar.zst')], stdout=subprocess.PIPE) as decoder:
        with tarfile.open(fileobj=decoder.stdout, mode='r|') as source:
            for member in source:
                if member.isfile() and ('licens' in member.name.lower() or 'notice' in member.name.lower()):
                    target_file = payload / member.name
                    target_file.parent.mkdir(parents=True, exist_ok=True)
                    target_file.write_bytes(source.extractfile(member).read())
        if decoder.wait():raise ValueError('Native primp license collection failed')
    pack(payload, Path(output) / f'search-primp-{target}.tar.gz', 'primp')
    shutil.copy2(verified / f'search-source-{target}.tar.zst', Path(output) / f'search-primp-source-{target}.tar.zst')
