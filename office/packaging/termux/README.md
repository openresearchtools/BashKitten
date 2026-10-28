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

The shared host setup includes Meson. When available, ccache wraps the pinned
NDK compiler commands; provenance still hashes the compiler itself. Ordinary CI
caches are separate for each target. Native setup metadata is regenerated before
packaging and its build ID must match the immutable Collabora revision. The
manifest's `depends` and `systemPackages` describe the same required Termux
packages; native ELF dependency validation remains a separate check.

The output root is `runtime/`, with native files, upstream SBOMs, full notices,
resolved ELF dependencies and `manifest.json`. The existing environment owner
launches the actual server with `COOL_FORCE_LANDLOCK=1`, the fixed Termux prefix,
and the bundled `engine/program` library path. Only kernels that can enforce
Landlock ABI 3 or later are accepted; the kit also installs upstream seccomp.
There is no silent unsandboxed fallback. The native user check is handled by the
existing nonprivileged host launch option, not an invented Android identity.

Native application load/edit/coedit/save/reopen/export, three-editor citations,
QuickJS/UNO, callback lifetimes, resource measurements and both installed-target
acceptance remain gates until verified. A source patch, successful configure or
standalone containment probe does not establish those results.
