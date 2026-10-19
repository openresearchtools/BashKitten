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

## Additional owned Display dependency checks

The complete registry dependency audit subsequently found compatible updates in
BashKitten's own Display lock: cc 1.8.0 → 1.9.0, find-msvc-tools 0.1.14 →
0.1.15, syn 3.0.7 → 3.0.9, and unicode-ident 1.0.26 → 1.0.27. These are now
materialized with registry SHA256s, crate release-commit metadata and complete
notices. The final offline Display build and seven unit tests pass again.

generic-array 0.14.9 is available, but crypto-common 0.1.7 requires exactly
`generic-array = "=0.14.7"`. Attempting 0.14.9 produced a concrete offline Cargo
resolution error, so 0.14.7 remains pinned. The upstream requirement was not
relaxed. Imported Podman/Firefox release vendor graphs retain their respective
upstream-tested dependency selections; this additional refresh applies to
BashKitten's own helper lock.

## Embedded Android X11 dependency refresh

The frozen Termux:X11 import still contains its original dependency gitlinks.
Dedicated pristine replacement releases were imported separately in `098133e3f4`:

| Dependency | Previous | Selected release commit | Official source archive SHA256 |
| --- | --- | --- | --- |
| libtirpc | 1.2.6 | 1.3.8, `b2a58e4ac15dd5f45952210ef466e9fd88dda553` | `8839959bfcc7a0f4c609d8e4f53f1c67ae33de23775ec35beb39ff15adf11920` |
| libX11 | 1.8.13 | 1.8.14, `b8d5a7046a98a244ee8ca3c9c07fd617c800dde2` | `bbc78c46217174655c2b32b138ad119f3ac15f50808b4d0b3a2677a4b1afc950` |
| Xorg server | 21.1.24 | 21.1.25, `edc1b378f804ef5bf286318057e0b935f91f22b7` | `6ad4e3c7b59a309b32c92e5c15ce1267110f9e13f1ac78da62361a628da1a0eb` |

Primary release sources are the maintainer's
[libtirpc 1.3.8 publication](https://sourceforge.net/projects/libtirpc/files/libtirpc/1.3.8/),
[libX11 1.8.14 archive](https://www.x.org/releases/individual/lib/libX11-1.8.14.tar.xz)
and [Xorg server 21.1.25 archive](https://www.x.org/releases/individual/xserver/xorg-server-21.1.25.tar.xz).
The libtirpc release tag was resolved directly from the advertised maintainer
repository `git://linux-nfs.org/~steved/libtirpc`; Xorg pins were peeled from the
official Freedesktop repositories. Each new source tree has a complete inventory
and full license paths. libtirpc's upstream `INSTALL` absolute symlink is retained
as link text; it is not followed during preparation or used during compilation.

`prepare.py` explicitly selects the new releases in build output, validates every
source checksum and rejects missing or extra files. Negative checks confirmed
rejection of changed source, an unrecorded source file and a missing license.
Gradle tracks the dependency directory as an input. About uses the same verified
selection and emits full copyright/license preambles for the actual dependencies.
The pristine original donor metadata and source remain unchanged.

The initial compile exposed duplicate `quad_t`/`u_quad_t` declarations in the old
Android recipe and generated Xorg config. The named adaptation removes those
obsolete declarations because libtirpc 1.3.8 now supplies them itself. It also
replaces the donor's development `VENDOR_RELEASE` value with `12101025`.
The existing libX11 and Xorg patches apply with zero fuzz; one Xorg hunk moves
by 13 lines. No authentication or transport behavior is substituted.

The complete `Xlorie` target successfully configures and links for x86_64 and
arm64-v8a using the existing NDK r29, Android API 31, static C++ runtime and
flexible-page-size setting, four build jobs on CPUs 0–7. Both resulting ELF files
have 16 KiB load-segment alignment and use Android system shared libraries.
Existing upstream compiler warnings remain. Component outputs:

- x86_64 `libXlorie.so`: `d9effb90dfae86de1de2b56467803c7be83c52267e067802736e3376a7bc05e4`
- arm64-v8a `libXlorie.so`: `863c34ad0cbb5d7db11b90b89371da2bdf77a92a8626211b8b849ec52a4301a4`

Logs and outputs remain in the same scratch directory under `embedded-*`.
Native builds and notice collection are not APK packaging, installed Display
acceptance or physical-device GPU evidence. Rebuild the combined candidate and
repeat the required installed flows, including standalone Termux:X11 coexistence.
