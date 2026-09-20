#!/usr/bin/env python3
"""Build a platform .deb from the shared source and locked upstream npm payload."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('target', choices=['linux', 'termux'])
args = parser.parse_args()
termux = args.target == 'termux'
arch = 'aarch64' if termux else {'aarch64': 'arm64', 'x86_64': 'amd64'}[platform.machine()]
prefix = '/data/data/com.termux/files/usr' if termux else '/usr'
package = json.loads((ROOT / 'package.json').read_text())
version = package['version']
lock_hash = hashlib.sha256((ROOT / 'package-lock.json').read_bytes()).hexdigest()
pi_version = package['dependencies']['@earendil-works/pi-coding-agent']
stage = ROOT / 'work' / ('package-' + args.target + '-' + arch)
if stage.exists():
    shutil.rmtree(stage)
stage.mkdir(parents=True)
app = stage / prefix.lstrip('/') / 'lib/bashkitten'
app.mkdir(parents=True)
for folder in ['src/server', 'src/web', 'reference']:
    if (ROOT / folder).exists():
        shutil.copytree(ROOT / folder, app / folder, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
for name in ['package.json', 'package-lock.json', 'LICENSE', 'PI_UPSTREAM.md']:
    if (ROOT / name).exists():
        shutil.copy2(ROOT / name, app / name)
command = ['npm', 'ci', '--prefix', str(app), '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']
if termux:
    assert int(subprocess.check_output(['npm', '--version'], text=True).split('.')[0]) >= 10, 'Use npm >=10 for explicit Android dependency selection'
    command += ['--os=android', '--cpu=arm64']
subprocess.run(command, check=True)
subprocess.run(['node', str(ROOT / 'src/server/updates/platform-packages.mjs'), str(app), 'android' if termux else 'linux', 'arm64' if arch in ('aarch64', 'arm64') else 'x64'], check=True)
# npm chooses the platform's upstream binaries; no lifecycle scripts compile host binaries.
installation = (prefix + '/var/lib' if termux else '/var/lib') + '/bashkitten/installed.json'
(app / 'build-platform.json').write_text(json.dumps({'platform': 'android' if termux else 'linux', 'architecture': arch, 'lockSha256': lock_hash, 'piVersion': pi_version, 'installationStamp': installation, 'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()}) + '\n')
runtime = (prefix + '/var/lib' if termux else '/var/lib') + '/bashkitten/runtimes/' + pi_version + '-' + lock_hash[:12]
(app / 'runtime-default.json').write_text(json.dumps({'root': runtime, 'version': pi_version}) + '\n')
bin_dir = stage / prefix.lstrip('/') / 'bin'
bin_dir.mkdir(parents=True, exist_ok=True)
node = prefix + '/bin/node'
shell = prefix + '/bin/sh' if termux else '/bin/sh'
for name, script, extra in [('bashkittenctl', 'control.mjs', ''), ('bashkitten-web', 'control.mjs', 'start'), ('bashkitten-pi', 'rpc/launcher.mjs', '')]:
    entry = bin_dir / name
    entry.write_text(f'#!{shell}\nexec {node} {prefix}/lib/bashkitten/src/server/{script} {extra} "$@"\n')
    entry.chmod(0o755)
entry = bin_dir / 'bashkitten-suite-manager'
entry.write_text(f'#!{shell}\nexport BASHKITTEN_ATTACHED_MANAGER=1\nwhile :; do\n  {node} {prefix}/lib/bashkitten/src/server/control.mjs serve\n  code=$?\n  [ "$code" -eq 75 ] || exit "$code"\n  sleep 1\ndone\n')
entry.chmod(0o755)
# Copy once before activation; dpkg can then remove its previous payload safely.
control = stage / 'DEBIAN'; control.mkdir()
control.joinpath('postinst').write_text(f'''#!{shell}
set -e
runtime='{runtime}'
if [ ! -f "$runtime/ready" ]; then
  mkdir -p "$runtime"
  cp -a '{prefix}/lib/bashkitten/node_modules' "$runtime/"
  cp '{prefix}/lib/bashkitten/package.json' "$runtime/"
  touch "$runtime/ready"
fi
printf '%s\\n' '{json.dumps({'owner': 'bashkitten', 'version': pi_version, 'lockSha256': lock_hash})}' > "$runtime/managed.json"
if ! command -v pi >/dev/null 2>&1 && [ ! -e '{prefix}/bin/pi' ] && [ ! -L '{prefix}/bin/pi' ]; then ln -s bashkitten-pi '{prefix}/bin/pi'; fi
# Publish readiness only after extraction and retained-runtime configuration finish.
cp '{prefix}/lib/bashkitten/build-platform.json' '{installation}.tmp'
chmod 644 '{installation}.tmp'
mv '{installation}.tmp' '{installation}'
''')
control.joinpath('postinst').chmod(0o755)
control.joinpath('postrm').write_text(f'''#!{shell}
if [ "$1" = remove ] || [ "$1" = purge ]; then
  if [ "$(readlink '{prefix}/bin/pi')" = bashkitten-pi ]; then rm '{prefix}/bin/pi'; fi
fi
# User data, native Pi credentials and retained runtimes are preserved.
''')
control.joinpath('postrm').chmod(0o755)
depends = 'nodejs-lts (>= 22.19), python, git, gh, ripgrep, fd, termux-api, ca-certificates, curl, unzip, zip, tar' if termux else 'nodejs (>= 22.19), npm, ripgrep, fd-find, ca-certificates'
if termux:
    profile = stage / prefix.lstrip('/') / 'etc/profile.d/bashkitten-privacy.sh'; profile.parent.mkdir(parents=True)
    profile.write_text('export PI_TELEMETRY=0 PI_OFFLINE=1 GH_TELEMETRY=0 DO_NOT_TRACK=1\nexport GH_NO_UPDATE_NOTIFIER=1 GH_NO_EXTENSION_UPDATE_NOTIFIER=1\n')
components = []
for metadata in sorted(app.glob('node_modules/**/package.json')):
    try:
        value = json.loads(metadata.read_text())
        if value.get('name') and value.get('version'):
            components.append({k: value.get(k) for k in ['name', 'version', 'license', 'repository']})
    except (ValueError, OSError):
        pass
(app / 'components.json').write_text(json.dumps(components, indent=2) + '\n')
doc = stage / prefix.lstrip('/') / 'share/doc/bashkitten'; doc.mkdir(parents=True)
for source in [ROOT / 'LICENSE', ROOT / 'PI_UPSTREAM.md', app / 'components.json']:
    if source.exists(): shutil.copy2(source, doc / source.name)

def deb(directory, name, description, dependencies):
    ctl = directory / 'DEBIAN'; ctl.mkdir(exist_ok=True)
    size = sum(p.stat().st_size for p in directory.rglob('*') if p.is_file()) // 1024
    ctl.joinpath('control').write_text(f'Package: {name}\nVersion: {version}\nArchitecture: {arch}\nMaintainer: Open Research Tools <openresearchtools@users.noreply.github.com>\nDepends: {dependencies}\nInstalled-Size: {size}\nSection: devel\nPriority: optional\nHomepage: https://bashkitten.com\nDescription: {description}\n')
    output = ROOT / 'dist' / f'{name}_{version}_{arch}.deb'; output.parent.mkdir(exist_ok=True)
    environment = {**os.environ, 'SOURCE_DATE_EPOCH': subprocess.check_output(['git', 'log', '-1', '--format=%ct'], cwd=ROOT, text=True).strip()}
    subprocess.run(['dpkg-deb', '--root-owner-group', '-Zzstd', '-z10', '--build', str(directory), str(output)], check=True, env=environment)
    print(output)

deb(stage, 'bashkitten', 'BashKitten browser UI and native Pi RPC server', depends)
if not termux:
    desktop = ROOT / 'work' / ('package-desktop-' + arch)
    if desktop.exists(): shutil.rmtree(desktop)
    host = desktop / 'usr/lib/bashkitten/src/linux'; host.mkdir(parents=True)
    shutil.copy2(ROOT / 'src/linux/host.py', host / 'host.py')
    launcher = desktop / 'usr/bin/bashkitten'; launcher.parent.mkdir(parents=True)
    launcher.write_text('#!/bin/sh\nexec /usr/bin/python3 /usr/lib/bashkitten/src/linux/host.py "$@"\n'); launcher.chmod(0o755)
    applications = desktop / 'usr/share/applications'; applications.mkdir(parents=True)
    shutil.copy2(ROOT / 'packaging/linux/com.bashkitten.desktop', applications)
    deb(desktop, 'bashkitten-desktop', 'BashKitten GTK and system WebKit desktop host', f'bashkitten (= {version}), python3 (>= 3.10), python3-gi, gir1.2-gtk-4.0 (>= 4.10), gir1.2-webkit-6.0 (>= 2.40)')
