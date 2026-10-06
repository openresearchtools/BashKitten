#!/usr/bin/env bash
# Shared native host adapter; all lifecycle policy stays in the existing controller.
set -euo pipefail
target=${1:?target required}
output=$(realpath -m "${2:?output directory required}")
root=$(cd "$(dirname "$0")/../.." && pwd)
[[ ${GITHUB_ACTIONS:-} == true ]] || { echo 'Native builds run in GitHub Actions.' >&2; exit 2; }
source_dir="$root/agent/native/remote"
if [[ $target == termux-aarch64 || $target == termux-x86_64 ]]; then
  exec "$root/auth/build/termux-component.sh" remote "$output" "${target#termux-}" "$source_dir"
fi
case "$target:$(uname -m)" in linux-amd64:x86_64|linux-arm64:aarch64) ;; *) echo "Use a native runner for $target." >&2; exit 2 ;; esac
cd "$source_dir"
export CGO_ENABLED=0 GOTOOLCHAIN=local GOTELEMETRY=off
mkdir -p "$output/bin"
go build -p "${BASHKITTEN_BUILD_JOBS:-2}" -mod=readonly -trimpath -buildvcs=false \
  -ldflags='-s -w' -o "$output/bin/bashkitten-remote" ./cmd/bashkitten-remote
python3 "$root/auth/build/go-notices.py" "$source_dir" "$output" remote

