#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Retain pinned native Poco only for Online's host configure probes."""
import importlib.util
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile

import source_graph
from engine import run
from source_archive import archive_revision

ROOT = source_graph.ROOT
LIBRARIES = ('Foundation', 'XML', 'JSON', 'Util', 'Net', 'NetSSL', 'Crypto', 'Zip')


def load(name):
    path = ROOT / 'agent/packaging' / (name + '.py')
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), path)
    owner = importlib.util.module_from_spec(spec); spec.loader.exec_module(owner)
    return owner


def prepare(args):
    store, native = load('component-store'), load('native-component')
    pin = next(row for row in json.loads((source_graph.DEPENDENCIES / 'sources.json').read_text())['components']
               if row['variable'] == 'POCO_TARBALL')
    recipe = 'agent/packaging/office/web-support.py'
    inputs = {'schema': 1, 'poco': pin, 'recipe': native.entry(args.source, recipe),
              'host': {'architecture': platform.machine(), 'system': 'Ubuntu24.04',
                       'gcc': subprocess.check_output(['gcc', '-dumpfullversion'], text=True).strip(),
                       'cmake': subprocess.check_output(['cmake', '--version'], text=True).splitlines()[0]}}
    output = args.directory / 'office-web-support'; output.mkdir(parents=True, exist_ok=True)
    result = store.restore('office-web-support', args.target, inputs, output,
                           roles={'build-support'}, requested_source=args.source)
    archive = output / 'office-web-support.tar.gz'
    if result is None:
        if os.environ.get('GITHUB_ACTIONS') != 'true':
            raise ValueError('Build native Office host support only in architecture GitHub Actions')
        original = source_graph.source_cache.fetch(pin, args.cache)
        work = args.work / 'host-poco'; work.mkdir(parents=True, exist_ok=True)
        with tarfile.open(original) as source:
            source.extractall(work, filter='data')
        source = work / pin['name'].removesuffix('.tar.bz2')
        build, prefix = work / 'build', work / 'poco'
        flags = ['-DPOCO_MINIMAL_BUILD=ON', '-DBUILD_SHARED_LIBS=ON',
                 '-DCMAKE_C_COMPILER=gcc', '-DCMAKE_CXX_COMPILER=g++',
                 '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_INSTALL_LIBDIR=lib',
                 '-DCMAKE_INSTALL_PREFIX=/poco', '-DENABLE_TESTS=OFF',
                 '-DENABLE_SAMPLES=OFF', '-DENABLE_FASTLOGGER=OFF', '-DENABLE_JWT=OFF',
                 '-DENABLE_APACHECONNECTOR=OFF', '-DENABLE_DATA=OFF', '-DENABLE_DATA_SQLITE=OFF',
                 '-DENABLE_DATA_MYSQL=OFF', '-DENABLE_DATA_POSTGRESQL=OFF', '-DENABLE_DATA_ODBC=OFF']
        flags += ['-DENABLE_' + name.upper() + '=ON' for name in LIBRARIES]
        run(['cmake', '-S', source, '-B', build, '-G', 'Ninja', *flags])
        run(['cmake', '--build', build, '--parallel', str(args.jobs)])
        run(['cmake', '--install', build, '--prefix', prefix])
        for name in LIBRARIES:
            library = prefix / 'lib' / ('libPoco' + name + '.so')
            if not library.is_file() or library.read_bytes()[:4] != b'\x7fELF':
                raise ValueError('Native Poco host support is incomplete: ' + name)
        legal = prefix / 'legal'; legal.mkdir()
        shutil.copy2(ROOT / 'LICENSE', legal / 'Taskarian-LICENSE')
        for path in source.rglob('*'):
            if path.is_file() and path.name.upper().startswith(('LICENSE', 'COPYING', 'NOTICE', 'COPYRIGHT')):
                destination = legal / path.relative_to(source)
                destination.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(path, destination)
        with tarfile.open(archive, 'w:gz', compresslevel=1) as bundle:
            bundle.add(prefix, arcname='poco')
        sources = output / 'office-web-support-source.tar'
        tracked = output / 'office-web-support-recipe.tar.gz'
        archive_revision(ROOT, args.source, tracked, paths=['LICENSE', 'agent/packaging',
            '.github/builders/native.yml', 'office/upstream/dependencies/sources.json'])
        with tarfile.open(sources, 'w') as bundle:
            bundle.add(original, arcname=pin['name']); bundle.add(tracked, arcname=tracked.name)
        tracked.unlink()
        licenses = output / 'office-web-support-licenses.tar.gz'
        with tarfile.open(licenses, 'w:gz') as bundle:
            bundle.add(legal, arcname='legal')
        result = store.publish('office-web-support', args.target,
            pin['name'].removeprefix('poco-').removesuffix('-all.tar.bz2'), inputs, output,
            assets={archive.name: 'build-support', sources.name: 'source', licenses.name: 'legal'},
            source_commit=args.source)
    restored = args.work / 'host-support'; restored.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as source:
        source.extractall(restored, filter='data')
    prefix = restored / 'poco'
    return prefix, {key: result[key] for key in ('repository', 'manifestName', 'manifestSha256')}
