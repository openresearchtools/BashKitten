#!/usr/bin/env bash
# Build pristine Chisel with the existing native component pipeline.
set -euo pipefail
target=${1:?target required}
output=$(realpath -m "${2:?output directory required}")
root=$(cd "$(dirname "$0")/../.." && pwd)
[[ ${GITHUB_ACTIONS:-} == true ]] || { echo 'Native builds run in GitHub Actions.' >&2; exit 2; }
if [[ $target == termux-aarch64 ]]; then
  exec "$root/auth/build/termux-component.sh" chisel "$output"
fi
case "$target:$(uname -m)" in linux-amd64:x86_64|linux-arm64:aarch64) ;; *) echo "Use a native runner for $target." >&2; exit 2 ;; esac
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/bashkitten-chisel.XXXXXX")
trap 'rm -rf "$work"' EXIT
cp -a "$root/auth/chisel/." "$work/"
cd "$work"
export CGO_ENABLED=0 GOTOOLCHAIN=local GOTELEMETRY=off
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["chisel"]["version"])' "$root/auth/upstreams.lock.json")
mkdir -p "$output/bin"
go build -p "${BASHKITTEN_BUILD_JOBS:-2}" -mod=readonly -trimpath -buildvcs=false \
  -ldflags="-s -w -X github.com/jpillora/chisel/share.BuildVersion=$version" \
  -o "$output/bin/chisel" .
install -Dm644 LICENSE "$output/share/licenses/chisel/LICENSE"
python3 "$root/auth/build/go-notices.py" "$work" "$output" chisel
printf 'ca-certificates\n' > "$output/share/metadata/chisel.dependencies"
"$output/bin/chisel" --version
