# SPDX-License-Identifier: AGPL-3.0-only
# Overlay recipe for the repository's pinned native Termux build framework.
TERMUX_PKG_HOMEPAGE=https://github.com/openresearchtools/BashKitten
TERMUX_PKG_DESCRIPTION="Shared BashKitten OS native XFCE desktop customization"
TERMUX_PKG_LICENSE="AGPL-V3, GPL-2.0, GPL-3.0, LGPL-2.1, LGPL-3.0, MIT"
TERMUX_PKG_LICENSE_FILE="repo/os/licenses/AGPL-3.0.txt, repo/os/licenses/GPL-2.0.txt, repo/os/licenses/GPL-3.0.txt, repo/os/licenses/LGPL-2.1.txt, repo/os/licenses/LGPL-3.0.txt, repo/os/licenses/PeGPU-MIT.txt"
TERMUX_PKG_MAINTAINER="openresearchtools <openresearchtools@gmail.com>"
: "${BASHKITTEN_SOURCE_ROOT:?Supply the checked-out BashKitten source root}"
TERMUX_PKG_VERSION="$(cat "$BASHKITTEN_SOURCE_ROOT/browser/bashkitten/config/version.txt")"
TERMUX_PKG_REVISION=1
TERMUX_PKG_SKIP_SRC_EXTRACT=true
TERMUX_PKG_NO_REPLACE_GUESS_SCRIPTS=true
TERMUX_PKG_AUTO_UPDATE=false
TERMUX_PKG_DEPENDS="python, pygobject, gtk3, librsvg, libwnck, xfconf, xfwm4, xfce4-session, xfdesktop, thunar, xfce4-terminal, xdotool, scrot, at-spi2-core, xorg-xrandr, xorg-xrdb, xorg-xprop, xdg-desktop-portal, libdisplay-info, libxfce4ui, libxfce4util, garcon, exo, desktop-file-utils"
TERMUX_PKG_BUILD_DEPENDS="xfce4-dev-tools"
TERMUX_PKG_PROVIDES="xfce4-panel (= 4.20.8)"
TERMUX_PKG_CONFLICTS="xfce4-panel"
TERMUX_PKG_REPLACES="xfce4-panel"

termux_step_get_source() {
    : "${BASHKITTEN_SOURCE_ROOT:?CI must supply its checked-out BashKitten source root}"
    test -f "$BASHKITTEN_SOURCE_ROOT/os/upstream/sources.json" || termux_error_exit "Missing committed OS source"
    mkdir -p "$TERMUX_PKG_SRCDIR/repo/os" "$TERMUX_PKG_SRCDIR/repo/agent/packaging" "$TERMUX_PKG_SRCDIR/repo/browser/bashkitten/browser/branding/assets"
    cp -a "$BASHKITTEN_SOURCE_ROOT/os/." "$TERMUX_PKG_SRCDIR/repo/os/"
    cp "$BASHKITTEN_SOURCE_ROOT/agent/packaging/build.py" "$TERMUX_PKG_SRCDIR/repo/agent/packaging/"
    cp "$BASHKITTEN_SOURCE_ROOT/browser/bashkitten/browser/branding/assets/bashkitten-logo-glasses-original.png" "$TERMUX_PKG_SRCDIR/repo/browser/bashkitten/browser/branding/assets/"
    for size in 48 64 128 256; do
        cp "$BASHKITTEN_SOURCE_ROOT/browser/bashkitten/browser/branding/default${size}.png" "$TERMUX_PKG_SRCDIR/repo/browser/bashkitten/browser/branding/"
    done
}
termux_step_configure() {
    export LDFLAGS="${LDFLAGS:-} -Wl,-z,max-page-size=16384 -lm"
    termux_setup_glib_cross_pkg_config_wrapper
    termux_setup_meson
    export BASHKITTEN_MESON="$TERMUX_MESON"
    # Source paths refer only to this CI checkout, never a workstation runtime.
    export BASHKITTEN_OS_SOURCE_COMMIT="$(git -C "$BASHKITTEN_SOURCE_ROOT" rev-parse HEAD)"
}
termux_step_make() {
    python3 "$TERMUX_PKG_SRCDIR/repo/os/packaging/build.py" --target termux --architecture "$TERMUX_ARCH" \
        --version "$TERMUX_PKG_VERSION-$TERMUX_PKG_REVISION" --build-dir "$TERMUX_PKG_BUILDDIR/component" \
        --output "$TERMUX_PKG_TMPDIR/artifacts" --cross-file "$TERMUX_MESON_CROSSFILE" \
        --autotools-host "$TERMUX_HOST_PLATFORM" --source-commit "$BASHKITTEN_OS_SOURCE_COMMIT" --jobs "$TERMUX_PKG_MAKE_PROCESSES" --stage-only
}
termux_step_make_install() {
    cp -a "$TERMUX_PKG_BUILDDIR/component/stage$TERMUX_PREFIX/." "$TERMUX_PREFIX/"
}
termux_step_create_debscripts() {
    cat > postinst <<EOF
#!$TERMUX_PREFIX/bin/sh
set -e
$TERMUX_PREFIX/bin/glib-compile-schemas $TERMUX_PREFIX/share/glib-2.0/schemas
$TERMUX_PREFIX/bin/update-desktop-database $TERMUX_PREFIX/share/applications
EOF
}
