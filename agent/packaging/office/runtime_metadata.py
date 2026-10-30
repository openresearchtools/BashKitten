#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Collect native Office legal payloads and actual Linux shared-library needs."""
import importlib.util
import email.parser
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import zipfile
import branding
import source_graph

ROOT = Path(__file__).resolve().parents[3]


def remove_windows_python_launchers(engine, target):
    """Drop only the native platform filter's obsolete files in an owned cache.

    gbuild's Package clean target uses the current FILES list, so it cannot
    remove files excluded by a newly applied platform condition. Do this before
    native SBOM generation; the resulting package inventories stay authoritative.
    """
    engine = Path(engine)
    if target not in ('linux', 'termux') or engine.name != 'instdir' or engine.is_symlink():
        raise ValueError('Windows launcher cleanup requires an owned native Linux/Termux instdir')
    groups = {'pip/_vendor/distlib': ('t32.exe', 't64-arm.exe', 't64.exe',
                                     'w32.exe', 'w64-arm.exe', 'w64.exe'),
              'setuptools': ('cli-32.exe', 'cli-64.exe', 'cli-arm64.exe', 'cli.exe',
                             'gui-32.exe', 'gui-64.exe', 'gui-arm64.exe', 'gui.exe')}
    removed = []
    for library in (engine / 'program').glob('python-core-*/lib'):
        for package, names in groups.items():
            for name in names:
                path = library / package / name
                if not path.exists() and not path.is_symlink():
                    continue
                if (path.is_symlink() or not path.resolve().is_relative_to(engine.resolve())
                        or not path.is_file()):
                    raise ValueError('Cached Windows launcher leaves its owned native output: ' + str(path))
                with path.open('rb') as stream:
                    if stream.read(2) != b'MZ':
                        raise ValueError('Cached Windows launcher is not the expected PE asset: ' + str(path))
                path.unlink()
                removed.append(str(path.relative_to(engine)))
    return removed


def python_notices(runtime):
    """Retain legal files dropped by the native Python package's dist-info filter."""
    libraries = [path for path in (runtime / 'engine/program').glob('python-core-*/lib')
                 if any((path / name).is_dir() for name in ('pip', 'setuptools'))]
    if not libraries:
        return []
    if len(libraries) != 1:
        raise ValueError('Ambiguous installed Office Python library')
    library = libraries[0]
    pin = next(row for row in source_graph.dependency_manifest()['components']
               if row['variable'] == 'PYTHON_TARBALL')
    if pin['name'].removeprefix('Python-').removesuffix('.tar.xz') != library.parent.name.removeprefix('python-core-'):
        raise ValueError('Installed Office Python differs from its retained source archive')
    original = source_graph.dependency_file(pin)
    # These are the two wheel inputs in upstream UnpackedTarball_python3.mk.
    inputs = {'pip': '/Lib/ensurepip/_bundled/pip-',
              'setuptools': '/Lib/test/wheeldata/setuptools-'}
    records, found = [], set()
    with tarfile.open(original) as archive:
        for member in archive:
            name = next((name for name, marker in inputs.items()
                         if marker in member.name and member.name.endswith('.whl')), None)
            if not member.isfile() or name is None or not (library / name).is_dir():
                continue
            if name in found:
                raise ValueError('Ambiguous native Python wheel input: ' + name)
            found.add(name)
            raw = archive.extractfile(member).read()
            with zipfile.ZipFile(io.BytesIO(raw)) as wheel:
                metadata_paths = [path for path in wheel.namelist()
                                  if path.count('/') == 1 and path.endswith('.dist-info/METADATA')]
                if len(metadata_paths) != 1:
                    raise ValueError('Native Python wheel lacks unique original metadata: ' + name)
                metadata = email.parser.Parser().parsestr(wheel.read(metadata_paths[0]).decode('utf-8'))
                if metadata['Name'].lower() != name:
                    raise ValueError('Native Python wheel identity differs: ' + name)
                # setuptools' native package drops its version metadata too;
                # compare unchanged source anchors rather than importing a
                # target-architecture module or inventing its runtime version.
                anchors = [name + '/__init__.py']
                if name == 'setuptools':
                    anchors.append(name + '/_core_metadata.py')
                for anchor in anchors:
                    if (library / anchor).read_bytes() != wheel.read(anchor):
                        raise ValueError('Installed Python package differs from its original wheel: ' + anchor)
                dist_info = metadata_paths[0].removesuffix('/METADATA')
                declared = set()
                for path in metadata.get_all('License-File', []):
                    candidates = [dist_info + '/licenses/' + path, dist_info + '/' + path]
                    selected = next((candidate for candidate in candidates if candidate in wheel.namelist()), None)
                    if selected is None:
                        raise ValueError('Original Python wheel lacks declared full legal file: ' + path)
                    declared.add(selected)
                files = [path for path in wheel.namelist() if not path.endswith('/')
                         and (path.startswith(name + '/') or path.startswith(dist_info + '/'))
                         and (path in declared or re.match(r'^(?:LICEN[CS]E|COPYING|NOTICE|COPYRIGHT|AUTHORS)(?:$|[._-])',
                                                          PurePosixPath(path).name, re.I))]
                if not files or not declared:
                    raise ValueError('Original Python wheel lacks full legal inventory: ' + name)
                destination = runtime / 'legal/python' / (name + '-' + metadata['Version'])
                texts, inventory = [], []
                for path in sorted(files):
                    relative = PurePosixPath(path)
                    if relative.is_absolute() or '..' in relative.parts:
                        raise ValueError('Python legal file leaves its original wheel')
                    data = wheel.read(path)
                    if not data.strip():
                        raise ValueError('Empty original Python legal file: ' + path)
                    target = destination / path
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(data)
                    inventory.append({'member': path, 'sha256': hashlib.sha256(data).hexdigest()})
                    texts.append(path + '\n' + data.decode('utf-8', 'replace'))
                provenance = {'sourceArchive': {key: pin[key] for key in ('url', 'sha256', 'name')},
                              'wheelMember': member.name, 'wheelSha256': hashlib.sha256(raw).hexdigest(),
                              'name': name, 'version': metadata['Version'], 'licenseFiles': inventory,
                              'nativeSbomScope': 'The native engine SBOM records Python; these original wheel notices include its shipped vendored dependencies.'}
                (destination / 'source.json').write_text(json.dumps(provenance, indent=2) + '\n')
                records.append({'name': 'Office Python ' + name + ' and vendored dependencies',
                                'version': metadata['Version'], 'source': pin['url'],
                                'license': (metadata.get('License-Expression') or metadata.get('License') or 'See included license text')
                                           + '; vendored components retain their included terms',
                                'text': '\n\n'.join(texts), 'sourceProvenance': provenance})
    if found != {name for name in inputs if (library / name).is_dir()}:
        raise ValueError('Installed Office Python package lacks its original wheel input')
    return records


