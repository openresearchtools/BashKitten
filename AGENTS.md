# BashKitten · native Pi / Linux and Termux

## 10 October native environments and Display plan

The requested next architecture is recorded in
[docs/native-environments-display-plan.md](docs/native-environments-display-plan.md).
Read it before implementing that work. It is a researched plan, not an
implementation or acceptance claim. It specifies embedded Termux:X11 without a
separate X11 APK, Linux Podman/crun environments, a native environment/project/chat
sidecar, shared XFCE customization and the requested CPU display fallback.
Display is **local Termux and local containers only**, as explicitly clarified;
saved remotes retain the existing encrypted Agent/service route. The plan
supersedes older display/frontend/lifetime requirements only where stated, and
does not authorize transport/authentication fallbacks or a Pi reimplementation.
Its Pi release update is planned; the current runtime pin below is unchanged.
Machine rootfs/configuration and durable runtime storage belong under the existing
`$BASHKITTEN_DATA_DIR`, with user-chosen names mapped to stable machine directories.
Retain lifecycle/deletion helpers. Implementation acceptance must include an
installed native Linux candidate in a virt-manager-managed Debian/Ubuntu VM using
a real Xorg login session, as well as the separate Wayland-host checks.
All operations must remain nonblocking, including the native Display tab/window:
no rootfs/process/IPC/frame/GPU-fence work may synchronously stall the UI thread.
Verify navigation/chat/tab-close responsiveness under load and stalled displays.
The custom Display tab is a reusable native viewport module with its own renderer
child process, not just a background thread in the browser UI process. Keep
Firefox/Fenix patches limited to documented lifecycle/focus/resize/IPC/surface
hooks so future Firefox upgrades adapt a small integration layer. Renderer-child
failure/closure must not stop the persistent Termux/container desktop or Pi work.
The native sidecar lists Local, every container and saved remotes directly, each
with projects and optional ungrouped chats. Replace the large backend dropdown
with one + for Connect remote/Create container (Linux only). Move power to each
backend heading; container headings also have Settings and a window/Display
button opening their full native viewport. Remote headings have connection
on/off/disconnect/delete only, no Display path/button or settings. Remote Off
disconnects the client, not the remote host. Impose no arbitrary container count.
Project creation uses a modal folder picker on its owning backend and stores the
selected working directory. New chats under that project inherit it automatically;
standalone chat folder/default logic stays unchanged. Regrouping or reopening an
existing chat never rewrites its native Pi cwd/history.
Merge needed BuzzardOS code directly into BashKitten; do not maintain a separate
Buzzard product boundary. Write only necessary code, reuse existing helpers and
owners, remove replaced paths and preserve source attribution/licenses.

## Current 8 October work and verification

The latest user request adds shared native Android/Linux LocalAI (llama.cpp,
Whisper/Parakeet and llama-tts), Termux CPU/Vulkan selection, an on-demand Android
performance overlay, and optional Pillama resumable llama.cpp streams. Preserve
the intended Tor/Caddy/Authelia/Chisel encrypted route; no transport bypass.
BashKitten owns a complete Pi profile under `$BASHKITTEN_DATA_DIR/pi`, including
credentials, settings, packages, extensions and native sessions. Do not import or
modify standalone Pi's profile. Use Pi's supported directory environment knobs.
For architecture acceptance use fresh browser/backend/Pi profiles, with no copied
old configuration. The latest 8 October instruction explicitly requires using
ADB for Android setup, permissions, package installation and debugging, and
direct Termux terminal access for shell/package work. Do not spend time clicking
Android Settings or screenshotting Termux when these commands can do the setup.
Use the desktop BashKitten browser with Cuttlefish's web UI for actual BashKitten
feature interaction and acceptance, rather than custom backend function calls.
Use stock Android 17 Cuttlefish with native KVM, 16 GiB RAM and at least 128 GiB
userdata on the system SSD; keep build sources/caches in the separate Data-drive
build repository, with 40 GiB desktop and Android x86_64 build budgets and P cores
0–7. These instructions supersede conflicting older ADB/profile/storage rules
below; do not claim emulator evidence verifies physical-device GPU behavior.

