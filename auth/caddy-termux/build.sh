# BashKitten private installation of the upstream Termux Caddy recipe.
source "$TERMUX_PKG_BUILDER_DIR/upstream-build.sh"
TERMUX_PKG_NO_STATICSPLIT=true
TERMUX_PKG_LICENSE_FILE=LICENSE
TERMUX_PKG_DEPENDS='ca-certificates'

termux_step_make() {
  termux_setup_golang
  export GOOS=android GOARCH=arm64 CGO_ENABLED=1 GOTOOLCHAIN=local GOTELEMETRY=off
  export CGO_LDFLAGS="$CGO_LDFLAGS -Wl,-z,max-page-size=16384"
  cd "$TERMUX_PKG_SRCDIR"
  go build -mod=readonly -trimpath -buildvcs=false -buildmode=pie \
    -ldflags="-s -w -X github.com/caddyserver/caddy/v2.CustomVersion=v$TERMUX_PKG_VERSION -linkmode=external -extldflags=-Wl,-z,max-page-size=16384" \
    -o "$TERMUX_PKG_BUILDDIR/caddy" ./cmd/caddy
}

termux_step_make_install() {
  local payload="$TERMUX_PREFIX/lib/bashkitten/auth"
  install -Dm755 "$TERMUX_PKG_BUILDDIR/caddy" "$payload/bin/caddy"
  python3 "$BASHKITTEN_SOURCE_ROOT/auth/build/go-notices.py" "$TERMUX_PKG_SRCDIR" "$payload" caddy
}
