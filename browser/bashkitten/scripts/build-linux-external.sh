#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Build a committed BashKitten revision in a runner-style checkout. Nothing is
# configured, compiled, cached, or packaged in the developer source checkout.

set -Eeuo pipefail

usage() {
  echo "Usage: $0 [options]"
  echo
  echo "Options:"
  echo "  --action ACTION    configure, build, gkrust, or archive (default: build)"
  echo "  --build-root DIR   external build root (default: ../bashkitten-builds)"
  echo "  --jobs NUMBER      parallel build jobs (default: all logical CPUs)"
  echo "  --ref REF          committed Git ref to build (default: HEAD)"
  echo "  --working-tree     include tracked and untracked developer changes"
  echo "  --bootstrap        force mach bootstrap before the requested action"
  echo "  --help             show this help"
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source_gecko="$(cd -- "${script_dir}/../.." && pwd -P)"
source_repo="$(git -C "${source_gecko}" rev-parse --show-toplevel)"
build_root="$(dirname -- "${source_repo}")/bashkitten-builds"
action="build"
build_ref="HEAD"
jobs="$(nproc)"
run_bootstrap=false
include_working_tree=false

while (($#)); do
  case "$1" in
    --action)
      action="${2:?--action requires a value}"
      shift 2
      ;;
    --build-root)
      build_root="${2:?--build-root requires a directory}"
      shift 2
      ;;
    --jobs)
      jobs="${2:?--jobs requires a number}"
      shift 2
      ;;
    --ref)
      build_ref="${2:?--ref requires a Git ref}"
      shift 2
      ;;
    --working-tree)
      include_working_tree=true
      shift
      ;;
    --bootstrap)
      run_bootstrap=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "${action}" in
  configure|build|gkrust|archive) ;;
  *) echo "Unsupported action: ${action}" >&2; exit 2 ;;
esac

if [[ ! "${jobs}" =~ ^[1-9][0-9]*$ ]]; then
  echo "--jobs must be a positive integer" >&2
  exit 2
fi

mkdir -p -- "${build_root}"
build_root="$(cd -- "${build_root}" && pwd -P)"

case "${build_root}/" in
  "${source_repo}/"*)
    echo "Build root must be outside the source repository: ${source_repo}" >&2
    exit 2
    ;;
esac

commit="$(git -C "${source_repo}" rev-parse --verify "${build_ref}^{commit}")"
short_commit="$(git -C "${source_repo}" rev-parse --short=12 "${commit}")"
source_date_epoch="$(git -C "${source_repo}" show -s --format=%ct "${commit}")"
run_id="${BASHKITTEN_BUILD_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-${short_commit}-$$}"
run_root="${build_root}/runs/${run_id}"
checkout_repo="${run_root}/source"
checkout_dir="${checkout_repo}/browser"
object_dir="${run_root}/obj"
log_dir="${run_root}/logs"
state_dir="${build_root}/state"
ccache_dir="${build_root}/ccache"
sccache_dir="${build_root}/sccache"

mkdir -p -- \
  "${run_root}" \
  "${object_dir}" \
  "${log_dir}" \
  "${state_dir}" \
  "${ccache_dir}" \
  "${sccache_dir}"

if ! git -C "${source_repo}" diff --quiet ||
  ! git -C "${source_repo}" diff --cached --quiet; then
  if [[ "${include_working_tree}" == true ]]; then
    echo "Note: this run includes the developer working tree over ${commit}."
  else
    echo "Note: the developer checkout is dirty; this run builds committed ${commit} only."
  fi
fi

# The checkout has its own index and worktree, while Git objects are borrowed
# read-only from the developer repository. This avoids copying and recompressing
# Firefox's multi-gigabyte history; all generated files still stay external.
git clone --shared --no-checkout -- "${source_repo}" "${checkout_repo}"
git -C "${checkout_repo}" sparse-checkout set browser
git -C "${checkout_repo}" checkout --detach "${commit}"

if [[ "${include_working_tree}" == true ]]; then
  git -C "${source_repo}" diff --binary "${commit}" -- browser \
    >"${run_root}/working-tree.patch"
  if [[ -s "${run_root}/working-tree.patch" ]]; then
    git -C "${checkout_repo}" apply --binary "${run_root}/working-tree.patch"
  fi
  while IFS= read -r -d '' path; do
    mkdir -p -- "${checkout_repo}/$(dirname -- "${path}")"
    cp -a -- "${source_repo}/${path}" "${checkout_repo}/${path}"
  done < <(
    git -C "${source_repo}" ls-files \
      --others --exclude-standard -z -- browser
  )
