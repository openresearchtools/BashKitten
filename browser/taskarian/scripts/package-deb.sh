#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Final packaging includes the shared Agent, auth and search artifacts.
set -Eeuo pipefail
root="$(git -C "$(dirname -- "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
exec python3 "$root/agent/packaging/build.py" linux "$@"
