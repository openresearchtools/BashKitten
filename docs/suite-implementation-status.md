# Suite implementation status

Updated 20 September 2026. Work stays on `main`; logical changes are committed
and pushed. Read the full [implementation plan](android-termux-suite-plan.md)
after compaction. This checkpoint supplements it and does not narrow its scope.

## Shared application and Linux

One `src/web` and `src/server` supplies the existing UI, native unmodified Pi RPC,
HTTP(S), files and runtime controls. Platform adapters supply roots, short managed
Pi context, notifications and package/desktop capabilities. Context preserves
personal/global/project instructions and reloads at idle; telemetry opt-outs and
Pi offline startup apply to background and terminal launches.

The supervisor preserves intentional stops, restarts dead services and replaces
updated server/Node processes at idle without marking Pi sessions intentionally
stopped. Durable package jobs expose native APT progress and independent APT/npm
results. Cancellation finishes the current transaction safely; Retry resumes
unfinished steps. Pi 0.85.1 → 0.86.0 → rollback passed through browser settings.

**17 shared-server tests pass on local Linux ARM64.** Native Linux ARM64 and
AMD64 CI both pass the shared suite and installed GTK/WebKit host checks,
including package install/remove/reinstall and retained cookies. Recent successful
runs include **35493031504** (0.2.1, both architectures). Local X11 and Wayland hosts pass
account creation and persistent login; the installed ARM64 host opens the real
native folder chooser. Browser clients retain the repository tree/ZIP controls;
only the Linux host hides them. Real system image/text clipboard paste, HTML
upload selection, hot session-link navigation, and native folder/file/URL launch
checks pass locally and on both native CI architectures. File launch tests use
isolated system application associations, including spaces/Unicode filenames.
The native Pi login helper shares the app's authenticated cookie jar and exposes
the external provider link; account authorization was deliberately cancelled.
Wayland also passes hot session navigation and bridge rejection. A local ARM64
Wayland measurement with GTK/WebKit, the server and one idle native Pi session
was approximately 637 MiB proportional memory (997 MiB summed RSS, which counts
shared pages repeatedly). This is a measured case, not a device minimum.

Cuttlefish's original Termux profile passed **13 shared tests** against native
Pi 0.86.0 and Node 24.18.0, including HTTPS, without changing its credentials.
The fresh suite profile now passes **all 17 shared tests** against Pi 0.85.1,
including HTTPS, with the native 0.2.1 package. The lifecycle test uses a longer
emulator allowance and TLS has its `openssl-tool` test dependency. Fixture OAuth is not a real provider-account authorization.

## Android device evidence

The disposable Cuttlefish Android 17 / aarch64 / 4 KB device is
`0.0.0.0:6521`, group `bashkittensuite`. Preserve the original, differently signed
Termux device at `192.168.97.2:5555`.

- Suite-signed Termux initializes through the protected setup activity without
  terminal configuration. Matching-signature command execution passes. A separate
  debug-signed probe APK requests the trusted permission and is denied by Android
  (`PASS: unrelated signer denied`). The public external-command policy remains.
- Core setup installed native Node, Python, Git, gh, ripgrep, fd, API CLI and the
  existing Termux APT keyring. Candidate BashKitten packages are installed through
  the protected command path; final APT publication has not occurred.
- The manager runs as a real long-lived task in Termux's foreground service.
  A native Pi turn using a local model fixture completes after force-stopping
  BashKitten; the backend and worker remain alive.
- **APK file flow passes** on production APK code 4 / 0.2.1: persistent login across
  activity recreation, home-confined working-folder picker, Unicode folder name,
  ordinary Android system image picker, decoded image preview, repository upload,
  real image clipboard paste, and backend ZIP download with its original filename
  and uploaded image inside. Android Gallery opens the uploaded image through
  the normal Open With path. Repeated ZIP tests match the current archive.
- Chrome separately passes login/render/reload-cookie checks against the same
  localhost server. Chrome usage/crash reporting was switched off during setup.
  Chrome file flow, clipboard paste and external-provider login remain to test.
- **Actual turn notification delivery and tap pass** with API suite revision 2:
  after the APK was force-stopped, a native Pi completion posts once and tapping
  it opens that conversation. Notification permission was enabled through Android
  settings; camera/microphone/location/contacts remain unrequested.
- **Real Termux:API store update passes** on BashKitten APK code 3 (**35492190686**):
  signed catalog verification, GitHub HTTPS download, APK hash/certificate checks,
  Android installer confirmation, API code 1002 → 1003, durable service pause and
  automatic backend recovery. Android 17's confirmation intent contains Binder
  data: store it in a system PendingIntent and persist only its lookup identity.
  The earlier candidate's Parcel-to-disk implementation crashed in this test;
  it is not suitable for release. **BashKitten self-update code 3 → 4 also passes**
  through the signed catalog and native installer; PackageManager records
  `com.bashkitten` as installer. Android ends the instrumentation process during
  APK replacement, so the resulting package identity was verified separately.
  Reopening retains the authenticated WebView cookie and existing conversation.