The user's latest 8 October instruction is to KEEP downloadable AI runtimes and
make the Android downloads work. This explicitly supersedes the intervening
request to bundle AI engines into desktop/Termux packages. Build llama.cpp
(including llama-tts) and Whisper/Parakeet only in the daughter repository's
GitHub Actions, not on this workstation. Publish matching native Linux and
Android assets with full licenses, source provenance and checksums. Termux
downloads native Android Vulkan engines for CPU/GPU execution; the APK controls that
Termux backend. Models remain separate downloads. No release path may depend on
local build directories or unpublished workstation binaries. Node and Pi remain
bundled in desktop/Termux packages. Local desktop/Android browser builds are for
development and acceptance only.
The latest runtime requirements use official upstream release tags and their
exact peeled commits, never arbitrary branch commits. The daughter repository
checks for newer upstream releases once daily and skips unchanged versions.
Use readable upstream versions with explicit package revisions. Vulkan builds
also provide CPU execution; do not build or download separate CPU artifacts.
Keep CPU/GPU execution choices, with GPU use disabled explicitly in CPU mode.
Show owned-workload CPU and, where real device counters permit, total CPU in
the Android performance overlay. Sample only while the overlay is visible.
Router model settings belong in per-model INI entries, with a native Add/Edit
form for backend file browsing, optional mmproj, context, actual devices, fit,
KV offload, flash attention and extra parameters. Keep direct INI editing and
separate launcher executable/port/INI/environment settings. Model retention
means idle time since last use, displayed in minutes with 0 meaning no idle
timeout (upstream sleep-idle-seconds=-1). An optional load check must stop its
temporary model and confirm cleanup before reporting success.
The chat controls must show the effective model/reasoning selection, or Not set
when absent, with compact widths. Android Agent power is a toggle beside the
logo; Display, LocalAI and performance use compact matching icons.

The latest file-viewer request enables Files on both native Linux and Android,
alongside Changes. Supported files have View and all files retain Download.
Images use the existing viewer; PDFs, text/code, rendered/raw Markdown, office
documents and spreadsheets open in ordinary browser tabs. Prepare documents
asynchronously on the backend, using LibreOffice for office-to-PDF conversion
and a read-only scrolling grid for spreadsheets. Use one request path with
cancellation and cleanup; remove superseded job/polling/open flows. The user
explicitly rejected adding OS sandboxing or device-capability gates around
LibreOffice conversion. Preserve the existing protected Agent/browser boundary.

This branch reuses BashKitten's browser UI with unmodified Pi 1.0.2
(`cd32f7725fdbddbaecdff5b1e68491563394e0ca`). It contains no Rust backend or
agent reimplementation. `PI_UPSTREAM.md` records the runtime pin;
`docs/pi-termux.md` describes the architecture and native boundaries.

BashKitten's own code is AGPL-3.0-only. Preserve third-party license notices and
the individual license metadata of dependencies.

## Change tracking

