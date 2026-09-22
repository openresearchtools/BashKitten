# SPDX-License-Identifier: GPL-3.0-only
# BashKitten recipe; build framework pinned in search/runtime-lock.json.
TERMUX_PKG_HOMEPAGE=https://github.com/deedy5/primp
TERMUX_PKG_DESCRIPTION="BashKitten private native DDGS HTTP client"
TERMUX_PKG_LICENSE="MIT, Apache-2.0, ISC"
TERMUX_PKG_LICENSE_FILE="crates/primp/LICENSE-MIT, crates/primp-reqwest/LICENSE-APACHE, crates/primp-rustls/rustls/LICENSE-ISC"
TERMUX_PKG_MAINTAINER="OpenResearchTools"
TERMUX_PKG_VERSION=1.3.1
TERMUX_PKG_SRCURL=https://files.pythonhosted.org/packages/cc/4b/7efa54f38da7de8df6b70dfed173bb41a52b740b144e4be24c1172db4209/primp-1.3.1.tar.gz
TERMUX_PKG_SHA256=b04a5941bf9c876d011c5defaf5a25be093d56e7270b8da52c9788b9df2a829a
TERMUX_PKG_DEPENDS="python, openssl"
TERMUX_PKG_BUILD_IN_SRC=true
TERMUX_PKG_AUTO_UPDATE=false

termux_step_pre_configure() {
	termux_setup_rust
	export CARGO_BUILD_TARGET="$CARGO_TARGET_NAME"
	export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$CC"
	export OPENSSL_NO_VENDOR=1
	export OPENSSL_DIR="$TERMUX_PREFIX"
	# Android loads Python extensions with RTLD_LOCAL. Link libpython explicitly,
	# matching the upstream Termux python-cryptography recipe's requirement.
	cat > "$TERMUX_PKG_TMPDIR/pyo3.txt" <<-EOF
	implementation=CPython
	version=$TERMUX_PYTHON_VERSION
	shared=true
	abi3=true
	lib_name=python$TERMUX_PYTHON_VERSION
	lib_dir=$TERMUX_PREFIX/lib
	pointer_width=64
	EOF
	export PYO3_CONFIG_FILE="$TERMUX_PKG_TMPDIR/pyo3.txt"
	export RUSTFLAGS="${RUSTFLAGS:-} -C link-arg=-Wl,-z,max-page-size=16384 -C link-arg=-Wl,-z,common-page-size=4096"
}

termux_step_configure() { :; }

termux_step_make() {
	cargo build --locked --release --target "$CARGO_TARGET_NAME" -p primp-python
}

termux_step_make_install() {
	local destination="$TERMUX_PREFIX/lib/bashkitten/search/runtime/site-packages"
	install -Dm755 "target/$CARGO_TARGET_NAME/release/libprimp.so" "$destination/primp.abi3.so"
	patchelf --add-needed "libpython$TERMUX_PYTHON_VERSION.so" "$destination/primp.abi3.so"
}
