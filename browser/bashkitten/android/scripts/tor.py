#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Stage only the source-built Guardian JNI runtime verified for this revision."""
import importlib.util
import os
from pathlib import Path
import shutil
import sys


def main():
    output, abi, metadata = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
    runtime = os.environ.get('BASHKITTEN_TOR_ANDROID_DIR')
    if not runtime:
        raise SystemExit('Build browser/bashkitten/android/tor/build.py for this ABI first and set BASHKITTEN_TOR_ANDROID_DIR')
    owner = Path(__file__).resolve().parents[1] / 'tor/build.py'
    spec = importlib.util.spec_from_file_location('android_tor_build', owner)
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    source = builder.validate(Path(runtime), abi)
    target = output / abi / 'libtor.so'
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source / 'libtor.so', target)
    metadata.mkdir(parents=True, exist_ok=True)
    for name in ['tor-android.json', 'tor-provenance.zip']:
        shutil.copy2(source / name, metadata / name)


if __name__ == '__main__':
    main()
