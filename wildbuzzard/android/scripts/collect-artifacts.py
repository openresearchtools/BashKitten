#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
from pathlib import Path
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import struct
import zipfile

root = Path(__file__).resolve().parents[3]
out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
(out/'INSTALL.txt').write_text('Install wildbuzzard-arm64-debug.apk. This is the complete browser, including agent control and Tor.\n\nThe agent-probe and agent-probe-test APKs are optional developer test tools. They are not required by users or agents.\nThese are debug-signed test builds, not production releases.\n')
obj = root.parent/'obj-wildbuzzard-android'
outputs = list((obj/'gradle/build/mobile/android/fenix').rglob('*.apk')) + list((obj/'gradle/build/mobile/android/wildbuzzard-agent-probe').rglob('*.apk'))
if not outputs:
    outputs = list(obj.rglob('*.apk'))
browser = []
native = {}
roles = {}
signers = {}
signing_key = os.environ.get('WILDBUZZARD_DEBUG_KEYSTORE')
expected_signer = None
if signing_key:
    expected_signer = hashlib.sha256(subprocess.check_output([
        'keytool', '-exportcert', '-keystore', signing_key, '-storepass', 'android',
        '-alias', 'androiddebugkey',
    ])).hexdigest()
    state = Path(os.environ.get('MOZBUILD_STATE_PATH', Path.home()/'.mozbuild'))
    signing_tools = sorted(state.glob('android-sdk-*/build-tools/*/apksigner'))
    if not signing_tools: raise SystemExit('APK signing verification tool not found')
for source in outputs:
    with zipfile.ZipFile(source) as apk:
        libraries = [name for name in apk.namelist() if name.startswith('lib/')]
        if any(name.endswith('/libxul.so') for name in libraries):
            destination = 'wildbuzzard-arm64-debug.apk'
            role = 'browser'
            if any(not name.startswith('lib/arm64-v8a/') for name in libraries):
                raise SystemExit('APK contains non-ARM64 native libraries: ' + str(source))
            if 'lib/arm64-v8a/libtor.so' not in libraries: raise SystemExit('Tor not packaged')
            for notice in ('THIRD-PARTY-NOTICES', 'WILDBUZZARD-NOTICES', 'TOR-NOTICES', 'BLOCKER-NOTICES', 'QR-NOTICES'):
                if 'assets/' + notice + '.txt' not in apk.namelist(): raise SystemExit('Missing legal notices: ' + notice)
            metadata = apk.read('res/raw/third_party_license_metadata')
            licenses = apk.read('res/raw/third_party_licenses')
            if b'Debug License Info' in metadata or len(metadata.splitlines()) < 10 or not licenses:
                raise SystemExit('Android dependency licenses are missing or contain a debug placeholder')
            for entry in metadata.splitlines():
                span, name = entry.split(b' ', 1)
                offset, length = map(int, span.split(b':'))
                if not name or offset < 0 or length < 1 or offset + length > len(licenses):
                    raise SystemExit('Invalid Android dependency license entry')
            with zipfile.ZipFile(io.BytesIO(apk.read('assets/omni.ja'))) as engine:
                resources = set(engine.namelist())
                required = {
                    'modules/GeckoViewWildBuzzard.sys.mjs',
                    'modules/WildBuzzardAndroid.sys.mjs',
                    'chrome/remote/content/wildbuzzard/BrowserControlChild.sys.mjs',
                    'defaults/settings/main/cookie-banner-rules-list.json',
                    'chrome/browser/wildbuzzard/blocker/assets/list_catalog.json',
                    'chrome/browser/wildbuzzard/blocker/assets/filters/easylist.txt',
                    'chrome/browser/wildbuzzard/blocker/assets/filters/easylist-cookie.txt',
                    'chrome/browser/wildbuzzard/blocker/assets/resources/resources.json',
                    'chrome/browser/wildbuzzard/blocker/assets/resources/ubo-scriptlets.json',
                }
                missing = required - resources
                if missing: raise SystemExit('Missing offline engine resources: ' + ', '.join(sorted(missing)))
            details = {}
            for name in libraries:
                if not name.endswith('.so'): continue
                with apk.open(name) as library:
                    header = library.read(64)
                    if header[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', header, 18)[0] != 183:
                        raise SystemExit('Native library is not AArch64 ELF: ' + name)
                    offset = struct.unpack_from('<Q', header, 32)[0]
                    size, count = struct.unpack_from('<HH', header, 54)
                    library.seek(offset)
                    segments = library.read(size * count)
                    alignment = min(struct.unpack_from('<Q', segments, i * size + 48)[0]
                                    for i in range(count) if struct.unpack_from('<I', segments, i * size)[0] == 1)
                    details[name] = {'machine': 'AArch64', 'load_segment_alignment': alignment}
            native[destination] = details
            browser.append(source)
        elif 'wildbuzzard-agent-probe' in source.parts:
            test = 'androidTest' in source.parts
            destination = 'wildbuzzard-agent-probe-test.apk' if test else 'wildbuzzard-agent-probe.apk'
            role = 'instrumentation' if test else 'agent_probe'
        else:
            continue
    shutil.copy2(source, out/destination)
    roles[role] = destination
    if expected_signer:
        verification = subprocess.check_output([
            str(signing_tools[-1]), 'verify', '--print-certs', str(out/destination),
        ], text=True)
        certificates = re.findall(r'Signer #\d+ certificate SHA-256 digest: ([0-9a-f]+)', verification)
        if certificates != [expected_signer]:
            raise SystemExit('APK did not use the configured signing identity: ' + destination)
        signers[destination] = expected_signer
if not browser: raise SystemExit('No real Gecko ARM64 APK produced')
if not {'browser', 'agent_probe', 'instrumentation'} <= roles.keys():
    raise SystemExit('Browser, independent agent probe and instrumentation APKs are all required')
shutil.copytree(root/'wildbuzzard/android/notices', out/'notices', dirs_exist_ok=True)
subprocess.run([sys.executable, str(root/'wildbuzzard/android/scripts/notices.py'), str(out)], check=True)
manifest = {'source': subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
            'architecture':'arm64-v8a','roles':roles,'native_libraries':native,'signing_certificates':signers,
            'apks':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.glob('*.apk')}}
if os.environ.get('WILDBUZZARD_ENGINE_PROVENANCE'):
    manifest['native_engine_artifact'] = json.loads(Path(os.environ['WILDBUZZARD_ENGINE_PROVENANCE']).read_text())
(out/'build-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
