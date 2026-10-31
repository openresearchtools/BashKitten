# Native Bionic Office build

The build entry point is `agent/packaging/office/termux.py`. It uses the existing
NDK 30 pin and libc++ corresponding-source inventory from the Node/Termux
packaging owner, the released Collabora headless server/engine build, and the
materialized dependency graph owned by `agent/packaging/office/source_graph.py`.
The shared `agent/packaging/termux/native_toolchain.py` validates that existing
NDK pin and corresponding-source inventory for native component builders.
The build host may be the existing Linux build container; the resulting runtime
is native Bionic and does not need a container on Android.

Run in the existing prepared Linux x86_64 build environment with Node 24:

```sh
python3 -B agent/packaging/office/termux.py \
  --architecture aarch64 \
  --work /external/office-aarch64 \
  --cache /external/office-tarballs \
  --ndk /external/android-ndk-r30 \
  --ndk-archive /external/android-ndk-r30-linux.zip \
  --output /external/office-output --jobs 2
```

Use `x86_64` for the other supported architecture. `--phase` supports independent
prepare, configure, engine, online and package iterations. Source/patch changes
require a fresh work directory; compiler outputs are never silently adopted
across input changes. Work, cache, NDK and output locations must be outside Git.
The optional archive argument validates the original toolchain archive against
the existing pin; without it, the receipt records that archive verification
was not performed and records the actual compiler digest. Release collection
must require the verified archive receipt.
`--stage-dir` selects an external package stage, using the same option as the
Linux builder; it defaults to `WORK/stage` and must not overlap either source
tree. This allows packaging on a separate disk without moving compiler outputs.

The shared host setup includes Meson. When available, ccache wraps the pinned
NDK compiler commands; provenance still hashes the compiler itself. Ordinary CI
caches are separate for each target. Native setup metadata is regenerated before
packaging and its build ID must match the immutable Collabora revision. The
manifest's `depends` and `systemPackages` describe the same required Termux
packages; native ELF dependency validation remains a separate check.

The native libcap dependency is built from the separately retained and hashed
2.78 source archive using its own library target and the selected Termux recipe's
configuration. Its original full license and source receipt enter the runtime
inventory. Online's normal capability detection remains required; no missing
header is treated as permission to remove capability checks.

GNU libiconv 1.19 uses the same pinned Termux framework's unpatched source and
`--enable-extra-encodings` recipe. Online's released WOPI filename converter
requires UTF-7 for Rename/SaveAs; Bionic's own iconv does not provide it. The
native builder supplies the GNU header and library to Online's existing gbuild
entry point, verifies its actual dynamic dependency and converter symbol, and
bundles `libiconv.so` in the existing private library directory. It builds only
the LGPL library; the original corresponding-source archive also retains the
GPL command-line sources. Both complete license texts and per-component license
identities are checksum-verified and included in the runtime/source notices.

Libetonyek and the eight affected import libraries (liborcus, librevenge,
libmwaw, libwpd, libwps, libwpg, libstaroffice and libodfgen) use explicit
compiler-builtins link inputs. Their bundled libtool otherwise omits Android
runtime helpers from shared-library links, allowing builds to finish but failing
when the native kit loads them. The compiler chooses its own builtins archive;
the existing NDK source owner retains the matching compiler-rt source and full
license. Patch 0019 passes that archive through each filter's native `LIBS`
configuration, preserving its other link inputs. Packaging rejects undefined
`__aarch64_*` runtime helpers in every native ELF, not merely missing `DT_NEEDED`
filenames. No runtime preload, replacement atomic implementation or isolation
change is used.

The bundled fontconfig uses its own matching configuration files, already
installed by the native `fontconfig_data` target. Its Bionic configure flags
select Android's `/system/fonts` and Termux's shared fonts and cache paths.
This avoids loading a newer installed Termux fontconfig's incompatible rules
into the pinned engine library; Office still registers its bundled fonts.

The output root is `runtime/`, with native files, upstream SBOMs, full notices,
resolved ELF dependencies and `manifest.json`. The existing environment owner
supplies the fixed Termux prefix and bundled `engine/program` library path.
The user's 31 October policy selects upstream `security.capabilities=false`
and `security.seccomp=true` for native Termux: Landlock may add restrictions
when supported, but is not required. Android confines the whole Termux UID,
not individual documents; workers share Termux's filesystem authority. This is
an explicit platform policy, not a probe-triggered fallback, and Linux isolation
is unchanged. `COOL_FORCE_LANDLOCK=1` is passed only to the existing systemplate
setup helper so it creates its native no-chroot layout, never to the server.
The native user check retains the existing nonprivileged host launch option.

Native application load/edit/coedit/save/reopen/export, three-editor citations,
QuickJS/UNO, callback lifetimes, resource measurements and both installed-target
acceptance remain gates until verified. A source patch, successful configure or
standalone containment probe does not establish those results.
