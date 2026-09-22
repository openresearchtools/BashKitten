# BashKitten private installation of the upstream Termux Tor recipe and patches.
source "$TERMUX_PKG_BUILDER_DIR/upstream-build.sh"
TERMUX_PKG_LICENSE_FILE=LICENSE
TERMUX_PKG_NO_STATICSPLIT=true
TERMUX_PKG_CONFFILES=''
TERMUX_PKG_SERVICE_SCRIPT=()
TERMUX_PKG_EXTRA_CONFIGURE_ARGS+="
--disable-asciidoc
--disable-system-torrc
"

termux_step_pre_configure() {
  export LDFLAGS="$LDFLAGS -Wl,-z,max-page-size=16384"
  cd "$TERMUX_PKG_SRCDIR"
  ./autogen.sh
}

termux_step_make() {
  make -j "$TERMUX_PKG_MAKE_PROCESSES" src/app/tor
}

termux_step_make_install() {
  local dest="$TERMUX_PREFIX/lib/bashkitten/auth"
  install -Dm755 src/app/tor "$dest/bin/tor"
  install -Dm644 "$TERMUX_PKG_SRCDIR/src/config/geoip" "$dest/share/tor/geoip"
  install -Dm644 "$TERMUX_PKG_SRCDIR/src/config/geoip6" "$dest/share/tor/geoip6"
  python3 "$BASHKITTEN_SOURCE_ROOT/auth/build/tor-notices.py" "$TERMUX_PKG_SRCDIR" "$dest"
  install -Dm644 "$TERMUX_SCRIPTDIR/packages/libandroid-glob/LICENSE" "$dest/share/licenses/tor/libandroid-glob-LICENSE"
}

termux_step_post_make_install() { :; }
