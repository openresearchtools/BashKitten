# Native runtime component refresh — 19 October 2026

This is source and bounded component-build evidence for the 19 October release
refresh amendment. Installed acceptance remains pending for the combined
Android, Wayland and real-Xorg candidate. The original native plan and its
frozen baseline remain unchanged.

## Selected releases

| Component | Previous | Selected | Exact upstream identity |
| --- | --- | --- | --- |
| Linux Node LTS | 24.21.0 / npm 11.19.0 | 24.22.0 / npm 11.19.1 | [v24.22.0](https://github.com/nodejs/node/releases/tag/v24.22.0), peeled commit `f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93` |
| Termux Node LTS | 24.18.0-1 | 24.18.0-1 | Current official Termux package on both architectures; Linux's newer release is not an Android package |
| Termux npm | 11.20.0 | 11.21.1 | [v11.21.1](https://github.com/npm/cli/releases/tag/v11.21.1), commit `1e39046cfae5a28c06e048403199c35458133ff3` |
| Termux SQLite | 3.53.4 | 3.54.1 | [Official source archive](https://www.sqlite.org/2026/sqlite-src-3540100.zip), SHA256 `387e7f6cad4797b17848c07d453dc6606917bb356a6cfe5a3abafd38c240c71b` |
| Private Podman | 6.1.3 | 6.1.4 | [v6.1.4](https://github.com/podman-container-tools/podman/releases/tag/v6.1.4), peeled commit `464c15fec06f0074c916f9eff87c4806869c2833` |
| sudo bridge / Display libc | 0.2.189 / 0.2.190 | 0.2.191 | [0.2.191](https://github.com/rust-lang/libc/releases/tag/0.2.191), peeled commit `ccc2ff4aaab962f7fde7b8edda7379c045b1ca12` |
| Display serde_json | 1.0.153 | 1.0.154 | [v1.0.154](https://github.com/serde-rs/json/releases/tag/v1.0.154), peeled commit `20572a6d066958542d79cdd6cf1a7cd9f0c8e1f8` |

crun 1.30.1, conmon 2.2.1, netavark 2.1.0, aardvark-dns 2.1.0,
passt 2026_10_02.cba3570, libfuse 3.18.3, fuse-overlayfs 1.18 and
catatonit 0.2.1 remain the current official releases checked in this pass.
The Podman refresh retains its exact upstream Go vendor graph, including
Buildah 1.45.2 and storage 1.64.2, with complete licenses. No frozen adapted
Buzzard/Phone/X11 donor tree is replaced.

## Source and integrity evidence

- Podman was imported as a separate pristine source commit `57d8698912`.
  The exact release Git archive, complete materialized source inventory and
  all 280 license/notice paths verify. The existing private catatonit patch
  applies with `--fuzz=0`, without source edits. All nine private engine/helper
  inventories pass the existing `verify_source` function.
- Node's official `SHASUMS256.txt` agrees with the new source and both Linux
  binary pins. The full source archives remain committed under
  `agent/vendor/node`, and all nine retained archive hashes verify.
- The Termux InRelease signature verifies with the already pinned automatic
  build key `CC72CF8BA7DBFA0182877D045A897D96E57CF20C`. Both compressed
  architecture indexes match its SHA256 entries; selected package SHA256s
  match those indexes. The new InRelease digest is retained in the lock.
  The complete recipe snapshot is pinned to
  `f3b242999b604dab33639c8211c3b461aad79dc9`. npm's separate distribution and
  its vendored dependencies are now retained as an additional source archive.
- Both Rust crates match their crates.io package checksums and their published
  release commits. Full source, license texts, `.cargo_vcs_info.json` and
  per-file `.cargo-checksum.json` are retained. Cargo accepts both updated
  locks with `--locked --offline`; optional unselected serde_json dependencies
  do not add runtime dependencies to this lock.

## Bounded verification

The existing Node builder successfully assembled runtime and corresponding-source
artifacts for Linux amd64/arm64 and Termux x86_64/aarch64. Its SHA256, native ELF
architecture, Android recursive shared-library closure, npm identity and full
dependency-notice checks all passed. Linux artifacts contain 145 notice entries;
Termux artifacts contain 152. Native amd64 Node reports `v24.22.0`, module ABI
137 and its private `process.execPath`; a child invocation uses that executable.
The bundled npm wrapper reports `11.19.1`.

Podman and rootlessport compile offline from the new release and the retained
private-helper patch with the production feature tags and explicit private paths.
The bounded local compile used Go 1.26.3, four jobs on CPUs 0–7. The resulting
Podman reports version 6.1.4. This is independent of the combined CI update to
Go 1.27.2 and does not replace native amd64/arm64 release builds.

The sudo bridge's five existing unit tests pass with libc 0.2.191. The existing
Display builder applies its named donor patches, builds offline and generates
notices/provenance successfully. Its seven existing unit tests pass with the
updated libc and serde_json. These Rust checks used the existing Rust 1.96.0
toolchain; compiler dead-code warnings remain.

Scratch downloads, component outputs and compile logs are under
`/home/user/Bashkitten-Acceptance/component-refresh-20261019/native`.
The signed-index files and exact output identities remain there for the
combined acceptance coordinator. These checks did not run installed Android
Node/npm, start containers, exercise rootless lifetime cleanup, inject Display
input, or establish absence of reporting traffic. Those flows and artifact/
traffic reconciliation remain part of the combined installed acceptance.
