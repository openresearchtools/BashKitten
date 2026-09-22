#!/usr/bin/env bash
# Build checked-in source using the pinned upstream Termux package toolchain.
set -euo pipefail

component=${1:?component required}
output=${2:?output directory required}
case "$component" in caddy|tor|authelia) ;; *) echo "Unsupported component: $component" >&2; exit 2 ;; esac
[[ ${GITHUB_ACTIONS:-} == true ]] || { echo 'Native builds run in GitHub Actions.' >&2; exit 2; }
[[ $(uname -m) == x86_64 ]] || { echo 'The pinned Termux builder requires an amd64 runner.' >&2; exit 2; }
root=$(cd "$(dirname "$0")/../.." && pwd)
source_dir=$(realpath "${3:-$root/auth/$component}")
output=$(realpath -m "$output")
recipe="$root/auth/$component-termux"
test -f "$recipe/build.sh"
test -d "$source_dir"
readarray -t pin < <(python3 - "$root/auth/build/termux-toolchain.json" <<'PY'
import json, sys
p = json.load(open(sys.argv[1]))
print(p['commit'])
print(p['builderImage'])
PY
)
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/bashkitten-termux-$component.XXXXXX")
container="bashkitten-$component-${GITHUB_RUN_ID:-build}-${GITHUB_RUN_ATTEMPT:-1}-$$"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
git -C "$work" init -q
git -C "$work" remote add origin https://github.com/termux/termux-packages.git
git -C "$work" fetch -q --depth=1 origin "${pin[0]}"
git -C "$work" checkout -q --detach FETCH_HEAD
[[ $(git -C "$work" rev-parse HEAD) == "${pin[0]}" ]]
package="bashkitten-$component-native"
mkdir -p "$work/packages/$package" "$work/bashkitten-sources/$component"
cp -a "$recipe/." "$work/packages/$package/"
cp -a "$source_dir/." "$work/bashkitten-sources/$component/"
# The upstream builder still applies its patches/toolchain/ELF checks. Only its
# network source download is replaced with this release's checked-in source.
cat >> "$work/packages/$package/build.sh" <<EOF

termux_step_get_source() {
  mkdir -p "\$TERMUX_PKG_SRCDIR"
  cp -a "\$TERMUX_SCRIPTDIR/bashkitten-sources/$component/." "\$TERMUX_PKG_SRCDIR/"
}
EOF
export TERMUX_BUILDER_IMAGE_NAME="${pin[1]}"
export CONTAINER_NAME="$container"
export TERMUX_DOCKER_RUN_EXTRA_ARGS="--volume $root:/bashkitten:ro"
export TERMUX_DOCKER_EXEC_EXTRA_ARGS='--env BASHKITTEN_SOURCE_ROOT=/bashkitten --env GITHUB_ACTIONS=true'
(
  cd "$work"
  ./scripts/run-docker.sh ./build-package.sh -a aarch64 -I -f "$package"
)
# Upstream records the versions actually extracted into its target sysroot in
# .built-packages; it does not install that sysroot using the host dpkg database.
docker exec -i "$container" python3 - <<'PY'
import hashlib, json, pathlib, subprocess
records = []
markers = pathlib.Path('/data/data/.built-packages')
for path in sorted(markers.glob('*')):
    if path.is_file():
        records.append({'package': path.name, 'version': path.read_text().strip()})
archives = []
for path in sorted(pathlib.Path('/home/builder/.termux-build').glob('_cache-*/*.deb')):
    values = subprocess.check_output(['dpkg-deb', '-f', str(path), 'Package', 'Version', 'Architecture'], text=True)
    archives.append({'file': path.name, 'fields': values.strip(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
pathlib.Path('/home/builder/termux-packages/bashkitten-dependencies.json').write_text(json.dumps({'sysrootPackages': records, 'dependencyArchives': archives}, indent=2) + '\n')
PY
mapfile -t packages < <(find "$work/output" -maxdepth 1 -name "${package}_*_aarch64.deb" -type f)
[[ ${#packages[@]} == 1 ]] || { echo 'Expected exactly one native component package.' >&2; exit 1; }
deb=${packages[0]}
mkdir -p "$work/unpacked" "$output/share/metadata" "$output/share/licenses/$component"
dpkg-deb -x "$deb" "$work/unpacked"
prefix="$work/unpacked/data/data/com.termux/files/usr"
test -x "$prefix/lib/bashkitten/auth/bin/$component"
cp -a "$prefix/lib/bashkitten/auth/." "$output/"
cp "$work/bashkitten-dependencies.json" "$output/share/metadata/$component-termux-build-dependencies.json"
if [[ -d "$prefix/share/$package" ]]; then
  cp -a "$prefix/share/$package/." "$output/share/licenses/$component/"
fi
dpkg-deb -f "$deb" Depends > "$output/share/metadata/$component.dependencies"
python3 - "$deb" "$output/share/metadata/$component-termux.json" "$component" "${pin[0]}" "${pin[1]}" <<'PY'
import json, subprocess, sys
deb, output, component, commit, image = sys.argv[1:]
def field(name):
    return subprocess.check_output(['dpkg-deb', '-f', deb, name], text=True).strip()
record = {'component': component, 'target': 'termux-aarch64',
          'version': field('Version'), 'architecture': field('Architecture'),
          'externalDependencies': field('Depends'), 'termuxPackagesCommit': commit,
          'builderImage': image}
with open(output, 'w') as f:
    json.dump(record, f, indent=2)
    f.write('\n')
PY
