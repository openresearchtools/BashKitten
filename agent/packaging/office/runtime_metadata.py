#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Collect native Office legal payloads and actual Linux shared-library needs."""
import importlib.util
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]


def notices(source, runtime):
    # The released SBOM owner defines the shipped JS dependency closure; do not
    # maintain a separate approximate list of browser libraries.
    spec = importlib.util.spec_from_file_location('collabora_sbom', source / 'scripts/create-sbom.py')
    upstream = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(upstream)
    _, packages = upstream.read_npm_runtime(str(source / 'browser'), str(source / 'browser'),
                                            str(source / 'browser/sbom-shipped-js.txt'))
    records = []
    def read(paths):
        return '\n\n'.join(path.name + '\n' + path.read_text(errors='replace') for path in paths)
    records.append({'name': 'Collabora Online', 'license': 'MPL-2.0 and component-specific terms',
                    'text': read([source / 'COPYING', source / 'THIRDPARTYLICENSES'])})
    records.append({'name': 'Collabora Office engine and bundled dependencies',
                    'license': 'MPL-2.0, LGPL-3.0-or-later and component-specific terms',
                    'text': read([runtime / 'engine/LICENSE', runtime / 'engine/NOTICE'])})
    for name, package in sorted(packages.items()):
        resolved = package['resolved']
        if not resolved.startswith('file:node_shrinkpack/'):
            raise ValueError('Unretained shipped browser dependency: ' + name)
        archive_path = source / 'browser' / resolved.removeprefix('file:')
        texts = []
        with tarfile.open(archive_path) as archive:
            for member in archive:
                if member.isfile() and re.search(r'(^|/)(licen[cs]e|copying|notice|copyright)([._/-]|$)', member.name, re.I):
                    texts.append(member.name + '\n' + archive.extractfile(member).read().decode('utf-8', 'replace'))
        if not texts:
            supplement = ROOT / 'office/upstream/supplements' / name
            provenance = json.loads((supplement / 'source.json').read_text()) if supplement.is_dir() else None
            if not provenance or provenance['version'] != package['version']:
                raise ValueError('Shipped npm archive lacks full legal text: ' + name)
            license_path = supplement / provenance['licenseFile']
            if hashlib.sha256(license_path.read_bytes()).hexdigest() != provenance['licenseSha256']:
                raise ValueError('Supplemental license checksum differs: ' + name)
            texts.append(license_path.name + '\n' + license_path.read_text())
        records.append({'name': name, 'version': package['version'],
                        'license': package['license'] or 'See included license text',
                        'source': 'https://www.npmjs.com/package/' + name,
                        'text': '\n\n'.join(texts)})
    (runtime / 'licenses.json').write_text(json.dumps(records, indent=2) + '\n')


def linux_dependencies(runtime, work):
    binaries = []
    sonames = set()
    needed = set()
    for path in runtime.rglob('*'):
        if path.is_symlink() or not path.is_file():
            continue
        with path.open('rb') as stream:
            if stream.read(4) != b'\x7fELF':
                continue
        dynamic = subprocess.check_output(['readelf', '-d', str(path)], text=True)
        sonames.add(path.name)
        sonames.update(re.findall(r'\(SONAME\).*\[([^]]+)\]', dynamic))
        if '(NEEDED)' not in dynamic:
            continue
        binaries.append(path)
        needed.update(re.findall(r'\(NEEDED\).*\[([^]]+)\]', dynamic))
    # Every external dependency must resolve to an actual OS-owned library.
    # --ignore-missing-info below is solely for our private bundled libraries.
    ldconfig = shutil.which('ldconfig') or '/sbin/ldconfig'
    cache = subprocess.check_output([ldconfig, '-p'], text=True)
    system = {}
    for line in cache.splitlines():
        match = re.match(r'\s*(\S+)\s+\([^)]*\)\s+=>\s+(\S+)', line)
        if match:
            system.setdefault(match[1], Path(match[2]))
    for name in sorted(needed - sonames):
        library = system.get(name)
        if library is None:
            raise ValueError('Unresolved native dependency: ' + name)
        candidates = [str(library), str(library.resolve())]
        if all(subprocess.run(['dpkg-query', '-S', value], stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL).returncode for value in candidates):
            raise ValueError('Native dependency has no installed OS package: ' + name)
    dependency_work = work / 'dependencies'
    (dependency_work / 'debian').mkdir(parents=True, exist_ok=True)
    (dependency_work / 'debian/control').write_text(
        'Source: bashkitten-office\nSection: utils\nPriority: optional\n'
        'Maintainer: Open Research Tools <openresearchtools@gmail.com>\n\n'
        'Package: bashkitten-office\nArchitecture: any\nDescription: private native Office component\n')
    dirs = sorted({str(path.parent) for path in binaries})
    result = subprocess.check_output(['dpkg-shlibdeps', '-O', '--ignore-missing-info',
                                      *('-l' + name for name in dirs),
                                      *('-e' + str(path) for path in binaries)], cwd=dependency_work, text=True)
    values = result.strip().removeprefix('shlibs:Depends=').split(', ')
    if not values or not any(value.startswith('libc6') for value in values):
        raise ValueError('Native library dependency inventory is empty')
    return sorted(set(values + ['fontconfig', 'cpio', 'coreutils', 'findutils', 'util-linux']))
