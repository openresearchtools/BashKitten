#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Build the shared remote client as a native Android library, without host code.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true ]] || { echo 'Native builds run in GitHub Actions.' >&2; exit 2; }
root=$(cd "$(dirname "$0")/../.." && pwd)
output=$(realpath -m "${1:?output directory required}")
test -d "${ANDROID_HOME:?Android SDK required}/platforms/android-31"
test -f "${ANDROID_NDK_HOME:?Android NDK required}/source.properties"
grep -q 'Pkg.Revision = 29.0.14206865' "$ANDROID_NDK_HOME/source.properties"
export GOTOOLCHAIN=local GOTELEMETRY=off GOFLAGS=-mod=readonly
unset GOOS GOARCH CGO_ENABLED
abi=${BASHKITTEN_ANDROID_ABI:-arm64-v8a}
case "$abi" in
  arm64-v8a) go_arch=arm64; compiler=aarch64-linux-android31-clang ;;
  x86_64) go_arch=amd64; compiler=x86_64-linux-android31-clang ;;
  *) echo "Unsupported Android ABI: $abi" >&2; exit 2 ;;
esac
cd "$root/agent/native/remote/android"
tools=$(mktemp -d "${RUNNER_TEMP:-/tmp}/bashkitten-mobile-tools.XXXXXX")
trap 'rm -rf "$tools"' EXIT
mkdir -p "$output" "$(go env GOPATH)/pkg/gomobile"
go mod download
go mod verify
go build -trimpath -o "$tools/gomobile" golang.org/x/mobile/cmd/gomobile
go build -trimpath -o "$tools/gobind" golang.org/x/mobile/cmd/gobind
# Do not run gomobile init: upstream init installs gobind@latest. Both tools
# above are built from the pristine checked-in module and exact dependency lock.
export PATH="$tools:$PATH"
gomobile bind -target="android/$go_arch" -androidapi=31 -tags=bashkitten_client -trimpath \
  -javapkg=com.bashkitten.remote -ldflags='-s -w -extldflags=-Wl,-z,max-page-size=16384' \
  -o "$output/bashkitten-remote.aar" github.com/openresearchtools/bashkitten/remote/mobile
export GOOS=android GOARCH="$go_arch" CGO_ENABLED=1
export CC="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/$compiler"
export GOFLAGS='-mod=readonly -tags=bashkitten_client'
mkdir -p "$output/share/metadata"
go list -deps github.com/openresearchtools/bashkitten/remote/mobile > "$output/share/metadata/remote-client-packages.txt"
if grep -Eq '^github.com/(openresearchtools/bashkitten/remote/(host|cmd/)|jpillora/chisel/server)' "$output/share/metadata/remote-client-packages.txt"; then
  echo 'Host code entered the Android client.' >&2; exit 1
fi
python3 "$root/auth/build/go-notices.py" "$PWD" "$output" remote-client
python3 - "$output" "$root" "$abi" <<'PY'
from pathlib import Path
import hashlib, io, json, os, struct, subprocess, sys, zipfile
output, root = map(Path, sys.argv[1:3])
abi = sys.argv[3]
machine = 62 if abi == "x86_64" else 183
with zipfile.ZipFile(output / 'bashkitten-remote.aar') as aar:
    libraries = [p for p in aar.namelist() if p.endswith('.so')]
    if libraries != [f'jni/{abi}/libgojni.so']:
        raise SystemExit('Unexpected remote library ABI/payload')
    library = aar.read(libraries[0])
    with zipfile.ZipFile(io.BytesIO(aar.read('classes.jar'))) as classes:
        for name in ('Mobile', 'Connection', 'TokenStore'):
            if f'com/bashkitten/remote/mobile/{name}.class' not in classes.namelist():
                raise SystemExit('Missing generated native Java binding: ' + name)
if library[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', library, 18)[0] != machine:
    raise SystemExit('Remote library ELF architecture does not match ' + abi)
offset = struct.unpack_from('<Q', library, 32)[0]
size, count = struct.unpack_from('<HH', library, 54)
alignments = []
for i in range(count):
    segment = offset + size * i
    if struct.unpack_from('<I', library, segment)[0] != 1:
        continue
    file_offset, address = struct.unpack_from('<QQ', library, segment + 8)
    alignment = struct.unpack_from('<Q', library, segment + 48)[0]
    if alignment < 16384 or file_offset % 16384 != address % 16384:
        raise SystemExit('Remote library lacks 16 KB segment alignment')
    alignments.append(alignment)
if not alignments:
    raise SystemExit('Remote library has no load segments')
record = {'source': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
          'architecture': abi, 'android_api': 31,
          'ndk': '29.0.14206865', 'go': subprocess.check_output(['go', 'version'], text=True).strip(),
          'load_segment_alignment': min(alignments),
          'library_sha256': hashlib.sha256(library).hexdigest()}
(output / 'build-manifest.json').write_text(json.dumps(record, indent=2) + '\n')
(output / 'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + str(p.relative_to(output)) + '\n'
    for p in sorted(output.rglob('*')) if p.is_file() and p.name != 'SHA256SUMS'))
PY
