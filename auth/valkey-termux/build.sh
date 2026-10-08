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
-DCMAKE_EXPORT_COMPILE_COMMANDS=ON
"

termux_step_pre_configure() {
  CPPFLAGS+=" -DHAVE_BACKTRACE"
  # Bionic rejects the x86 TSC probe's non-POSIX \s regex at startup.
  # Select Valkey's documented OS monotonic clock; keep upstream source intact.
  if [[ "$TERMUX_ARCH" == x86_64 ]]; then CPPFLAGS+=" -DNO_PROCESSOR_CLOCK"; fi
  CFLAGS+=" $CPPFLAGS"
  LDFLAGS+=" -landroid-execinfo -landroid-glob -Wl,-z,max-page-size=16384"
  ( cd "$TERMUX_PKG_SRCDIR/src" && ./mkreleasehdr.sh )
}

termux_step_make() {
  cmake --build "$TERMUX_PKG_BUILDDIR" --target valkey-server -j "$TERMUX_PKG_MAKE_PROCESSES"
  if [[ "$TERMUX_ARCH" == x86_64 ]]; then
    python3 - "$TERMUX_PKG_BUILDDIR/compile_commands.json" <<'PY'
import json, shlex, sys
commands = [item for item in json.load(open(sys.argv[1])) if item['file'].endswith('/monotonic.c')]
assert commands, 'Missing actual monotonic.c compile command'
assert all('-DNO_PROCESSOR_CLOCK' in item.get('arguments', shlex.split(item.get('command', ''))) for item in commands), 'Missing required Bionic clock build option'
print('Verified monotonic.c compiles with the upstream NO_PROCESSOR_CLOCK option')
PY
  fi
}

termux_step_make_install() {
  local dest="$TERMUX_PREFIX/lib/bashkitten/auth"
  install -Dm755 "$TERMUX_PKG_BUILDDIR/bin/valkey-server" "$dest/bin/valkey-server"
  python3 "$BASHKITTEN_SOURCE_ROOT/auth/build/valkey-notices.py" "$TERMUX_PKG_SRCDIR" "$dest"
}

termux_step_post_make_install() { :; }
