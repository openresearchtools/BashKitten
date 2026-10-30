#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Sign and collect the production browser APK and its actual build inventory."""
from pathlib import Path
import hashlib
import importlib.util
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tarfile
import zipfile


def verify_android_sdk_removal(apk):
    """Reject actual DEX definitions from removed SDKs, including stale outputs."""
    forbidden = (b'Lcom/google/android/gms/', b'Lcom/google/android/play/',
                 b'Lcom/google/firebase/', b'Lcom/android/installreferrer/')
    classes = 0
    dex_files = [name for name in apk.namelist() if re.fullmatch(r'classes(?:\d+)?\.dex', name)]
    if not dex_files:
        raise ValueError('APK contains no DEX code')
    for name in dex_files:
        data = apk.read(name)
        if (len(data) < 112 or data[:4] != b'dex\n' or data[4:8] not in
                (b'035\0', b'037\0', b'038\0', b'039\0', b'040\0') or
                struct.unpack_from('<III', data, 32) != (len(data), 112, 0x12345678)):
            raise ValueError('Unsupported or malformed DEX header: ' + name)

        def table(header_offset, entry_size):
            count, offset = struct.unpack_from('<II', data, header_offset)
            if offset > len(data) or count > (len(data) - offset) // entry_size:
                raise ValueError('Malformed DEX table: ' + name)
            return count, offset

        strings_count, strings_offset = table(56, 4)
        types_count, types_offset = table(64, 4)
        definitions_count, definitions_offset = table(96, 32)
        for index in range(definitions_count):
            type_index = struct.unpack_from('<I', data, definitions_offset + index * 32)[0]
            if type_index >= types_count:
                raise ValueError('Invalid DEX class type: ' + name)
            string_index = struct.unpack_from('<I', data, types_offset + type_index * 4)[0]
            if string_index >= strings_count:
                raise ValueError('Invalid DEX class descriptor: ' + name)
            offset = struct.unpack_from('<I', data, strings_offset + string_index * 4)[0]
            # Skip the UTF-16 length's bounded ULEB128 prefix. The package
            # prefixes being checked are ASCII in the following MUTF-8 string.
            for _ in range(5):
                if offset >= len(data):
                    raise ValueError('Truncated DEX class descriptor: ' + name)
                byte = data[offset]
                offset += 1
                if byte < 128:
                    break
            else:
                raise ValueError('Invalid DEX string length: ' + name)
            end = data.find(b'\0', offset)
            if end < 0:
                raise ValueError('Unterminated DEX class descriptor: ' + name)
            descriptor = data[offset:end]
            if descriptor.startswith(forbidden):
                raise ValueError('Removed Android SDK class remains in APK: ' + descriptor.decode('ascii', errors='replace'))
            classes += 1
    return {'dex_files': len(dex_files), 'class_definitions': classes,
            'removed_sdk_class_definitions': 0}


ROOT = Path(__file__).resolve().parents[3]
OUT = Path(sys.argv[1]).resolve()
OUT.mkdir(parents=True, exist_ok=True)
OBJ = Path(os.environ.get('BASHKITTEN_ANDROID_OBJDIR', ROOT.parent.parent / 'obj-bashkitten-android'))
version = (ROOT / 'bashkitten/config/version.txt').read_text().strip()
abi = os.environ.get('BASHKITTEN_ANDROID_ABI', 'arm64-v8a')
machine, machine_name, target = {
    'arm64-v8a': (183, 'AArch64', 'android'),
    'x86_64': (62, 'x86-64', 'android-x86_64'),
}[abi]
engine = (ROOT / 'browser/config/version_display.txt').read_text().strip()
# Check before signing/copying a candidate. Licenses do not replace source, and
# a collector receipt with unresolved coordinates is not a complete archive.
source_inventories = list((OBJ / 'gradle/build/mobile/android/fenix').rglob('generated/bashkitten-sources/sources.json'))
if len(source_inventories) != 1:
    raise SystemExit('Expected exactly one resolved Android dependency source inventory, found ' + str(len(source_inventories)))
sources = source_inventories[0].parent
missing_sources = json.loads((sources / 'missing.json').read_text())
if not isinstance(missing_sources, list) or missing_sources:
    raise SystemExit('Android dependency source is incomplete: ' + json.dumps(missing_sources))
source_manifest = json.loads(source_inventories[0].read_text())
if not isinstance(source_manifest, list) or not source_manifest:
    raise SystemExit('Resolved Android dependency source inventory is missing')
pins = json.loads((ROOT / 'bashkitten/android/sources/sources.json').read_text())
if json.loads((sources / 'pins.json').read_text()) != pins:
    raise SystemExit('Staged Android dependency source pins differ from the current source tree')
expected_sources = sorted((entry['component'], entry['kind'], Path(item['file']).name, item['sha256'])
                          for entry in pins['entries']
                          for item in ([entry] if entry['kind'] == 'sources' else entry['files']))
actual_sources = sorted((entry['component'], entry['kind'], entry['file'], entry['sha256'])
                        for entry in source_manifest)
