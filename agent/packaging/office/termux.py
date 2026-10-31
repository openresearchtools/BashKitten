#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Cross-build the native Bionic Collabora server, kit and matching engine.

This uses the released Linux server/gbuild entry points with the pinned Android
NDK compiler, not Collabora's MOBILEAPP target. Run in the existing prepared
Linux build environment. All generated work and outputs remain outside Git.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile

import source_graph
from build import ENGINE_OPTIONS, PATCHES as COMMON_PATCHES, inventory, prepare_stage, run, write_json
import runtime_metadata
import branding

ROOT = Path(__file__).resolve().parents[3]
PREFIX = '/data/data/com.termux/files/usr'
RUNTIME = PREFIX + '/lib/bashkitten/office/runtime'
sys.path.insert(0, str(ROOT / 'agent/packaging'))
from source_cache import fetch
sys.path.insert(0, str(ROOT / 'agent/packaging/termux'))
import native_toolchain

PATCH_ROOT = ROOT / 'office/patches/termux'
NATIVE_DEPENDENCIES = source_graph.DEPENDENCIES / 'native-termux'
SYSTEM_PACKAGES = ['bash', 'ca-certificates', 'coreutils', 'fontconfig']


def patch_inputs():
    names = [line.strip() for line in (PATCH_ROOT / 'series').read_text().splitlines()
             if line.strip() and not line.startswith('#')]
    return [ROOT / name for name in COMMON_PATCHES] + [PATCH_ROOT / name for name in names]


def native_inputs():
    donor = json.loads((PATCH_ROOT / 'donor.json').read_text())
    return {'archive': donor['sourceArchive'], 'sha256': donor['donor']['sha256'],
            'archiveRoot': donor['archiveRoot'], 'files': donor['nativeBuildInputs']}


def materialize_native_inputs(source):
    retained = native_inputs()
    donor = json.loads((PATCH_ROOT / 'donor.json').read_text())
    archive = fetch(donor['donor'], local=ROOT / retained['archive'])
    with tarfile.open(archive) as bundle:
        for row in retained['files']:
            payload = bundle.extractfile(retained['archiveRoot'] + '/' + row['file']).read()
            if hashlib.sha256(payload).hexdigest() != row['sha256']:
                raise ValueError('Retained native Termux member changed: ' + row['file'])
            destination = source / row['destination']
            if not destination.resolve().is_relative_to(source.resolve()):
                raise ValueError('Native source destination leaves its build tree')
            destination.parent.mkdir(parents=True, exist_ok=True)
            # The retained Python patch carries the framework's documented
            # prefix placeholder. Resolve it before applying our named delta.
            destination.write_bytes(payload.replace(b'@TERMUX_PREFIX@', PREFIX.encode()))


def prepare(work, cache, architecture):
    source_graph.verify_source()
    source_graph.prepare_cache(cache)
    source = work / 'source'
    pin = json.loads((source_graph.UPSTREAM / 'online/source.json').read_text())
    inputs = [{'file': str(path.relative_to(ROOT)), 'sha256': source_graph.digest(path)}
              for path in patch_inputs()]
    expected = {'tree': pin['tree'], 'patches': inputs, 'nativeInputs': native_inputs(),
                'prefix': PREFIX, 'architecture': architecture}
    stamp = work / 'source-inputs.json'
    if source.exists():
        if not stamp.is_file() or json.loads(stamp.read_text()) != expected:
            raise ValueError('Existing work has different source/patch inputs; use a new work directory')
    else:
        run(['cp', '-a', '--reflink=auto', source_graph.SOURCE, source])
        materialize_native_inputs(source)
        for patch in patch_inputs():
            # Substitute only the documented Termux build-prefix placeholders.
            payload = patch.read_text().replace('@TERMUX_PREFIX@', PREFIX)
            subprocess.run(['patch', '--batch', '--fuzz=0', '-p1'], input=payload,
                           cwd=source, text=True, check=True)
        (source / 'dist_git_hash').write_text(pin['commit'][:10] + '\n')
        write_json(stamp, expected)
    return source


