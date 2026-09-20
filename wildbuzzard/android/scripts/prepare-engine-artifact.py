#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Reuse this fork's native engine only across explicitly permitted Android UI and packaged JavaScript changes."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('artifacts', type=Path)
parser.add_argument('destination', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[3]
manifest = json.loads((args.artifacts / 'build-manifest.json').read_text())
source = manifest['source']
if not re.fullmatch(r'[0-9a-f]{40}', source) or manifest['architecture'] != 'arm64-v8a':
    raise SystemExit('Expected a recorded ARM64 source revision')
subprocess.run(['git', 'cat-file', '-e', source + '^{commit}'], cwd=root, check=True)
changed = subprocess.check_output(['git', 'diff', '--name-only', source, 'HEAD'], cwd=root, text=True).splitlines()
allowed_prefixes = (
    '.github/workflows/',
    'mobile/android/fenix/app/src/main/java/',
    'mobile/android/fenix/app/src/main/res/',
    'mobile/android/android-components/components/browser/thumbnails/src/',
    'mobile/android/android-components/components/feature/top-sites/src/',
    'mobile/android/wildbuzzard/src/main/java/',
    'mobile/android/wildbuzzard/src/main/res/',
    'mobile/android/wildbuzzard-agent-probe/',
    'wildbuzzard/android/tests/',
    'wildbuzzard/android/scripts/',
    'wildbuzzard/android/pi/',
)
allowed_files = {
    'README.md',
    'mobile/android/wildbuzzard/src/main/AndroidManifest.xml',
    'mobile/android/geckoview/src/main/java/org/mozilla/geckoview/GeckoSession.java',
    'mobile/android/geckoview/src/main/java/org/mozilla/geckoview/WildBuzzardController.java',
    'mobile/shared/modules/geckoview/GeckoViewWildBuzzard.sys.mjs',
    'mobile/shared/modules/geckoview/WildBuzzardAndroid.sys.mjs',
    'remote/wildbuzzard/BrowserControlChild.sys.mjs',
    'mobile/android/android-components/components/feature/downloads/src/main/java/mozilla/components/feature/downloads/DownloadsFeature.kt',
    'wildbuzzard/android/validation-results.json',
    'mobile/android/fenix/app/build.gradle',
    'mobile/android/fenix/app/src/main/assets/shared_error_style.css',
    'mobile/android/fenix/app/src/main/assets/low_and_medium_risk_error_style.css',
    'mobile/android/fenix/app/src/main/assets/high_risk_error_style.css',
    'wildbuzzard/android/API.md',
    'wildbuzzard/android/README.md',
    'wildbuzzard/android/VALIDATION.md',
    'wildbuzzard/android/mozconfig-artifact',
}
forbidden_suffixes = {'.c', '.cc', '.cpp', '.h', '.rs', '.S', '.so', '.aar', '.jar'}
rejected = [p for p in changed if Path(p).suffix in forbidden_suffixes or not
            (p in allowed_files or p.startswith(allowed_prefixes))]
# Native Tor construction must stay unchanged. The listed JS modules are repackaged by mach build.
rejected += [p for p in changed if p == 'wildbuzzard/android/scripts/tor.py']
if rejected:
    raise SystemExit('Full native build required for: ' + ', '.join(sorted(set(rejected))))
name = manifest['roles']['browser']
if Path(name).name != name or not name.endswith('.apk'):
    raise SystemExit('Invalid browser artifact filename')
apk = args.artifacts / name
checksum = hashlib.sha256(apk.read_bytes()).hexdigest()
if checksum != manifest['apks'][name]:
    raise SystemExit('Native engine APK checksum mismatch')
if manifest.get('native_engine_artifact'):
    raise SystemExit('Use an original full native build, not an artifact-derived build')
args.destination.mkdir(parents=True, exist_ok=True)
shutil.copy2(apk, args.destination / 'geckoview_example.apk')
provenance = {'source': source, 'apk_sha256': checksum, 'allowed_android_changes': changed}
(args.destination / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
print('Verified native engine source ' + source + '; Android-only changed files: ' + str(len(changed)))