if actual_sources != expected_sources:
    raise SystemExit('Staged Android dependency sources differ from their committed inventory')
for entry in source_manifest:
    name = entry['file']
    if Path(name).name != name or not (sources / name).is_file():
        raise SystemExit('Missing Android dependency source: ' + name)
    if hashlib.sha256((sources / name).read_bytes()).hexdigest() != entry.get('sha256'):
        raise SystemExit('Android dependency source differs from its committed pin: ' + name)
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
        if f'lib/{abi}/libxul.so' in archive.namelist():
            outputs.append(candidate)
if len(outputs) != 1:
    raise SystemExit(f'Expected exactly one release {abi} Gecko APK, found ' + str(len(outputs)))
with zipfile.ZipFile(outputs[0]) as apk:
    sdk_removal = verify_android_sdk_removal(apk)
destination = OUT / f'bashkitten_{version}_{abi}.apk'
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
    if f'lib/{abi}/libtor.so' not in files:
        raise SystemExit('Browser Tor client is missing')
    if f'lib/{abi}/libgojni.so' not in files:
        raise SystemExit('Native remote client is missing')
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
        if not name.startswith(f'lib/{abi}/'):
            raise SystemExit('Unexpected APK ABI: ' + name)
        with apk.open(name) as library:
            header = library.read(64)
            if header[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', header, 18)[0] != machine:
                raise SystemExit(f'Library is not {machine_name} ELF: ' + name)
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
            native[name] = {'machine': machine_name, 'load_segment_alignment': min(alignments)}
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
manifest = {'source': revision, 'product_version': version, 'firefox_version': engine,
            'package_id': identity[1], 'version_code': int(identity[2]), 'publisher_signed': True,
            'architecture': abi, 'native_libraries': native, 'certificate_sha256': certificate,
            'apks': {destination.name: hashlib.sha256(destination.read_bytes()).hexdigest()}}
manifest['android_sdk_removal'] = sdk_removal
manifest['browser_input_sha256'] = subprocess.check_output(
    ['python3', str(ROOT.parent / 'agent/packaging/browser-component.py'), 'fingerprint', target],
    text=True).strip()
manifest['build_repository'] = os.environ.get('GITHUB_REPOSITORY', '')
manifest['build_run'] = os.environ.get('GITHUB_RUN_ID', '')
sys.path.insert(0, str(ROOT.parent / 'agent/packaging'))
spec = importlib.util.spec_from_file_location('android_native_component', ROOT.parent / 'agent/packaging/android-native-component.py')
native_component = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native_component)
manifest['native_gecko'] = native_component.record_build(destination, target)
spec = importlib.util.spec_from_file_location('tor_native_sources', ROOT.parent / 'agent/packaging/android_native_sources.py')
tor_sources = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tor_sources)
with zipfile.ZipFile(destination) as apk:
    manifest['tor_android'] = tor_sources.verify_android_tor(apk, ROOT.parent)
remote = Path(os.environ['BASHKITTEN_REMOTE_CLIENT_DIR'])
remote_manifest = json.loads((remote / 'build-manifest.json').read_text())
if remote_manifest['source'] != revision or remote_manifest['architecture'] != abi:
    raise SystemExit('Native remote client source/architecture does not match the APK')
with zipfile.ZipFile(destination) as apk:
    if hashlib.sha256(apk.read(f'lib/{abi}/libgojni.so')).hexdigest() != remote_manifest['library_sha256']:
        raise SystemExit('APK remote client differs from its built library')
manifest['remote_client'] = remote_manifest
shutil.copy2(remote / 'share/source/remote-client-go.tar.gz', OUT / f'bashkitten-remote-client-source_{abi}.tar.gz')
shutil.copy2(remote / 'bashkitten-remote-sources.jar', OUT / f'bashkitten-remote-client-java-source_{abi}.jar')
with tarfile.open(OUT / f'bashkitten-android-library-source_{abi}.tar.gz', 'w:gz') as archive:
    archive.add(sources, arcname='android-library-sources')
    spec = importlib.util.spec_from_file_location('android_native_sources', ROOT.parent / 'agent/packaging/android_native_sources.py')
    native_sources = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native_sources)
    sys.path.insert(0, str(ROOT.parent / 'agent/packaging'))
    import source_cache
    with zipfile.ZipFile(destination) as apk:
        manifest['native_source_components'] = native_sources.collect(
            lambda name: (ROOT.parent / name).read_bytes(), archive,
            source_manifest=source_manifest, apk=apk,
            fetch_source=lambda record, name: source_cache.fetch(
                native_sources.download_pin(record), local=None if record.get('member') else ROOT.parent / name))
(OUT / 'build-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
(OUT / 'signature.txt').write_text(signature)
(OUT / 'manifest.txt').write_text(badging)
(OUT / 'SHA256SUMS').write_text(''.join(hashlib.sha256(file.read_bytes()).hexdigest() + '  ' + file.name + '\n'
                                      for file in sorted(OUT.iterdir()) if file.is_file() and file.name != 'SHA256SUMS'))
print(destination)
