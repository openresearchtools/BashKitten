#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
import zipfile

root = Path(__file__).resolve().parents[3]
out = Path(sys.argv[1]).resolve()
obj = root.parent/'obj-wildbuzzard-android'
outputs = list((obj/'gradle/build/mobile/android/fenix').rglob('*.apk')) + list((obj/'gradle/build/mobile/android/wildbuzzard-agent-probe').rglob('*.apk'))
if not outputs:
    outputs = list(obj.rglob('*.apk'))
browser = []
for source in outputs:
    if 'androidTest' in source.name: continue
    with zipfile.ZipFile(source) as apk:
        libraries = [name for name in apk.namelist() if name.startswith('lib/')]
        if any(name.endswith('/libxul.so') for name in libraries):
            if any(not name.startswith('lib/arm64-v8a/') for name in libraries):
                raise SystemExit('APK contains non-ARM64 native libraries: ' + str(source))
            if 'lib/arm64-v8a/libtor.so' not in libraries: raise SystemExit('Tor not packaged')
            if 'assets/THIRD-PARTY-NOTICES.txt' not in apk.namelist(): raise SystemExit('Missing legal notices')
            browser.append(source)
    shutil.copy2(source, out/source.name)
if not browser: raise SystemExit('No real Gecko ARM64 APK produced')
shutil.copytree(root/'wildbuzzard/android/notices', out/'notices', dirs_exist_ok=True)
subprocess.run([sys.executable, str(root/'wildbuzzard/android/scripts/notices.py'), str(out)], check=True)
manifest = {'source': subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
            'architecture':'arm64-v8a','apks':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.glob('*.apk')}}
(out/'build-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
