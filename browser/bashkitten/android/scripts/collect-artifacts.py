#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Sign and collect the production browser APK and its actual build inventory."""
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(sys.argv[1]).resolve()
OUT.mkdir(parents=True, exist_ok=True)
OBJ = Path(os.environ.get('BASHKITTEN_ANDROID_OBJDIR', ROOT.parent.parent / 'obj-bashkitten-android'))
version = (ROOT / 'bashkitten/config/version.txt').read_text().strip()
engine = (ROOT / 'browser/config/version_display.txt').read_text().strip()
key = Path(os.environ['BASHKITTEN_PUBLISHER_KEYSTORE'])
if not key.is_file():
    raise SystemExit('The Droid signing identity is required for a product candidate')
state = Path(os.environ.get('MOZBUILD_STATE_PATH', Path.home() / '.mozbuild'))
tools = sorted(state.glob('android-sdk-*/build-tools/*/apksigner'))
if not tools:
    tools = sorted(Path(os.environ['ANDROID_HOME']).glob('build-tools/*/apksigner'))
if not tools:
    raise SystemExit('Android signing tools not found')
tools = tools[-1].parent
outputs = []
for candidate in (OBJ / 'gradle/build/mobile/android/fenix').rglob('*.apk'):
    if 'release' not in candidate.parts:
        continue
    with zipfile.ZipFile(candidate) as archive:
        if 'lib/arm64-v8a/libxul.so' in archive.namelist():
            outputs.append(candidate)
if len(outputs) != 1:
    raise SystemExit('Expected exactly one release ARM64 Gecko APK, found ' + str(len(outputs)))
destination = OUT / f'bashkitten_{version}_arm64-v8a.apk'
aligned = OUT / '.aligned.apk'
subprocess.run([str(tools / 'zipalign'), '-P', '16', '-f', '4', str(outputs[0]), str(aligned)], check=True)
subprocess.run([str(tools / 'apksigner'), 'sign', '--ks', str(key), '--ks-type', 'PKCS12',
                '--ks-key-alias', os.environ['ANDROID_KEY_ALIAS'], '--ks-pass', 'env:ANDROID_KEYSTORE_PASSWORD',
                '--key-pass', 'env:ANDROID_KEY_PASSWORD', '--out', str(destination), str(aligned)], check=True)
aligned.unlink()
subprocess.run([str(tools / 'zipalign'), '-c', '-P', '16', '4', str(destination)], check=True)
signature = subprocess.check_output([str(tools / 'apksigner'), 'verify', '--verbose', '--print-certs', str(destination)], text=True)
certificate = '2f6a2ceae1a80e98b3a12156d37e7dc5541ce0968dd48285bc71bb555713df38'
if 'certificate SHA-256 digest: ' + certificate not in signature:
    raise SystemExit('APK did not use the existing Droid identity')
badging = subprocess.check_output([str(tools / 'aapt'), 'dump', 'badging', str(destination)], text=True)
identity = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging)
if not identity or identity[1] != 'com.bashkitten' or identity[3] != version or 'application-debuggable' in badging:
    raise SystemExit('APK package, version or release flags do not match BashKitten')
native = {}
with zipfile.ZipFile(destination) as apk:
    files = set(apk.namelist())
    for notice in ('THIRD-PARTY-NOTICES', 'BASHKITTEN-NOTICES', 'TOR-NOTICES', 'BLOCKER-NOTICES', 'QR-NOTICES'):
        if 'assets/' + notice + '.txt' not in files:
            raise SystemExit('Missing offline license notice: ' + notice)
    if 'lib/arm64-v8a/libtor.so' not in files:
        raise SystemExit('Browser Tor client is missing')
    metadata = apk.read('assets/raw/third_party_license_metadata')
    licenses = apk.read('assets/raw/third_party_licenses')
    if b'Debug License Info' in metadata or len(metadata.splitlines()) < 10:
        raise SystemExit('Android dependency licenses are missing')
    for entry in metadata.splitlines():
        span, name = entry.split(b' ', 1)
        offset, length = map(int, span.split(b':'))
        if not name or offset < 0 or length < 1 or offset + length > len(licenses):
            raise SystemExit('Invalid Android dependency license entry')
    for name in sorted(files):
        if not name.startswith('lib/') or not name.endswith('.so'):
            continue
        if not name.startswith('lib/arm64-v8a/'):
            raise SystemExit('Unexpected APK ABI: ' + name)
        with apk.open(name) as library:
            header = library.read(64)
            if header[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', header, 18)[0] != 183:
                raise SystemExit('Library is not AArch64 ELF: ' + name)
            offset = struct.unpack_from('<Q', header, 32)[0]
            size, count = struct.unpack_from('<HH', header, 54)
            library.seek(offset)
            segments = library.read(size * count)
            alignments = []
            for i in range(count):
                if struct.unpack_from('<I', segments, i * size)[0] != 1:
                    continue
                file_offset, address = struct.unpack_from('<QQ', segments, i * size + 8)
                alignment = struct.unpack_from('<Q', segments, i * size + 48)[0]
                if alignment < 16384 or file_offset % 16384 != address % 16384:
                    raise SystemExit('Library does not satisfy 16 KB segment alignment: ' + name)
                alignments.append(alignment)
            native[name] = {'machine': 'AArch64', 'load_segment_alignment': min(alignments)}
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
manifest = {'source': revision, 'product_version': version, 'firefox_version': engine,
            'package_id': identity[1], 'version_code': int(identity[2]), 'publisher_signed': True,
            'architecture': 'arm64-v8a', 'native_libraries': native, 'certificate_sha256': certificate,
            'apks': {destination.name: hashlib.sha256(destination.read_bytes()).hexdigest()}}
manifest['browser_input_sha256'] = subprocess.check_output(
    ['python3', str(ROOT.parent / 'agent/packaging/browser-component.py'), 'fingerprint', 'android'],
    text=True).strip()
manifest['build_repository'] = os.environ.get('GITHUB_REPOSITORY', '')
manifest['build_run'] = os.environ.get('GITHUB_RUN_ID', '')
source_inventories = list((OBJ / 'gradle/build/mobile/android/fenix').rglob('generated/bashkitten-sources/sources.json'))
if len(source_inventories) != 1:
    raise SystemExit('Expected exactly one resolved Android dependency source inventory, found ' + str(len(source_inventories)))
sources = source_inventories[0].parent
source_manifest = json.loads(source_inventories[0].read_text())
if not isinstance(source_manifest, list) or not source_manifest:
    raise SystemExit('Resolved Android dependency source inventory is missing')
for entry in source_manifest:
    name = entry['file']
    if Path(name).name != name or not (sources / name).is_file():
        raise SystemExit('Missing Android dependency source: ' + name)
    entry['sha256'] = hashlib.sha256((sources / name).read_bytes()).hexdigest()
(sources / 'sources.json').write_text(json.dumps(source_manifest, indent=2) + '\n')
with tarfile.open(OUT / 'bashkitten-android-library-source.tar.gz', 'w:gz') as archive:
    archive.add(sources, arcname='android-library-sources')
(OUT / 'build-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
(OUT / 'signature.txt').write_text(signature)
(OUT / 'manifest.txt').write_text(badging)
(OUT / 'SHA256SUMS').write_text(''.join(hashlib.sha256(file.read_bytes()).hexdigest() + '  ' + file.name + '\n'
                                      for file in sorted(OUT.iterdir()) if file.is_file() and file.name != 'SHA256SUMS'))
print(destination)
