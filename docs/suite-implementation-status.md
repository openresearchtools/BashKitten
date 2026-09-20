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
runs include **35496733935** (0.2.2, both architectures). Local X11 and Wayland hosts pass
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
including HTTPS, with the 0.2.2 server source and native dependencies. The lifecycle test uses a longer
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
  the protected command path. The published 0.2.2 package also installs from the
  existing signed APT repository; the manager reloads it and retains Pi 0.86.0.
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
  Its normal Android picker uploaded rose.jpg into a native Pi turn; repository
  upload and a browser-downloaded backend ZIP containing strawberries.jpg pass.
  Chrome clipboard paste and external-provider login remain to test.
- Completion notification delivery passed on the earlier API candidate. The final
  suite restores unmodified upstream API; notifications now use its standard text
  interface without a custom notification-link action. Camera/microphone/location/
  contacts remain unrequested.
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
API and all other add-ons retain upstream application behavior; the earlier
notification-link patch has been removed.

All eight apps, both X11 variants and the paired aarch64 companion pass Actions
build/signing checks in **35495776147**, published as **suite-35495776147**.
API is 0.53.0 suite revision 3/code 1004; Termux is 0.118.3 suite revision 2/code
1003. The companion and BashKitten 0.2.2 are indexed in the existing APT repository.
The production signed catalog contains all ten APK entries (including both X11
variants); renewal **35497362022** passed. Upstream displayed
versions and individual licenses are retained.

The daily upstream workflow now imports official releases for each app and X11
nightlies, checks the patches, commits the source update and dispatches the full
build/sign/publish workflow. The current-release check passed in **35496320826**;
all eight current upstream revisions match. A future changed-source import has
not yet been exercised by an actual newer upstream release. Build-layout changes
or rejected patches stop the update visibly. Unchanged X11 companion versions
are reused across releases so APT never sees duplicate package identities.

APK ELF/ZIP alignment is checked. The pinned official bootstrap contains **340
ELFs** passing 4 KB/16 KB load-alignment checks. This is not a 16 KB device test.
The bootstrap source collector verified **98 exact source/build inputs for 83
packages**, retaining recipes, patches and toolchain provenance. A complete local
suite release assembly includes the unmodified API revision 3 and is published
with its bootstrap source inputs.

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
The disposable device’s eight experimental packages were also restored to their
official upstream versions through APT; no application was uninstalled.

A system-call trace of Pi service discovery, RPC startup and idle operation
showed no IP network connections; offline/telemetry settings were effective.
The separate requested store/package checks remain enabled.

The daily signed catalog renewal workflow uses release manifests pinned by
SHA-256. APK replacement pause/recovery, X11 companion pairing and named custom
graphics profiles/dependencies are implemented. Package updates use the npm
registry directly; the custom Pi release-manifest gate and automatic runtime
cleanup have been removed. Installed global npm packages are checked separately
from APT, and APT-owned npm files remain managed by APT.

A real **Update all** operation on Cuttlefish completed APT and global npm checks
and updated native Pi **0.85.1 → 0.86.0**. Its actual runtime then completed all
seven native tools: write, edit, read, bash, grep, find and ls. The previous runtime
remains available. The final 0.2.2 server source passes all 17 shared tests in
Termux; Android build **35496789356** and both native Linux builds pass.

The Android host has a hamburger menu with Apps, Desktop and Pi sessions.
Apps contains compact cards with upstream icons and an expandable Packages block
below the required apps. There is no separate package-updates menu destination.
The single X11 card offers Normal (standalone, the default) or Shared UID before
installation, and shows the actual installed type afterwards. The WebView stays
attached: the final navigation test verifies the same document, selected session
and unsent draft across both Apps and the expanded package list.

External Termux installations use upstream's public RUN_COMMAND service after
Android's normal permission grant and the copyable allow-external-apps command.
The card explains those steps. Suite Termux/add-on APK installs are rejected at
both the UI and worker boundary for external Termux; missing add-ons show Missing
and the same-source instruction. Our protected route remains unchanged. A real
external installation passed permission/command tests, the shared bootstrap,
APT registration and candidate package installation without replacing Termux.
Its files and other installed applications were preserved.

