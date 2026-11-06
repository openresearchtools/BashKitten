# SPDX-License-Identifier: AGPL-3.0-only
"""Build/install the native Online browser bundle without its C++ server."""
import shutil
import branding
from engine import run

def build_ui(source, args, env, payload):
    import build as owner
    platform = args.target.split('-', 1)[0]
    # Use ordinary server-mode configure and its browser subdirectory.
    # Host-only configure dependencies are never packaged into this UI.
    prefix = '/data/data/com.termux/files/usr/lib/taskarian/office/runtime' if platform == 'termux' else owner.PREFIX
    run(['./autogen.sh'], cwd=source, env=env)
    run(['./configure', '--prefix=' + prefix, '--sysconfdir=' + prefix + '/etc',
         '--localstatedir=' + prefix + '/var', '--disable-tests',
         *branding.online_options(), '--with-lo-builddir=' + str(source / 'engine'),
         '--with-lokit-path=' + str(source / 'engine/include'),
         '--with-lo-path=' + str(source / 'engine/instdir')], cwd=source, env=env)
    run(['make', '-C', 'browser', 'node_modules'], cwd=source, env=env)
    run(['make', '-C', 'browser', '-j' + str(args.jobs), 'build-cool', 'sbom-shipped-js.txt'], cwd=source, env=env)
    stage = args.work / 'ui-stage'; stage.mkdir(exist_ok=True)
    run(['make', '-C', 'browser', 'DESTDIR=' + str(stage), 'install'], cwd=source, env=env)
    shutil.copytree(stage / prefix.lstrip('/'), payload, dirs_exist_ok=True, symlinks=True)