fi

build_commit="${commit}"
if [[ "${include_working_tree}" == true ]]; then
  git -C "${checkout_dir}" add --all
  if ! git -C "${checkout_dir}" diff --cached --quiet; then
    GIT_AUTHOR_DATE="@${source_date_epoch} +0000" \
      GIT_COMMITTER_DATE="@${source_date_epoch} +0000" \
      git -C "${checkout_dir}" \
      -c user.name="openresearchtools" \
      -c user.email="229047507+openresearchtools@users.noreply.github.com" \
      commit -m "BashKitten external build snapshot"
    build_commit="$(git -C "${checkout_dir}" rev-parse HEAD)"
  fi
fi

{
  echo "base_commit=${commit}"
  echo "build_commit=${build_commit}"
  echo "ref=${build_ref}"
  echo "source_repo=${source_repo}"
  echo "run_root=${run_root}"
  echo "object_dir=${object_dir}"
  echo "jobs=${jobs}"
  echo "action=${action}"
  echo "working_tree=${include_working_tree}"
  echo "source_date_epoch=${source_date_epoch}"
  echo "started_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >"${run_root}/build-manifest.txt"

export MOZBUILD_STATE_PATH="${state_dir}"
export SOURCE_DATE_EPOCH="${source_date_epoch}"
export MOZ_SOURCE_REPO="https://github.com/openresearchtools/bashkitten"
export MOZ_SOURCE_CHANGESET="${build_commit}"
export DISABLE_TELEMETRY=1
export CCACHE_DIR="${ccache_dir}"
export SCCACHE_DIR="${sccache_dir}"
export SCCACHE_CACHE_SIZE="${SCCACHE_CACHE_SIZE:-50G}"
# Normalize source and object roots so fresh runners share cache keys.
export SCCACHE_BASEDIRS="${run_root}:${checkout_dir}:${object_dir}"

run_step() {
  local name="$1"
  local log_file="${log_dir}/${name}.log"
  shift
  echo "==> ${name}"
  if (
    cd -- "${checkout_dir}"
    "$@"
  ) 2>&1 | tee "${log_file}"; then
    echo "Completed ${name}; log: ${log_file}"
  else
    local status=$?
    echo "Failed ${name}; log: ${log_file}" >&2
    return "${status}"
  fi
}

run_step branding python3 -I -B bashkitten/scripts/render-branding.py
run_step release-version python3 -I -B bashkitten/scripts/firefox_release.py check --versions-only

if [[ "${run_bootstrap}" == true || ! -x "${state_dir}/cbindgen/cbindgen" ]]; then
  run_step bootstrap ./mach --no-interactive bootstrap \
    --application-choice browser \
    --no-system-changes
fi

# Bootstrap installs Mozilla's pinned sccache into the state directory. Write
# the configuration afterwards so a fresh runner uses it on its first build.
{
  echo "mk_add_options MOZ_OBJDIR=${object_dir}"
  echo "mk_add_options AUTOCLOBBER=1"
  echo "mk_add_options MOZ_MAKE_FLAGS=-j${jobs}"
  echo "ac_add_options --enable-application=browser"
  echo "ac_add_options --enable-optimize"
  echo "ac_add_options --disable-debug"
  echo "ac_add_options --disable-crashreporter"
  echo "ac_add_options --disable-tests"
  echo "ac_add_options --disable-debug-symbols"
  if [[ -n "${SCCACHE_PATH:-}" && -x "${SCCACHE_PATH}" ]]; then
    echo "ac_add_options --with-ccache=${SCCACHE_PATH}"
  elif [[ -x "${state_dir}/sccache/sccache" ]]; then
    echo "ac_add_options --with-ccache=${state_dir}/sccache/sccache"
  elif command -v ccache >/dev/null 2>&1; then
    echo "ac_add_options --with-ccache=$(command -v ccache)"
  fi
} >"${checkout_dir}/.mozconfig"

case "${action}" in
  configure)
    run_step configure ./mach configure
    ;;
  build)
    run_step build ./mach build
    ;;
  gkrust)
    run_step configure ./mach configure
    run_step pre-export ./mach build pre-export
    run_step export ./mach build export
    run_step gkrust ./mach build \
      toolkit/library/rust/force-cargo-library-build
    ;;
  archive)
    run_step configure ./mach configure
    run_step build ./mach build
    run_step package ./mach package
    ;;
esac

echo "Build run complete: ${run_root}"
echo "Packages, when requested, are under: ${object_dir}/dist"
echo "Shared sccache: ${sccache_dir}"
