#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Bundle original CUDA 12 redistributables and retain matching source notices."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

from native_sources import sha256

TOOLKIT = Path('/usr/local/cuda-12.9')
REDISTRIBUTABLES = {'libcudart.so.12', 'libcublas.so.12', 'libcublasLt.so.12',
                   'libnvJitLink.so.12', 'libnvrtc.so.12', 'libnvrtc-builtins.so.12.9'}
SYSTEM = re.compile(r'^(?:lib(?:c|m|dl|rt|pthread|gcc_s|stdc\+\+|gomp|atomic)\.so(?:\..*)?|ld-linux[^/]*\.so(?:\..*)?)$')


def needed(path):
    text = subprocess.check_output(['readelf', '-d', str(path)], text=True)
    return re.findall(r'\(NEEDED\).*\[([^\]]+)\]', text)


def prepare(inputs, evidence, arch):
    """Retain the actual installed CUDA headers, notices and binary input hashes."""
    lock = json.loads((inputs / 'native-sources/cuda-12.9/SOURCE.json').read_text())
    packages = lock['platforms'][arch]['packages']
    records, notices = {}, []
    retained = evidence / 'cuda-12.9'
    retained.mkdir()
    for name, pin in packages.items():
        # nvJitLink is not needed by every cuBLAS build. Only record it when installed.
        installed = subprocess.run(['dpkg-query', '-W', '-f=${Version}', name], capture_output=True, text=True)
        if installed.returncode:
            if name == 'libnvjitlink-12-9':
                continue
            raise RuntimeError('Missing pinned CUDA build package: ' + name)
        if installed.stdout != pin['version']:
            raise RuntimeError(f'CUDA package differs from the pin: {name} {installed.stdout}')
        records[name] = pin
        copyright = Path('/usr/share/doc') / name / 'copyright'
        if not copyright.is_file():
            raise RuntimeError('Missing full NVIDIA package notices: ' + name)
        shutil.copy2(copyright, retained / (name + '-LICENSE.txt'))
        notices.append('===== ' + name + ' =====\n' + copyright.read_text())
    # Header implementations retain their original bytes, including CCCL. The
    # complete CCCL source archive is staged separately by prepare_inputs().
    shutil.copytree(TOOLKIT / 'include', retained / 'include', symlinks=True)
    for directory in ('nvvm/include', 'nvvm/libdevice'):
        if (TOOLKIT / directory).exists():
            shutil.copytree(TOOLKIT / directory, retained / directory, symlinks=True)
    files = {str(path.relative_to(retained)): sha256(path)
             for path in retained.rglob('*') if path.is_file() or path.is_symlink()}
    binary_inputs = {str(path.relative_to(TOOLKIT)): {'sha256': sha256(path), 'size': path.stat().st_size}
                     for path in TOOLKIT.rglob('*')
                     if path.is_file() and not path.is_symlink() and path.suffix in ('.a', '.bc')}
    record = {'schema': 1, 'toolkit': lock['release'], 'packages': records,
              'filesSHA256': files,
              'binaryInputs': binary_inputs,
              'sourceAvailability': 'nvvm/libdevice contains original compiler bitcode; proprietary implementation source is unavailable.',
              'cccl': lock['cccl']}
    (retained / 'SOURCE.json').write_text(json.dumps(record, indent=2) + '\n')
    return record, notices


def bundle(directory, arch):
    """Copy required redistributable DSOs unchanged, including transitive needs."""
    target = 'x86_64-linux' if arch == 'amd64' else 'sbsa-linux'
    libraries = TOOLKIT / 'targets' / target / 'lib'
    if not libraries.is_dir():
        raise FileNotFoundError(libraries)
    pending = list(directory.iterdir())
    copied, external = {}, set()
    # Include Lt explicitly: cuBLAS can load it dynamically as well as via NEEDED.
    required = {'libcudart.so.12', 'libcublas.so.12', 'libcublasLt.so.12'}
    while pending or required:
        if required:
            name = required.pop()
            if (directory / name).exists():
                continue
            if name not in REDISTRIBUTABLES:
                raise RuntimeError('Unexpected NVIDIA redistributable dependency: ' + name)
            original = libraries / name
            if not original.is_file():
                raise FileNotFoundError(original)
            real = original.resolve()
            if not real.is_relative_to(TOOLKIT):
                raise RuntimeError('CUDA runtime escaped its pinned toolkit')
            output = directory / real.name
            with real.open('rb') as stream:
                header = stream.read(20)
            if header[:6] != b'\x7fELF\x02\x01' or int.from_bytes(header[18:20], 'little') != (62 if arch == 'amd64' else 183):
                raise RuntimeError('CUDA redistributable has the wrong target architecture: ' + name)
            shutil.copy2(real, output)
            if name != real.name:
                (directory / name).symlink_to(real.name)
            copied[name] = {'file': real.name, 'sha256': sha256(output), 'size': output.stat().st_size,
                            'needed': needed(output)}
            pending.append(output)
        else:
            path = pending.pop()
            for name in needed(path):
                if (directory / name).exists():
                    continue
                if name == 'libcuda.so.1' or SYSTEM.fullmatch(name):
                    external.add(name)
                elif name in REDISTRIBUTABLES:
                    required.add(name)
                else:
                    raise RuntimeError(f'Unbundled non-system dependency: {path.name}: {name}')
    if any(path.name.startswith('libcuda.so') for path in directory.iterdir()):
        raise RuntimeError('The NVIDIA driver must never be bundled')
    return {'toolkit': '12.9.2', 'bundled': copied, 'external': sorted(external),
            'driver': 'CUDA 12 compatible NVIDIA driver and libcuda.so.1; no host CUDA toolkit or cuBLAS package is required',
            'loader': 'Launcher LD_LIBRARY_PATH points to the private runtime bin directory; original NVIDIA DSOs are unmodified.'}
