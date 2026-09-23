# BashKitten · native Pi / Linux and Termux

This branch reuses BashKitten's browser UI with unmodified Pi 0.86.1
(`13cbf77df2396303013a41646bcfa77b4271ae56`). It contains no Rust backend or
agent reimplementation. `PI_UPSTREAM.md` records the runtime pin;
`docs/pi-termux.md` describes the architecture and native boundaries.

BashKitten's own code is GPL-3.0-only. Preserve third-party license notices and
the individual license metadata of dependencies.

## Change tracking

Work directly on `main` unless the user explicitly asks for a branch.
Always stage, commit and push completed changes, including documentation and plans.
Use focused commits for logical changes so features are easy to track, fix and
revert. Run the relevant checks before committing, push to the current branch's
remote, and report the commit IDs and push result.
Stage only files belonging to the task; preserve unrelated work and never commit
credentials, signing keys or personal runtime data.
Read `docs/browser-integration-plan.md` in full before browser-migration work and
after compaction. It records the requested replacement of the native wrappers
and Termux suite with one Android/Linux browser, Caddy/Authelia authentication
and optional desktop llama runtime/relay. It supersedes the older plan and the
current-implementation descriptions below where those requirements differ;
it does not claim that migration is already implemented. The migration keeps
one product repository: `/agent` for the existing shared app, `/browser` for the
Gecko subtree and `/auth` for tracked Authelia/Caddy/Tor source and isolated
Termux build patches. Any installed `com.termux` must be able to request native
browser approval, regardless of signer; already authorized calls run directly.
Preserve dynamic-port discovery. One Agent power control owns both Android wake
locks and whole-group start/stop, including owned Pi workers. Target full Linux
amd64/arm64 .deb packages, a Termux aarch64 .deb with the Pi browser extension,
and the Android APK. Reuse WildBuzzard's working component-artifact/GHA compiler
cache workflow for desktop builds. Bring Buzzard Search into `/agent/search`
as a native Python helper with a normally discovered Pi skill. DDGS only for
now; SearXNG integration is deferred. Preserve full Markdown saving, native
Termux dependency recipes and Unsloth/other retained license provenance.
Package our own native search runtime for Linux amd64/arm64 as well as Termux
aarch64; do not require a separate DDGS install. Supply distinct mobile/Termux
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

Bind to 127.0.0.1. Keep the local web account, Argon2id password hashing,
HttpOnly/SameSite cookies, Origin/CSRF checks, private storage permissions and
filesystem path confinement. Do not expose provider credentials in browser
status, logs or URLs. Disable startup catalog/update traffic and telemetry.

Use Node >=22.19, plus ripgrep and fd. Keep BashKitten-owned test suites,
fixtures, instrumentation apps, probes and test dependencies outside this
repository and all application/release artifacts. Verify production builds on
Linux and disposable Android devices with external tools. Never seed production
profiles with test providers or chats. Use stock, hardware-accelerated Cuttlefish
with 64 GiB userdata for Android testing. The user explicitly rejected a separate
16 KB software-emulated guest; do not recreate it or change the stock kernel.
Keep build-time 16 KB alignment checks and report runtime coverage accurately.
External checks must reserve isolated ports,
stop all their owned processes in cleanup, and verify normal-profile startup too.
Preserve unmodified upstream sources and
licenses. Do not commit runtime credentials, node_modules or personal sessions.

## User-facing documentation and license delivery

Keep README and release notes short, factual and for users. Preserve developer
details in docs/usage.md, packaging/README.md and the implementation status.
Audit desktop menus, submenus, settings and built-in pages for inherited
Firefox/Mozilla product, support and promotional links and controls for removed
services. Remove those affordances while preserving working browser functions,
DevTools, normal extension support and mandatory offline license attribution.
The native apps are browsers and the separate server is part of BashKitten:
its .deb bundles Pi/npm dependencies; Node, Termux and OS libraries are external.
Use the browser's native menus and appearance settings. About contains separate
engine and bundled-component license buttons, available without login or backend.
Do not restore the duplicate Agent shell menu or standalone web About/licenses.
Keep About text accurate for both. Generate full offline license texts from
actual bundled artifacts; fail builds on missing texts. Preserve source licenses,
including native transitive dependencies, and publish matching source archives.
