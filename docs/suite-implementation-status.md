# Suite implementation status

Updated 20 September 2026. Work stays on `main`; logical changes are committed
and pushed. Read the full [implementation plan](android-termux-suite-plan.md)
after compaction. This checkpoint supplements it and does not narrow its scope.

## Implemented and checked

- One `src/web` and `src/server`, with native Pi integration in `rpc`, shared
  HTTP/files code, home-confined Termux roots and configurable Linux roots.
- Short managed Pi environment context, preserving personal/global overrides,
  project context, credentials and existing settings. Context changes apply at
  an idle boundary. Telemetry defaults and Pi offline startup remain in force.
- Shared local supervisor/CLI, backend attach/start/stop/restart and recovery.
  Optional loopback HTTPS validates the matching Origin and sets Secure cookies.
- Pi instance stop/kill controls, deliberate-stop persistence, native history
  while stopped, and a durable draft journal that never automatically replays
  uncertain delivery after a worker restart. Existing turn abort is retained.
- Small Linux GTK/WebKitGTK host, persistent cookies, Services menu and recovery
  surface, native working-folder chooser and file launch. Only this host hides
  repository browsing/ZIP; ordinary browsers retain those controls.
- Optional Termux turn notifications, a deduplicated retryable outbox, expiring
  visibility heartbeats and Unicode-safe previews. Shared-server fixture tests
  cover this; actual Android notification delivery is still pending.
- Android `com.bashkitten` source and candidate workflow: Compose control screen,
  system WebView, persistent cookies, ordinary system upload picker, streaming
  authenticated Downloads, Pi login popup/external-browser handling and protected
  Termux setup/command integration. Production candidates compile and pass signing
  checks. The fresh Cuttlefish profile initializes Termux and executes protected
  commands with the correct native home; an unrelated shell caller is denied.
- Signed catalog verification with a separate pinned public key, installer
  identity/hash checks, Android installation confirmation handling and periodic
  catalog checks. Catalog publication and real installer update tests remain.
- Durable supervisor-owned package jobs, native APT progress, interrupted-job
  recovery, independent APT/npm checks, tested immutable Pi manifests and one
  runtime resolver for RPC, provider services and the terminal launcher.
  Browser settings successfully updated Pi 0.85.1 to 0.86.0 and rolled it back.
- Resumable protected Termux package bootstrap; native package/store controls,
  owned X11 process groups, startup-method options and graphics dependency
  preparation. X11 code has not yet passed real renderer/device checks.
- Native Linux arm64/amd64 candidate build matrix and Termux aarch64 packaging;
  package post-install retains Pi runtimes independently of dpkg-owned payloads.

Local Linux arm64: **15 shared-server tests pass**. They exercise real unmodified
Pi RPC using local model fixtures, all seven tools, queue edits, attachments,
fork/compaction, stopped instances, backend recovery, HTTPS, file confinement,
environment context, notification delivery fixtures, runtime activation/rollback,
package journal/progress and fixture OAuth callbacks.

Cuttlefish Android 17 / Termux aarch64 / 4 KB pages: **13 shared tests passed**
against unmodified Pi 0.86.0 and native Node 24.18.0, including HTTPS after
installing upstream openssl-tool. This uses a separate source/profile directory
and preserves existing credentials. The later graphics-conflict and native
APT-progress tests still need their Termux rerun. Fixture OAuth is not a real
provider account login. Pi 0.86.0 also passed 13 tests on Linux Node 22 and 24.

Linux host: account creation and persistent login pass across separate processes
on X11 and Wayland. A real X11 pointer click opens the native GTK folder chooser;
synthetic native requests are rejected. Screenshots/logs are in local
`test-results/linux`. Full upload/paste/external-launch/package tests and native
AMD64 testing remain release gates. The installed ARM64 .deb passed the real
window, login and native folder-picker test. Both CI architectures pass the
shared tests and build/install packages; WebKit's nested sandbox needs the
disposable CI runner namespace configuration currently under test.

## Termux distribution repository

`https://github.com/openresearchtools/termux-suite` now tracks pristine upstream
trees, expanded X11 submodules, source hashes, licenses, exact releases and
version-code ledger. The small patch adds signature-protected setup/command
components; the public command route and allow-external-apps policy are unchanged.

Builds use upstream wrappers and per-project toolchains, then a separate signing
job. All eight apps, both X11 variants and the paired aarch64 companion passed
candidate build/signature checks in Actions run **35482852022**. Candidates are
not published releases. Internal APK metadata and the shared Droid certificate
are verified, and APK ELF/ZIP alignment checks are enforced.

Documented build fixes preserve upstream behavior: build the unavailable
JitPack libraries from their exact `7bceab88e2` source; align their terminal and
local-socket libraries; retain X11's loader certificate check with the suite's
public certificate; make release loader naming/lint compatible. Termux 0.118.3's
old bootstrap failed the 16 KB check, so a separately locked official
`bootstrap-2026.09.20-r1+apt.android-7` is used. All **340** ELF binaries in that
bootstrap pass 4 KB/16 KB load-alignment checks. This is not a 16 KB device test.

The original usable signing backup remains `/home/user/Documents/droid.txt`.
The four repository Secrets are stored in BashKitten and termux-suite; no key
material is tracked. Public certificate metadata is tracked for verification.
The separate catalog private-key backup is `/home/user/Documents/droid-catalog.txt`
(0600), with its own catalog-only repository Secret.

## Remaining work

Finish and validate the native Android store/catalog/install/self-update flow;
fresh core/desktop bootstrap from actual packages; paired X11 APK/companion
updates, GPU/profile controls and custom dependencies; APK lifecycle/download/
picker/OAuth/notification tests; package upgrade/removal and AMD64 host CI;
source/license release artifacts including exact bootstrap corresponding source;
candidate upgrade/migration tests; final existing-APT publication and install
checks. GPU claims require physical devices. Real-account OAuth and 16 KB device
tests must be distinguished from fixtures and static alignment checks.

Do not uninstall the original emulator's differently signed Termux or destroy
its profile (`192.168.97.2:5555`). A separate disposable Cuttlefish instance now
runs as group `bashkittensuite`, ADB `0.0.0.0:6521`, with the suite-signed Termux,
API, standalone X11 and BashKitten candidates. Use that instance for fresh setup,
installer updates and signature/variant migration tests.
