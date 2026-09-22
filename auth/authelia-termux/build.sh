TERMUX_PKG_HOMEPAGE=https://www.authelia.com/
TERMUX_PKG_DESCRIPTION="BashKitten private native Authelia authentication server"
TERMUX_PKG_LICENSE="Apache-2.0"
TERMUX_PKG_MAINTAINER="OpenResearchTools"
TERMUX_PKG_VERSION=4.39.28
TERMUX_PKG_DEPENDS="ca-certificates"
TERMUX_PKG_BUILD_IN_SRC=true
TERMUX_PKG_AUTO_UPDATE=false

termux_step_make() {
	termux_setup_golang
	export GOOS=android GOARCH=arm64 CGO_ENABLED=1 GOTELEMETRY=off GOTOOLCHAIN=local
	export CGO_CFLAGS="$CFLAGS" CGO_CPPFLAGS="$CPPFLAGS"
	export CGO_LDFLAGS="$LDFLAGS -Wl,-z,max-page-size=16384"
	local output="$TERMUX_PKG_BUILDDIR/authelia"
	bash "$BASHKITTEN_SOURCE_ROOT/auth/build/authelia-go.sh" "$TERMUX_PKG_SRCDIR" "$output"
	$CC $CPPFLAGS $CFLAGS -std=c11 -Wall -Wextra -Werror -O2 \
		"$BASHKITTEN_SOURCE_ROOT/agent/src/server/access/runtime-guard.c" \
		$LDFLAGS -Wl,-z,max-page-size=16384 -o "$TERMUX_PKG_BUILDDIR/runtime-guard"
}

termux_step_make_install() {
	local payload="$TERMUX_PREFIX/lib/bashkitten/auth"
	install -Dm755 "$TERMUX_PKG_BUILDDIR/authelia" "$payload/bin/authelia"
	install -Dm755 "$TERMUX_PKG_BUILDDIR/runtime-guard" "$payload/bin/runtime-guard"
	python3 "$BASHKITTEN_SOURCE_ROOT/auth/build/go-notices.py" "$TERMUX_PKG_SRCDIR" "$payload" authelia
	cp -a "$TERMUX_PKG_SRCDIR/.bashkitten-frontend/share" "$payload/"
}