APK installs now run in WorkManager, independently of the Activity. The production
signed catalog, download, signature checks and Android installer successfully
installed Termux:Boot (versionCode 1000) while the store Activity was paused.
Catalog checks use conditional requests and a daily schedule. Healthy chat stops
native polling. Initial setup reconnects to its durable log on reopen and detects
an interrupted bootstrap. Package network checks require an explicit store action;
local inventory uses offline npm with its automatic update notifier disabled.

All **18 shared-server tests pass inside external Termux**, including actual
inventory and the external/upstream versus suite X11 companion boundary. A real
Update packages job completed APT full-upgrade, global npm and Pi checks while
the native screen was closed; output correctly reported all packages and selected
Pi 0.86.0 up to date. Its bounded output remains available in Apps. Android build
**35503020916** passed the navigation/background-install checks. Published build
**35503594352** additionally preserves an explicit X11 type choice across Android
permission screens and activity restarts. Normal remains the fresh-install default. The installed local Linux 0.2.3 candidate passed native file/folder/URL,
image picker/paste, provider-login helper and persistent-cookie tests under Xvfb.

BashKitten **v0.2.2** is a normal release with the Android APK, five native
packages, tracked application source and 202 dependency source archives. APT
publisher **35497361590** succeeded. Actual signed-index upgrade/reinstall and
retained-login checks passed on native **arm64 and amd64** in **35497614997**;
the local ARM64 machine and native Termux **aarch64** also installed 0.2.2 from
that index. The installed local GTK host passes native folder/file/URL launch,
system image picker, clipboard paste and persistent login under Xvfb. The first
local pointer test was obscured in the shared desktop; its isolated-display rerun
passed. No product code changed for that test failure.

The production store's Refresh and Termux:API Update buttons were exercised on
Cuttlefish, upgrading API **1003 → 1004** through Android's confirmation screen.
The first attempt timed out while shutting down an idle worker; Retry completed,
and the backend recovered with the same account/session. The subsequent APT
backend replacement reloaded services successfully and preserved selected Pi
0.86.0. This records a recoverable timeout, not a claim that every install was
uninterrupted.

BashKitten **v0.2.3** is published with the signed APK, five native packages and
matching application/Pi/202 dependency source archives. Final Linux build
**35503218579** passes both architectures. Catalog renewal **35503885568** and APT
publication **35503885573** succeeded; signed-index upgrade/reinstall and retained
login pass on Linux arm64 and amd64 in **35503976327**. Native Termux installed
0.2.3 from that signed index and reports revision `bfe332b`. The final local ARM64
package passes the saved-login/window checks. External Termux's final offline
inventory returned 473 APT packages, two global npm packages and its selected Pi
0.85.1 with an unreachable test registry; Git, gh and Python were present. The
suite device retained its explicitly selected Pi 0.86.0. Repositories remain on
`main`; no upstream Termux application source or package behavior changed in this
store/connection update.

The usable Android signing backup is `/home/user/Documents/droid.txt` (0600).
The same four signing Secrets exist in both repositories. Catalog signing uses
its separate key and `/home/user/Documents/droid-catalog.txt`; the existing APT
key remains separate. No private key is tracked.

## License delivery and production-only source (20 September 2026)

BashKitten 0.2.4 adds offline Android About/Licenses and shared web/Linux
Settings → About. The Android APK contains 76 license records, the Termux server
168 and each Linux server 170, including full texts and native dependency
notices. Release sources include exact Android source jars, locked npm/Pi source
and the supplemental native sources. Node, Termux and system web engines remain
separately installed; the server package includes Pi and its dependencies.

Production Android build **35507158209** and both Linux architectures in
**35507272186** succeeded. The actual installed Android app opens About, its
license list and full GPL text. The installed Linux ARM64 host retains its login
and displays the same shared About/license content. The Termux server on the
suite Cuttlefish device reports the production package revision `bbb2e87` and
serves 168 license records. Termux suite build **35505368171** rebuilt all nine
APK variants and the matching companion; its short Termux-only About notice
was checked on that device. Add-on source and app screens remain upstream.

