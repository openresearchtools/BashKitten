#!/usr/bin/env python3
"""Assemble tested application candidates and source into a local release directory."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
CERT = '2f6a2ceae1a80e98b3a12156d37e7dc5541ce0968dd48285bc71bb555713df38'
SERVER_INPUTS = ['src/server', 'src/web', 'src/linux', 'packaging/build.py', 'packaging/about.py', 'package.json', 'package-lock.json', 'reference', 'licenses', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'PI_UPSTREAM.md']

def sha(file):
    with file.open('rb') as stream: return hashlib.file_digest(stream, 'sha256').hexdigest()

def unchanged(commit, inputs):
    subprocess.run(['git', 'diff', '--exit-code', commit, 'HEAD', '--', *inputs], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)

def build(run, inputs):
    value = json.loads(subprocess.check_output(['gh', 'api', f'repos/openresearchtools/bashkitten/actions/runs/{run}']))
    assert value['conclusion'] == 'success' and value['head_branch'] == 'main', 'Use a successful main-branch candidate'
    unchanged(value['head_sha'], inputs)
    return value['head_sha']

def package(file):
    fields = dict(line.split(': ', 1) for line in subprocess.check_output(['dpkg-deb', '-f', str(file), 'Package', 'Version', 'Architecture'], text=True).splitlines())
    process = subprocess.Popen(['dpkg-deb', '--fsys-tarfile', str(file)], stdout=subprocess.PIPE)
    stamp = None
    with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
        for item in archive:
            if item.name.endswith('/lib/bashkitten/build-platform.json'): stamp = json.load(archive.extractfile(item))
    assert process.wait() == 0
    return fields, stamp

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidates', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--android-run', type=int, required=True)
    parser.add_argument('--linux-run', type=int, required=True)
    parser.add_argument('--java', default='java')
    parser.add_argument('--apksigner-jar', type=Path, required=True)
    args = parser.parse_args()
    assert re.fullmatch('[A-Za-z0-9._-]+', args.tag)
    subprocess.run(['git', 'diff', '--quiet', 'HEAD'], cwd=ROOT, check=True)
    android_commit = build(args.android_run, ['src/android', 'licenses/Apache-2.0.txt', 'LICENSE', 'package.json', 'package-lock.json', 'licenses/upstream', 'src/server/licenses.mjs', 'src/server/updates/platform-packages.mjs', 'packaging/about.py', 'src/web/about.js', 'src/web/web_ui.html', 'src/server/platform/termux/bootstrap', '.github/workflows/android.yml'])
    linux_commit = build(args.linux_run, SERVER_INPUTS + ['.github/workflows/packages.yml'])
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    args.output.mkdir(parents=True, exist_ok=True)
    assert not any(args.output.iterdir()), 'Use an empty release directory'
    subprocess.run(['python3', str(ROOT / 'packaging/sources.py'), str(args.output)], check=True)
    android_sources, = args.candidates.rglob('android-dependency-sources.tar.gz')
    shutil.copy2(android_sources, args.output / android_sources.name)
    base = f'https://github.com/openresearchtools/bashkitten/releases/download/{args.tag}/'
    source = next(args.output.glob('bashkitten-source-*.tar.gz'))
    manifests = list(args.candidates.rglob('manifest.txt')); assert len(manifests) == 1
    manifest = manifests[0].read_text()
    identity = re.search(r"package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'", manifest)
    assert identity and identity[1] == 'com.bashkitten' and 'application-debuggable' not in manifest
    apk, = manifests[0].parent.glob('*.apk')
    sums = (apk.parent / 'sha256sums').read_text()
    assert any(line.split()[0] == sha(apk) and Path(line.split()[-1]).name == apk.name for line in sums.splitlines())
    signature = subprocess.check_output([args.java, '-jar', str(args.apksigner_jar), 'verify', '--print-certs', str(apk)], text=True)
    assert 'certificate SHA-256 digest: ' + CERT in signature
    app = {'packageId': identity[1], 'versionCode': int(identity[2]), 'versionName': identity[3], 'suiteRevision': 1,
           'abi': 'arm64-v8a', 'minSdk': int(re.search(r"sdkVersion:'([0-9]+)'", manifest)[1]),
           'targetSdk': int(re.search(r"targetSdkVersion:'([0-9]+)'", manifest)[1]), 'asset': apk.name,
           'url': base + apk.name, 'size': apk.stat().st_size, 'sha256': sha(apk), 'certificateSha256': CERT,
           'sourceUrl': base + source.name, 'sourceCommit': revision, 'buildCommit': android_commit, 'buildRun': args.android_run}
    shutil.copy2(apk, args.output / apk.name)
    packages = []; identities = set()
    for file in sorted(args.candidates.rglob('*.deb')):
        fields, stamp = package(file)
        pair = (fields['Package'], fields['Architecture']); assert pair not in identities
        identities.add(pair)
        assert fields['Version'] == identity[3], 'Package/APK version mismatch'
        if fields['Package'] == 'bashkitten':
            assert stamp and stamp['architecture'] == fields['Architecture']
            unchanged(stamp['revision'], SERVER_INPUTS)
            if fields['Architecture'] != 'aarch64': assert stamp['revision'] == linux_commit
        shutil.copy2(file, args.output / file.name)
        packages.append({**fields, 'asset': file.name, 'sha256': sha(file), 'url': base + file.name, 'build': stamp})
    assert identities == {('bashkitten', 'aarch64'), ('bashkitten', 'arm64'), ('bashkitten', 'amd64'), ('bashkitten-desktop', 'arm64'), ('bashkitten-desktop', 'amd64')}
    sources = [{'asset': file.name, 'sha256': sha(file), 'url': base + file.name} for file in sorted(args.output.iterdir()) if file.suffix in ('.tar', '.gz', '.json')]
    value = {'schema': 1, 'tag': args.tag, 'sourceCommit': revision, 'apps': [app], 'packages': packages, 'sources': sources, 'androidRun': args.android_run, 'linuxRun': args.linux_run}
    (args.output / 'release.json').write_text(json.dumps(value, indent=2) + '\n')
    (args.output / 'SHA256SUMS').write_text(''.join(sha(file) + '  ' + file.name + '\n' for file in sorted(args.output.iterdir()) if file.is_file() and file.name != 'SHA256SUMS'))
    print('Assembled verified Android APK, five native packages and matching application/dependency source')

if __name__ == '__main__': main()
