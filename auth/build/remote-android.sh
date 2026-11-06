#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Build the shared remote client as a native Android library, without host code.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true ]] || { echo 'Native builds run in GitHub Actions.' >&2; exit 2; }
root=$(cd "$(dirname "$0")/../.." && pwd)
source "$root/auth/build/go-env.sh"
output=$(realpath -m "${1:?output directory required}")
test -d "${ANDROID_HOME:?Android SDK required}/platforms/android-31"
test -f "${ANDROID_NDK_HOME:?Android NDK required}/source.properties"
grep -q 'Pkg.Revision = 29.0.14206865' "$ANDROID_NDK_HOME/source.properties"
export GOTOOLCHAIN=local GOTELEMETRY=off GOFLAGS=-mod=readonly
unset GOOS GOARCH CGO_ENABLED
abi=${TASKARIAN_ANDROID_ABI:-arm64-v8a}
case "$abi" in
  arm64-v8a) go_arch=arm64; compiler=aarch64-linux-android31-clang ;;
  x86_64) go_arch=amd64; compiler=x86_64-linux-android31-clang ;;
  *) echo "Unsupported Android ABI: $abi" >&2; exit 2 ;;
esac
cd "$root/agent/native/remote/android"
tools=$(mktemp -d "${RUNNER_TEMP:-/tmp}/taskarian-mobile-tools.XXXXXX")
trap 'rm -rf "$tools"' EXIT
mkdir -p "$output" "$(go env GOPATH)/pkg/gomobile"
go mod download
go mod verify
go build -trimpath -o "$tools/gomobile" golang.org/x/mobile/cmd/gomobile
go build -trimpath -o "$tools/gobind" golang.org/x/mobile/cmd/gobind
# Do not run gomobile init: upstream init installs gobind@latest. Both tools
# above are built from the pristine checked-in module and exact dependency lock.
export PATH="$tools:$PATH"
TMPDIR="$tools" gomobile bind -work -target="android/$go_arch" -androidapi=31 -tags=taskarian_client,ts_omit_logtail,ts_omit_netlog -trimpath \
  -javapkg=com.taskarian.remote -ldflags='-s -w -extldflags=-Wl,-z,max-page-size=16384' \
  -o "$output/taskarian-remote.aar" github.com/openresearchtools/Taskarian/remote/mobile