def build_environment(args):
    env, provenance = native_toolchain.build_environment(args)
    env.update({
        'GIT_CEILING_DIRECTORIES': str(args.work),
        'SOURCE_REVISION': json.loads((source_graph.UPSTREAM / 'online/source.json').read_text())['commit'],
    })
    return env, provenance


def native_dependency_archive(component):
    path = NATIVE_DEPENDENCIES / component['file']
    if not path.resolve().is_relative_to(NATIVE_DEPENDENCIES.resolve()):
        raise ValueError('Native dependency input leaves its retained directory')
    return fetch(component, local=path)


def native_dependencies():
    manifest = NATIVE_DEPENDENCIES / 'sources.json'
    result = json.loads(manifest.read_text())
    for row in result['components']:
        native_dependency_archive(row)
        if not row.get('license'):
            raise ValueError('Native dependency has no license: ' + row['name'])
        for record in native_dependency_licenses(row):
            path = NATIVE_DEPENDENCIES / record['file']
            if not path.resolve().is_relative_to(NATIVE_DEPENDENCIES.resolve()):
                raise ValueError('Native dependency input leaves its retained directory')
            if not record.get('license') or source_graph.digest(path) != record['sha256']:
                raise ValueError('Native dependency input changed: ' + str(path))
    return {**result, 'manifestSha256': source_graph.digest(manifest)}


def native_dependency_licenses(component):
    return [{'file': component['licenseFile'], 'sha256': component['licenseSha256'],
             'license': component['license']}, *component.get('sourceLicenseFiles', [])]


def native_dependency_notices(component):
    notices = []
    for index, record in enumerate(native_dependency_licenses(component)):
        notices.append({'name': component['name'] + (' source archive terms' if index else ''),
                        'version': component['version'], 'license': record['license'],
                        'source': component['url'],
                        'text': (NATIVE_DEPENDENCIES / record['file']).read_text(),
                        **({'scope': record['scope']} if record.get('scope') else {})})
    return notices


def build_libcap(args, env):
    """Use libcap's native library target and the retained Termux configuration."""
    retained = native_dependencies()
    component = next(row for row in retained['components'] if row['name'] == 'libcap')
    work = args.work / 'native-termux'
    source = work / ('libcap-' + component['version'])
    command = ['make', '-C', str(source / 'libcap'), '-j' + str(args.jobs),
               'CC=' + env['CC'], 'AR=' + env['AR'], 'RANLIB=' + env['RANLIB'],
               'OBJCOPY=' + str(args.ndk / 'toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-objcopy'),
               'BUILD_CC=gcc', 'BUILD_CFLAGS=-O2', 'PTHREADS=no', 'PAM_CAP=no', 'PREFIX=' + PREFIX]
    expected = {'source': component, 'architecture': args.architecture,
                'configuration': command[4:],
                'flags': {key: env[key] for key in ['CFLAGS', 'CPPFLAGS', 'LDFLAGS']}}
    stamp = work / 'libcap-inputs.json'
    if source.exists():
        if not stamp.is_file() or json.loads(stamp.read_text()) != expected:
            raise ValueError('Native libcap build inputs changed; use a fresh native-termux dependency directory')
    else:
        work.mkdir(parents=True, exist_ok=True)
        with tarfile.open(native_dependency_archive(component)) as archive:
            archive.extractall(work, filter='data')
        write_json(stamp, expected)
    # BUILD_CC is supported by this release, so the donor's old hardcoded-gcc
    # patch is unnecessary. Build only the native library target: it has no
    # attr dependency and does not run target executables on the build host.
    run(command, cwd=source, env=env)
    if not (source / 'libcap/libcap.so.2').is_file():
        raise ValueError('Native libcap shared library was not produced')
    return source


