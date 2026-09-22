#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Retain the resource settings from WildBuzzard's hosted desktop build.
set -Eeuo pipefail
for path in /usr/local/lib/android /usr/share/dotnet /opt/ghc /usr/local/.ghcup \
  /opt/hostedtoolcache/CodeQL /opt/hostedtoolcache/go /opt/hostedtoolcache/PyPy \
  /opt/hostedtoolcache/Ruby /usr/local/share/boost; do
  if [[ -e "$path" ]]; then sudo rm -rf --one-file-system -- "$path"; fi
done
sudo apt-get update
sudo apt-get install -y imagemagick
sudo apt-get clean
if ! swapon --show=NAME --noheadings | grep -qx /mnt/bashkitten-build.swap; then
  sudo fallocate --length 8G /mnt/bashkitten-build.swap
  sudo chmod 0600 /mnt/bashkitten-build.swap
  sudo mkswap /mnt/bashkitten-build.swap
  sudo swapon /mnt/bashkitten-build.swap
fi
mkdir -p "$MOZBUILD_STATE_PATH"
cat > "$MOZBUILD_STATE_PATH/machrc" <<'MACHRC'
[mach_telemetry]
is_enabled = false
is_set_up = true
is_employee = false
MACHRC
df -h /
free -h
