#!/usr/bin/env python3
"""Retain notices for the libc, non-TLS, static-Lua valkey-server build.

Read the pinned CMake source lists without configuring or compiling Valkey.
Retain complete license comments wherever they occur: Lua struct/cmsgpack put
their licenses at the end of the file, and fast_float uses // comments.
"""
from pathlib import Path
import json
import re
import shutil
import sys


source, output = (Path(arg).resolve() for arg in sys.argv[1:])
destination = output / 'share/licenses/valkey'
destination.mkdir(parents=True, exist_ok=True)


def cmake_sources(relative, variable, base):
    path = source / relative
    text = re.sub(r'#[^\n]*', '', path.read_text())
    match = re.search(r'\bset\(\s*' + re.escape(variable) + r'\s+(.*?)\)', text, re.S | re.I)
    if not match:
        raise SystemExit(f'Missing Valkey source list {variable}: {path}')
    values = match[1]
    for name, value in {
        'CMAKE_SOURCE_DIR': source,
        'CMAKE_CURRENT_LIST_DIR': path.parent,
        'LUA_SRC_DIR': source / 'deps/lua/src',
    }.items():
        values = values.replace('${' + name + '}', str(value))
    files = []
    for token in values.split():
        token = token.strip('"')
        if '${' in token or Path(token).suffix not in ('.c', '.h'):
            raise SystemExit(f'Unrecognized Valkey source-list entry: {token}')
        file = (source / base / token).resolve()
        if not file.is_file() or not file.is_relative_to(source):
            raise SystemExit(f'Missing Valkey source: {file}')
        files.append(file)
    return files


files = set()
for relative, variable, base in [
    ('cmake/Modules/SourceFiles.cmake', 'VALKEY_SERVER_SRCS', '.'),
    ('src/modules/lua/CMakeLists.txt', 'LUA_ENGINE_SRCS', 'src/modules/lua'),
    ('deps/lua/CMakeLists.txt', 'LUA_SRCS', 'deps/lua'),
    ('deps/libvalkey/CMakeLists.txt', 'valkey_sources', 'deps/libvalkey'),
    ('deps/fpconv/CMakeLists.txt', 'SRCS', 'deps/fpconv'),
    ('deps/hdr_histogram/CMakeLists.txt', 'SRCS', 'deps/hdr_histogram'),
]:
    files.update(cmake_sources(relative, variable, base))
files.add(source / 'deps/fast_float/ffc.h')

# Follow local includes too, retaining notices from header-only code and the
# event-loop implementations included by ae.c. Conditional platform headers
# are retained together; this is a source-notice inventory, not a linker map.
include_dirs = [source / name for name in (
    'src', 'deps/libvalkey/include', 'deps/libvalkey/include/valkey',
    'deps/libvalkey/src', 'deps/lua/src', 'deps/fpconv',
    'deps/hdr_histogram', 'deps/fast_float',
)]
pending = list(files)
while pending:
    path = pending.pop()
    for name in re.findall(r'^\s*#\s*include\s*[<"]([^">]+)[">]', path.read_text(), re.M):
        for directory in [path.parent, *include_dirs]:
            included = (directory / name).resolve()
            if included.is_file() and included.is_relative_to(source):
                relative = included.relative_to(source).as_posix()
                if relative.startswith(('src/unit/', 'deps/jemalloc/')):
                    break  # Excluded by the production libc build.
                if included not in files:
                    files.add(included)
                    pending.append(included)
                break

license_files = (
    'COPYING', 'deps/libvalkey/COPYING', 'deps/lua/COPYRIGHT',
    'deps/fpconv/LICENSE.txt', 'deps/hdr_histogram/COPYING.txt',
    'deps/hdr_histogram/LICENSE.txt',
)
for relative in license_files:
    path = source / relative
    if not path.is_file() or not path.read_bytes().strip():
        raise SystemExit(f'Missing Valkey license text: {path}')
    target = destination / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, target)
shutil.copy2(source / 'COPYING', destination / 'LICENSE')

# Skip string/character literals so strings containing comment delimiters do
# not hide a later license. Keep each selected comment byte-for-byte intact.
tokens = re.compile(rb'/\*.*?\*/|//[^\n]*(?:\n[ \t]*//[^\n]*)*|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', re.S)
license_marker = re.compile(rb'copyright|SPDX-License-Identifier|permission (?:is hereby|to use)|redistribution and use|public domain', re.I)
notices = {}
for path in sorted(files):
    comments = [match.group() for match in tokens.finditer(path.read_bytes())
                if match.group().startswith((b'/*', b'//')) and license_marker.search(match.group())]
    if not comments:
        continue
    relative = path.relative_to(source).as_posix()
    target = destination / 'source-notices' / (relative + '.txt')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b'\n\n'.join(comments) + b'\n')
    notices[relative] = target.relative_to(destination).as_posix()

# These embedded components do not have independent top-level license files.
# Fail an upstream update if their complete source notices have disappeared.
for relative in (
    'deps/fast_float/ffc.h', 'deps/lua/src/lua_bit.c',
    'deps/lua/src/lua_cjson.c', 'deps/lua/src/lua_cmsgpack.c',
    'deps/lua/src/lua_struct.c', 'deps/lua/src/fpconv.c',
    'deps/lua/src/strbuf.c', 'src/lzf.h', 'src/lzf_c.c', 'src/lzf_d.c',
    'src/siphash.c', 'src/crccombine.c', 'src/crcspeed.c', 'src/mt19937-64.c',
    'src/pqsort.c', 'src/setproctitle.c', 'src/strl.c', 'src/sha1.c', 'src/sha256.c',
):
    if relative not in notices:
        raise SystemExit(f'Missing Valkey embedded-component notice: {relative}')

metadata = output / 'share/metadata'
metadata.mkdir(parents=True, exist_ok=True)
(metadata / 'valkey-licenses.json').write_text(json.dumps({
    'build': 'valkey-server; BUILD_MALLOC=libc; BUILD_TLS=no; BUILD_LUA=static; BUILD_RDMA=no',
    'components': {
        'Valkey/libvalkey': 'BSD-3-Clause; individual source copyrights retained',
        'Lua and bundled CJSON/cmsgpack/struct/BitOp': 'MIT; individual source copyrights retained',
        'fpconv': 'BSL-1.0',
        'fast_float C port': 'MIT (also offered under Apache-2.0 or BSL-1.0)',
        'HdrHistogram': 'CC0-1.0 or BSD-2-Clause; both upstream texts retained',
        'liblzf': 'BSD-2-Clause (also offered under GPL-2.0-or-later)',
        'SipHash': 'CC0-1.0; full dedication in deps/hdr_histogram/COPYING.txt',
        'CRC speed/combine': 'Zlib',
        'other embedded code': 'Exact per-file copyright, license and public-domain notices retained',
    },
    'sourceNoticeScope': 'CMake server/library inputs and their local includes, including conditional platform headers',
    'sourceNotices': notices,
    'licenseFiles': sorted(path.relative_to(destination).as_posix() for path in destination.rglob('*') if path.is_file()),
    'excluded': ['jemalloc', 'linenoise', 'CLI', 'benchmark', 'test/example modules', 'TLS/RDMA libraries'],
    'externalLibraries': 'Platform libc, libm, pthread and dynamic-loader libraries, plus Termux libandroid-execinfo and libandroid-glob, are declared external system packages, not bundled copies.',
}, indent=2) + '\n')
