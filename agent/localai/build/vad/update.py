#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Materialize a resolved official Silero release and reproduce its GGML model."""
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import tempfile
import tomllib
import urllib.request

from .verify import convert, verify


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def update(root, pin):
    source = json.loads((root / 'SOURCE.json').read_text())
    url = 'https://codeload.github.com/snakers4/silero-vad/tar.gz/' + pin['commit']
    with tempfile.TemporaryDirectory(prefix='taskarian-silero-release-') as temp:
        temp = Path(temp)
        archive = temp / 'source.tar.gz'
        with urllib.request.urlopen(url, timeout=180) as response, archive.open('wb') as output:
            shutil.copyfileobj(response, output)
        with tarfile.open(archive) as tar:
            tar.extractall(temp / 'source', filter='data')
        pristine = temp / 'source' / ('silero-vad-' + pin['commit'])
        package_version = tomllib.loads((pristine / 'pyproject.toml').read_text())['project']['version']
        if package_version != pin['version'].removeprefix('v'):
            raise ValueError('Silero package version differs from its official release')
        if not (pristine / 'LICENSE').is_file():
            raise ValueError('Silero release has no full license')
        if (pristine / 'LICENSE').read_bytes() != (root / 'SILERO-LICENSE').read_bytes():
            raise ValueError('Silero license changed; review its notice before updating')
        stage = temp / 'vad'
        shutil.copytree(root / 'upstream/whisper', stage / 'upstream/whisper')
        shutil.copytree(pristine, stage / 'upstream/silero')
        shutil.copy2(pristine / 'LICENSE', stage / 'SILERO-LICENSE')
        source['silero'].update(tag=pin['version'], version=package_version,
                                commit=pin['commit'], archive=url, archiveSHA256=digest(archive),
                                releaseId=pin['releaseId'], releaseUrl=pin['releaseUrl'],
                                tagObject=pin['tagObject'])
        model_file = 'models/ggml-silero-v' + package_version + '.bin'
        model = stage / model_file
        model.parent.mkdir()
        torch_version, numpy_version = convert(stage, source, model)
        if (torch_version, numpy_version) != ('2.9.1+cpu', '2.3.5'):
            raise ValueError('Use the pinned VAD conversion environment: torch 2.9.1+cpu and numpy 2.3.5')
        jit = 'upstream/silero/src/silero_vad/data/silero_vad.jit'
        source['model'] = {key: value for key, value in source['model'].items()
                           if key not in ('repository', 'revision', 'url')}
        source['model'].update(file=model_file, sha256=digest(model), bytes=model.stat().st_size,
                               derivation={'kind': 'converted-from-retained-source', 'sourceFile': jit,
                                           'sourceSHA256': digest(stage / jit),
                                           'converterSHA256': source['converter']['sha256'],
                                           'torch': torch_version, 'numpy': numpy_version})
        source['filesSHA256'] = {str(path.relative_to(stage)): digest(path)
                                 for path in sorted(stage.rglob('*')) if path.is_file()}
        (stage / 'SOURCE.json').write_text(json.dumps(source, indent=2) + '\n')
        verify(stage)
        # Mutation happens only after the full staged input/model inventory passes.
        for name in ('upstream/silero', 'models'):
            shutil.rmtree(root / name)
            shutil.copytree(stage / name, root / name)
        for name in ('SOURCE.json', 'SILERO-LICENSE'):
            shutil.copy2(stage / name, root / name)
    print('Materialized Silero ' + package_version + ' and model ' + source['model']['sha256'])
