#!/usr/bin/env bash
set -euo pipefail
target=${1:?target required}
output=$(realpath -m "${2:?output directory required}")
root=$(cd "$(dirname "$0")/../.." && pwd)
[[ ${GITHUB_ACTIONS:-} == true ]] || { echo 'Native builds run in GitHub Actions.' >&2; exit 2; }
if [[ $target == termux-aarch64 ]]; then
  exec "$root/auth/build/termux-component.sh" caddy "$output"
fi
case "$target:$(uname -m)" in linux-amd64:x86_64|linux-arm64:aarch64) ;; *) echo "Use a native runner for $target." >&2; exit 2 ;; esac
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/bashkitten-caddy.XXXXXX")
trap 'rm -rf "$work"' EXIT
cp -a "$root/auth/caddy/." "$work/"
cd "$work"
export CGO_ENABLED=0 GOTOOLCHAIN=local GOTELEMETRY=off
version=$(python3 - "$root/auth/caddy-termux/upstream-build.sh" <<'PY'
import re, sys
print(re.search(r'^TERMUX_PKG_VERSION="([^"]+)"', open(sys.argv[1]).read(), re.M)[1])
PY
)
mkdir -p "$output/bin"
go build -mod=readonly -trimpath -buildvcs=false \
  -ldflags="-s -w -X github.com/caddyserver/caddy/v2.CustomVersion=v$version" \
  -o "$output/bin/caddy" ./cmd/caddy
install -Dm644 LICENSE "$output/share/licenses/caddy/LICENSE"
python3 "$root/auth/build/go-notices.py" "$work" "$output" caddy
printf 'ca-certificates\n' > "$output/share/metadata/caddy.dependencies"
"$output/bin/caddy" version
