#!/usr/bin/env bash
# Source from a build shell; no Go resolver fallback or external telemetry.
# SPDX-License-Identifier: AGPL-3.0-only
bashkitten_source_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
GOPROXY=$(python3 "$bashkitten_source_root/auth/build/retained-sources.py" go)
export GOPROXY GOSUMDB=off GONOPROXY=none GOTOOLCHAIN=local GOTELEMETRY=off
unset bashkitten_source_root
