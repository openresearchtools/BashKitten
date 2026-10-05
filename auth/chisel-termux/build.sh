TERMUX_PKG_HOMEPAGE=https://github.com/jpillora/chisel
TERMUX_PKG_DESCRIPTION="BashKitten private native Chisel tunnel transport"
TERMUX_PKG_LICENSE="MIT"
TERMUX_PKG_LICENSE_FILE=LICENSE
TERMUX_PKG_MAINTAINER="OpenResearchTools"
TERMUX_PKG_VERSION=1.12.0
TERMUX_PKG_DEPENDS="ca-certificates"
TERMUX_PKG_BUILD_IN_SRC=true
TERMUX_PKG_AUTO_UPDATE=false

termux_step_make() {
  termux_setup_golang
  export GOOS=android GOARCH=arm64 CGO_ENABLED=1 GOTOOLCHAIN=local GOTELEMETRY=off
  export CGO_CFLAGS="$CFLAGS" CGO_CPPFLAGS="$CPPFLAGS"
  export CGO_LDFLAGS="$LDFLAGS -Wl,-z,max-page-size=16384"
  cd "$TERMUX_PKG_SRCDIR"
  go build -p 2 -mod=readonly -trimpath -buildvcs=false -buildmode=pie \
    -ldflags="-s -w -X github.com/jpillora/chisel/share.BuildVersion=$TERMUX_PKG_VERSION -linkmode=external -extldflags=-Wl,-z,max-page-size=16384" \
    -o "$TERMUX_PKG_BUILDDIR/chisel" .
}

termux_step_make_install() {
  local payload="$TERMUX_PREFIX/lib/bashkitten/auth"
  install -Dm755 "$TERMUX_PKG_BUILDDIR/chisel" "$payload/bin/chisel"
  python3 "$BASHKITTEN_SOURCE_ROOT/auth/build/go-notices.py" "$TERMUX_PKG_SRCDIR" "$payload" chisel
}
