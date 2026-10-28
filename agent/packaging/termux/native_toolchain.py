# SPDX-License-Identifier: AGPL-3.0-only
"""Shared native Bionic build environment using the existing Termux/NDK pin.

Callers supply ndk, optional ndk_archive, architecture and external work paths.
This validates the retained NDK runtime sources and separates target lookup
paths from the Linux build host. Component revisions stay with each caller.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[3]
SOURCE_INPUTS = ['agent/packaging/termux/native_toolchain.py',
                 'agent/packaging/node/lock.json', 'agent/vendor/node/libcxx']


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def build_environment(args):
    if args.architecture not in ['aarch64', 'x86_64']:
        raise ValueError('Expected a supported native 64-bit Termux architecture')
    ndk = args.ndk.resolve()
    properties = (ndk / 'source.properties').read_text()
    if 'Pkg.Revision = 30.0.16248370' not in properties:
        raise ValueError('Expected the pinned Android NDK r30 (30.0.16248370)')
    lock = json.loads((ROOT / 'agent/packaging/node/lock.json').read_text())['termux']
    if args.ndk_archive and digest(args.ndk_archive) != lock['dependency_sources']['libc++']['sha256']:
        raise ValueError('NDK archive differs from the existing Termux toolchain pin')
    retained = ROOT / 'agent/vendor/node/libcxx'
    retained_manifest = json.loads((retained / 'retained.json').read_text())
    if digest(retained / 'SHA256SUMS') != retained_manifest['inventorySha256']:
        raise ValueError('Existing NDK runtime source inventory changed')
    for line in (retained / 'SHA256SUMS').read_text().splitlines():
        expected, name = line.split('  ', 1)
        if digest(retained / name) != expected:
            raise ValueError('Existing NDK runtime source changed: ' + name)
    binary = ndk / 'toolchains/llvm/prebuilt/linux-x86_64/bin'
    target = args.architecture + '-linux-android28'
    tools = {'CC': binary / (target + '-clang'), 'CXX': binary / (target + '-clang++')}
    tools.update({name: binary / ('llvm-' + name.lower())
                  for name in ['AR', 'NM', 'RANLIB', 'STRIP', 'OBJDUMP', 'READELF']})
    tools['LD'] = binary / 'ld.lld'
    for path in tools.values():
        if not path.is_file():
            raise ValueError('Missing pinned NDK tool: ' + str(path))
    pc = args.work / 'pkgconfig'
    pc.mkdir(parents=True, exist_ok=True)
    temporary = args.work / 'tmp'
    temporary.mkdir(exist_ok=True)
    # Same native Bionic link aliases as the pinned Termux framework's
    # scripts/build/termux_step_start_build.sh. These APIs live in libc;
    # no replacement implementation or runtime library is introduced.
    aliases = args.work / 'bionic-link-aliases'
    aliases.mkdir(exist_ok=True)
    for name in ['libutil.so', 'libpthread.so', 'librt.so']:
        (aliases / name).write_text('INPUT(-lc)\n')
    # Android supplies zlib as a public NDK platform library. No host pkg-config
    # directory may leak into target configuration.
    zlib_header = (binary.parent / 'sysroot/usr/include/zlib.h').read_text()
    zlib_version = re.search(r'^#define ZLIB_VERSION "([^"]+)"', zlib_header, re.M).group(1)
    (pc / 'zlib.pc').write_text('Name: zlib\nDescription: Android platform zlib\nVersion: ' + zlib_version + '\nLibs: -lz\nCflags:\n')
    env = {**os.environ, **{key: str(value) for key, value in tools.items()},
           'CFLAGS': '-O2 -fPIC -D__TERMUX__', 'CXXFLAGS': '-O2 -fPIC -D__TERMUX__',
           'CPPFLAGS': '-D__TERMUX__', 'LDFLAGS': '-L' + str(aliases) + ' -Wl,--undefined-version -Wl,-z,global',
           'PKG_CONFIG_LIBDIR': str(pc), 'PKG_CONFIG_PATH': '',
           'TMPDIR': str(temporary),
           'ZLIB_CFLAGS': ' ', 'ZLIB_LIBS': '-lz',
           'GOTELEMETRY': 'off', 'DO_NOT_TRACK': '1',
           'npm_config_offline': 'true', 'PIP_NO_INDEX': '1', 'CARGO_NET_OFFLINE': 'true'}
    ccache = shutil.which('ccache')
    if ccache:
        for name in ['CC', 'CXX']:
            env[name] = shlex.join([ccache, str(tools[name])])
    provenance = {'pin': lock['dependency_sources']['libc++'],
                  'recipeSha256': digest(Path(__file__)),
                  'development': bool(subprocess.check_output(['git', 'status', '--porcelain', '--',
                      *SOURCE_INPUTS], cwd=ROOT, text=True).strip()),
                  'archiveVerified': bool(args.ndk_archive),
                  'compilerCache': ccache,
                  'correspondingSourceInventorySha256': retained_manifest['inventorySha256'],
                  'targetWrapperSha256': digest(tools['CXX']),
                  'compilerSha256': digest((binary / 'clang++').resolve()),
                  'version': subprocess.check_output([tools['CXX'], '--version'], text=True).splitlines()[0]}
    return env, provenance