Work directly on `main` unless the user explicitly asks for a branch.
Always stage, commit and push completed changes, including documentation and plans.
Use focused commits for logical changes so features are easy to track, fix and
revert. Run the relevant checks before committing, push to the current branch's
remote, and report the commit IDs and push result.
Stage only files belonging to the task; preserve unrelated work and never commit
credentials, signing keys or personal runtime data.
Implement only the requested plan features, with minimal clear code and no added
functions, buttons or options beyond what they require. Reuse existing controllers
and upstream APIs; remove replaced paths. Do not add fallback implementations or
silently substitute transports/authentication/runtimes after failure. Preserve the
saved choice and show the actual error. Build pristine Chisel first and keep only
proven necessary Android build patches outside its source tree. These 5 October
constraints supersede older automatic-fallback wording in the plans.
Read `docs/browser-integration-plan.md` in full before browser-migration work and
after compaction. It records the requested replacement of the native wrappers
and Termux suite with one Android/Linux browser, Caddy/Authelia authentication
and optional desktop llama runtime/relay. It supersedes the older plan and the
current-implementation descriptions below where those requirements differ;
it does not claim that migration is already implemented. The latest remote/service
requirements are in `docs/remote-tunnel-plan.md`, which must also be read before
this work and after compaction. That 5 October plan
supersedes conflicting older remote-export, Android relay, llama bearer-injection
and Linux window-close requirements: encrypted QR using the chosen Authelia
password, native Chisel service mappings on both clients, remote host service
controls, identity reissue, close-to-tray and explicit Quit. Preserve Local Pi's
access to enabled remote localhost mappings. Publishing is now planned for Linux
and Android's Termux backend, superseding the 4 October Linux-only restriction.
Build Chisel for both the APK client and native Termux host. All host publishing,
account/enrollment/export/reset, file-manager permission and service-definition
controls belong in browser-owned **Share Local** beside Local/remotes; remove
their web UI and remote HTTP/RPC management paths. Use the native private local
controller/Termux bridge. Preserve permitted remote service-ID start/stop/reload.
Keep complete pinned pillama source/build metadata in this repository and build
its shipped runtime from that tree. Android's native Agent tab also gets an
optional compact **Display** panel only in Local mode. Use one Termux
`bashkitten-display` launcher and durable editable script shared by native UI,
user and local Pi; preserve edits across upgrades. Plan compatible X11 downloads
(shared UID only for matching GitHub Termux), software-rendered XFCE by default,
actual owned display status/Start/Stop/Open X11 and a concise local Termux Pi skill
for verified device-specific GPU help. Keep headless Xvfb and no-Termux remote
operation; this supersedes the earlier blanket removal of X11 controls only for
this optional feature. See the remote tunnel plan for the paths and manual gates.
Display also includes a short Copy prompt block asking Pi to use `termux-display`
and save the device's working launch command; copying never submits or executes it.
Desktop Local gets native **LocalAI** for llama.cpp/Whisper runtime commands,
router INI editing and the relocated model downloader; retain backend jobs and
remove shared web management routes. Share Local only has **Share llama.cpp**
for that same service. The planned `bashkitten-localai` runtime build repository
supplies mainstream llama.cpp/whisper.cpp amd64/arm64 CUDA/Vulkan artifacts;
Custom llama binary disables its managed updates. Configure the owned Pi provider
only when **Import this configuration into the coding agent** is saved enabled;
default it on for new LocalAI configurations. Remote mappings have Add to Pi plus
the import checkbox, applied on Save changes to local Pi using the actual mapped
endpoint. Preserve custom providers/defaults/current chat model and honor opt-out
on later port/model changes. Optional host-side Whisper dictation
uses one microphone button: click to record (red), click again to stop and transcribe.
The existing native LocalAI Whisper settings contain **Automatically send voice
messages**, enabled by default; Off puts the transcript in the composer, On sends
ordinary chat text. No separate Stop/Cancel buttons or general-settings toggle.
Authenticated Android/Linux clients use their selected host's saved choice.
No retained audio, separate transcripts, content logs or telemetry; keep audio
out of disk staging and durable jobs. The remote plan defines the complete gates.
These are planned requirements,
not a claim that the new transport or tray is already implemented. Tor tabs must
route all network requests, including public HTTP/HTTPS assets and DNS, through
Tor or block them. Ordinary unenrolled onion URLs enter private Tor before any
request. Native mapped-service/Agent routes stay separately scoped; never give
Tor pages a blanket localhost bypass. Remote file-manager access requires the
host's explicit, default-off permission and server-side checks on manager file,
diff, preview, archive and job routes, with live revocation and no fallback.
Chat attachments/uploads/downloads, image previews and stock Pi filesystem tools
remain available with the manager off; preserve their own authorization boundaries.
The migration keeps one product repository:
`/agent` for the existing shared app, `/browser` for the
Gecko subtree and `/auth` for tracked Authelia/Caddy/Tor source and isolated
Termux build patches. Any installed `com.termux` must be able to request native
browser approval, regardless of signer; already authorized calls run directly.
Preserve dynamic-port discovery. One Agent power control owns both Android wake
locks and whole-group start/stop, including owned Pi workers. Target full Linux
amd64/arm64 .deb packages, native Termux aarch64/x86_64 .deb packages with the Pi browser extension,
and Android arm64-v8a/x86_64 APKs with the same signing identity. Keep each browser
target in its own build repository and select downloads, updates and dependencies
for the actual architecture. Reuse WildBuzzard's working component-artifact/GHA compiler
cache workflow for desktop builds. Bring Buzzard Search into `/agent/search`
as a native Python helper with a normally discovered Pi skill. DDGS only for
now; SearXNG integration is deferred. Preserve full Markdown saving, native
Termux dependency recipes and Unsloth/other retained license provenance.
Package our own native search runtime for Linux amd64/arm64 as well as Termux
aarch64/x86_64; do not require a separate DDGS install. Supply distinct mobile/Termux
and desktop Linux browser skills and install the one matching each target.
The first migrated browser release must include the latest verified Firefox
153.x ESR update and retain WildBuzzard's Firefox-aligned product versioning.
Keep the user-authorized compact history: the complete Firefox 153.0 source
baseline and subsequent ESR/product work, with original upstream SHAs recorded
in `browser/bashkitten/upstreams.toml`. Preserve source trees and licenses.
Use compact `bashkitten/firefox/` source tags and the bounded ESR updater; never
fetch native Mozilla ancestry into this repository or retain old official tags
that make it reachable. Future exact official releases are shallow-fetched in
an isolated temporary repository, then their source tree is merged against the
previous compact upstream base. No Mozilla tracking branch is needed. Remove
temporary history-upload/build branches when complete.
Keep one DDGS-only query-or-url helper interface, using Unsloth-style concise
skill guidance while saving full Markdown before truncating the inline preview
and returning its path. Remove obsolete provider selection and call variants.
For existing-suite maintenance, also read
`docs/android-termux-suite-plan.md` in full. Keep shared code small and preserve
upstream components and licenses.

