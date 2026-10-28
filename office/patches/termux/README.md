# Native Termux patch series

These patches adapt the immutable Collabora Online/engine release
`cp-26.04.5-2` (`42745e44dd8530fac7acd5f46cb7571ceea63c6a`). Apply them
at the Online source root after the shared BashKitten patch series. Pristine
source is never modified in place. `agent/packaging/office/termux.py` applies
zero-fuzz patches in an external build directory and replaces only the explicit
`@TERMUX_PREFIX@` build placeholder.

The retained native Termux LibreOffice donor is the **24 patches and build.sh**
in the already imported framework archive at commit
`f3b242999b604dab33639c8211c3b461aad79dc9`; there is no numbered patch 0015.
`donor.json` records the immutable archive and every input checksum. It is not
a new untraceable source dump. Original patch authors, including Md Arif, remain
attributed in the retained archive; the engine and Online source keep their
original MPL-2.0/Apache-2.0 notices. These rebased source changes are MPL-2.0.

## Adaptations

- `0001-bionic-engine-and-cross-tools.patch`: retains the native Linux headless
  engine target while recognizing the Bionic compiler in the two 64-bit UNO
  bridges. Reuses the donor's RTTI lookup, reserved ARM64 register/cache handling,
  allocator pointer-tag compatibility, liblangtag exit handling, locale/header
  fixes and LLVM LTO handling. Separates target flags from build-host tools,
  registers the headless fontconfig package, and uses the Termux prefix for
  temporary-file and CA-bundle defaults. The CPython dependency's own UUID
  implementation remains available when the optional system `_uuid` module is
  absent on Bionic; Python/UNO and QuickJS are retained.
- `0002-native-landlock-and-systemplate.patch`: extends **upstream Landlock**
  with read-only access to the native loader, specific Android/APEX runtime
  directories and Termux libraries/fonts/certificates. It never grants the
  entire app data, home, project or prefix tree. Bionic requires ABI 3 or later
  to restrict truncation. The native systemplate script recognizes mandatory
  Landlock mode and creates its native working layout without copying Android
  system or application data into a fake chroot. Upstream's seccomp filter is
  unchanged.
- `0003-optional-native-pam-build.patch`: exposes a configure switch for the
  server's **existing** no-PAM branch. Android has no Linux PAM development
  headers. An attempted PAM login still fails closed; normal WOPI and
  BashKitten authentication retain their owners. The admin console is disabled
  in the host's native configuration.

- `0004-native-meson-cross-build.patch`: feeds the existing Meson cross files
  to same-CPU Bionic cross builds and explicitly tells Meson that target programs
  cannot execute on the Linux build host. ARM64 CPU-family naming follows Meson.
- `0005-native-external-cross-targets.patch`: builds the same bzip2 library and
  executable targets without running Android executables as host tests. Selects
  NSS's existing cross-capable coreconf owner for Bionic, retains the native
  Termux NSS linker-flag and Bionic environment fixes through the engine's
  external-source patch owner, and selects the existing Poco
  Android shared-memory configuration (the server does not use that unsupported
  Poco class). Native kit IPC remains unchanged.
- `0006-native-python-cross-build.patch`: builds the matching retained CPython
  interpreter through the engine's existing host-tool graph, supplies it through
  CPython's native `--with-build-python` option, and selects CPython's released
  Android configuration for the Bionic library. The Office server/engine remains
  the native Linux headless target. Host include paths do not enter target Python.
- `0007-native-python-semaphores.patch`: reuses the retained Termux semaphore
  library, NDK symbol mappings and Python multiprocessing/shared-memory patch.
  The native gbuild Python owner builds and packages them. Temporary files use
  the kit's existing private `TMPDIR`; missing or nonabsolute directories fail
  closed. It also packages the actual Android Python ABI and sysconfig names.
  CPython's own pure-Python UUID implementation remains available, matching
  the selected native Termux recipe without a system UUID library.
- `0008-native-libffi-executable-mappings.patch`: uses the retained Termux
  libffi recipe's executable-mapping configuration. This resolves the native
  `_ctypes` link failure while retaining callback support and existing isolation.
- `0009-native-boost-bionic-selection.patch`: selects the pinned engine's
  existing Android long-double patch for its native Bionic configuration. This
  retains Boost's existing IEEE-128 implementation on Android x86_64.
