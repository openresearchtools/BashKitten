#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Stage the offline legal bundle; --licenses prints the same bundle for CLI users."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]

def bundles():
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    intro = "\n".join([
        "Wild Buzzard for Android\n\nCopyright notices and source availability\n",
        "This product uses Mozilla Gecko and the Fenix interface. Mozilla's source licenses, copyright notices and about:license are retained. Wild Buzzard is an independent fork.\n",
        f"Build source: https://github.com/openresearchtools/bashkitten/tree/{revision}\n",
        "Complete corresponding source is available at that revision, including patches, build scripts and the inherited source history. External source revisions are recorded below.\n",
        "BrowserOS tool-contract and Mozilla Firefox DevTools MCP provenance is retained below. The Android APK does not bundle the desktop CLI, torrents, agent runtimes, or BashKitten search extensions.\n",
        "Android library notices are generated from resolved dependencies with the same OSS license plugin used by Fenix and are available in Android library licenses.\n",
    ])

    def files(paths):
        return "\n\n".join(str(path.relative_to(ROOT)) + "\n" + "=" * 64 + "\n" + path.read_text() for path in paths)

    records = json.loads((ROOT/'bashkitten/android/notices/sources.json').read_text())
    for record in records:
        file = ROOT/'bashkitten/android/notices'/record['notice']
        if hashlib.sha256(file.read_bytes()).hexdigest() != record['sha256']:
            raise RuntimeError('License provenance hash mismatch: ' + record['name'])

    def dependencies(selected):
        return "\n\n".join(json.dumps(record, indent=2) + "\n\n" +
            files([ROOT/'bashkitten/android/notices'/record['notice']]) for record in selected)

    product = intro + files([ROOT/'LICENSE', ROOT/'COPYING', ROOT/'bashkitten/browser/branding/LICENSE',
        ROOT/'bashkitten/components/bashkitten-cli/NOTICE',
        ROOT/'bashkitten/components/bashkitten-cli/MOZILLA-MCP-LICENSE'])
    product += "\n\nInherited desktop source notice (desktop packaging references below do not describe this Android APK):\n" + files([ROOT/'bashkitten/SOURCE-NOTICE'])
    tor = "C Tor, Guardian Project Android integration, control library and linked dependencies\n\n" + dependencies([
        record for record in records if record['name'].startswith('tor') or record['name'] in ('jtorctl', 'libevent', 'openssl', 'zlib', 'zstd')])
    blocker = "Adblocking, scriptlets and bundled filter data\n\n" + files([
        ROOT/'bashkitten/BLOCKER-ASSET-SOURCE-NOTICE', ROOT/'third_party/rust/adblock/LICENSE',
        ROOT/'browser/components/blocker/assets/SOURCES.lock.json'])
    blocker += "\n\n" + dependencies([record for record in records if record['name'] in ('ublock', 'brave-resources')])
    for file in sorted((ROOT/'browser/components/blocker/assets/filters').glob('*.txt')):
        headers = []
        for line in file.read_text().splitlines():
            if line.startswith(('!', '#', '[')) or not line: headers.append(line)
            else: break
        blocker += '\n\nFilter list: ' + file.name + '\n' + '\n'.join(headers)
    qr = "QR scanner\n\n" + dependencies([record for record in records if record['name'] == 'zxing-android'])
    sections = {'BASHKITTEN-NOTICES.txt': product, 'TOR-NOTICES.txt': tor,
                'BLOCKER-NOTICES.txt': blocker, 'QR-NOTICES.txt': qr}
    sections['THIRD-PARTY-NOTICES.txt'] = "\n\n".join(sections.values())
    return sections


def notices():
    return bundles()['THIRD-PARTY-NOTICES.txt']


if __name__ == '__main__':
    values = bundles()
    if sys.argv[1:] == ['--licenses']: print(values['THIRD-PARTY-NOTICES.txt'])
    else:
        path = Path(sys.argv[1]); path.mkdir(parents=True, exist_ok=True)
        for name, value in values.items(): (path/name).write_text(value)