def refreshed_dependency_notices(runtime):
    """Deliver the full original notices for the named dependency refresh."""
    records = []
    for component in source_graph.dependency_refresh()['components']:
        texts = []
        for notice in component.get('licenseFiles', []):
            original = source_graph.DEPENDENCIES / notice['file']
            destination = runtime / 'legal/dependencies' / notice['file']
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(original, destination)
            texts.append(notice['member'] + '\n' + original.read_text(errors='replace'))
        if texts:
            records.append({'name': 'Office ' + component['product'], 'version': component['version'],
                            'license': component['license'], 'source': component['url'],
                            'text': '\n\n'.join(texts), 'sourceProvenance': component})
    return records


def notices(source, runtime):
    # The released SBOM owner defines the shipped JS dependency closure; do not
    # maintain a separate approximate list of browser libraries.
    spec = importlib.util.spec_from_file_location('collabora_sbom', source / 'scripts/create-sbom.py')
    upstream = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(upstream)
    _, packages = upstream.read_npm_runtime(str(source / 'browser'), str(source / 'browser'),
                                            str(source / 'browser/sbom-shipped-js.txt'))
    records = []
    attribution = branding.BRANDING / 'ATTRIBUTION.txt'
    # Keep donor legal payloads byte-for-byte; integration attribution is an
    # additional record and a separate installed plain-text notice.
    branding.inputs()
    shutil.copy2(attribution, runtime / 'legal/BashKitten-Office-ATTRIBUTION.txt')
    integration_license = branding.BRANDING / 'online/branding-bashkitten-LICENSE.txt'
    shutil.copy2(integration_license, runtime / 'legal/BashKitten-Office-LICENSE.txt')
    records.append({'name': 'BashKitten integrated Office',
                    'license': 'AGPL-3.0-only (BashKitten integration); upstream components retain their own terms',
                    'text': attribution.read_text() + '\n\n' + integration_license.read_text()})
    def read(paths):
        return '\n\n'.join(path.name + '\n' + path.read_text(errors='replace') for path in paths)
    records.append({'name': 'Collabora Online', 'license': 'MPL-2.0 and component-specific terms',
                    'text': read([source / 'COPYING', source / 'THIRDPARTYLICENSES'])})
    records.append({'name': 'Collabora Office engine and bundled dependencies',
                    'license': 'MPL-2.0, LGPL-3.0-or-later and component-specific terms',
                    'text': read([runtime / 'engine/LICENSE', runtime / 'engine/NOTICE'])})
    records.extend(python_notices(runtime))
    records.extend(refreshed_dependency_notices(runtime))
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