BashKitten-owned test suites, fixtures, instrumentation, permission probes and
test dependencies were removed from the app repository and build workflows.
Local verification material is outside the repository. Both test-only APKs and
the two fixture chats/provider were removed from the disposable suite emulator;
only `com.bashkitten` remains among BashKitten package IDs. Production package
payloads have no app test script or development dependency. Unmodified upstream
source archives retain their original contents and licenses. Historical checks
above describe earlier verification, not a suite shipped with the application.

BashKitten **v0.2.4** and rebuilt suite **suite-35505368171** are published
with short user-facing release notes and matching source/license archives.
All preceding application releases were deleted, and the catalog release was
recreated. Catalog renewal **35507618879** and APT publication **35507634926**
succeeded. The public catalog signature/expiry and all ten APK entries were
verified. The signed APT index selects the five 0.2.4 packages and matching X11
companion; actual APT reinstalls completed on local Linux ARM64 and native Termux
aarch64. The emulator's old fixture work directories were also removed.

## Remaining acceptance gates

Finish paired X11 APK/companion upgrade and variant-migration device coverage;
Android external OAuth and Chrome clipboard paste; final platform telemetry
audits. Real-provider account authorization, physical GPU tests, Android 12/16
and 16 KB device coverage remain unverified. The production release, signed
catalog and APT installs for all three targets are now published and tested.

### Native About and Pi 0.86.1 — 20 September 2026

Linux's native menu now opens About and full installed license texts, even when
the backend is stopped. Its notice identifies GTK/WebKitGTK/PyGObject/Python/Node
as system packages. Android retains its native Menu → About → Licenses.

Pi is pinned to 0.86.1 and the npm updater validates its native llama.cpp provider
alongside ModelRuntime before activation. Services uses Pi's bundled provider
factory, native URL/key prompts, credential store and model refresh; login and
explicit refresh contact the configured HTTP server. Startup uses the saved cache.
The updated dependency notices include proxy-agent-negotiate and esbuild's actual
Go 1.26.5 runtime, with matching source records.

External Linux checks passed process-kill recovery, port conflicts, duplicate
launches and intentional Stop against 0.86.1. Native GTK/WebKit checks passed
Menu → About → Licenses with the backend stopped and confirmed that closing the
window preserves the backend. A disposable HTTP router fixture verified native
Pi llama.cpp login, stored credentials, model refresh/cache and logout; this is
connection verification, not a claim of real-model inference. Production Android
and package installation checks follow the rebuild. No verification code is
included in the app source or artifacts.

### Shared offline About presentation — 20 September 2026

The native About pages now use the same web renderer and CSS as Settings →
About, including its expandable license list. Android bundles an offline page
with its APK and companion-server notices; Linux bundles the server notices and explicitly identifies
GTK/WebKitGTK/PyGObject/Python/Node as system dependencies. Native pages require
neither the backend nor login and have no command bridge. They replace the
earlier native list/dropdown implementations; the web About entry remains.

The installed GTK/WebKit host and production Android APK rendered and expanded
the full GPL text with the backend stopped. Android passed on both our signed
Termux and an external upstream Termux installation. The APK includes 217 notice
records covering its libraries and the separately delivered server. Closing
About preserves the existing chat document and stopped/running service state.

The Android check exposed an interrupted web startup that remained half-loaded
after the backend returned. Startup now retries until initialized, using the
existing status interval, without reloading an initialized chat. An external
WebKit check with a failed startup request passed recovery in the same document
and verified that later focus/status checks preserve an unsent draft.

Production Android build **35512248234** and Linux ARM64/AMD64 build
**35512248212** at `09fabc7` passed. The final APK opens the shared offline About
and full licenses on both signed-suite and external-upstream Termux devices;
Back → Start returns to the normal chat/login. The installed Linux ARM64 host
passes the same offline view and interrupted-startup checks. Pi 0.86.1 is selected
on all three normal installations. AMD64 packages were built on native CI; this
change's desktop interaction checks ran on ARM64.

**v0.2.5** is published with its APK, five packages and matching source/license
archives. Catalog renewal **35512636900** and APT publication **35512635577**
passed. The public catalog signature and exact APK hash were verified, as were
all five package hashes in the APT index. Actual signed-index reinstalls passed
on Linux ARM64 and both Termux installations, with their backends running at the
remembered addresses afterward. All verification scripts and fixtures remain
outside application repositories and release artifacts.
