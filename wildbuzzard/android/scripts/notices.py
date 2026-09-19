#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Stage the offline legal bundle; --licenses prints the same bundle for CLI users."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]

def notices():
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    text = ["WildBuzzard for Android\n\nCopyright notices and source availability\n",
            "This product uses Mozilla Gecko and the Fenix interface. Mozilla's source licenses, copyright notices and about:license are retained. WildBuzzard is an independent fork.\n",
            f"Build source: https://github.com/openresearchtools/wildbuzzard-android/tree/{revision}\n",
            "Complete corresponding source is available at that revision, including patches, build scripts and the inherited source history. External source revisions are recorded below.\n",
            "BrowserOS tool-contract and Mozilla Firefox DevTools MCP provenance is retained below. The Android APK does not bundle the desktop CLI, torrents, agent runtimes, or WildBuzzard search extensions.\n",
            "Android library notices are generated from the resolved dependencies with the same OSS license plugin used by Fenix and are available in Android library licenses.\n"]
    files = [ROOT/'LICENSE', ROOT/'COPYING', ROOT/'wildbuzzard/SOURCE-NOTICE',
             ROOT/'wildbuzzard/components/wildbuzzard-cli/NOTICE',
             ROOT/'wildbuzzard/components/wildbuzzard-cli/MOZILLA-MCP-LICENSE',
             ROOT/'wildbuzzard/BLOCKER-ASSET-SOURCE-NOTICE', ROOT/'third_party/rust/adblock/LICENSE',
             ROOT/'wildbuzzard/browser/branding/LICENSE', ROOT/'browser/components/blocker/assets/SOURCES.lock.json']
    records = json.loads((ROOT/'wildbuzzard/android/notices/sources.json').read_text())
    for record in records:
        file = ROOT/'wildbuzzard/android/notices'/record['notice']
        if hashlib.sha256(file.read_bytes()).hexdigest() != record['sha256']:
            raise RuntimeError('License provenance hash mismatch: ' + record['name'])
    files += sorted((ROOT/'wildbuzzard/android/notices').glob('*'))
    for file in files:
        if file.is_file(): text.extend(['\n\n' + str(file.relative_to(ROOT)) + '\n' + '=' * 64 + '\n', file.read_text()])
    for file in sorted((ROOT/'browser/components/blocker/assets/filters').glob('*.txt')):
        # Retain each list's authors, license and project links as shipped.
        headers = []
        for line in file.read_text().splitlines():
            if line.startswith(('!', '#', '[')) or not line: headers.append(line)
            else: break
        text.extend(['\n\nFilter list: ' + file.name + '\n', '\n'.join(headers)])
    return '\n'.join(text)

if __name__ == '__main__':
    value = notices()
    if sys.argv[1:] == ['--licenses']: print(value)
    else:
        path = Path(sys.argv[1]); path.mkdir(parents=True, exist_ok=True)
        (path/'THIRD-PARTY-NOTICES.txt').write_text(value)
