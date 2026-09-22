#!/usr/bin/env python3
"""Retain Tor's embedded-code notices and the shipped GeoIP data license."""
from pathlib import Path
import json
import shutil
import sys

source, output = map(Path, sys.argv[1:])
destination = output / 'share/licenses/tor'
destination.mkdir(parents=True, exist_ok=True)
files = [source / 'LICENSE']
files += [p for p in source.iterdir() if p.is_file() and p.name.upper().startswith('NOTICE')]
files += [p for p in (source / 'src/ext').rglob('*') if p.is_file() and p.name.upper().startswith(('LICENSE', 'COPYING', 'NOTICE', 'COPYRIGHT'))]
for path in files:
    relative = path.relative_to(source)
    target = destination / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, target)

shutil.copy2(Path(__file__).parent / 'licenses/CC-BY-SA-4.0.txt', destination)
header = []
for line in (source / 'src/config/geoip').read_text().splitlines():
    if not line.startswith('#'):
        break
    header.append(line.removeprefix('#').lstrip())
(destination / 'GeoIP-NOTICE.txt').write_text('\n'.join(header) + '\n\nThe bundled Tor GeoIP files are unmodified.\n')
metadata = output / 'share/metadata'
metadata.mkdir(parents=True, exist_ok=True)
(metadata / 'tor-licenses.json').write_text(json.dumps({
    'tor': 'BSD-3-Clause and the embedded component licenses retained below',
    'geoip': {'license': 'CC-BY-SA-4.0', 'source': 'https://location.ipfire.org/',
              'licenseTextSource': 'https://creativecommons.org/licenses/by-sa/4.0/legalcode.txt'},
    'licenseFiles': sorted(str(p.relative_to(destination)) for p in destination.rglob('*') if p.is_file()),
    'externalLibraries': 'System OpenSSL, libevent, liblzma and zlib are package dependencies, not bundled copies.'
}, indent=2) + '\n')
