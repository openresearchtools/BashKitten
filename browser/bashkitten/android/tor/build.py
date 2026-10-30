#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Build the existing Guardian JNI library from pinned, pristine Tor source."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[4]
OWNER = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'agent/packaging'))
from source_cache import fetch
from android_native_sources import download_pin

ABIS = {'arm64-v8a': (183, 'aarch64'), 'x86_64': (62, 'x86_64')}
JNI = {'createTorConfiguration', 'mainConfigurationFree',
       'mainConfigurationSetCommandLine', 'mainConfigurationSetupControlSocket',
       'runMain', 'apiGetProviderVersion', 'torFreeAll', 'prepareFileDescriptor'}


def digest(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def selection():
    pins = json.loads((OWNER / 'pins.json').read_text())
    tor = tomllib.loads((ROOT / pins['torPin']).read_text())
    if pins['schema'] != 1 or tor['version'] != pins['version']:
        raise ValueError('Android Tor and pristine Tor release pins differ')
    records = {r['file']: r for r in json.loads((ROOT / 'agent/vendor/native/android-sources.json').read_text())}
    dependencies = {name: records[file] for name, file in pins['dependencies'].items()}
    ndk = json.loads((ROOT / 'agent/packaging/node/lock.json').read_text())['termux']['dependency_sources']['libc++']
    inputs = {str(p.relative_to(ROOT)): digest(p) for p in OWNER.rglob('*') if p.is_file() and '__pycache__' not in p.parts}
    for name in [pins['torPin'], 'browser/bashkitten/android/scripts/tor.py',
                 'browser/bashkitten/android/notices/sources.json', pins['gplLicense']['file']]:
        inputs[name] = digest(ROOT / name)
    for notice in json.loads((ROOT / 'browser/bashkitten/android/notices/sources.json').read_text()):
        if notice['name'].startswith('tor') or notice['name'] in {'jtorctl', 'libevent', 'openssl', 'zlib', 'zstd'}:
            name = 'browser/bashkitten/android/notices/' + notice['notice']
            inputs[name] = digest(ROOT / name)
    for name, expected in pins['integration']['files'].items():
        if digest(OWNER / 'upstream' / name) != expected:
            raise ValueError('Changed pristine Guardian build source: ' + name)
    if digest(OWNER / pins['jniDonor']['patch']) != pins['jniDonor']['sha256']:
        raise ValueError('Changed Guardian JNI donor patch')
    if digest(ROOT / pins['gplLicense']['file']) != pins['gplLicense']['sha256']:
        raise ValueError('Changed full GPL license')
    graph = {'schema': 1, 'tor': tor, 'pins': pins, 'dependencies': dependencies,
             'ndk': ndk, 'inputs': inputs}
    fingerprint = hashlib.sha256(json.dumps(graph, sort_keys=True).encode()).hexdigest()
    return graph, fingerprint


def elf(binary, abi, version):
    data = Path(binary).read_bytes()
    if data[:6] != b'\x7fELF\x02\x01' or int.from_bytes(data[18:20], 'little') != ABIS[abi][0]:
        raise ValueError('Expected a native ' + abi + ' ELF')
    if (version + '\0').encode() not in data:
        raise ValueError('Tor library has the wrong release version')
    symbols = subprocess.check_output(['readelf', '-Ws', str(binary)], text=True)
    exported = {line.split()[-1] for line in symbols.splitlines() if ' GLOBAL ' in line and ' UND ' not in line}
    required = {'Java_org_torproject_jni_TorService_' + name for name in JNI}
    if not required.issubset(exported):
        raise ValueError('Missing native TorService JNI exports')
    dynamic = subprocess.check_output(['readelf', '-d', str(binary)], text=True)
    needed = re.findall(r'\(NEEDED\).*?\[(.*?)\]', dynamic)
    if set(needed) - {'libc.so', 'libm.so', 'libdl.so', 'liblog.so'} or ' PIE' in dynamic:
        raise ValueError('Tor JNI must be a shared library with static bundled dependencies')
    loads = [line.split() for line in subprocess.check_output(['readelf', '-lW', str(binary)], text=True).splitlines()
             if line.strip().startswith('LOAD ')]
    if not loads or any(int(line[-1], 16) < 16384 for line in loads):
        raise ValueError('Tor JNI requires 16 KB compatible load segments')
    return {'machine': ABIS[abi][0], 'jniExports': sorted(required), 'needed': needed,
            'loadAlignment': [int(line[-1], 16) for line in loads]}


def validate(directory, abi):
    graph, fingerprint = selection()
    directory = Path(directory) / abi
    manifest = json.loads((directory / 'tor-android.json').read_text())
    if (manifest.get('schema') != 1 or manifest.get('abi') != abi or
            manifest.get('inputSha256') != fingerprint or
            manifest.get('binarySha256') != digest(directory / 'libtor.so')):
        raise ValueError('Android Tor binary provenance differs from current source inputs')
    with zipfile.ZipFile(directory / 'tor-provenance.zip') as archive:
        if archive.read('tor-android.json') != (directory / 'tor-android.json').read_bytes():
            raise ValueError('Android Tor provenance manifest differs')
        for name, expected in graph['inputs'].items():
            if hashlib.sha256(archive.read(name)).hexdigest() != expected:
                raise ValueError('Android Tor provenance source differs: ' + name)
    if manifest['elf'] != elf(directory / 'libtor.so', abi, graph['tor']['version']):
        raise ValueError('Android Tor ELF provenance differs')
    return directory


def unpack(archive, destination):
    destination.mkdir(parents=True)
    with tarfile.open(archive) as source:
        prefix = source.getmembers()[0].name.split('/')[0] + '/'
        for member in source:
            if not member.name.startswith(prefix):
                continue
            member.name = member.name[len(prefix):]
            if member.name:
                source.extract(member, destination, filter='data')


def build(args):
    graph, fingerprint = selection()
    work, output = args.work.resolve(), args.output.resolve()
    if work.is_relative_to(ROOT) or output.is_relative_to(ROOT):
        raise ValueError('Tor work and output must be outside the source checkout')
    target = output / args.abi
    if (target / 'tor-android.json').exists():
        validate(output, args.abi)
        print('Verified cached Android Tor: ' + str(target), flush=True)
        return
    work.mkdir(parents=True, exist_ok=True)
    ndk = args.ndk
    if ndk is None:
        archive = fetch(graph['ndk'])
        ndk = work / 'android-ndk-r30'
        if not (ndk / 'source.properties').exists():
            subprocess.run(['unzip', '-q', str(archive), '-d', str(work)], check=True)
    ndk = ndk.resolve()
    if ('Pkg.Revision = ' + graph['pins']['ndkVersion']) not in (ndk / 'source.properties').read_text():
        raise ValueError('Guardian Android Tor requires the pinned NDK r30')
    jdk = args.jdk.resolve()
    if not (jdk / 'include/jni.h').is_file():
        raise ValueError('A JDK with JNI headers is required')
    run = work / (args.abi + '-' + fingerprint[:16])
    if run.exists():
        raise ValueError('Incomplete Tor build directory; inspect its logs and select a new --work: ' + str(run))
    external = run / 'external'
    external.mkdir(parents=True)
    source_archive = run / ('tor-' + graph['tor']['version'] + '-pristine.tar')
    with source_archive.open('wb') as stream:
        subprocess.run(['git', 'archive', '--mtime=@' + str(graph['tor']['source_date_epoch']),
                        graph['tor']['tree']], cwd=ROOT, stdout=stream, check=True)
    spec = importlib.util.spec_from_file_location('tor_source_provenance', ROOT / 'browser/bashkitten/scripts/tor-runtime-provenance.py')
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    verifier.verify_source(ROOT / graph['pins']['torPin'], source_archive, ROOT / 'browser/third_party/tor')
    (external / 'tor').mkdir()
    with tarfile.open(source_archive) as source:
        source.extractall(external / 'tor', filter='data')
    subprocess.run(['git', 'apply', '--unsafe-paths', '--directory=' + str(external / 'tor'),
                    str(OWNER / graph['pins']['jniDonor']['patch'])], cwd=ROOT, check=True)
    for name, record in graph['dependencies'].items():
        archive = fetch(download_pin(record))
        unpack(archive, external / name)
    for name in ['Makefile', 'build-tools']:
        shutil.copy2(OWNER / 'upstream/external' / name, external / name)
    env = {**os.environ, 'ANDROID_NDK_HOME': str(ndk), 'ANDROID_NDK_ROOT': str(ndk),
           'JAVA_HOME': str(jdk), 'APP_ABI': args.abi, 'V': '0',
           'CFLAGS': '-fPIC', 'LDFLAGS': '-Wl,-z,max-page-size=16384',
           'PKG_CONFIG_LIBDIR': str(external / 'lib/pkgconfig'), 'PKG_CONFIG_PATH': '',
           'GOTELEMETRY': 'off', 'DO_NOT_TRACK': '1'}
    # Guardian's OpenSSL recipe calls nproc itself. Bound that child through
    # affinity too, while keeping its top-level dependency ordering sequential.
    cpus = sorted(os.sched_getaffinity(0))[:args.jobs]
    if not cpus:
        raise ValueError('--jobs must be positive')
    command = ['taskset', '-c', ','.join(map(str, cpus)), 'make']
    with (run / 'build.log').open('w') as log:
        subprocess.run(command + ['-f', 'build-tools'], cwd=external, env=env,
                       stdout=log, stderr=subprocess.STDOUT, check=True)
        subprocess.run(command, cwd=external, env=env,
                       stdout=log, stderr=subprocess.STDOUT, check=True)
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy2(external / 'lib' / args.abi / 'libtor.so', target / 'libtor.so')
    (target / 'libtor.so').chmod(0o755)
    compiler = ndk / 'toolchains/llvm/prebuilt/linux-x86_64/bin/clang'
    manifest = {'schema': 1, 'abi': args.abi, 'version': graph['tor']['version'],
                'inputSha256': fingerprint, 'binarySha256': digest(target / 'libtor.so'),
                'sources': graph, 'compilerSha256': digest(compiler.resolve()),
                'compiler': subprocess.check_output([str(compiler), '--version'], text=True).splitlines()[0],
                'elf': elf(target / 'libtor.so', args.abi, graph['tor']['version'])}
    (target / 'tor-android.json').write_text(json.dumps(manifest, indent=2) + '\n')
    with zipfile.ZipFile(target / 'tor-provenance.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.write(target / 'tor-android.json', 'tor-android.json')
        for name in graph['inputs']:
            archive.write(ROOT / name, name)
    validate(output, args.abi)
    print('Built Android Tor: ' + str(target), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--abi', choices=ABIS, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--ndk', type=Path)
    parser.add_argument('--jdk', type=Path, default=Path(os.environ.get('JAVA_HOME', '/usr/lib/jvm/default-java')))
    parser.add_argument('--jobs', type=int, default=2)
    args = parser.parse_args()
    try:
        build(args)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
