#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Build the native Debian guest service package from its pinned offline source."""
import argparse
import hashlib
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
    libc=ROOT/'guest/sudo-bridge/vendor/libc'
    for license in libc.glob('LICENSE*'):shutil.copy2(license,docs/('libc-'+license.name))
    (docs/'source.json').write_text(json.dumps({'revision':args.revision,'source':'https://github.com/openresearchtools/BashKitten','donor':json.loads((ROOT/'upstream/buzzard-runtime/provenance.json').read_text()),'libc':{'version':'0.2.189','checksum':'3eaf3ede3fee6db1a4c2ee091bf8a8b4dccdc6d17f656fb07896ee72867612f2'}},indent=2)+'\n')
    copyright_dir=stage/'usr/share/doc/bashkitten-machines-guest';copyright_dir.mkdir(parents=True)
    (copyright_dir/'copyright').symlink_to('../../bashkitten-machines-guest/copyright')
    debian=stage/'DEBIAN';debian.mkdir()
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
