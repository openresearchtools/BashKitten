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
  Termux setup/command integration. Build/device validation is still in progress.

Local Linux arm64: **10 shared-server tests pass**. They exercise real unmodified
Pi RPC using local model fixtures, all seven tools, queue edits, attachments,
fork/compaction, stopped instances, backend recovery, HTTPS, file confinement,
environment context, notification delivery fixtures and fixture OAuth callbacks.

Cuttlefish Android 17 / Termux aarch64 / 4 KB pages: **7 shared tests pass** after
the source move, including the real Pi RPC integration, context and supervisor.
They use a separate source/profile directory and preserve existing credentials.
The Linux-only file test and new notification test were not part of that run;
the TLS test requires an openssl command absent from this emulator's package
installation. Do not describe the Termux run as all ten tests or real-account OAuth.

Linux host: account creation and persistent login pass across separate processes
on X11 and Wayland. A real X11 pointer click opens the native GTK folder chooser;
synthetic native requests are rejected. Screenshots/logs are in local
`test-results/linux`. Full upload/paste/external-launch/package tests and native
AMD64 testing remain release gates.

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

## Remaining work

Finish and validate the native Android store/catalog/install/self-update flow;
foreground Termux manager startup; resumable bootstrap/APT/Pi npm jobs and runtime
selection; X11/GPU profile/package switching controls; APK lifecycle/download/
picker/OAuth/notification tests; platform `.deb` packaging and AMD64 CI;
source/license release artifacts including exact bootstrap corresponding source;
candidate upgrade/migration tests; final existing-APT publication and install
checks. GPU claims require physical devices. Real-account OAuth and 16 KB device
tests must be distinguished from fixtures and static alignment checks.

Do not uninstall the existing emulator's differently signed Termux or destroy
its profile. Cuttlefish snapshot attempts from earlier work failed; a disk backup
exists locally but must be assessed before relying on it. Use a disposable
instance/profile for signature migration and fresh-install tests.
