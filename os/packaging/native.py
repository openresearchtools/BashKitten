#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Build an original OS source unit with its existing native configure commands."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def run(argv, **kwargs):
    subprocess.run(list(map(str, argv)), check=True, **kwargs)


def meson():
    return shlex.split(os.environ.get('TASKARIAN_MESON', 'meson'))


def write(path, text, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    path.chmod(mode)


def cache_key(args,prefix):
    key=hashlib.sha256((ROOT/'upstream/sources.json').read_bytes())
    for patch in sorted((ROOT/'patches').rglob('*.patch')):
        key.update(str(patch.relative_to(ROOT)).encode());key.update(patch.read_bytes())
    key.update((prefix+args.architecture+str(args.cross_file)).encode())
    for name in ('CC','CFLAGS','CPPFLAGS','LDFLAGS','PKG_CONFIG','PKG_CONFIG_PATH'):
        key.update((name+'='+os.environ.get(name,'')).encode())
    key.update(subprocess.check_output(shlex.split(os.environ.get('CC','cc'))+['--version']))
    if args.cross_file:key.update(args.cross_file.read_bytes())
    return key

def invalidate(work,identity):
    stamp=work/'source-key'
    if not stamp.exists() or stamp.read_text()!=identity:
        shutil.rmtree(work,ignore_errors=True);work.mkdir(parents=True)
        stamp.write_text(identity)

def verify_sources():
    records=json.loads((ROOT/'upstream/sources.json').read_text())
    for record in records:
        for relative,expected in record['files'].items():
            source=ROOT/'upstream'/record['name']/relative
            if not source.is_file() or digest(source)!=expected:raise RuntimeError('Pristine source checksum mismatch: '+str(source))
    for text in ('GPL-2.0.txt','GPL-3.0.txt','LGPL-2.1.txt','LGPL-3.0.txt','AGPL-3.0.txt','PeGPU-MIT.txt'):
        if not (ROOT/'licenses'/text).is_file():raise RuntimeError('Missing full license: '+text)
    return records

def build_dbusmenu(args,prefix,stage):
    if args.target!='termux':return
    work=args.build_dir/'dbusmenu';source=work/'source';build=work/'build'
    invalidate(work,cache_key(args,prefix).hexdigest())
    if not source.exists():
        shutil.copytree(ROOT/'upstream/libdbusmenu',source)
        for patch in sorted((ROOT/'patches/libdbusmenu').glob('*.patch')):
            run(['patch','-p1','--input',patch.resolve()],cwd=source)
    build.mkdir(parents=True,exist_ok=True)
    private=prefix+'/lib/taskarian-os/panel'
    env=os.environ.copy()
    env['LDFLAGS']=env.get('LDFLAGS','')+' -Wl,-rpath,'+private+'/lib -Wl,-z,max-page-size=16384 -lm'
    if not (build/'Makefile').exists():
        argv=[source/'configure','--prefix='+private,'--disable-static','--disable-introspection',
              '--disable-vala','--disable-tests','--disable-dumper','--disable-gtk-doc',
              '--enable-gtk','--with-gtk=3']
        if args.autotools_host:argv+=['--host='+args.autotools_host]
        run(argv,cwd=build,env=env)
    run(['make','-r','-j',args.jobs],cwd=build,env=env)
    run(['make','-r','install','DESTDIR='+str(stage)],cwd=build,env=env)
    # Compile-time pkgconfig paths point into staging, runtime rpath stays final.
    pkg=work/'pkgconfig';pkg.mkdir(exist_ok=True)
    for source in (stage/private.lstrip('/')/'lib/pkgconfig').glob('*.pc'):
        write(pkg/source.name,source.read_text().replace('prefix='+private,'prefix='+str(stage/private.lstrip('/'))))
    os.environ['PKG_CONFIG_PATH']=str(pkg)+(':'+os.environ['PKG_CONFIG_PATH'] if os.environ.get('PKG_CONFIG_PATH') else '')

def build_windowing(args,prefix,stage):
    work=args.build_dir/'windowing';work.mkdir(parents=True,exist_ok=True)
    invalidate(work,cache_key(args,prefix).hexdigest())
    build=work/'build';source=ROOT/'upstream/libxfce4windowing'
    private=prefix+'/lib/taskarian-os/panel'
    if not (build/'build.ninja').exists():
        argv=meson()+['setup',build,source,'--prefix='+private,'--libdir=lib','--buildtype=release',
              '-Dx11=enabled','-Dwayland=disabled','-Dintrospection=false','-Dvala=disabled','-Dtests=false',
              '-Dc_link_args='+repr(shlex.split(os.environ.get('LDFLAGS',''))+['-Wl,-rpath,'+private+'/lib']+
                                   (['-Wl,-z,max-page-size=16384'] if args.target=='termux' else []))]
        if args.cross_file:argv+=['--cross-file',args.cross_file]
        run(argv)
    run(meson()+['compile','-C',build,'-j',args.jobs])
    run(meson()+['install','-C',build,'--destdir',stage,'--no-rebuild'])
    pkg=work/'pkgconfig';pkg.mkdir(exist_ok=True)
    for source in (stage/private.lstrip('/')/'lib/pkgconfig').glob('*.pc'):
        write(pkg/source.name,source.read_text().replace('prefix='+private,'prefix='+str(stage/private.lstrip('/'))))
    os.environ['PKG_CONFIG_PATH']=str(pkg)+(':'+os.environ['PKG_CONFIG_PATH'] if os.environ.get('PKG_CONFIG_PATH') else '')

def build_panel(args,prefix,stage):
    work=args.build_dir/'panel';work.mkdir(parents=True,exist_ok=True)
    source=work/'source';build=work/'build'
    key=cache_key(args,prefix)
    for patch in sorted((ROOT/'patches').glob('*.patch')):key.update(patch.read_bytes())
    identity=key.hexdigest();stamp=work/'source-key'
    if not stamp.exists() or stamp.read_text()!=identity:
        shutil.rmtree(source,ignore_errors=True);shutil.rmtree(build,ignore_errors=True)
        shutil.copytree(ROOT/'upstream/xfce4-panel',source)
        for patch in sorted((ROOT/'patches').glob('*.patch')):run(['patch','-p1','--input',patch.resolve()],cwd=source)
        stamp.write_text(identity)
    panel_prefix=prefix+'/lib/taskarian-os/panel'
    # Meson already includes this build-source root before dependency -I paths.
    # Stage the matching private headers here: distro libxfce4ui exposes a broad
    # /include/xfce4 path that would otherwise shadow our newer pinned windowing.
    headers=stage/panel_prefix.lstrip('/')/'include/xfce4/libxfce4windowing-0'
    for name in ('libxfce4windowing','libxfce4windowingui'):
        shutil.copytree(headers/name,source/name,dirs_exist_ok=True)
    if not (build/'build.ninja').exists():
        argv=meson()+['setup',build,source,'--prefix='+panel_prefix,'--libdir=lib','--buildtype=release',
              '-Dx11=enabled','-Dwayland=disabled','-Dgtk-layer-shell=disabled','-Dintrospection=false','-Dvala=disabled',
              '-Ddbusmenu=enabled']
        link_args=shlex.split(os.environ.get('LDFLAGS',''))+['-Wl,-rpath,'+panel_prefix+'/lib']
        if args.target=='termux':link_args+=['-Wl,-z,max-page-size=16384','-lm']
        argv+=['-Dc_link_args='+repr(link_args)]
        if args.cross_file:argv+=['--cross-file',args.cross_file]
        run(argv)
    run(meson()+['compile','-C',build,'-j',args.jobs])
    run(meson()+['install','-C',build,'--destdir',stage,'--no-rebuild'])
    return identity

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--unit', choices=['dbusmenu', 'windowing', 'panel'], required=True)
    parser.add_argument('--target', choices=['linux', 'termux'], required=True)
    parser.add_argument('--architecture', required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--build-dir', type=Path, required=True)
    parser.add_argument('--cross-file', type=Path)
    parser.add_argument('--autotools-host')
    parser.add_argument('--source-commit')
    parser.add_argument('--jobs', type=int, default=2)
    parser.add_argument('--stage-only', action='store_true')
    parser.add_argument('--prebuilt-native', type=Path)
    args = parser.parse_args()
    verify_sources()
    args.build_dir = args.build_dir.resolve(); args.build_dir.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    stage = args.build_dir / 'stage'
    shutil.rmtree(stage, ignore_errors=True); stage.mkdir()
    if args.prebuilt_native:
        shutil.copytree(args.prebuilt_native, stage, dirs_exist_ok=True, symlinks=True)
    prefix = '/data/data/com.termux/files/usr' if args.target == 'termux' else '/usr'
    private = prefix + '/lib/taskarian-os/panel'
    # Native installed headers/pkgconfig from prerequisite source units are the
    # build support. No upstream configure or compiler implementation is replaced.
    pkg = args.build_dir / 'pkgconfig'; pkg.mkdir(exist_ok=True)
    for source in (stage / private.lstrip('/') / 'lib/pkgconfig').glob('*.pc'):
        (pkg / source.name).write_text(source.read_text().replace('prefix=' + private, 'prefix=' + str(stage / private.lstrip('/'))))
    os.environ['PKG_CONFIG_PATH'] = str(pkg) + (':' + os.environ['PKG_CONFIG_PATH'] if os.environ.get('PKG_CONFIG_PATH') else '')
    globals()['build_' + args.unit](args, prefix, stage)
    print(stage)


if __name__ == '__main__':
    main()
