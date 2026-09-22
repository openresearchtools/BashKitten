#!/usr/bin/env python3
"""Collect the four matching build candidates and their corresponding sources.

This assembles files only. Publishing and APT promotion follow real device
validation; a successful compilation does not claim that validation occurred.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
CERT = '2f6a2ceae1a80e98b3a12156d37e7dc5541ce0968dd48285bc71bb555713df38'


def sha(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def package(file):
    fields = dict(line.split(': ', 1) for line in subprocess.check_output(
        ['dpkg-deb', '-f', str(file), 'Package', 'Version', 'Architecture'], text=True).splitlines())
    process = subprocess.Popen(['dpkg-deb', '--fsys-tarfile', str(file)], stdout=subprocess.PIPE)
    stamp = None
    with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
        for item in archive:
            if item.name.endswith('/lib/bashkitten/build-platform.json'):
                stamp = json.load(archive.extractfile(item))
    if process.wait() != 0 or not stamp:
        raise ValueError('Package has no valid build provenance: ' + str(file))
    return fields, stamp


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidates', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--tag')
    parser.add_argument('--candidate-only', action='store_true')
    parser.add_argument('--run', type=int, help='Successful complete-candidate workflow run')
    args = parser.parse_args()
    version = (ROOT / 'browser/bashkitten/config/version.txt').read_text().strip()
    engine = (ROOT / 'browser/browser/config/version_display.txt').read_text().strip()
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if not re.fullmatch(r'\d+\.\d+(?:\.\d+)?', version):
        raise ValueError('Invalid Firefox-aligned product version')
    tag = args.tag or 'v' + version
    if tag != 'v' + version:
        raise ValueError('Release tag must match the browser product version')
    if not args.candidate_only:
        if not args.run:
            parser.error('--run is required outside the candidate build')
        build = json.loads(subprocess.check_output(
            ['gh', 'api', f'repos/openresearchtools/bashkitten/actions/runs/{args.run}']))
        if build['conclusion'] != 'success' or build['head_sha'] != revision:
            raise ValueError('Use a successful complete candidate from this exact revision')
    args.output.mkdir(parents=True, exist_ok=True)
    if any(args.output.iterdir()):
        raise ValueError('Use an empty release directory')

    def copy(file):
        destination = args.output / file.name
        if destination.exists():
            if sha(destination) != sha(file):
                raise ValueError('Conflicting release source: ' + file.name)
        else:
            shutil.copy2(file, destination)
        return {'asset': file.name, 'sha256': sha(file), 'size': file.stat().st_size,
                'url': f'https://github.com/openresearchtools/bashkitten/releases/download/{tag}/{file.name}'}

    apks = list(args.candidates.rglob('*.apk'))
    if len(apks) != 1:
        raise ValueError('Exactly one production APK is required')
    apk = apks[0]
    manifest = json.loads((apk.parent / 'build-manifest.json').read_text())
    if manifest.get('source') != revision or manifest.get('product_version') != version or manifest.get('firefox_version') != engine:
        raise ValueError('APK product, engine or source revision mismatch')
    if manifest.get('package_id') != 'com.bashkitten' or not manifest.get('publisher_signed'):
        raise ValueError('APK must be the signed BashKitten product')
    if manifest.get('apks', {}).get(apk.name) != sha(apk):
        raise ValueError('APK hash mismatch')
    sdk = Path(os.environ.get('ANDROID_HOME', '/usr/local/lib/android/sdk'))
    signers = sorted(sdk.glob('build-tools/*/apksigner'))
    if not signers:
        raise ValueError('Android apksigner is required to verify the final APK')
    signature = subprocess.check_output([str(signers[-1]), 'verify', '--print-certs', str(apk)], text=True)
    if 'certificate SHA-256 digest: ' + CERT not in signature:
        raise ValueError('APK did not use the existing Droid signing certificate')
    app = {**copy(apk), 'packageId': 'com.bashkitten', 'versionName': version,
           'versionCode': manifest['version_code'], 'abi': 'arm64-v8a',
           'certificateSha256': CERT, 'sourceCommit': revision, 'buildRun': args.run or os.environ.get('GITHUB_RUN_ID')}
    packages = []
    architectures = set()
    for file in sorted(args.candidates.rglob('*.deb')):
        fields, stamp = package(file)
        architecture = fields['Architecture']
        if fields['Package'] != 'bashkitten' or fields['Version'].split('-', 1)[0] != version:
            raise ValueError('Unexpected package name/version: ' + file.name)
        if architecture in architectures or architecture not in {'amd64', 'arm64', 'aarch64'}:
            raise ValueError('Duplicate or unexpected package architecture')
        if stamp.get('revision') != revision or stamp.get('architecture') != architecture:
            raise ValueError('Package build provenance mismatch')
        architectures.add(architecture)
        packages.append({**fields, **copy(file), 'build': stamp})
    if architectures != {'amd64', 'arm64', 'aarch64'}:
        raise ValueError('All three complete native packages are required')
    sources = []
    for file in sorted(args.candidates.rglob('*')):
        if file.is_file() and re.search(r'(?:source|sources|provenance)[^.]*\.(?:tar(?:\.(?:gz|xz|zst))?|zip)$', file.name):
            sources.append(copy(file))
    names = [value['asset'] for value in sources]
    for token in ('bashkitten-source-', 'dependency-source-', 'auth', 'search', 'blocker', 'android-library-source'):
        if not any(token in name for name in names):
            raise ValueError('Missing corresponding source bundle: ' + token)
    result = {'schema': 2, 'tag': tag, 'version': version, 'firefoxVersion': engine,
              'sourceCommit': revision, 'buildRun': args.run or os.environ.get('GITHUB_RUN_ID'),
              'apps': [app], 'packages': packages, 'sources': sources}
    (args.output / 'release.json').write_text(json.dumps(result, indent=2) + '\n')
    (args.output / 'SHA256SUMS').write_text(''.join(
        sha(file) + '  ' + file.name + '\n' for file in sorted(args.output.iterdir()) if file.name != 'SHA256SUMS'))
    print('Assembled Android APK, three complete native packages and matching sources; not published.')


if __name__ == '__main__':
    main()