def build_libiconv(args, env):
    """Use the pinned Termux recipe's native GNU libiconv and extra encodings."""
    component = next(row for row in native_dependencies()['components'] if row['name'] == 'libiconv')
    work = args.work / 'native-termux'
    source = work / ('libiconv-' + component['version'])
    options = ['--build=x86_64-pc-linux-gnu', '--host=' + args.architecture + '-linux-android',
               '--prefix=' + PREFIX, '--enable-extra-encodings', '--enable-shared', '--disable-static']
    expected = {'source': component, 'architecture': args.architecture, 'configuration': options,
                'flags': {key: env[key] for key in ['CC', 'CFLAGS', 'CPPFLAGS', 'LDFLAGS']}}
    stamp = work / 'libiconv-inputs.json'
    if source.exists():
        if not stamp.is_file() or json.loads(stamp.read_text()) != expected:
            raise ValueError('Native libiconv build inputs changed; use a fresh native-termux dependency directory')
    else:
        work.mkdir(parents=True, exist_ok=True)
        with tarfile.open(native_dependency_archive(component)) as archive:
            archive.extractall(work, filter='data')
        write_json(stamp, expected)
    if not (source / 'config.status').is_file():
        run(['./configure', *options], cwd=source, env=env)
    # The matching released Termux package builds GNU libiconv without source
    # patches. Office uses its library only; do not build/install the GPL CLI.
    run(['make', '-j' + str(args.jobs), 'lib/localcharset.h'], cwd=source, env=env)
    run(['make', '-C', str(source / 'lib'), '-j' + str(args.jobs), 'all'], cwd=source, env=env)
    if not (source / 'lib/.libs/libiconv.so').is_file() or not (source / 'include/iconv.h').is_file():
        raise ValueError('Native GNU libiconv shared library/header was not produced')
    return source


def configure_engine(source, args, env):
    options = [*ENGINE_OPTIONS, *branding.engine_options(), '--build=x86_64-pc-linux-gnu',
               '--host=' + args.architecture + '-linux', '--prefix=' + RUNTIME,
               '--with-parallelism=' + str(args.jobs), '--with-external-tar=' + str(args.cache),
               '--with-external-dict-dir=' + PREFIX + '/share/hunspell',
               '--with-external-hyph-dir=' + PREFIX + '/share/hyphen',
               '--with-external-thes-dir=' + PREFIX + '/share/mythes', '--without-system-libxml']
    run(['sh', './autogen.sh', *options], cwd=source / 'engine', env=env)
    # Check the selected native graph before make can fetch anything. A new
    # dependency needs a separately reviewed/materialized source input.
    retained = {row['name']: row['sha256'] for row in source_graph.verify_dependencies()['components']}
    for config in [source / 'engine/config_host.mk', source / 'engine/config_build.mk']:
        for row in source_graph.engine_inputs(config):
            if retained.get(row['name']) != row['sha256']:
                raise ValueError('Unmaterialized Bionic build dependency: ' + row['name'])
    branding.verify_engine(source)
    return options


def online_make_inputs(libcap, libiconv):
    return ['CAP_LIBS=-L' + str(libcap / 'libcap') + ' -lcap',
            'ICONV_LIBS=-L' + str(libiconv / 'lib/.libs') + ' -liconv']