## Runtime ownership

- Pi owns the agent loop, tools, providers, models, thinking, queues, compaction,
  native session history, credential storage and token refresh.
- Do not force a tool allowlist or override native extension discovery. Use stock
  RPC for session operations, including fork and its extension hooks; never write
  Pi JSONL or substitute SessionManager mutations for available RPC commands.
  Let Pi restore model/thinking from existing history and choose new-session
  defaults unless the user explicitly selects them. Pi also restores the cwd
  saved in its native header; only new chats choose a folder. Read saved history
  through the native parser into an in-memory view without file writes.
- Run Pi as a separate RPC process per session. A detached Node worker owns the
  process. Android browser closure leaves Termux work running. The Linux browser
  adopts its local service group: Quit, close or browser death stops that group
  and its Pi workers, preserving unrelated terminal Pi. Standalone server CLI
  remains independent until a native Linux browser adopts its group.
- Use Pi's public ModelRuntime for service login because RPC has no login command.
  Open authorization in the Android browser and let Pi receive its own loopback
  callback. Present all required steps in the browser, without terminal sign-in.
- Never modify Pi, port its agent logic, introduce a custom provider credential
  format, or restore the old llama.cpp supervisor or goal loop.
- Ship an exact Pi release and dependency lock. User-requested npm updates
  resolve an exact new runtime from the registry, validate its native API and
  retain its lock before activation. Do not require a custom release manifest.
  Inspect upstream APIs before changing how the adapter interacts with Pi.

## UI and filesystem

Do not impose arbitrary upload/download, ZIP size/entry/selection, tab-count,
search-extraction or model-download quotas. Use ordinary backend file operations
and browser downloads; stream large files rather than buffering whole uploads.
Preserve complete saved documents and user-requested content. The requested
Agent isolation applies to automation, not user screenshots or ordinary content
tabs. Keep actual protocol/format validation and user cancellation.

- Preserve the existing transcript, thinking/tool streaming, compaction styling,
  image viewer, themes and project/chat sidebar. Adapt layout for narrow screens.
- On Termux, working-folder choices are writable directories inside home only.
  Show `~` and `~/project`, stop parent navigation at home, and omit shared storage
  and inaccessible system folders. Linux additionally allows explicitly chosen
  project roots through its platform adapter.
- Uploads use the browser's ordinary file picker, clipboard and drag/drop. Never
  substitute a custom Android picker or require Android storage permissions.
- Browse repositories on the backend. Open/download files through normal browser
  behavior; build complete repository ZIPs on the backend.
- The Termux file sidebar may browse its own complete app data directory, separate
  from the working-folder picker. Run bulk copy/delete/ZIP work in short-lived
  child processes; validate paths and links and confirm deletion in the UI.
  The Changes sidebar reads Git status, line counts and diffs without modifying
  Git. Refresh on demand while visible, with no hidden polling or filesystem
  watchers. The local Linux shell shows Changes and uses native folder opening.
- Retain native queue order, attachments and per-tab edit ownership. Never replay
  consumed messages after queue edits or browser reconnects.

