# Embedded Android Display

This module adapts the pristine Termux:X11 official nightly at
`fa3a8b430e2896a19f44c99a9cb056254615ae06`, imported in `10843938bc`.
`browser/bashkitten/vendor/termux-x11/source.json` records the donor archive
and all sixteen materialized native dependency pins/checksums. Original full
licenses and per-file notices remain in that pristine source. `prepare.py`
applies the named patch only in build output, selects the native/input/extra-key
library and generates its typed preferences; no donor Application, launcher,
accessibility interceptor or external X11 APK participates in the main manifest.
The adapted GPL files retain attribution; new BashKitten integration is AGPL.

## Browser host contract

`DisplayTabs.open(Activity, "local")` opens/selects the one Android native tab
and requests the existing local Display owner to start. Explicit Stop remains
in Display setup. `DisplayTabs.toggle` closes an existing viewport tab without
sending Stop or revoking its backend, and opens it when absent. The native
toolbar marks that actual tab state, including while the Agent is selected.
Fenix changes are limited to:

- `FenixAgentHost`: native context identity, tab creation/selection/closure, and
  exclusion from ordinary browser automation. Any browser navigation opens an
  ordinary tab without inheriting a native capability.
- `DisplayToolbar` and the existing toolbar wrappers: an address-free native
  Display row with the logo, active Display toggle, Configuration and Firefox's
  existing tab/menu action objects. Ordinary and custom-tab address bars are
  unchanged; the native tab strip and menu retain their existing handlers.
- `FenixDisplayViewport`: selected-tab lifecycle and the measured content bounds,
  excluding the actual measured browser chrome and current IME. It does not
  execute/render X11.
- `BaseBrowserFragment`: create/dispose that host and supply toolbar bounds.
- `FenixApplication`: minimal `:display` startup, without Gecko or telemetry.

The browser owns a `SurfaceView` slot. The private `:display` service owns the
child window, adapted Lorie hierarchy and renderer on its worker thread.
`SurfaceControlViewHost`/`SurfacePackage` preserve Android's input and IME path;
the embedded child window, rather than the parent window's focus loss during
input transfer, owns focus. Native resolution follows the actual viewport and
extra keys, separately from XFCE scaling. Typed one-way IPC and generation checks
keep native/IPC work off the browser UI thread and discard stale completions.
Unbinding terminates only the disposable renderer process, including a blocked
GPU worker. Closing/switching tabs never sends Display Stop to Termux.

## Termux server and private handoff

`bashkitten-x11` loads the native server from the installed BashKitten APK under
Termux's UID. The generated loader checks the actual publisher SHA-256 and exact
Display protocol version, with no environment override. Its small recipe in
`loader/build.py` produces the command, dex JAR, manifest/checksums and notices.
The verified package's `ApplicationInfo.nativeLibraryDir` supplies the class
loader's native search path. `System.loadLibrary("Xlorie")` then loads Android's
extracted library; Fenix's compressed APK entries cannot be loaded through a
direct `base.apk!/lib/...` path. No caller-provided library path is accepted.
Package the JAR at `usr/lib/bashkitten/display/bashkitten-x11-loader.jar`, and
the command at `usr/bin/bashkitten-x11` with mode `0755`; source/signing identity
mismatch is an error. The loader recipe publishes a read-only `0400` JAR.
Termux package assembly stages it as `0600`, then its `postinst` immediately
sets `0400`, following the pristine donor companion package's install pattern.
Non-root dpkg must reopen its `.dpkg-new` file for deferred writeback after
applying archive permissions, so a read-only archive entry fails unpacking.
Android's dynamic-code loading policy rejects writable DEX/JAR files before
the loader runs; incomplete installation cannot load this file. No launch-time
chmod or platform compatibility override is used.

`DisplayPublisher` reuses the existing BrowserCommand one-shot discovery and
UID-verified Binder endpoint. `DISPLAY_REGISTER` accepts a typed source only from
the currently approved installed Termux UID while Local is On. The source gives
fresh connection FDs through the typed callback; no generic JSON/HTTP tool may
supply one. Donor LAN knock discovery is removed. The service is non-exported.
This is process separation, not a claim that the child has Gecko's web sandbox
or that hostile code sharing Termux's UID is isolated from its approved owner.

The existing `bashkitten-display` controller owns its durable script, X server,
process group and readiness. Only its exact old generated default migrates;
custom commands are retained with an actionable note when they still invoke
independent Termux:X11. The owned environment supplies `DISPLAY`, the `termux`
execution role and `BASHKITTEN_DESKTOP_CONTEXT`. BashKitten OS autostart publishes
actual X11/D-Bus context after provisioning; startup does not reinstall defaults.

Component probes and product acceptance records belong outside this repository.
An isolated compile/probe does not establish integrated Fenix, ARM64, physical
GPU or 16 KiB-device acceptance. Both ELF and APK zip alignment are release gates.