modules=("$tools"/gomobile-work-*/src-android-"$go_arch")
if [[ ${#modules[@]} != 1 || ! -f ${modules[0]}/go.mod || ! -f ${modules[0]}/go.sum ]]; then
  echo 'The native gomobile generated module is missing or ambiguous.' >&2; exit 1
fi
module=${modules[0]}
export GOOS=android GOARCH="$go_arch" CGO_ENABLED=1
export CC="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/$compiler"
export GOFLAGS='-mod=readonly -tags=taskarian_client,ts_omit_logtail,ts_omit_netlog'
mkdir -p "$output/share/metadata"
(
  cd "$module"
  go mod verify
  go list -deps ./gobind > "$output/share/metadata/remote-client-packages.txt"
)
if grep -Eq '^github.com/(openresearchtools/Taskarian/remote/(host|cmd/)|jpillora/chisel/server)' "$output/share/metadata/remote-client-packages.txt"; then
  echo 'Host code entered the Android client.' >&2; exit 1
fi
python3 "$root/auth/build/go-notices.py" "$module" "$output" remote-client
python3 - "$output" "$root" "$abi" "$module" <<'PY'
from pathlib import Path
import hashlib, io, json, os, struct, subprocess, sys, tempfile, zipfile
output, root = map(Path, sys.argv[1:3])
abi = sys.argv[3]
module = Path(sys.argv[4])
machine = 62 if abi == "x86_64" else 183
with zipfile.ZipFile(output / 'taskarian-remote.aar') as aar:
    libraries = [p for p in aar.namelist() if p.endswith('.so')]
    if libraries != [f'jni/{abi}/libgojni.so']:
        raise SystemExit('Unexpected remote library ABI/payload')
    library = aar.read(libraries[0])
    with zipfile.ZipFile(io.BytesIO(aar.read('classes.jar'))) as classes:
        for name in ('Mobile', 'Connection', 'TokenStore'):
            if f'com/taskarian/remote/mobile/{name}.class' not in classes.namelist():
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
with tempfile.TemporaryDirectory(prefix='taskarian-go-buildinfo-') as temporary:
    binary = Path(temporary) / 'libgojni.so'
    binary.write_bytes(library)
    buildinfo = json.loads(subprocess.check_output(['go', 'version', '-m', '-json', str(binary)], text=True))
settings = {item['Key']: item['Value'] for item in buildinfo['Settings']}
if (buildinfo['Main']['Path'] != 'gobind' or buildinfo['Path'] != 'gobind/gobind' or
        any(settings.get(key) != value for key, value in {
            'GOOS': 'android', 'GOARCH': 'amd64' if abi == 'x86_64' else 'arm64',
            'CGO_ENABLED': '1', '-buildmode': 'c-shared'}.items()) or
        'taskarian_client' not in settings.get('-tags', '').split(',')):
    raise SystemExit('Remote library build information does not match its native client target')
inventory = json.loads((output / 'share/metadata/remote-client-go-modules.json').read_text())
runtime, = (item for item in inventory if item['name'] == 'Go runtime and standard library')
linked = {item['Path']: item.get('Version') or 'checked-in' for item in buildinfo['Deps']}
notices = {item['name']: item['version'] or 'checked-in' for item in inventory if item is not runtime}
if linked != notices or buildinfo['GoVersion'] != 'go' + runtime['version']:
    raise SystemExit('Remote library linked modules/compiler differ from its full notices and sources')
raw = subprocess.check_output(['go', 'list', '-m', '-mod=readonly', '-json', 'all'], cwd=module, text=True)
decoder, offset, resolved = json.JSONDecoder(), 0, {}
while offset < len(raw):
    while offset < len(raw) and raw[offset].isspace(): offset += 1
    if offset == len(raw): break
    item, offset = decoder.raw_decode(raw, offset)
    resolved[item['Path']] = item
pins = json.loads((root / 'auth/dependencies/go/sources.json').read_text())
retained = {(item['name'], item['version']): item for item in pins['modules']}
for item in buildinfo['Deps']:
    expected = resolved.get(item['Path'])
    if not expected or (expected.get('Version') or 'checked-in') != linked[item['Path']]:
        raise SystemExit('Remote library module differs from its generated native module: ' + item['Path'])
    replacement = item.get('Replace')
    source = expected.get('Replace')
    if bool(replacement) != bool(source):
        raise SystemExit('Remote library module replacement differs: ' + item['Path'])
    if source:
        if (Path(replacement['Path']).resolve() != Path(source.get('Dir', source['Path'])).resolve() or
                (replacement.get('Version') or '(devel)') != (source.get('Version') or '(devel)')):
            raise SystemExit('Remote library source replacement differs: ' + item['Path'])
    elif retained.get((item['Path'], item['Version']), {}).get('sum') != item.get('Sum'):
        raise SystemExit('Remote library source checksum is not pinned: ' + item['Path'])
(output / 'share/metadata/remote-client-buildinfo.json').write_text(json.dumps(buildinfo, indent=2) + '\n')
record = {'source': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
          'architecture': abi, 'android_api': 31,
          'ndk': '29.0.14206865', 'go': subprocess.check_output(['go', 'version'], text=True).strip(),
          'load_segment_alignment': min(alignments),
          'library_sha256': hashlib.sha256(library).hexdigest()}
(output / 'build-manifest.json').write_text(json.dumps(record, indent=2) + '\n')
(output / 'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + str(p.relative_to(output)) + '\n'
    for p in sorted(output.rglob('*')) if p.is_file() and p.name != 'SHA256SUMS'))
PY