def build_online(source, args, env):
    libcap = build_libcap(args, env)
    libiconv = build_libiconv(args, env)
    native = {**env, 'CPPFLAGS': env['CPPFLAGS'] + ' -I' + str(libcap / 'libcap/include')
              + ' -I' + str(libiconv / 'include'),
              'LDFLAGS': env['LDFLAGS'] + ' -L' + str(libcap / 'libcap')
              + ' -L' + str(libiconv / 'lib/.libs'), 'LIBS': '-liconv'}
    run(['bash', './autogen.sh'], cwd=source, env=native)
    run(['./configure', '--build=x86_64-pc-linux-gnu', '--host=' + args.architecture + '-linux-android',
         '--prefix=' + RUNTIME, '--sysconfdir=' + RUNTIME + '/etc', '--localstatedir=' + RUNTIME + '/var',
         '--disable-tests', '--disable-pam', '--enable-landlock', '--enable-seccomp',
         *branding.online_options(),
         '--with-lo-builddir=' + str(source / 'engine'),
         '--with-lokit-path=' + str(source / 'engine/include'), '--with-lo-path=' + RUNTIME + '/engine'],
        cwd=source, env=native)
    branding.verify_online(source)
    config = (source / 'config.h').read_text()
    for required in ['#define MOBILEAPP 0', '#define DISABLE_SECCOMP 0', '#define DISABLE_LANDLOCK 0',
                     '#define HAVE_LIBCAP 1', '#define BASHKITTEN_TERMUX_PREFIX "' + PREFIX + '"']:
        if required not in config:
            raise ValueError('Native server/isolation configuration missing: ' + required)
    # Online forwards its complete configured CPPFLAGS to native gbuild. Keep
    # configure's COKit/Poco/OpenSSL additions for the remaining autotools units;
    # overriding top-level CPPFLAGS would remove those required include paths.
    run(['make', '-j' + str(args.jobs), *online_make_inputs(libcap, libiconv)], cwd=source, env=native)
    run(['make', 'sbom-check'], cwd=source, env=native)
    readelf = args.ndk / 'toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf'
    server = source / 'coolwsd'
    dynamic = subprocess.check_output([readelf, '-d', server], text=True)
    symbols = subprocess.check_output([readelf, '--dyn-syms', server], text=True)
    if not re.search(r'\(NEEDED\).*\[libiconv\.so\]', dynamic) or 'libiconv_open' not in symbols:
        raise ValueError('Native WOPI server is not linked to the required GNU UTF-7 converter')


