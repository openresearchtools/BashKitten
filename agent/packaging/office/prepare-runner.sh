#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -Eeuo pipefail
# Reuse the desktop builder's hosted-runner space policy. Local environments
# retain all installed tools and caches.
if [[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted ]]; then
  for path in /usr/local/lib/android /usr/share/dotnet /opt/ghc /usr/local/.ghcup \
    /opt/hostedtoolcache/CodeQL /opt/hostedtoolcache/PyPy \
    /opt/hostedtoolcache/Ruby /usr/local/share/boost; do
    if [[ -e "$path" ]]; then sudo rm -rf --one-file-system -- "$path"; fi
  done
fi
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  build-essential autoconf automake libtool clang lld llvm cmake ninja-build meson \
  ccache ca-certificates curl git python3 python3-dev python3-venv pkg-config \
  m4 nasm unzip zip zstd xz-utils bzip2 file patch perl bison flex gperf \
  libxml2-dev libxml2-utils xsltproc libxslt1-dev libcap-dev libpam0g-dev \
  libpng-dev libssl-dev libzstd-dev libkrb5-dev libcups2-dev libx11-dev \
  libxrandr-dev libxinerama-dev libxcb-xfixes0-dev libxrender-dev libffi-dev \
  fontconfig libfontconfig1-dev libfreetype-dev libcurl4-openssl-dev \
  libasound2-dev libdbus-1-dev libgl-dev libglu1-mesa-dev libxext-dev \
  ant openjdk-17-jdk-headless uuid-runtime cpio python3-lxml python3-polib
sudo apt-get clean
df -h /
free -h
