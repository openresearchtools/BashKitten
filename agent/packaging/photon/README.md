# Source-built Photon for Pi

The selected Pi npm graph contains `@silvia-odwyer/photon-node` 0.3.4. Its
published `gitHead` is `685f5b155b36c5611c08ca678bb78ddbab3edbac`; that exact
upstream source calls the Rust crate `photon-rs` 0.3.3. These are distinct
upstream version labels, preserved without relabelling either release.

The npm package contains prebuilt WASM, but the exact Git tree has no Cargo.lock.
Binary panic paths expose some historical dependency versions, not a complete
build closure. BashKitten therefore replaces that opaque binary and its generated
Node glue with a build of the same pristine source using the committed
`Cargo.lock`. This is a marked BashKitten source build, not a claim to reproduce
the historical npm binary. The npm dependency graph and package version stay
unchanged. Native Cargo and the matching wasm-bindgen CLI generate the code;
there is no replacement image-processing implementation.

`lock.json` selects the exact source archive, every registry crate in both native
Cargo locks, the matching wasm-bindgen CLI archive and its upstream lock checksum.
All these exact HTTPS URLs and SHA256 checksums also occur in the existing
`agent/licenses/source-archives.json` owner. The normal corresponding-source
artifact includes their original archives. Downloaded bytes remain outside Git
in `BASHKITTEN_SOURCE_CACHE`. Cargo's native directory-source checksums are
materialized from verified originals; both builds use `--frozen --offline`.

The existing `agent/machines/rust-toolchain/sources.json` owns Rust 1.96.0 source,
standard-library/compiler-runtime notices and exact compiler identity. The
existing native legal helper checks and copies its full `COPYRIGHT-library.html`
and license/exception texts. Provision that exact toolchain, its `rust-docs`
component and `wasm32-unknown-unknown` target; do not create another toolchain pin.

The existing package and Android companion-notice assemblers call this recipe
after their ordinary npm installation. It verifies the actual installed public
exports and class methods, then compares PNG/JPEG encode, PNG decode and Lanczos
resize results against the selected original package using a synthetic image.
Generated code replaces only this package's main glue/WASM; the obsolete generated
`photon_rs_bg.js` is removed. The installed `BASHKITTEN-SOURCE.json` marks the
modification and records exact input identities, compiler/lock/recipe hashes,
selected native packages, validation and generated-file checksums. The matching
locks accompany it. Full original per-crate notices and Rust runtime notices in
`BASHKITTEN-NOTICES.txt` flow through the existing npm offline legal collector.

Run it against an already installed package tree:

```sh
export BASHKITTEN_SOURCE_CACHE=/absolute/path/to/verified-source-cache
export BASHKITTEN_PHOTON_BUILD_CACHE=/absolute/path/to/build-cache
export BASHKITTEN_OFFLINE_SOURCES=1
python3 agent/packaging/photon/build.py /absolute/path/to/application
```

The work cache remains outside the checkout and keys builds by the exact locks,
recipe, existing Rust source/notice owner, host and compiler identity. Cached
outputs are checked against their recorded SHA256 hashes. Each assembly still
checks the actual installed original package's API and image behavior. Ordinary
GitHub Actions caches retain these inputs/results; no service, registry, extra
release or separate build repository is involved.
