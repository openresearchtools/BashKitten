#!/usr/bin/env bash
# Build the pinned native Cloudflare connector; lifecycle belongs to Share Local.
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
target=${1:?target required}
output=$(realpath -m "${2:?output directory required}")
root=$(cd "$(dirname "$0")/../.." && pwd)
source "$root/auth/build/go-env.sh"
[[ ${GITHUB_ACTIONS:-} == true ]] || { echo 'Native builds run in GitHub Actions.' >&2; exit 2; }
if [[ $target == termux-aarch64 || $target == termux-x86_64 ]]; then
  exec "$root/auth/build/termux-component.sh" cloudflared "$output" "${target#termux-}"
fi
case "$target:$(uname -m)" in linux-amd64:x86_64|linux-arm64:aarch64) ;; *) echo "Use a native runner for $target." >&2; exit 2 ;; esac
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/taskarian-cloudflared.XXXXXX")
trap 'rm -rf "$work"' EXIT
cp -a "$root/auth/cloudflared/." "$work/"
patch --directory "$work" --strip 1 --fuzz=0 --batch < "$root/auth/build/cloudflared-no-telemetry.patch"
cd "$work"
export CGO_ENABLED=0 GOTOOLCHAIN=local GOTELEMETRY=off
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["cloudflared"]["version"])' "$root/auth/upstreams.lock.json")
mkdir -p "$output/bin"
go build -p "${TASKARIAN_BUILD_JOBS:-2}" -mod=readonly -trimpath -buildvcs=false \
  -ldflags="-s -w -X main.Version=$version -X main.BuildType=Taskarian" \
  -o "$output/bin/cloudflared" ./cmd/cloudflared
install -Dm644 LICENSE "$output/share/licenses/cloudflared/LICENSE"
python3 "$root/auth/build/go-notices.py" "$work" "$output" cloudflared
printf 'ca-certificates\n' > "$output/share/metadata/cloudflared.dependencies"
"$output/bin/cloudflared" --version
