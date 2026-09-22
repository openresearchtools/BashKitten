#!/usr/bin/env python3
"""Generate companion-server notices from the actual Termux release payloads."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from build import checked_archive, extract

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--auth-archive', type=Path, required=True)
parser.add_argument('--search-archive', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
for archive in (args.auth_archive, args.search_archive):
    checked_archive(archive)
version = (ROOT.parent / 'browser/bashkitten/config/version.txt').read_text().strip()
with tempfile.TemporaryDirectory(prefix='bashkitten-apk-notices-') as temporary:
    stage = Path(temporary)
    for name in ('LICENSE', 'PI_UPSTREAM.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json',
                 'src/server/access/NOTICE', 'src/server/access/TORKITTEN-LICENSE'):
        (stage / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, stage / name)
    for name in ('licenses', 'pi', 'search', 'src/server/models/third_party'):
        shutil.copytree(ROOT / name, stage / name, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', 'runtime'))
    subprocess.run(['npm', 'ci', '--prefix', str(stage), '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--os=android', '--cpu=arm64'], check=True)
    subprocess.run(['node', str(ROOT / 'src/server/updates/platform-packages.mjs'), str(stage), 'android', 'arm64'], check=True)
    extract(args.auth_archive, stage / 'auth')
    extract(args.search_archive, stage)
    if json.loads((stage / 'auth/share/metadata/runtime.json').read_text())['target'] != 'termux-aarch64':
        raise ValueError('Android companion notices require the native Termux auth payload')
    if json.loads((stage / 'search/runtime/manifest.json').read_text())['target'] != 'termux-aarch64':
        raise ValueError('Android companion notices require the native Termux search payload')
    subprocess.run(['node', str(ROOT / 'packaging/licenses.mjs'), str(stage), '--target', 'termux', '--version', version], check=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(stage / 'licenses.json', args.output)
