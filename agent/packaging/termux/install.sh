#!/data/data/com.termux/files/usr/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only
# The app's short command upgrades Termux before curl downloads this file.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if [[ ${PREFIX:-} != /data/data/com.termux/files/usr ]]; then
    echo 'Run this setup in Termux.' >&2
    exit 1
fi
architecture=$(dpkg --print-architecture)
case "$architecture" in
    aarch64)
        keyring_sha=d8b1c57b81cee66761a428a46d22297107d81431415d3712960e88a86c81050a
        nightly_sha=65835cdf5bd67813524247812f6b88278e43162f76dff7850249228196f68f9e
        ;;
    x86_64)
        keyring_sha=44b556e0464890bc8bf856fe9844fe79be8960bb59c08e9923305a8888e507a8
        nightly_sha=ced2e108569474fec6c5149480650eac6bafb2ecc9e2485327a2eeb1f017a08e
        ;;
    *) echo "Unsupported Termux architecture: $architecture. Use ARM64 or x86_64 Termux." >&2; exit 1 ;;
esac
if [[ $# != 1 || ! $1 =~ ^com\.bashkitten/[A-Za-z0-9_.$]+$ ]]; then
    echo 'Copy the setup command from BashKitten so it can return to the installed app.' >&2
    exit 1
fi
destination=$1
setup_dir=$(mktemp -d)
trap 'rm -rf -- "$setup_dir"' EXIT

# Register stable and nightly with the same signing key. These are testing
# releases; normal package version ordering still permits a newer stable update.
curl --fail --location --proto '=https' --proto-redir '=https' --retry 3 \
    -o "$setup_dir/keyring.deb" \
    "https://github.com/openresearchtools/apt/releases/download/repo/openresearchtools-termux-keyring_2026.10.06_${architecture}.deb"
printf '%s  %s\n' "$keyring_sha" \
    "$setup_dir/keyring.deb" | sha256sum -c -
pkg install -y -o Dpkg::Options::=--force-confold "$setup_dir/keyring.deb" x11-repo
curl --fail --location --proto '=https' --proto-redir '=https' --retry 3 \
    -o "$setup_dir/nightly.deb" \
    "https://github.com/openresearchtools/apt/releases/download/nightly/openresearchtools-termux-nightly_2026.10.06_${architecture}.deb"
printf '%s  %s\n' "$nightly_sha" "$setup_dir/nightly.deb" | sha256sum -c -
pkg install -y -o Dpkg::Options::=--force-confold "$setup_dir/nightly.deb"
apt-get -o APT::Update::Error-Mode=any update
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