- `0010-native-openssl-trust-path.patch`: selects the retained Termux OpenSSL
  recipe's native certificate directory through OpenSSL's own Configure option.
  The runtime declares the existing `ca-certificates` package; normal certificate
  validation remains enabled.

The semaphore source, licenses and Python patch are materialized directly from
the already retained immutable framework archive before applying the named
delta. `donor.json` lists exact archive members and SHA-256 values. No second
download, mutable framework checkout or anonymous source copy is a build input.

The shared engine undo-property, extension small-screen, light-canvas and proof
key patches are applied separately and remain owned by their respective modules.

## Donor decisions

| Donor patches | Decision |
| --- | --- |
| 0001, 0009 | Rebased cross-toolset flag isolation; target CPPFLAGS retained |
| 0002 | Prevent the cross compiler's host `/usr/include` probe; system GPGME/header paths are not selected |
| 0003, 0008 | Bionic locale and filesystem-header compatibility retained |
| 0004, 0012, 0020 | Native aarch64/x86_64 UNO ABI fixes retained; desktop IPC-error suppression and 32-bit edits omitted |
| 0005, 0011, 0024 | System ICU/Box2D changes not applicable: released internal dependency graph retained |
| 0006 | Desktop `distro-pack-install` changes not applicable: package upstream engine `instdir` |
| 0007 | Desktop launcher `/proc/version` workaround not selected by the kit server |
| 0010 | Cross-build test suppression already follows upstream cross-compiling condition |
| 0013, 0014 | Not applied preemptively; retain actual upstream cross-configure and diagnose any concrete failure |
| 0016 | Relevant native temporary-file and certificate paths rebased; desktop mail/print/xdg launcher changes omitted |
| 0017 | Only two 64-bit targets are supported; no 32-bit CoinMP builtins workaround |
| 0018, 0019 | Preserve released Online resource/feature defaults; no desktop default-policy changes |
| 0021, 0022, 0023, 0025 | Bionic allocator/exit, headless host-tool registration and LLVM fixes retained |

## Update checks and current gates

A new pin must pass strict patch application, both native Bionic configurations,
the retained host/target source graph, native ELF closure, full source/legal
inventory and actual Termux app execution. Never solve a regression with
`--enable-androidapp`, `MOBILEAPP`, `--disable-seccomp`, an optional Landlock
failure, a container substitute, or a broad app-data allowlist.

On 28 October 2026 the patched upstream Landlock and unchanged upstream seccomp
sources compiled with NDK 30 for aarch64 and x86_64. The x86_64 probe ran in the
actual Termux application (`UID 10123`, `untrusted_app_27`, Android 17): allowed
private-directory writes succeeded, unrelated reads/truncation failed with
`EACCES`, Bionic `dlopen(libz.so)` succeeded, and exec failed with `EPERM`.
Both full engine configurations passed; target compilation remains under active
verification. This is not a complete native `coolwsd`/kit/engine runtime pass or
installed product acceptance. Evidence and build logs stay outside the checkout
under `BashkittenBuild/verification/office-port-20261028` and
`BashkittenBuild/components/office/termux-*`.

The focused x86_64 native NSS and Python/libffi build targets also passed.
`_multiprocessing` and `_posixshmem` are retained. The reused semaphore library
compiled for both architectures and its create/wait/post/getvalue/close/unlink
flow passed in the actual Termux application, including invalid-name rejection
and the required private temporary directory. Full engine and server acceptance
remain pending.

The built Python 3.14.7 runtime then passed actual Termux application checks for
ctypes callbacks, multiprocessing semaphores, shared-memory create/reopen/unlink,
SQLite, UUID generation and OpenSSL loading. This verifies native dependency
execution; it does not establish complete Collabora document acceptance.

The same focused Python dependency checks also passed after installing the
patched upstream Landlock rules and unchanged upstream seccomp filter in the
actual Termux app. The diagnostic runtime was read-only, only its private
temporary directory was writable, and an unrelated sibling read was denied.
This strengthens the dependency proof; it remains separate from a full native
kit/document runtime check.

The native OpenSSL/Python rebuild with patch 0010 passed. In the actual Termux
app, the default certificate store changed from zero CAs at `/usr/local/ssl` to
121 CAs from the installed Termux bundle, including under native Landlock and
seccomp. This used no environment certificate override and did not bypass
verification; external HTTPS and full Office acceptance remain separate checks.
