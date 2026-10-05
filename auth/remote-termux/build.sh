TERMUX_PKG_HOMEPAGE=https://github.com/openresearchtools/BashKitten
TERMUX_PKG_DESCRIPTION="BashKitten private native remote host adapter"
TERMUX_PKG_LICENSE="AGPL-3.0, Apache-2.0, MIT"
TERMUX_PKG_LICENSE_FILE="LICENSE, TORKITTEN-LICENSE"
TERMUX_PKG_MAINTAINER="OpenResearchTools"
TERMUX_PKG_VERSION=1
TERMUX_PKG_BUILD_IN_SRC=true
TERMUX_PKG_AUTO_UPDATE=false

termux_step_make() {
  termux_setup_golang
  export GOOS=android GOARCH=arm64 CGO_ENABLED=1 GOTOOLCHAIN=local GOTELEMETRY=off
  export CGO_CFLAGS="$CFLAGS" CGO_CPPFLAGS="$CPPFLAGS"
  export CGO_LDFLAGS="$LDFLAGS -Wl,-z,max-page-size=16384"
  cd "$TERMUX_PKG_SRCDIR"
  # Only the staged integration module changes: dependencies resolve to the
  # read-only, checked-in pristine upstream source in the existing builder mount.
  go mod edit \
    -replace github.com/jpillora/chisel="$BASHKITTEN_SOURCE_ROOT/auth/chisel" \
    -replace filippo.io/age="$BASHKITTEN_SOURCE_ROOT/auth/age" \
    -replace github.com/boombuler/barcode="$BASHKITTEN_SOURCE_ROOT/auth/barcode" \
    -replace github.com/makiuchi-d/gozxing="$BASHKITTEN_SOURCE_ROOT/auth/gozxing"
  go build -p 2 -mod=readonly -trimpath -buildvcs=false -buildmode=pie \
    -ldflags='-s -w -linkmode=external -extldflags=-Wl,-z,max-page-size=16384' \
    -o "$TERMUX_PKG_BUILDDIR/bashkitten-remote" ./cmd/bashkitten-remote
}

termux_step_make_install() {
  local payload="$TERMUX_PREFIX/lib/bashkitten/auth"
  install -Dm755 "$TERMUX_PKG_BUILDDIR/bashkitten-remote" "$payload/bin/bashkitten-remote"
  python3 "$BASHKITTEN_SOURCE_ROOT/auth/build/go-notices.py" "$TERMUX_PKG_SRCDIR" "$payload" remote
}
