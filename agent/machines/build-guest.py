#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Build the native Debian guest service package from its pinned offline source."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess

ROOT=Path(__file__).resolve().parent

def run(args,**kwargs):
    subprocess.run([str(a) for a in args],check=True,**kwargs)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--work',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--architecture',choices=['amd64','arm64'],required=True)
    parser.add_argument('--version',required=True)
    parser.add_argument('--revision',required=True)
    args=parser.parse_args()
    actual={'x86_64':'amd64','aarch64':'arm64'}.get(platform.machine())
    if actual!=args.architecture:
        parser.error('Build the guest package on the matching native Linux architecture')
    repo=ROOT.parents[1]
    if args.work.resolve().is_relative_to(repo) or args.output.resolve().is_relative_to(repo):
        parser.error('Build/output directories must be outside the source repository')
    source=args.work/'source';stage=args.work/'package'
    if source.exists():shutil.rmtree(source)
    if stage.exists():shutil.rmtree(stage)
    shutil.copytree(ROOT/'guest/sudo-bridge',source)
    env={**os.environ,'CARGO_TARGET_DIR':str(args.work/'target')}
    run(['cargo','build','--locked','--offline','--release'],cwd=source,env=env)
    bindir=stage/'usr/lib/bashkitten/machines/bin';bindir.mkdir(parents=True)
    binary=args.work/'target/release/bashkitten-sudo'
    for name in ['bashkitten-sudo','bashkitten-sudo-exec','sudo-policy']:
        shutil.copy2(binary,bindir/name)
    # Reuse the engine source verifier; only the unmodified native helper is
    # needed in the guest, not another libfuse or a privileged mount service.
    spec=importlib.util.spec_from_file_location('machine_build',repo/'agent/packaging/machines/build.py')
    machine_build=importlib.util.module_from_spec(spec);spec.loader.exec_module(machine_build)
    fuse_vendor=ROOT/'vendor/libfuse'
    fuse_record=machine_build.verify_source(fuse_vendor)
    fuse_source=args.work/'libfuse'
    if fuse_source.exists():shutil.rmtree(fuse_source)
    shutil.copytree(fuse_vendor/'source',fuse_source,symlinks=True)
    run(['meson','setup','build','--prefix=/usr','--sysconfdir=/etc','--buildtype=release',
         '-Dexamples=false','-Dtests=false','-Duseroot=false','-Dinitscriptdir=',
         '-Denable-io-uring=false'],cwd=fuse_source)
    run(['meson','compile','-C','build','-j','2','fusermount3'],cwd=fuse_source)
    shutil.copy2(fuse_source/'build/util/fusermount3',bindir/'fusermount3')
    (bindir/'fusermount3').chmod(0o4755)
    commands=stage/'usr/bin';commands.mkdir(parents=True)
    (commands/'fusermount3').symlink_to('/usr/lib/bashkitten/machines/bin/fusermount3')
    units=stage/'usr/lib/systemd/system';units.mkdir(parents=True)
    for file in (ROOT/'guest/assets').iterdir():
        destination=(units if file.suffix in ['.service','.socket'] else bindir)/file.name
        shutil.copy2(file,destination)
        destination.chmod(0o644 if file.suffix in ['.service','.socket','.mjs'] else 0o755)
    aliases=stage/'usr/local/bin';aliases.mkdir(parents=True)
    for name in ['sudo','sudoedit']:(aliases/name).symlink_to('/usr/lib/bashkitten/machines/bin/bashkitten-sudo')
    # Debian slim drops most /usr/share/doc files during installation.
    docs=stage/'usr/share/bashkitten-machines-guest';docs.mkdir(parents=True)
    shutil.copy2(ROOT/'upstream/buzzard-runtime/LICENSE',docs/'COPYING')
    shutil.copy2(ROOT/'NOTICE',docs/'copyright')
    machine_build.rust_toolchain_notices(docs/'rust-toolchain')
    libc=ROOT/'guest/sudo-bridge/vendor/libc'
    for license in libc.glob('LICENSE*'):shutil.copy2(license,docs/('libc-'+license.name))
    for license in fuse_record['license_paths']:
        shutil.copy2(fuse_vendor/license,docs/('libfuse-'+Path(license).name))
    (docs/'source.json').write_text(json.dumps({'revision':args.revision,'source':'https://github.com/openresearchtools/BashKitten','donor':json.loads((ROOT/'upstream/buzzard-runtime/provenance.json').read_text()),'libc':{'version':'0.2.191','checksum':'65cd87c9a6d60536580b316ad985726104730a5151c99845f2490428ef91240a'},'fusermount3':fuse_record},indent=2)+'\n')
    copyright_dir=stage/'usr/share/doc/bashkitten-machines-guest';copyright_dir.mkdir(parents=True)
    (copyright_dir/'copyright').symlink_to('../../bashkitten-machines-guest/copyright')
    debian=stage/'DEBIAN';debian.mkdir()
    for script in (ROOT/'guest/debian').iterdir():
        shutil.copy2(script,debian/script.name)
        (debian/script.name).chmod(0o755)
    (debian/'control').write_text(f'''Package: bashkitten-machines-guest
Version: {args.version}
Architecture: {args.architecture}
Maintainer: openresearchtools <openresearchtools@gmail.com>
Depends: libc6, python3, systemd, util-linux, sudo, dbus-user-session, xwayland, xauth, x11-utils, xfce4-session, pipewire, pipewire-pulse, wireplumber, gstreamer1.0-tools, gstreamer1.0-pipewire, gstreamer1.0-pulseaudio, gstreamer1.0-plugins-base, gstreamer1.0-plugins-good, gstreamer1.0-plugins-bad, fuse3
Description: BashKitten private container guest session and native sudo handoff
 Rootless Podman guest services, independent desktop and private Agent endpoint.
''')
    args.output.mkdir(parents=True,exist_ok=True)
    target=args.output/f'bashkitten-machines-guest_{args.version}_{args.architecture}.deb'
    run(['dpkg-deb','--root-owner-group','--build',stage,target])
    (target.with_suffix('.deb.json')).write_text(json.dumps({'file':target.name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'revision':args.revision,'architecture':args.architecture},indent=2)+'\n')
    print(target)

if __name__=='__main__':main()
