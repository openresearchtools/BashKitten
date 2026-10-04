#!/data/data/com.termux/files/usr/bin/bash
# SPDX-License-Identifier: GPL-3.0-only
# The app's short command upgrades Termux before curl downloads this file.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if [[ ${PREFIX:-} != /data/data/com.termux/files/usr || $(dpkg --print-architecture) != aarch64 ]]; then
    echo 'Run this setup in ARM64 Termux.' >&2
    exit 1
fi
if [[ $# != 1 || ! $1 =~ ^com\.bashkitten/[A-Za-z0-9_.$]+$ ]]; then
    echo 'Copy the setup command from BashKitten so it can return to the installed app.' >&2
    exit 1
fi
destination=$1
setup_dir=$(mktemp -d)
trap 'rm -rf -- "$setup_dir"' EXIT

# Register the signed package repository; the .deb owns all dependencies.
curl --fail --location --proto '=https' --proto-redir '=https' --retry 3 \
    -o "$setup_dir/keyring.deb" \
    https://github.com/openresearchtools/apt/releases/download/repo/openresearchtools-termux-keyring_2026.09.19_aarch64.deb
printf '%s  %s\n' b1f0f0b0089344331d42ef0c623df79c88197823cc951e5f56184bd88e414bf8 \
    "$setup_dir/keyring.deb" | sha256sum -c -
pkg install -y -o Dpkg::Options::=--force-confold "$setup_dir/keyring.deb" x11-repo
pkg install -y -o Dpkg::Options::=--force-confold bashkitten

mkdir -p ~/.termux
if grep -q '^[[:space:]]*allow-external-apps[[:space:]]*=' ~/.termux/termux.properties 2>/dev/null; then
    sed -i 's/^[[:space:]]*allow-external-apps[[:space:]]*=.*/allow-external-apps=true/' ~/.termux/termux.properties
else
    printf '\nallow-external-apps=true\n' >> ~/.termux/termux.properties
fi
termux-reload-settings
am start --user "$(( $(id -u) / 100000 ))" \
    -a android.intent.action.MAIN -c android.intent.category.LAUNCHER \
    -n "$destination" --ez com.bashkitten.TERMUX_SETUP_COMPLETE true
