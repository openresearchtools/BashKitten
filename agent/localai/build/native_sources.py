#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Package retained third-party notices and source records with runtime builds."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import importlib.util


def prepare_inputs(destination):
    """Stage pristine recipe inputs and original archives outside the Git tree."""
    here = Path(__file__).resolve().parent
    integration = here.parent
    main = integration.parents[1]
    destination = Path(destination).resolve()
    if destination.exists():
        raise FileExistsError(destination)
    shutil.copytree(here, destination, symlinks=True,
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    for name in ('LICENSE', 'upstreams.json', 'models.json', 'ORIGIN.json'):
        shutil.copy2(integration / name, destination / name)
    shutil.copy2(main / 'LICENSE', destination / 'LICENSE.Taskarian')
    spec = importlib.util.spec_from_file_location('taskarian_source_cache', main / 'agent/packaging/source_cache.py')
    cache = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cache)
    ubuntu = json.loads((destination / 'native-sources/ubuntu-24.04/SOURCE.json').read_text())
    for package in ubuntu['packages'].values():
        for record in package['files']:
            shutil.copy2(cache.fetch(record), destination / 'native-sources/ubuntu-24.04' / record['file'])
    cuda = json.loads((destination / 'native-sources/cuda-12.9/SOURCE.json').read_text())
    shutil.copy2(cache.fetch(cuda['cccl']), destination / 'native-sources/cuda-12.9' / cuda['cccl']['file'])
    return destination


def sha256(path):
    if path.is_symlink():
        return hashlib.sha256(os.readlink(path).encode()).hexdigest()
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def retained_sources(inputs, target_os, backend):
    root = inputs / 'native-sources'
    ubuntu = json.loads((root / 'ubuntu-24.04/SOURCE.json').read_text())
    record = {'ubuntu': {name: spec for name, spec in ubuntu['packages'].items()
              if target_os in spec['targets'] and
              (name not in ('vulkan-loader', 'spirv-headers') or backend == 'vulkan')}}
    if backend == 'cuda':
        record['cuda'] = {'provenance': json.loads((root / 'cuda-12.9/SOURCE.json').read_text())}
    if target_os == 'android':
        record['android'] = {'provenance': json.loads((root / 'android-r29/SOURCE.json').read_text())}
    return record


def native_notices(inputs, record):
    root = inputs / 'native-sources/ubuntu-24.04'
    notices = ['===== ' + name + ' corresponding runtime/header sources =====\n' + (root / spec['notices']['file']).read_text()
            for name, spec in record['ubuntu'].items()]
    if 'cuda' in record:
        for name in ('CUDA-LICENSE.txt', 'CCCL-LICENSES.txt'):
            notices.append('===== NVIDIA CUDA component ' + name + ' =====\n' + (inputs / 'native-sources/cuda-12.9' / name).read_text())
        notices.append('NVIDIA compiler and runtime implementation code retain their original licenses. Proprietary implementation source is unavailable; exact original packages, installed headers, libdevice binary inputs and runtime hashes are identified in the corresponding source/provenance archive. CUDA 12 cudart, cuBLAS and cuBLASLt are bundled unchanged. The NVIDIA driver and libcuda.so.1 remain host requirements.')
    return notices


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare', required=True, type=Path)
    print(prepare_inputs(parser.parse_args().prepare))
