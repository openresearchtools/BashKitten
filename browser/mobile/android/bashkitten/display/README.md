# Embedded Android Display

This module adapts the pristine Termux:X11 official 27 October nightly at
`6dfb8b4a4cc887bc329284d31eb049d596bd1208`, imported in `1a6659aef2`.
The original `fa3a8b430e2896a19f44c99a9cb056254615ae06` import in `10843938bc`
remains recoverable in Git history.
`browser/bashkitten/vendor/termux-x11/source.json` records the donor archive
and all sixteen unchanged materialized native dependency pins/checksums. The
original upstream archive is pinned by HTTPS URL/SHA-256 in that manifest and
collected from `BASHKITTEN_SOURCE_CACHE` into matching source deliverables. Original full
licenses and per-file notices remain in that pristine source. `prepare.py`
applies the named patches only in build output, selects the native/input/extra-key
library and generates its typed preferences; no donor Application, launcher,
accessibility interceptor or external X11 APK participates in the main manifest.
The adapted GPL files retain attribution; new BashKitten integration is AGPL.

The 19 October 2026 native dependency selection is retained.
Separate pristine release sources under `browser/bashkitten/vendor/display-dependencies`
select libtirpc 1.3.8, libX11 1.8.14 and Xorg server 21.1.25. Their metadata
records official release URLs, peeled commits, archive hashes, complete source
inventories and full licenses. `prepare.py` verifies those inventories and copies
the selected dependencies into build output before applying named adaptations.
Gradle includes those source directories in its preparation inputs. Android's
offline About collector uses the same verified selection, including original
source copyright preambles and full notices for the actual compiled releases.

Patch `0003-release-native-dependencies.patch` removes the donor recipe's obsolete
`quad_t`/`u_quad_t` macros and Xorg configuration typedefs: libtirpc 1.3.8 supplies
these types itself. It also reports the selected server version as `12101025`.
The original libX11/Xorg patches still apply to the new sources. The libtirpc
release's `INSTALL` symlink points at its maintainer's Automake manual; it is
retained as a symlink, hashed as link text and never used as a build input.
The main module and paired loader retain their existing identity and private IPC.

The 30 October 2026 nightly refresh incorporates the upstream IME code-point
deletion, sticky-key release, newline handling, DRI3 buffer lifetime/import,
root-pixmap locking and GPU damage/Present synchronization fixes. The embedded
host retains the new native heartbeat field; standalone Activity/overlay code
remains outside the module. The named host/input patches apply with zero fuzz,
and the paired protocol identifies this exact engine revision. Source preparation
also removes the manifest's excluded public dummy signing fixture from build output.

## Browser host contract

`DisplayTabs.open(Activity, "local")` opens/selects the one Android native tab
and requests the existing local Display owner to start. The Display tab's power
control and Display setup share the same asynchronous Start/Stop owner. Stop
ends only the owned X11 desktop group, leaving Termux/Pi and the tab available
for another start. `DisplayTabs.toggle` closes an existing viewport tab without
sending Stop or revoking its backend, and opens it when absent. The native
toolbar marks that actual tab state, including while the Agent is selected.
Fenix changes are limited to:

- `FenixAgentHost`: native context identity, tab creation/selection/closure, and
  exclusion from ordinary browser automation. Any browser navigation opens an
  ordinary tab without inheriting a native capability.
- `DisplayToolbar` and the existing toolbar wrappers: an address-free native
  Display row with the logo, service On/Off, Display command shortcut,
  Interact/Observe, Configuration and Firefox's
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
Observe keeps rendering and resize active while gating user input at the
LorieView native boundary, including hardware keys, retained IME connections,
pointer/touch/stylus events and clipboard. Switching releases the viewport's
held inputs and cancels pending gestures. It does not disable agent X11 input.

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
actual X11/D-Bus context after provisioning. The backend provisions a new private
desktop profile before its first launch; the initializer's existing marker
prevents repeating initialization on subsequent starts.
The embedded desktop has private XDG config/data/cache/runtime directories under
`$BASHKITTEN_DATA_DIR/display/desktop` and a fresh session bus. It never inherits
the standalone Termux:X11 session or changes that app's files, lock/socket or
processes. Both use standard Termux X client paths with distinct unused display
numbers; the owned desktop context supplies those exact XDG paths to agents.

Component probes and product acceptance records belong outside this repository.
An isolated compile/probe does not establish integrated Fenix, ARM64, physical
GPU or 16 KiB-device acceptance. Both ELF and APK zip alignment are release gates.
