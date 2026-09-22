#!/usr/bin/env bash
# Build pattern adapted from Torkitten, Copyright 2026 The Torkitten Authors.
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
target=${1:?target required}
output=$(realpath -m "${2:?staging directory required}")
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
[[ ${GITHUB_ACTIONS:-} == true ]] || { echo 'Native builds run in GitHub Actions.' >&2; exit 2; }
case "$target" in linux-amd64|linux-arm64|termux-aarch64) ;; *) exit 2 ;; esac
work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/bashkitten-authelia.XXXXXX")
trap 'rm -rf "$work"' EXIT
cp -a "$root/auth/authelia" "$work/source"
export DO_NOT_TRACK=1 GOTELEMETRY=off GOTOOLCHAIN=local PNPM_DISABLE_SELF_UPDATE_CHECK=true
export NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_UPDATE_NOTIFIER=false
(
  cd "$work/source/web"
  pnpm install --frozen-lockfile --ignore-scripts
  pnpm build
  pnpm licenses list --prod --json > "$work/frontend-licenses.json"
)
rm -rf "$work/source/internal/server/public_html/api"
cp -a "$work/source/api" "$work/source/internal/server/public_html/api"
python3 "$root/auth/build/frontend-notices.py" "$work/frontend-licenses.json" "$work/source/.bashkitten-frontend"
mkdir -p "$work/source/.bashkitten-frontend/share/licenses/authelia-assets"
cp -a "$work/source/LICENSES/." "$work/source/.bashkitten-frontend/share/licenses/authelia-assets/"
find "$work/source/web" -path '*/node_modules' -prune -o -type f -name '*.license' -print0 | while IFS= read -r -d '' notice; do
  relative=${notice#"$work/source/"}
  install -Dm644 "$notice" "$work/source/.bashkitten-frontend/share/licenses/authelia-assets/$relative"
done
if [[ $target == termux-aarch64 ]]; then
  "$root/auth/build/termux-component.sh" authelia "$output" "$work/source"
else
  expected=${target#linux-}
  actual=$(go env GOHOSTARCH)
  [[ "$actual" == "$expected" ]] || { echo "Use a native $expected runner (found $actual)" >&2; exit 1; }
  export GOOS=linux GOARCH="$expected" CGO_ENABLED=1
  export CGO_CFLAGS='-O2 -pipe -fstack-protector-strong'
  export CGO_CPPFLAGS='-D_FORTIFY_SOURCE=3'
  export CGO_LDFLAGS='-Wl,-z,relro,-z,now'
  "$root/auth/build/authelia-go.sh" "$work/source" "$output/bin/authelia"
  cc -std=c11 -Wall -Wextra -Werror -O2 "$root/agent/src/server/access/runtime-guard.c" -o "$output/bin/runtime-guard"
  python3 "$root/auth/build/go-notices.py" "$work/source" "$output" authelia
  cp -a "$work/source/.bashkitten-frontend/share" "$output/"
  "$output/bin/authelia" --version
  (
    cd "$work/source"
    mkdir -p debian
    printf 'Source: bashkitten-auth\nSection: utils\nPriority: optional\nMaintainer: OpenResearchTools\nStandards-Version: 4.7.0\n\nPackage: bashkitten-auth\nArchitecture: any\nDescription: BashKitten native access stack\n' > debian/control
    dpkg-shlibdeps -O -e"$output/bin/authelia" -e"$output/bin/runtime-guard" | sed 's/^shlibs:Depends=//' | tr '\n' ','
    printf ' ca-certificates\n'
  ) > "$output/share/metadata/authelia.dependencies"
fi
install -Dm644 "$root/LICENSE" "$output/share/licenses/runtime-guard/LICENSE"
install -Dm644 "$root/auth/build/TORKITTEN-LICENSE" "$output/share/licenses/torkitten/LICENSE"
python3 - "$root" "$target" "$output" <<'PY'
import hashlib, json, pathlib, sys
root, target, output = pathlib.Path(sys.argv[1]), sys.argv[2], pathlib.Path(sys.argv[3])
lock = json.loads((root / 'auth/upstreams.lock.json').read_text())
metadata = dict(lock['authelia'], target=target, cgo=True, sqlite='upstream go-sqlite3, compiled for target', frontend='frozen web/pnpm-lock.yaml', sha256=hashlib.sha256((output / 'bin/authelia').read_bytes()).hexdigest())
(output / 'share/metadata').mkdir(parents=True, exist_ok=True)
(output / 'share/metadata/authelia.json').write_text(json.dumps(metadata, indent=2) + '\n')
PY
