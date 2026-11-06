#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Verify pristine VAD inputs; optionally reproduce the hosted model exactly."""
import argparse
import hashlib
import json
from pathlib import Path
import runpy
import sys
import tempfile
import types


def verify(root):
    source = json.loads((root / 'SOURCE.json').read_text())
    for name, expected in source['filesSHA256'].items():
        path = root / name
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise RuntimeError('VAD source/model checksum mismatch: ' + name)
    model = root / source['model']['file']
    if model.stat().st_size != source['model']['bytes'] or hashlib.sha256(model.read_bytes()).hexdigest() != source['model']['sha256']:
        raise RuntimeError('VAD model does not match the pinned artifact')
    return source


def convert(root, source, output):
    import torch
    import numpy
    # Execute the unchanged upstream converter against the committed TorchScript
    # model. This supplies only its public loader/version, avoiding the upstream
    # convenience package's unnecessary torchaudio/ONNX dependencies or downloads.
    module = types.ModuleType('silero_vad')
    module.__version__ = source['silero']['version']
    jit = root / source['silero']['path'] / 'src/silero_vad/data/silero_vad.jit'
    module.load_silero_vad = lambda: torch.jit.load(str(jit), map_location='cpu').eval()
    sys.modules['silero_vad'] = module
    converter = runpy.run_path(str(root / source['converter']['path']))['convert_silero_vad']
    with tempfile.TemporaryDirectory(prefix='taskarian-vad-conversion-') as temp:
        converter(str(Path(temp) / 'silero.bin'))
        converted = Path(temp) / f'silero-v{module.__version__}-ggml.bin'
        output.write_bytes(converted.read_bytes())
    return torch.__version__, numpy.__version__


def reproduce(root, source):
    with tempfile.TemporaryDirectory(prefix='taskarian-vad-verify-') as temp:
        converted = Path(temp) / 'model.bin'
        torch_version, numpy_version = convert(root, source, converted)
        if converted.read_bytes() != (root / source['model']['file']).read_bytes():
            raise RuntimeError('Converted VAD model differs from the pinned bytes')
    print(f'Exact VAD conversion verified (torch {torch_version}, numpy {numpy_version})')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reproduce', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    source = verify(root)
    if args.reproduce:
        reproduce(root, source)
    print('VAD source/model checksums verified: ' + source['model']['sha256'])
