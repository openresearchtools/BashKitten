# Executed by Termux's protected command task after its normal bootstrap installer.
set -eu
umask 077
export PI_TELEMETRY=0 PI_OFFLINE=1 GH_TELEMETRY=0 DO_NOT_TRACK=1 GH_NO_UPDATE_NOTIFIER=1 GH_NO_EXTENSION_UPDATE_NOTIFIER=1
export DEBIAN_FRONTEND=noninteractive
case "${1:-}" in *[!0-9a-f]*|'') echo 'Invalid keyring checksum'; exit 1;; esac
[ "${#1}" -eq 64 ] || exit 1
bootstrap="$HOME/.local/share/bashkitten-pi/bootstrap"
mkdir -p "$bootstrap"
exec 9>"$bootstrap/lock"
flock -n 9 || exit 0
exec >>"$bootstrap/output.log" 2>&1
state() {
  printf '{"status":"%s","phase":"%s"}\n' "$1" "$2" >"$bootstrap/status.tmp"
  mv "$bootstrap/status.tmp" "$bootstrap/status.json"
}
trap 'state failed "Setup interrupted. Retry resumes completed steps."' EXIT
apt_options=(-o DPkg::Lock::Timeout=300 -o Dpkg::Use-Pty=0 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
if [ ! -f "$bootstrap/core.done" ]; then
  available=$(df -Pk "$PREFIX" | awk 'NR==2 {print $4}')
  [ "$available" -ge 2097152 ] || { state failed 'Free at least 2 GB on internal storage before setup'; trap - EXIT; exit 1; }
  state running 'Refreshing upstream packages'
  apt-get "${apt_options[@]}" update
  state running 'Installing Node, Python, Git and GitHub CLI'
  apt-get "${apt_options[@]}" install -y nodejs-lts python git gh ripgrep fd termux-api ca-certificates curl unzip zip tar
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<19))process.exit(1)'
  touch "$bootstrap/core.done"
fi
if [ ! -f "$bootstrap/keyring-$1.done" ]; then
  state running 'Registering the BashKitten package repository'
  curl --fail --location --proto '=https' --proto-redir '=https' --retry 3 -o "$bootstrap/keyring.deb" https://github.com/openresearchtools/apt/releases/download/repo/openresearchtools-termux-keyring.deb
  printf '%s  %s\n' "$1" "$bootstrap/keyring.deb" | sha256sum -c -
  dpkg -i "$bootstrap/keyring.deb"
  touch "$bootstrap/keyring-$1.done"
fi
if [ ! -f "$bootstrap/server.done" ] || ! command -v bashkittenctl >/dev/null; then
  state running 'Installing BashKitten'
  apt-get "${apt_options[@]}" update
  apt-get "${apt_options[@]}" install -y bashkitten
  touch "$bootstrap/server.done"
fi
mkdir -p "$PREFIX/etc/profile.d"
cat >"$PREFIX/etc/profile.d/bashkitten-privacy.sh" <<'PROFILE'
# BashKitten-owned defaults. Other shell settings are preserved.
export PI_TELEMETRY=0 PI_OFFLINE=1 GH_TELEMETRY=0 DO_NOT_TRACK=1
export GH_NO_UPDATE_NOTIFIER=1 GH_NO_EXTENSION_UPDATE_NOTIFIER=1
PROFILE
state complete 'Termux environment is ready'
trap - EXIT
flock -u 9
exec bashkitten-suite-manager
