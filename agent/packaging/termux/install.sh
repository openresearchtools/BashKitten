#!/data/data/com.termux/files/usr/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only
# Downloaded from the installed APK's exact source revision by its setup command.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if [[ ${PREFIX:-} != /data/data/com.termux/files/usr ]]; then
    echo 'Run this setup in Termux.' >&2
    exit 1
fi
architecture=$(dpkg --print-architecture)
case "$architecture" in
    aarch64)
        keyring_url=https://apt.openresearchtools.com/apt/releases/download/repo/openresearchtools-termux-keyring_2026.10.06.1_aarch64.deb
        nightly_url=https://apt.openresearchtools.com/apt/releases/download/nightly/openresearchtools-termux-nightly_2026.10.06.1_aarch64.deb
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
if [[ ( $# != 1 && $# != 4 ) || ! $1 =~ ^com\.bashkitten/[A-Za-z0-9_.$]+$ ]]; then
    echo 'Copy the complete setup command from the installed BashKitten APK; its package versions and architecture are required.' >&2
    exit 1
fi
destination=$1
backend_version=${2:-}
os_version=${3:-}
if [[ $# == 4 && ( ! $backend_version =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ||
      $os_version != "$backend_version-1" || $4 != "$architecture" ) ]]; then
    echo 'The setup package versions or architecture do not match this APK.' >&2
    exit 1
fi
setup_dir=$(mktemp -d)
trap 'rm -rf -- "$setup_dir"' EXIT

# Keep both catalogues available with the same signing key: an older APK may
# require a retained prerelease even when the user checks only for stable APKs.
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
if [[ $(dpkg-query -W -f='${Status}' bashkitten 2>/dev/null || true) == 'install ok installed' ]]; then
    # The installed backend may own live work. The APK's updater verifies the
    # package identities and replaces them only at its existing idle boundary.
    printf 'Returning to the installed BashKitten app to verify and match its required packages.\n'
else
    # APT verifies the signed catalogue; new APK commands select exact versions.
    # The returning APK checks producer/OS identities before backend startup.
    install_options=(--no-remove install -y
        -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
    if [[ -n $backend_version ]]; then
        install_options+=(--allow-downgrades "bashkitten=$backend_version" "bashkitten-os=$os_version")
    else
        # Already-shipped APKs pass only their return Activity. Preserve their
        # bootstrap entry point; their APK-owned exact reconciler gates startup.
        # New APKs always supply their requirements before initial installation.
        printf 'Legacy setup: the installed app will verify its exact packages before starting Agent.\n'
        install_options+=(bashkitten)
    fi
    apt-get -s "${install_options[@]}" > "$setup_dir/plan"
    cat "$setup_dir/plan"
    # --allow-downgrades applies only to the two explicit APK requirements,
    # never a user's unrelated packages selected by other APT preferences.
    while IFS= read -r line; do
        if [[ $line =~ ^Inst\ ([^[:space:]]+)\ \[([^]]+)\]\ \(([^[:space:]]+) ]]; then
            package=${BASH_REMATCH[1]%%:*}
            if [[ $package != bashkitten && $package != bashkitten-os ]] &&
                dpkg --compare-versions "${BASH_REMATCH[3]}" lt "${BASH_REMATCH[2]}"; then
                printf 'Refusing to downgrade unrelated package %s during app setup.\n' "$package" >&2
                exit 1
            fi
        fi
    done < "$setup_dir/plan"
    apt-get "${install_options[@]}"
fi
# The Display owner provisions its private desktop profile on first use;
# installing BashKitten must not change an independent Termux:X11 profile.

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
