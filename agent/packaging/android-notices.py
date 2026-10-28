#!/usr/bin/env python3
"""Generate companion-server notices from the actual Termux release payloads."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from build import checked_archive, extract, install_node, install_termux_display, collect_termux_os
from release import validate_termux_update, termux_os_identity

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--architecture', choices=['aarch64', 'x86_64'], default='aarch64')
parser.add_argument('--auth-archive', type=Path, required=True)
parser.add_argument('--search-archive', type=Path, required=True)
parser.add_argument('--node-archive', type=Path, required=True)
parser.add_argument('--termux-display-dir', type=Path, required=True)
parser.add_argument('--os-package', type=Path, required=True)
parser.add_argument('--development-signing', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
cpu = 'x64' if args.architecture == 'x86_64' else 'arm64'
target = 'termux-' + args.architecture
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
    reviewer_legal = stage / 'systematic-reviewer'
    reviewer_legal.mkdir()
    for name in ('package.json', 'LICENSE', 'NOTICE'):
        shutil.copy2(ROOT / 'systematic-reviewer' / name, reviewer_legal / name)
    cache = stage / 'npm-cache'
    subprocess.run(['python3', str(ROOT / 'packaging/npm-sources.py'), '--cache', str(cache)], check=True)
    subprocess.run(['npm', 'ci', '--offline', '--cache', str(cache), '--prefix', str(stage), '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--os=android', '--cpu=' + cpu], check=True)
    subprocess.run(['node', str(ROOT / 'src/server/updates/platform-packages.mjs'), str(stage), 'android', cpu], check=True)
    install_node(args.node_archive, stage, 'termux', args.architecture)
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    install_termux_display(args, stage, revision, stage / 'bin')
    os_metadata = collect_termux_os(args.os_package, stage, revision, args.architecture, version)
    os_identity = termux_os_identity(args.os_package)
    if os_identity['architecture'] != args.architecture or os_identity['version'] != os_metadata['version']:
        raise ValueError('Termux OS installed identity differs from its package')
    extract(args.auth_archive, stage / 'auth')
    extract(args.search_archive, stage)
    if json.loads((stage / 'auth/share/metadata/runtime.json').read_text())['target'] != target:
        raise ValueError('Android companion notices require the native Termux auth payload')
    if json.loads((stage / 'search/runtime/manifest.json').read_text())['target'] != target:
        raise ValueError('Android companion notices require the native Termux search payload')
    subprocess.run(['node', str(ROOT / 'packaging/licenses.mjs'), str(stage), '--target', 'termux', '--version', version], check=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(stage / 'licenses.json', args.output)
    # The backend is assembled later from this exact recipe revision. The OS
    # package is already an input, so retain its actual checksum and provenance.
    pairing = validate_termux_update({
        'schema': 1, 'productVersion': version, 'sourceCommit': revision,
        'bootstrapSha256': hashlib.sha256((ROOT / 'src/server/platform/termux/updates-bootstrap.mjs').read_bytes()).hexdigest(),
        'architecture': args.architecture,
        'apkAbi': 'x86_64' if args.architecture == 'x86_64' else 'arm64-v8a',
        'packages': [
            {'name': 'bashkitten', 'version': version, 'architecture': args.architecture,
             'sourceCommit': revision},
            {'name': 'bashkitten-os', 'version': os_metadata['version'], 'architecture': os_metadata['architecture'],
             'sourceCommit': os_identity['sourceCommit'], 'sha256': os_metadata['sha256'],
             'installedManifestSha256': os_identity['installedManifestSha256']},
        ],
    })
    (args.output.parent / 'termux-update.json').write_text(json.dumps(pairing, indent=2) + '\n')