- **Software X11/XFCE passes** with Mesa 26.2.3 llvmpipe (LLVM 21.1.8), OpenGL 4.6,
  glxinfo, glxgears and a rendered XFCE desktop. Closing the viewer preserves the
  desktop; stopping the desktop preserves the backend. Selecting the already
  validated profile performs no APT transaction. Native XFCE and LibreOffice
  are installed. Named custom profiles also pass rendered preparation, idempotent
  repeat selection without APT changes, and waiting for desktop stop before
  switching. Hardware GPU qualification remains separate.

Device evidence is retained locally under `test-results/android`, including
`web-flow-download.log`, `native-lifecycle-direct-notification.log`,
`notification-open.png`, `graphics-software.log` and `xfce-software.png`.

## Distribution, signatures and source

`openresearchtools/termux-suite` tracks pristine upstream sources, expanded X11
submodules, hashes, licenses, upstream versions and the internal version ledger.
The Termux patches add trusted setup/commands and bootstrap-path compatibility.
A small Termux:API patch routes exact BashKitten notification URIs through a
direct Android activity PendingIntent: Android 17 testing demonstrated that the
upstream shell trampoline is blocked for background activity launches.

All eight apps, both X11 variants and the paired aarch64 companion pass Actions
build/signing checks. **35488852785** includes API 0.53.0 suite revision 2/code
1003. Termux remains 0.118.3 suite revision 2/code 1003. Upstream displayed
versions and individual licenses are retained. No production release/catalog has
been promoted to production. Complete source-backed **candidate-20260920**
prereleases now exist in both repositories for actual installer tests. Their
assets remain outside the production catalog and APT index. The first BashKitten
prerelease is superseded for APK confirmation by the code 3 fix described above.
Daily read-only upstream checks report new release/commit
identities without importing or installing them automatically.

APK ELF/ZIP alignment is checked. The pinned official bootstrap contains **340
ELFs** passing 4 KB/16 KB load-alignment checks. This is not a 16 KB device test.
The bootstrap source collector verified **98 exact source/build inputs for 83
packages**, retaining recipes, patches and toolchain provenance. A complete local
suite release assembly passed with the API revision 2 artifacts and was used for
the source-backed prerelease.

BashKitten's source collector successfully verifies **202 npm archives**, keeps
unmodified license/notice payloads, and includes exact Pi upstream source plus
tracked application/build source. The root lock now supplies exact registry SRI
where Pi's published shrinkwrap omitted internal-package integrity. Versions and
package contents are unchanged. The new 0.2.1 builder and Pi updater omit optional
packages whose own OS/CPU metadata excludes the target, because npm retains
foreign binaries below Pi's nested shrinkwrap. Pi and the selected dependency
contents stay unmodified. The selected Termux payload's native ELF passes
aarch64 and 4 KB/16 KB static alignment checks and all 17 native Termux tests.
The Termux package shrank from about 122 MB to 23 MB.

The installed environment audit found 28 unaligned ELF files in eight upstream
packages. An experimental rebuild passed static alignment checks, but this package
fork was removed from the product scope. Its release is marked withdrawn/prerelease
and is not indexed in APT. Ordinary packages continue from upstream Termux. Full
16 KB desktop compatibility is therefore not established by the current 4 KB test.

A system-call trace of Pi service discovery, RPC startup and idle operation
showed no IP network connections; offline/telemetry settings were effective.
The separate requested store/package checks remain enabled.

The daily signed catalog renewal workflow is implemented. It renews only explicitly
selected release manifests pinned by SHA-256; no production channel is selected
yet. APK replacement pause/recovery, X11 companion pairing, named custom graphics
profiles/dependencies, are implemented. The custom Pi release-manifest gate and automatic runtime cleanup
have been removed; package updates use npm registry releases.
Cleanup preserves active, rollback, bundled, terminal-used, unowned and symlinked
runtimes; its regression passes, with a seven-day grace period.

The usable Android signing backup is `/home/user/Documents/droid.txt` (0600).
The same four signing Secrets exist in both repositories. Catalog signing uses
its separate key and `/home/user/Documents/droid-catalog.txt`; the existing APT
key remains separate. No private key is tracked.

## Remaining acceptance gates

Finish paired X11 APK/companion updates and variant migration; Android external
OAuth and Chrome file checks; final source/notice and platform telemetry audits; release assembly/publishing, signed catalog renewal, and
actual install/upgrade from the existing APT repository for all three package
targets. Keep real-provider login, physical GPU tests, Android 12/16 and 16 KB
device availability explicit. Candidate compilation is not the final product gate.
