#!/usr/bin/env bash
# Build pattern adapted from Torkitten, Copyright 2026 The Torkitten Authors.
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
source_dir=$(realpath "${1:?source directory required}")
output=$(realpath -m "${2:?output executable required}")
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
commit=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["authelia"]["commit"])' "$root/auth/upstreams.lock.json")
version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["authelia"]["version"])' "$root/auth/upstreams.lock.json")
cd "$source_dir"
test -s internal/server/public_html/index.html
test -d internal/server/public_html/static
mkdir -p "$(dirname "$output")"
export GOTELEMETRY=off GOTOOLCHAIN=local
go build -p "${BASHKITTEN_BUILD_JOBS:-2}" -buildmode=pie -buildvcs=false -mod=readonly -trimpath \
  -ldflags="-linkmode=external -s -w -X github.com/authelia/authelia/v4/internal/utils.BuildTag=v$version -X github.com/authelia/authelia/v4/internal/utils.BuildCommit=$commit -X github.com/authelia/authelia/v4/internal/utils.BuildBranch=release -X 'github.com/authelia/authelia/v4/internal/utils.BuildState=tagged clean' -X github.com/authelia/authelia/v4/internal/utils.BuildExtra=bashkitten" \
  -o "$output" ./cmd/authelia