def package(source, args, env, toolchain):
    branding.verify_engine(source)
    branding.verify_online(source)
    libcap = build_libcap(args, env)
    libiconv = build_libiconv(args, env)
    run(['./config.status', 'instsetoo_native/util/openoffice.lst'], cwd=source / 'engine', env=env)
    run(['make', 'Package_instsetoo_native_setup'], cwd=source / 'engine', env=env)
    runtime_metadata.remove_windows_python_launchers(source / 'engine/instdir', 'termux')
    run(['make', 'LIBO_TEST_INSTALL=TRUE', 'CustomTarget_instsetoo_native/sbom'], cwd=source / 'engine', env=env)
    stage = prepare_stage(source, args.work, getattr(args, 'stage_dir', None))
    run(['make', *online_make_inputs(libcap, libiconv), 'DESTDIR=' + str(stage), 'install'], cwd=source, env=env)
    runtime = stage / RUNTIME.lstrip('/')
    shutil.copytree(source / 'engine/instdir', runtime / 'engine', symlinks=True)
    if 'buildid=' + env['SOURCE_REVISION'] not in (runtime / 'engine/program/versionrc').read_text():
        raise ValueError('Native engine versionrc does not contain the pinned source revision')
    # One shared C++ ABI implementation for every dlopened UNO component.
    triple = args.architecture + '-linux-android'
    libcxx = args.ndk / 'toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib' / triple / 'libc++_shared.so'
    shutil.copy2(libcxx, runtime / 'engine/program/libc++_shared.so')
    for library in (libcap / 'libcap').glob('libcap.so*'):
        shutil.copy2(library, runtime / 'engine/program' / library.name, follow_symlinks=False)
    for library in (libiconv / 'lib/.libs').glob('libiconv.so*'):
        shutil.copy2(library, runtime / 'engine/program' / library.name, follow_symlinks=False)
    required = ['bin/coolwsd', 'bin/coolforkit-ns', 'bin/coolforkit-caps',
                'bin/coolwsd-systemplate-setup', 'etc/coolwsd/coolwsd.xml',
                'engine/program/libmergedlo.so', 'engine/program/libiconv.so',
                'share/coolwsd/browser/dist/cool.html',
                'share/coolwsd/collabora-online-sbom.spdx.json']
    for name in required:
        if not (runtime / name).is_file():
            raise ValueError('Missing native Termux runtime output: ' + name)
    if not list((runtime / 'engine/sbom').glob('*.json')):
        raise ValueError('Native engine SBOM generation produced no installed output')
    legal = runtime / 'legal'
    legal.mkdir()
    for name in ['COPYING', 'LICENSE', 'THIRDPARTYLICENSES', 'NOTICE']:
        if (source / name).is_file():
            shutil.copy2(source / name, legal / name)
    shutil.copy2(source / 'engine/readlicense_oo/license/license.xml', legal / 'engine-license.xml')
    runtime_metadata.notices(source, runtime)
    branding.verify_runtime(runtime)
    notices_path = runtime / 'licenses.json'
    notices = json.loads(notices_path.read_text())
    notices.append({'name': 'Android NDK libc++ shared runtime',
                    'license': toolchain['pin']['license'],
                    'source': toolchain['pin']['url'],
                    'text': (args.ndk / 'NOTICE').read_text() + '\n' + (args.ndk / 'NOTICE.toolchain').read_text()})
    llvm_source = ROOT / 'agent/vendor/node/libcxx'
    llvm_pin = json.loads((llvm_source / 'source.json').read_text())
    notices.append({'name': 'Android NDK compiler-rt builtins',
                    'license': 'Apache-2.0 WITH LLVM-exception',
                    'source': llvm_pin['archive'], 'revision': llvm_pin['commit'],
                    'text': (llvm_source / 'source/compiler-rt/LICENSE.TXT').read_text()})
    notices.append({'name': 'Termux POSIX semaphore compatibility library', 'license': 'MIT',
                    'source': json.loads((PATCH_ROOT / 'donor.json').read_text())['donor']['url'],
                    'text': (source / 'engine/external/python3/termux/LICENSE').read_text()})
    notices.append({'name': 'Termux native build configuration and Python compatibility patches', 'license': 'MIT',
                    'source': json.loads((PATCH_ROOT / 'donor.json').read_text())['donor']['url'],
                    'text': (source / 'engine/external/python3/termux/FRAMEWORK-LICENSE').read_text()})
    for component in native_dependencies()['components']:
        notices.extend(native_dependency_notices(component))
        for record in native_dependency_licenses(component):
            shutil.copy2(NATIVE_DEPENDENCIES / record['file'], legal / record['file'])
    write_json(notices_path, notices)
    # Resolve the actual ELF dependency closure against bundled libraries and
    # Android's public platform libraries, never the build host's ldconfig.
    needed, provided = set(), set()
    readelf = args.ndk / 'toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf'
    for binary in runtime.rglob('*'):
        if binary.is_symlink() or not binary.is_file():
            continue
        with binary.open('rb') as stream:
            header = stream.read(20)
            if header[:4] != b'\x7fELF':
                continue
        expected_machine = {'aarch64': 183, 'x86_64': 62}[args.architecture]
        if header[4] != 2 or header[5] != 1 or int.from_bytes(header[18:20], 'little') != expected_machine:
            raise ValueError('Wrong native target ELF in runtime: ' + str(binary.relative_to(runtime)))
        dynamic = subprocess.check_output([readelf, '-d', binary], text=True)
        symbols = subprocess.check_output([readelf, '--wide', '--dyn-syms', binary], text=True)
        builtins = sorted(set(re.findall(r'\bUND\s+(__aarch64_[A-Za-z0-9_]+)', symbols)))
        if builtins:
            raise ValueError('Unlinked native compiler builtins in ' + str(binary.relative_to(runtime))
                             + ': ' + ', '.join(builtins))
        needed.update(re.findall(r'\(NEEDED\).*\[([^]]+)\]', dynamic))
        provided.add(binary.name)
        provided.update(re.findall(r'\(SONAME\).*\[([^]]+)\]', dynamic))
    platform_libs = args.ndk / 'toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib' / triple / '28'
    public = {value.name for value in platform_libs.glob('*.so')}
    missing = needed - provided - public
    if missing:
        raise ValueError('Unbundled native Bionic libraries: ' + ', '.join(sorted(missing)))
    pin = json.loads((source_graph.UPSTREAM / 'online/source.json').read_text())
    manifest = {'schema': 1, 'apiVersion': 1, 'revision': pin['commit'],
                'component': 'collabora-online', 'target': 'termux', 'architecture': args.architecture,
                'compiledPrefix': RUNTIME, 'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                'development': toolchain['development'] or bool(subprocess.check_output(['git', 'status', '--porcelain', '--',
                    *native_toolchain.SOURCE_INPUTS, 'agent/packaging/source_cache.py',
                    'agent/packaging/office', 'office/upstream', 'office/patches', 'office/branding',
                    'files/patches/collabora'], cwd=ROOT, text=True).strip()),
                'upstream': pin, 'toolchain': toolchain,
                'toolchainRecipeSha256': toolchain['recipeSha256'],
                'paths': {'coolwsd': 'bin/coolwsd', 'forkitNamespace': 'bin/coolforkit-ns',
                          'forkitCapabilities': 'bin/coolforkit-caps', 'engine': 'engine',
                          'systemplateSetup': 'bin/coolwsd-systemplate-setup',
                          'web': 'share/coolwsd', 'config': 'etc/coolwsd/coolwsd.xml'},
                'requiredEnvironment': {'COOL_FORCE_LANDLOCK': '1', 'PREFIX': PREFIX},
                'libraryPath': 'engine/program',
                'platformLibraries': sorted(needed - provided),
                'systemPackages': SYSTEM_PACKAGES,
                'depends': SYSTEM_PACKAGES,
                'recipeSha256': source_graph.digest(Path(__file__)),
                'engineOptions': [*ENGINE_OPTIONS, *branding.engine_options()],
                'branding': branding.metadata(),
                'isolation': {'landlockMinimumABI': 3, 'seccomp': True, 'failClosed': True},
                'patches': [path.stem.split('-', 1)[1] for path in patch_inputs()],
                'patchInputs': [{'file': str(path.relative_to(ROOT)), 'sha256': source_graph.digest(path)} for path in patch_inputs()],
                'dependencyManifestSha256': source_graph.digest(source_graph.DEPENDENCIES / 'sources.json'),
                'nativeSourceInputs': native_inputs(),
                'nativeDependencies': native_dependencies(),
                'files': inventory(runtime)}
    write_json(runtime / 'manifest.json', manifest)
    args.output.mkdir(parents=True, exist_ok=True)
    archive = args.output / ('office-termux-' + args.architecture + '.tar.xz')
    with tarfile.open(archive, 'w:xz') as bundle:
        bundle.add(runtime, arcname='runtime')
    receipt = args.output / (archive.name + '.json')
    write_json(receipt, {key: value for key, value in manifest.items() if key != 'files'})
    (args.output / 'SHA256SUMS').write_text(''.join(source_graph.digest(path) + '  ' + path.name + '\n'
                                                  for path in [archive, receipt]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--architecture', choices=['aarch64', 'x86_64'], required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--ndk', type=Path, required=True)
    parser.add_argument('--ndk-archive', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--stage-dir', type=Path, help='External package stage; defaults to WORK/stage')
    parser.add_argument('--jobs', type=int, default=2)
    parser.add_argument('--phase', choices=['prepare', 'configure', 'engine', 'online', 'package', 'all'], default='all')
    args = parser.parse_args()
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        parser.error('Use the existing Linux x86_64 NDK build environment')
    for key in ['work', 'cache', 'ndk', 'output', 'stage_dir']:
        value = getattr(args, key)
        if value is not None:
            value = value.resolve(); setattr(args, key, value)
            if value.is_relative_to(ROOT):
                parser.error(key + ' must be outside the source checkout')
    if args.jobs < 1 or (args.phase in ['package', 'all'] and args.output is None):
        parser.error('Positive --jobs and --output for packaging are required')
    args.work.mkdir(parents=True, exist_ok=True)
    source = prepare(args.work, args.cache, args.architecture)
    env, provenance = build_environment(args)
    if args.phase in ['configure', 'engine', 'all']:
        configure_engine(source, args, env)
    if args.phase in ['engine', 'all']:
        run(['make', '-j' + str(args.jobs), 'build'], cwd=source / 'engine', env=env)
    if args.phase in ['online', 'all']:
        build_online(source, args, env)
    if args.phase in ['package', 'all']:
        package(source, args, env, provenance)


if __name__ == '__main__':
    main()
