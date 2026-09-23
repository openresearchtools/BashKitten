#!/usr/bin/env bash
# Private stock Redis-protocol session storage for Authelia.
set -euo pipefail
target=${1:?target required}
output=$(realpath -m "${2:?output directory required}")
root=$(cd "$(dirname "$0")/../.." && pwd)
[[ ${GITHUB_ACTIONS:-} == true ]] || { echo 'Native builds run in GitHub Actions.' >&2; exit 2; }
if [[ $target == termux-aarch64 ]]; then
  exec "$root/auth/build/termux-component.sh" valkey "$output"
fi
case "$target:$(uname -m)" in linux-amd64:x86_64|linux-arm64:aarch64) ;; *) echo "Use a native runner for $target." >&2; exit 2 ;; esac
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/bashkitten-valkey.XXXXXX")
trap 'rm -rf "$work"' EXIT
cp -a "$root/auth/valkey/." "$work/source"
cmake -S "$work/source" -B "$work/build" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX=/usr/lib/bashkitten/auth -DBUILD_MALLOC=libc \
  -DBUILD_TLS=OFF -DBUILD_RDMA=OFF -DBUILD_LUA=static
cmake --build "$work/build" --target valkey-server -j "${BASHKITTEN_BUILD_JOBS:-2}"
install -Dm755 "$work/build/bin/valkey-server" "$output/bin/valkey-server"
python3 "$root/auth/build/valkey-notices.py" "$work/source" "$output"
mkdir -p "$output/share/metadata" "$work/debian"
printf 'Source: bashkitten-auth\nSection: utils\nPriority: optional\nMaintainer: Open Research Tools\nStandards-Version: 4.7.0\n\nPackage: bashkitten-auth\nArchitecture: any\nDescription: BashKitten native access stack\n' > "$work/debian/control"
cd "$work"
dpkg-shlibdeps -O -e"$output/bin/valkey-server" | sed 's/^shlibs:Depends=//' > "$output/share/metadata/valkey.dependencies"
"$output/bin/valkey-server" --version
