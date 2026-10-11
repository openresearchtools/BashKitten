#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Stage the pinned donor, apply recorded patches, build offline native Display."""
import argparse
import hashlib
import json
import os
import platform
import tarfile
from pathlib import Path
import shutil
import subprocess
import tomllib

ROOT = Path(__file__).resolve().parent

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--work-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--target', default='')
    parser.add_argument('--debug', action='store_true')
    args = parser.parse_args()
    architecture = {'x86_64':'amd64','aarch64':'arm64'}.get(platform.machine())
    if not architecture or platform.system() != 'Linux':
        parser.error('Display supports native Linux amd64/arm64 builds')
    expected = {'amd64':'x86_64-unknown-linux-gnu','arm64':'aarch64-unknown-linux-gnu'}[architecture]
    if args.target and args.target != expected:
        parser.error('Display builds use the matching native Linux architecture runner')
    source_commit = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    work = args.work_dir.resolve()
    repository = ROOT.parents[2]
    if work == repository or repository in work.parents:
        parser.error('Build staging must be outside product source')
    work.mkdir(parents=True, exist_ok=True)
    source = work / 'source'
    if source.exists():
        shutil.rmtree(source)
    shutil.copytree(ROOT / 'linux', source)
    donor = ROOT / 'vendor/buzzardos'
    record = json.loads((donor / 'UPSTREAM.json').read_text())
    for name, digest in record['files'].items():
        if hashlib.sha256((donor / name).read_bytes()).hexdigest() != digest:
            raise RuntimeError(f'Pristine Display source differs: {name}')
    for name in ('guest_display.rs', 'keyboard.rs', 'drm_syncobj.rs'):
        shutil.copy2(donor / 'host/crates/buzzardos-display/src' / name, source / 'src' / name)
    shutil.copytree(donor/'tests', source/'tests', dirs_exist_ok=True)
    for patch in sorted((ROOT / 'patches').glob('*.patch')):
        subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-i', str(patch)], cwd=source, check=True)
    (source / '.cargo').mkdir(exist_ok=True)
    (source / '.cargo/config.toml').write_text('[source.crates-io]\nreplace-with = "vendored-sources"\n[source.vendored-sources]\ndirectory = '+json.dumps(str(ROOT / 'vendor/rust'))+'\n')
    command = ['cargo', 'build', '--locked', '--offline', '--manifest-path', str(source / 'Cargo.toml')]
    if not args.debug:
        command.append('--release')
    if args.target:
        command += ['--target', args.target]
    env = dict(os.environ, CARGO_TARGET_DIR=str(work / 'target'))
    subprocess.run(command, cwd=source, env=env, check=True)
    binary = work / 'target'
    if args.target:
        binary /= args.target
    binary = binary / ('debug' if args.debug else 'release') / 'bashkitten-display'
    args.output.mkdir(parents=True, exist_ok=True)
    payload = args.output / 'display'
    if payload.exists():
        shutil.rmtree(payload)
    payload.mkdir()
    shutil.copy2(binary, payload / 'bashkitten-display')
    notice = payload / 'notices'
    notice.mkdir(exist_ok=True)
    (notice/'buzzardos').mkdir()
    for name in ('LICENSE','NOTICE','THIRD_PARTY_NOTICES.md'):
        if (donor/name).exists():
            shutil.copy2(donor/name,notice/'buzzardos'/name)
    shutil.copy2(ROOT.parents[2]/'LICENSE',notice/'BashKitten-LICENSE')
    license_inventory = [{'name':'BuzzardOS Display','license':'AGPL-3.0-or-later','texts':[str(p.relative_to(payload)) for p in (notice/'buzzardos').iterdir()]},
                         {'name':'BashKitten Display','license':'AGPL-3.0-only','texts':['notices/BashKitten-LICENSE']}]
    dependencies = []
    for package in tomllib.loads((source / 'Cargo.lock').read_text())['package']:
        if 'source' not in package:
            continue
        crate = ROOT / 'vendor/rust' / package['name']
        if not crate.exists() or tomllib.loads((crate/'Cargo.toml').read_text())['package']['version'] != package['version']:
            crate = ROOT / 'vendor/rust' / (package['name']+'-'+package['version'])
        manifest = tomllib.loads((crate / 'Cargo.toml').read_text())['package']
        licenses = [p for p in crate.rglob('*') if p.is_file() and
                    (p.name.upper().startswith(('LICENSE', 'LICENCE', 'COPYING', 'NOTICE')))]
        if not licenses:
            raise RuntimeError(f'Missing full license text: {package["name"]}')
        target = notice / 'rust' / f'{package["name"]}-{package["version"]}'
        for text in licenses:
            dest = target / text.relative_to(crate)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(text, dest)
        license_inventory.append({'name':package['name'],'version':package['version'],'license':manifest.get('license'),'texts':[str((target/text.relative_to(crate)).relative_to(payload)) for text in licenses]})
        vcs=json.loads((crate/'.cargo_vcs_info.json').read_text())
        dependencies.append({k:package[k] for k in ('name','version','checksum')} | {'license':manifest.get('license'),
            'repository':manifest.get('repository'),'releaseCommit':vcs['git']['sha1'],'pathInRepository':vcs.get('path_in_vcs','')})
    (payload / 'provenance.json').write_text(json.dumps({'schema':1,'component':'bashkitten-display','donor':record,
        'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest(),
        'cargoLockSha256':hashlib.sha256((source/'Cargo.lock').read_bytes()).hexdigest(),
        'patches':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT/'patches').glob('*.patch'))},
        'dependencies':dependencies},indent=2)+'\n')

    (payload/'licenses.json').write_text(json.dumps({'schema':1,'components':license_inventory},indent=2)+'\n')
    (payload/'manifest.json').write_text(json.dumps({'schema':1,'component':'bashkitten-display','sourceCommit':source_commit,
        'architecture':architecture,'depends':['libxkbcommon0','libdrm2','libgbm1','libegl1','libgles2','xkb-data'],
        'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest()},indent=2)+'\n')
    archive=args.output/f'display-runtime-linux-{architecture}.tar.gz'
    with tarfile.open(archive,'w:gz') as tar:
        tar.add(payload,arcname='display')
    (args.output/'SHA256SUMS').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n')

if __name__ == '__main__':
    main()
