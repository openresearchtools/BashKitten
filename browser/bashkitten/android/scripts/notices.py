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
        "BashKitten for Android\n\nCopyright notices and source availability\n",
        "This product uses Mozilla Gecko and the Fenix interface. Mozilla's source licenses, copyright notices and about:license are retained. BashKitten is an independent fork.\n",
        f"Build source: https://github.com/openresearchtools/bashkitten/tree/{revision}\n",
        "Complete corresponding source is available at that revision, including retained upstream sources, patches and build scripts. External source revisions are recorded below.\n",
        "BrowserOS tool-contract and Mozilla Firefox DevTools MCP provenance is retained below. The APK includes native Display, Phone controls and Telephony modules. Its paired Termux backend supplies the private Node/Pi, search and desktop runtime packages; their full component notices are included in offline About.\n",
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
    jna_records = [record for record in records if record['name'] == 'jna' or record['name'].startswith('jna-')]
    required_jna = {'LICENSE', 'AL2.0', 'LGPL2.1', 'native/libffi/LICENSE', 'native/libffi/LICENSE-BUILDTOOLS'}
    if {record['licensePath'] for record in jna_records} != required_jna:
        raise RuntimeError('Missing complete JNA/native libffi notices')
    versions = {record['version'] for record in jna_records}
    catalog = (ROOT / 'gradle/libs.versions.toml').read_text().splitlines()
    declared = [line.split('=', 1)[1].strip().strip('"') for line in catalog if line.startswith('jna = "')]
    if len(declared) != 1 or versions != {declared[0]}:
        raise RuntimeError('JNA source notices do not match the declared Android dependency')
    jna = f"Java Native Access {declared[0]} — Java, JNI dispatch and libffi\n\n" + dependencies(jna_records)
    sections = {'BASHKITTEN-NOTICES.txt': product, 'TOR-NOTICES.txt': tor,
                'BLOCKER-NOTICES.txt': blocker, 'QR-NOTICES.txt': qr, 'JNA-NOTICES.txt': jna}
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
