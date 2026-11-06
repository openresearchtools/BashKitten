TERMUX_PKG_HOMEPAGE=https://github.com/cloudflare/cloudflared
TERMUX_PKG_DESCRIPTION="Taskarian private Cloudflare Quick Tunnel connector"
TERMUX_PKG_LICENSE="Apache-2.0"
TERMUX_PKG_LICENSE_FILE=LICENSE
TERMUX_PKG_MAINTAINER="openresearchtools <openresearchtools@gmail.com>"
TERMUX_PKG_VERSION=2026.10.7
TERMUX_PKG_DEPENDS="ca-certificates"
TERMUX_PKG_BUILD_IN_SRC=true
TERMUX_PKG_AUTO_UPDATE=false

termux_step_pre_configure() {
  patch --directory "$TERMUX_PKG_SRCDIR" --strip 1 --fuzz=0 --batch \
    < "$TASKARIAN_SOURCE_ROOT/auth/build/cloudflared-no-telemetry.patch"
}

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
  go build -p 2 -mod=readonly -trimpath -buildvcs=false -buildmode=pie \
    -ldflags="-s -w -X main.Version=$TERMUX_PKG_VERSION -X main.BuildType=Taskarian -linkmode=external -extldflags=-Wl,-z,max-page-size=16384" \
    -o "$TERMUX_PKG_BUILDDIR/cloudflared" ./cmd/cloudflared
}

termux_step_make_install() {
  local payload="$TERMUX_PREFIX/lib/taskarian/auth"
  install -Dm755 "$TERMUX_PKG_BUILDDIR/cloudflared" "$payload/bin/cloudflared"
  python3 "$TASKARIAN_SOURCE_ROOT/auth/build/go-notices.py" "$TERMUX_PKG_SRCDIR" "$payload" cloudflared
}