## Local security and verification

Bind to 127.0.0.1. Local Android/Linux Agent sessions authenticate automatically
with a runtime credential delivered only through the native private controller
bridge and installed as a Secure/HttpOnly/SameSite cookie in the protected Agent
context. No local account or Authelia enrollment is required. Host Tor
publishing uses a separate listener with mandatory Authelia two-factor login;
never bypass remote authentication based on a loopback source address or Host.
Start Authelia/Valkey only for remote account setup or enabled publishing, retaining
their durable account/session storage. Android can connect without Termux, or
publish its local Termux backend through native Share Local as planned above.
Keep Argon2id, Origin/CSRF checks, private
storage permissions and filesystem path confinement. Do not expose provider credentials in browser
status, logs or URLs. Disable startup catalog/update traffic and telemetry.

Use the bundled Node runtime, plus ripgrep and fd. Keep BashKitten-owned test suites,
fixtures, instrumentation apps, probes and test dependencies outside this
repository and all application/release artifacts. Verify production builds on
Linux and disposable Android devices with external tools. Never seed production
profiles with test providers or chats. Use stock, hardware-accelerated Android 17
Cuttlefish with 16 GiB RAM and at least 128 GiB userdata on the system SSD.
The user explicitly rejected a separate
16 KB software-emulated guest; do not recreate it or change the stock kernel.
Keep build-time 16 KB alignment checks and report runtime coverage accurately.
External checks must reserve isolated ports,
stop all their owned processes in cleanup, and verify normal-profile startup too.
The 8 October instructions replace the old September prohibition on ADB and
command-based Android setup. Use ADB and direct Termux commands for setup,
permissions, package operations and debugging. Disabling Android child-process
restrictions is authorized. Do not describe this as an unchanged-default device.
Do not add or run BashKitten-owned scripted product tests. Use the real app UI
for feature acceptance, reserving screenshots for visible state that needs
verification; use fresh capture filenames and correct viewport coordinates.
Build and artifact-integrity checks are not evidence of that user flow. Continue
through the builds and manual flows, fixing discovered failures; a dispatched
build is not completion. Label Cuttlefish results accurately, without claiming
verification on a physical Pixel or guaranteeing the absence of every bug.
Preserve unmodified upstream sources and
licenses. Do not commit runtime credentials, node_modules or personal sessions.

## Packaged Pi tools (8 October update)

Ship one concise `browser` guide for the installed client, plus `websearch` and
`subagents`; Android additionally includes `termux-display`. Keep the other
client's browser guide outside discovered skills for authorized remote control.
Browser/search/agent tools use stock Pi's `exposure: 'deferred'` and `tool_search`;
do not replace that with a custom loader or patch Pi. See `docs/pi-tools.md`.

## User-facing documentation and license delivery

Keep README and release notes short, factual and for users. Preserve developer
details in docs/usage.md, packaging/README.md and the implementation status.
For now, every release must prominently include the README testing-release SVG
and text stating that it is for testing only and not ready for production.
Use the generated `release-notes.md` when publishing, including manual publication.
Audit desktop menus, submenus, settings and built-in pages for inherited
Firefox/Mozilla product, support and promotional links and controls for removed
services. Remove those affordances while preserving working browser functions,
DevTools, normal extension support and mandatory offline license attribution.
The native apps are browsers and the separate server is part of BashKitten:
its .deb bundles private Node 24 LTS/npm, Pi and their dependencies. Termux and
remaining declared OS libraries are external. The 8 October user request
supersedes the earlier external-Node design: installed launchers must use the
bundled native Node ELF, never silently fall back to a system runtime. npm's
prefix, cache, userconfig and globalconfig belong beneath BashKitten's private
Pi profile. Preserve HOME and project cwd; ordinary project dependencies remain
project-local and agent `npm -g` installs go into the private prefix. Do not copy
standalone Pi/npm settings or credentials into fresh profiles.
Use the browser's native menus and appearance settings. About contains separate
engine and bundled-component license buttons, available without login or backend.
Do not restore the duplicate Agent shell menu or standalone web About/licenses.
Keep About text accurate for both. Generate full offline license texts from
actual bundled artifacts; fail builds on missing texts. Preserve source licenses,
including native transitive dependencies, and publish matching source archives.
