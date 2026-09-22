#!/usr/bin/env bash
set -euo pipefail
target=${1:?target required}
output=$(realpath -m "${2:?output directory required}")
root=$(cd "$(dirname "$0")/../.." && pwd)
[[ ${GITHUB_ACTIONS:-} == true ]] || { echo 'Native builds run in GitHub Actions.' >&2; exit 2; }
if [[ $target == termux-aarch64 ]]; then
  exec "$root/auth/build/termux-component.sh" tor "$output"
fi
case "$target:$(uname -m)" in linux-amd64:x86_64|linux-arm64:aarch64) ;; *) echo "Use a native runner for $target." >&2; exit 2 ;; esac
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/bashkitten-tor.XXXXXX")
trap 'rm -rf "$work"' EXIT
cp -a "$root/auth/tor/." "$work/"
cd "$work"
./autogen.sh
./configure --prefix=/usr/lib/bashkitten/auth --disable-unittests \
  --disable-asciidoc --disable-system-torrc --disable-zstd --disable-seccomp
make -j "${CMAKE_BUILD_PARALLEL_LEVEL:-2}" src/app/tor
install -Dm755 src/app/tor "$output/bin/tor"
python3 "$root/auth/build/tor-notices.py" "$work" "$output"
install -Dm644 src/config/geoip "$output/share/tor/geoip"
install -Dm644 src/config/geoip6 "$output/share/tor/geoip6"
mkdir -p "$output/share/metadata"
# These are system libraries, not privately bundled copies. shlibdeps obtains
# their ABI package constraints from the binary actually assembled on this runner.
mkdir -p debian
printf 'Source: bashkitten-auth\nSection: utils\nPriority: optional\nMaintainer: Open Research Tools\nStandards-Version: 4.7.0\n\nPackage: bashkitten-auth\nArchitecture: any\nDescription: BashKitten native access stack\n' > debian/control
dpkg-shlibdeps -O -e"$output/bin/tor" | sed 's/^shlibs:Depends=//' > "$output/share/metadata/tor.dependencies"
dpkg-query -W -f='${binary:Package}\t${Version}\n' libevent-dev libssl-dev liblzma-dev zlib1g-dev \
  > "$output/share/metadata/tor-build-libraries.tsv"
"$output/bin/tor" --version
