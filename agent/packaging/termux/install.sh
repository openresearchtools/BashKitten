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
        keyring_url=https://termux.openresearchtools.com
        nightly_url=https://nightly-termux.openresearchtools.com
        keyring_sha=7023814ef3728ac90a77a8e316a852a6431498e54b3c3bacd89a183d97e1f225
        nightly_sha=03e4e96f3233fb6a4bdf94f183c7b0b59eec5ecc49b3f329653f53cbd8508541
        ;;
    x86_64)
        keyring_url=https://apt.openresearchtools.com/apt/releases/download/repo/openresearchtools-termux-keyring_2026.10.06.1_x86_64.deb
        nightly_url=https://apt.openresearchtools.com/apt/releases/download/nightly/openresearchtools-termux-nightly_2026.10.06.1_x86_64.deb
        keyring_sha=47ca6e30a466ec69fdf29b77fd19dc8579c4ab881bc85cf8a156896023df6f93
        nightly_sha=f7017bfa15baa1a6905725d57e178fe79f650c3190197de3453b46d02a9dd05a
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
    -o "$setup_dir/keyring.deb" "$keyring_url"
printf '%s  %s\n' "$keyring_sha" \
    "$setup_dir/keyring.deb" | sha256sum -c -
pkg install -y -o Dpkg::Options::=--force-confold "$setup_dir/keyring.deb" x11-repo
curl --fail --location --proto '=https' --proto-redir '=https' --retry 3 \
    -o "$setup_dir/nightly.deb" "$nightly_url"
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
