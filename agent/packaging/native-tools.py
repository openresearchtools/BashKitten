#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""The toolchain contract executed by the four architecture workers."""
import json
import hashlib
import os
from pathlib import Path
import subprocess

AUTH_GO = {'auth-authelia', 'auth-caddy', 'auth-chisel', 'auth-remote'}
MACHINE_GO = {'machines', 'machines-podman'}
MACHINE_RUST = {'machines', 'machines-netavark', 'machines-aardvark-dns', 'display', 'guest-sudo'}
APT = {
 'auth': 'build-essential cmake autoconf automake libtool pkg-config libevent-dev libssl-dev zlib1g-dev liblzma-dev libzstd-dev libseccomp-dev python3 python3-yaml binutils dpkg-dev',
 'machines': 'build-essential autoconf automake libtool pkg-config libcap-dev libseccomp-dev libsystemd-dev libjson-c-dev libglib2.0-dev meson ninja-build libprotobuf-dev protobuf-compiler libgpgme-dev libapparmor-dev libbpf-dev python3 dpkg-dev',
 'display': 'build-essential pkg-config libxkbcommon-dev libdrm-dev libgbm-dev libegl-dev libgles-dev python3 dpkg-dev',
 'node': 'python3 curl xz-utils patchelf binutils dpkg-dev gnupg',
 'search': 'python3 zstd binutils dpkg-dev',
 'os': 'python3 git zstd', 'guest': 'python3 git zstd',
 'loader': 'python3', 'runtime-guard': 'build-essential python3 dpkg-dev',
}


def contract(component, target, read):
    family = 'auth' if component.startswith('auth') else 'machines' if component.startswith('machines') else component
    result = {'runner': 'ubuntu-24.04-arm' if target == 'linux-arm64' else 'ubuntu-24.04',
              'apt': APT.get(family, '').split(), 'go': None, 'rust': None, 'node': None, 'pnpm': None}
    if component in AUTH_GO | MACHINE_GO:
        result['go'] = json.loads(read('auth/dependencies/go-toolchain/sources.json'))['version']
    if component in MACHINE_RUST :
        result['rust'] = json.loads(read('agent/machines/rust-toolchain/sources.json'))['version']
    if component == 'auth-authelia':
        lock = json.loads(read('auth/upstreams.lock.json'))['build']
        result.update(node=lock['node'], pnpm=lock['pnpm'])
    if target.startswith('termux-') and component.startswith('auth-'):
        result['termux'] = json.loads(read('auth/build/termux-toolchain.json'))
    return result


def setup(value):
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise ValueError('Native tool setup runs only in GitHub Actions')
    marker = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'taskarian-native-tools' / hashlib.sha256(json.dumps(value['apt']).encode()).hexdigest()
    if value['apt'] and not marker.exists():
        subprocess.run(['sudo', 'apt-get', 'update'], check=True)
        subprocess.run(['sudo', 'apt-get', 'install', '-y', '--no-install-recommends', *value['apt']], check=True)
        marker.parent.mkdir(parents=True, exist_ok=True); marker.touch()
    if value.get('go'):
        actual = subprocess.check_output(['go', 'env', 'GOVERSION'], text=True).strip()
        if actual != 'go' + value['go']:
            raise ValueError('Worker Go differs from its native toolchain contract')
    for name in ('node', 'pnpm'):
        if value.get(name):
            actual = subprocess.check_output([name, '--version'], text=True).strip().removeprefix('v')
            if actual != value[name]:
                raise ValueError('Installed ' + name + ' differs from its exact native toolchain pin')
    if value.get('rust'):
        subprocess.run(['rustup', 'toolchain', 'install', value['rust'], '--profile', 'minimal', '--component', 'rust-docs'], check=True)
        os.environ['RUSTUP_TOOLCHAIN'] = value['rust']
