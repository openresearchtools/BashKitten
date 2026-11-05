TERMUX_PKG_HOMEPAGE=https://github.com/openresearchtools/Taskarian
TERMUX_PKG_DESCRIPTION="Taskarian private native remote host adapter"
TERMUX_PKG_LICENSE="AGPL-3.0, Apache-2.0, MIT"
TERMUX_PKG_LICENSE_FILE="LICENSE, TORKITTEN-LICENSE"
TERMUX_PKG_MAINTAINER="openresearchtools <openresearchtools@gmail.com>"
TERMUX_PKG_VERSION=1
TERMUX_PKG_BUILD_IN_SRC=true
TERMUX_PKG_AUTO_UPDATE=false

termux_step_make() {
  termux_setup_golang
  source "$TASKARIAN_SOURCE_ROOT/auth/build/go-env.sh"
  case "$TERMUX_ARCH" in
    aarch64) export GOARCH=arm64 ;;
    x86_64) export GOARCH=amd64 ;;
    *) echo "Unsupported Termux architecture: $TERMUX_ARCH" >&2; exit 2 ;;
  esac
  export GOOS=android CGO_ENABLED=1 GOTOOLCHAIN=local GOTELEMETRY=off
  export CGO_CFLAGS="$CFLAGS" CGO_CPPFLAGS="$CPPFLAGS"
  export CGO_LDFLAGS="$LDFLAGS -Wl,-z,max-page-size=16384"
  cd "$TERMUX_PKG_SRCDIR"
  # Only the staged integration module changes: dependencies resolve to the
  # read-only, checked-in pristine upstream source in the existing builder mount.
  go mod edit \
    -replace github.com/jpillora/chisel="$TASKARIAN_SOURCE_ROOT/auth/chisel" \
    -replace filippo.io/age="$TASKARIAN_SOURCE_ROOT/auth/age" \
    -replace github.com/boombuler/barcode="$TASKARIAN_SOURCE_ROOT/auth/barcode" \
    -replace github.com/makiuchi-d/gozxing="$TASKARIAN_SOURCE_ROOT/auth/gozxing"
  go build -p 2 -mod=readonly -trimpath -buildvcs=false -buildmode=pie \
    -ldflags='-s -w -linkmode=external -extldflags=-Wl,-z,max-page-size=16384' \
    -o "$TERMUX_PKG_BUILDDIR/taskarian-remote" ./cmd/taskarian-remote
}

termux_step_make_install() {
  local payload="$TERMUX_PREFIX/lib/taskarian/auth"
  install -Dm755 "$TERMUX_PKG_BUILDDIR/taskarian-remote" "$payload/bin/taskarian-remote"
  python3 "$TASKARIAN_SOURCE_ROOT/auth/build/go-notices.py" "$TERMUX_PKG_SRCDIR" "$payload" remote
}
