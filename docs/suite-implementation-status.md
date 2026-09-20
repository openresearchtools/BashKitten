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

**16 shared-server tests pass on local Linux ARM64.** Native Linux ARM64 and
AMD64 CI both pass the shared suite and installed GTK/WebKit host checks,
including package install/remove/reinstall and retained cookies. Recent successful
runs include **35489082383** and **35489266621**. Local X11 and Wayland hosts pass
account creation and persistent login; the installed ARM64 host opens the real
native folder chooser. Browser clients retain the repository tree/ZIP controls;
only the Linux host hides them. Full host paste, external file/URL launching and
footprint checks remain.

Cuttlefish's original Termux profile passed **13 shared tests** against native
Pi 0.86.0 and Node 24.18.0, including HTTPS, without changing its credentials.
The newer graphics-conflict, APT-progress and cancellation cases still need their
Termux rerun. Fixture OAuth is not a real provider-account authorization.

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
- **APK file flow passes** on build **35489019438**: persistent login across
  activity recreation, home-confined working-folder picker, Unicode folder name,
  ordinary Android system image picker, decoded image preview, repository upload,
  and backend ZIP download with its original filename and uploaded image inside.
  Explicit downloads save; explicit file opens use Android's normal Open With.
- Chrome separately passes login/render/reload-cookie checks against the same
  localhost server. Chrome usage/crash reporting was switched off during setup.
  Chrome file flow, clipboard paste and external-provider login remain to test.
- **Actual turn notification delivery and tap pass** with API suite revision 2:
  after the APK was force-stopped, a native Pi completion posts once and tapping
  it opens that conversation. Notification permission was enabled through Android
  settings; camera/microphone/location/contacts remain unrequested.
- **Software X11/XFCE passes** with Mesa 26.2.3 llvmpipe (LLVM 21.1.8), OpenGL 4.6,
  glxinfo, glxgears and a rendered XFCE desktop. Closing the viewer preserves the
  desktop; stopping the desktop preserves the backend. Selecting the already
  validated profile performs no APT transaction. Native XFCE and LibreOffice
  are installed. Hardware GPU qualification remains separate.

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
been published. Daily read-only upstream checks report new release/commit
identities without importing or installing them automatically.

APK ELF/ZIP alignment is checked. The pinned official bootstrap contains **340
ELFs** passing 4 KB/16 KB load-alignment checks. This is not a 16 KB device test.
The bootstrap source collector verified **98 exact source/build inputs for 83
packages**, retaining recipes, patches and toolchain provenance. A complete local
suite release assembly passed using an earlier candidate; rebuild its manifest
with the API revision 2 artifacts before publication.

BashKitten's source collector successfully verifies **202 npm archives**, keeps
unmodified license/notice payloads, and includes exact Pi upstream source plus
tracked application/build source. The root lock now supplies exact registry SRI
where Pi's published shrinkwrap omitted internal-package integrity. Versions and
package contents are unchanged.

The usable Android signing backup is `/home/user/Documents/droid.txt` (0600).
The same four signing Secrets exist in both repositories. Catalog signing uses
its separate key and `/home/user/Documents/droid-catalog.txt`; the existing APT
key remains separate. No private key is tracked.

## Remaining acceptance gates

Finish native catalog/download/install/self-update and service quiescence tests;
paired X11 APK/companion updates and variant migration; named custom graphics
profiles/dependencies; unused-runtime cleanup; Android clipboard/open/OAuth and
Chrome file tests; full Linux native file/paste/link checks; final source/notice
and telemetry audits; release assembly/publishing, signed catalog renewal, and
actual install/upgrade from the existing APT repository for all three package
targets. Keep real-provider login, physical GPU tests, Android 12/16 and 16 KB
device availability explicit. Candidate compilation is not the final product gate.
