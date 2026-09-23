# Keep Termux's Bionic fixes while installing only our private session server.
source "$TERMUX_PKG_BUILDER_DIR/upstream-build.sh"
TERMUX_PKG_LICENSE_FILE=COPYING
TERMUX_PKG_NO_STATICSPLIT=true
TERMUX_PKG_CONFFILES=''
TERMUX_PKG_BREAKS=''
TERMUX_PKG_CONFLICTS=''
TERMUX_PKG_PROVIDES=''
TERMUX_PKG_AUTO_UPDATE=false
TERMUX_PKG_EXTRA_CONFIGURE_ARGS+="
-DBUILD_TLS=OFF
-DBUILD_RDMA=OFF
-DBUILD_LUA=static
"

termux_step_pre_configure() {
  CPPFLAGS+=" -DHAVE_BACKTRACE"
  CFLAGS+=" $CPPFLAGS"
  LDFLAGS+=" -landroid-execinfo -landroid-glob -Wl,-z,max-page-size=16384"
  ( cd "$TERMUX_PKG_SRCDIR/src" && ./mkreleasehdr.sh )
}

termux_step_make() {
  cmake --build "$TERMUX_PKG_BUILDDIR" --target valkey-server -j "$TERMUX_PKG_MAKE_PROCESSES"
}

termux_step_make_install() {
  local dest="$TERMUX_PREFIX/lib/bashkitten/auth"
  install -Dm755 "$TERMUX_PKG_BUILDDIR/bin/valkey-server" "$dest/bin/valkey-server"
  python3 "$BASHKITTEN_SOURCE_ROOT/auth/build/valkey-notices.py" "$TERMUX_PKG_SRCDIR" "$dest"
}

termux_step_post_make_install() { :; }
