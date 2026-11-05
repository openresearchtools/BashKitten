#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -Eeuo pipefail
# Native server-mode configure supplies browser Makefiles. These host libraries
# satisfy its probes; no host C++ library is installed in the web UI payload.
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  build-essential autoconf automake libtool pkg-config m4 rsync \
  libpoco-dev libcap-dev libpam0g-dev libssl-dev libpng-dev libzstd-dev \
  zlib1g-dev python3-lxml python3-polib
sudo apt-get clean
