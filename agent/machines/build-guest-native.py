#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Build one original guest helper against the established Debian guest ABI."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def run(command, **kwargs):
    subprocess.run([str(value) for value in command], check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--component', choices=['sudo', 'fusermount'], required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    stage = args.output.resolve(); binary = stage / 'usr/lib/taskarian/machines/bin'; binary.mkdir(parents=True)
    docs = stage / 'usr/share/taskarian-machines-guest'; docs.mkdir(parents=True)
    spec = importlib.util.spec_from_file_location('guest_native_owner', ROOT / 'agent/packaging/machines/build.py')
    owner = importlib.util.module_from_spec(spec); spec.loader.exec_module(owner)
    if args.component == 'sudo':
        source = args.work / 'sudo-source'
        shutil.copytree(ROOT / 'agent/machines/guest/sudo-bridge', source)
        env = {**os.environ, 'CARGO_TARGET_DIR': str(args.work / 'target')}
        run(['cargo', 'build', '--locked', '--offline', '--release'], cwd=source, env=env)
        for name in ('taskarian-sudo', 'taskarian-sudo-exec', 'sudo-policy'):
            shutil.copy2(args.work / 'target/release/taskarian-sudo', binary / name)
        owner.rust_toolchain_notices(docs / 'rust-toolchain')
        for license in (source / 'vendor/libc').glob('LICENSE*'):
            shutil.copy2(license, docs / ('libc-' + license.name))
    else:
        vendor = ROOT / 'agent/machines/vendor/libfuse'; record = owner.verify_source(vendor)
        source = args.work / 'fuse-source'
        shutil.copytree(vendor / 'source', source, symlinks=True)
        run(['meson', 'setup', 'build', '--prefix=/usr', '--sysconfdir=/etc', '--buildtype=release',
             '-Dexamples=false', '-Dtests=false', '-Duseroot=false', '-Dinitscriptdir=', '-Denable-io-uring=false'], cwd=source)
        run(['meson', 'compile', '-C', 'build', '-j', '2', 'fusermount3'], cwd=source)
        shutil.copy2(source / 'build/util/fusermount3', binary / 'fusermount3')
        (binary / 'fusermount3').chmod(0o4755)
        for license in record['license_paths']:
            shutil.copy2(vendor / license, docs / ('libfuse-' + Path(license).name))


if __name__ == '__main__':
    main()
