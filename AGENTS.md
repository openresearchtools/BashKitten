# BashKitten · native Pi / Linux and Termux

## 28 October Files, Office and References replacement plan

The user's new specification is recorded in
[docs/files-office-bibliography-plan.md](docs/files-office-bibliography-plan.md).
It supersedes conflicting older Files/SheetJS/LibreOffice viewer requirements;
preserve the frozen original native-plan history and unrelated requirements.
This is a plan, not a claim of implementation or acceptance.

**Mandatory for every implementing agent and subagent:** if the selected app
can provide a requested function through its native configuration, UI, APIs or
plugin facilities, use that native function. Do not reimplement it. First inspect
the pinned release's actual capabilities; write a small pluggable module/bridge
only for a specific required capability that is genuinely missing or cannot work
natively. Reuse existing BashKitten owners too. Include this rule in every
delegation and review proposed modules against it before writing them. The
References exception concerns the application boundary: do not bundle the whole
desktop Zotero application as a backend. Reuse its relevant reference-management,
translation, resolver and capture source/behavior in our backend and connector,
adapting only what that separation requires.

Use ordinary web tabs for File Browser Quantum, Collabora Online and our References
manager. Keep main Mozilla changes limited to small launch/lifecycle hooks and
a small privileged References capture/resolver extension. Reuse actual Zotero
Connector save logic with BashKitten names/icons/styling; retain donor attribution
in legal/source information, not product branding. PDFs use normal browser tabs.
Keep existing folder pickers, Git Changes and shared chat attachments; cleanly
delete the superseded internal manager, spreadsheet viewer and conversion paths
during implementation. The screenshot specifies layout/functions, not colors.

Latest clarification: Files is only a one-click sidecar folder button opening
the ordinary local service URL or the exact Chisel-forwarded loopback mapping.
Quantum opens Office through its own web UI; add no Office-specific Mozilla
integration. `office-diff` is an optional Pi/CLI tool over our Office snapshots
only, with no UI/Git/Changes integration. Reuse native Office collaboration,
native autosave/WOPI writes and the native history action/restore handshake,
with a minimal host snapshot list/storage adapter where required. Pi can
open/edit/save/export and view via native APIs and normal browser URLs. Test modules independently without browser rebuilds.
If large component builds need more capacity, additional build repos may produce
collected Linux/Termux artifacts for the normal packages, not separate releases.
Use ordinary GitHub Actions caches and uploaded artifacts only; the user rejects
GHCR registry-cache/image publishing for these builds. Split builder repos only
as needed for measured target cache capacity; do not substitute external storage.

Each owning native Linux, VM/container or Termux environment has exactly one
Quantum server and one Collabora Online server with its native kit workers,
shared by all chats, projects, folders and documents. Collabora requires no
separate PostgreSQL/RabbitMQ/Redis stack. Never launch the stack per
chat/project/tab. Libraries have separate project databases
outside repositories, served by one References module; attachments belong in
the project's Bibliography folder. Office snapshots stay outside projects.
Default to on-demand component startup through the existing backend owner:
Files on first Files use, Office on first user/Pi Office operation, References on
first use. Keep needed file/callback services alive during Office work and saves.
No heavy-stack startup just for browser launch, no per-tab shutdown and no new
automatic-idle subsystem; honor explicit saved autostart and backend lifetime.
Keep actual Office resource defaults initially and measure the whole shared
stack. All remote access retains the existing authorized Tor/Chisel/Caddy/
Authelia route. Complex implementation work uses Astra with xhigh reasoning.
Native Termux support, live human/agent editing, full citation features across
all three editors and independently iterable modules remain required; record
technical blockers honestly rather than silently reducing scope.

Citations belong to a replaceable References Office plugin and the References
backend, using native Collabora fields/anchors, UNO/kit APIs and JS extension
dialogs, not a large hardcoded Office fork. Users see normal style-rendered citations; Pi reads the
rendered text plus field/reference identities and can insert/edit those same
citations through the plugin. Preserve citation fields during ordinary prose
edits. Typed citation codes are optional input that becomes managed fields.

References must preserve Systematic Reviewer's abstract retrieval/enrichment
rules and automatic identifier/OpenAlex import flows for both UI and Pi. Borrow
search web UI ideas from the reviewer's main branch while retaining V3's stronger
identifier/provenance/abstract validation. Reuse Zotero's complete metadata
translators/schema and PDF resolver implementation, including its conservative
request queue, per-domain pacing/retries and unchanged custom-resolver JSON
syntax. The acceptance target is equivalent metadata/PDF retrieval for the same
identifier batch as native Zotero on the same machine/network with matched
resolver/access conditions. Do not replace this with a minimal DOI lookup or
aggressive parallel downloader; investigate and record parity differences.

References web UI and the shared classic citation modal must support up to
100,000 records per project database, with scrollable virtualized lists, bounded
lazy pages, indexed backend search/sort and nonblocking cancellable work. Do not
fetch/render the whole library or freeze the UI/backend loop for large jobs.
Port the actual pinned Zotero classic citation-dialog behavior into the web UI
and all three Office extension adapters: creator/item search, full multi-author
records, single/multi-source clusters, ordering, locators/affixes/suppress-author,
preview and confirm/cancel, with keyboard and phone parity. Use the same chooser
and References API for user and agent. The user rejects a mandatory 1k/10k/100k
benchmark campaign: implement scalable code and use proportionate focused local
checks with existing/synthetic metadata. Do not resolve or harvest large batches
of real citations/PDFs for testing. Verify bounded work, stale-response handling
and concurrent changes without hours-long load runs.

Latest 28 October amendments select Collabora Online throughout the active plan. Use its native WOPI integration, separate human/Pi
views and authenticated browserless WebSocket/UNO/script sessions; verify actual
released extension gates and native Termux support. Reuse upstream Quantum's
pinned Collabora/WOPI work, but keep our integration as a separately versioned
add-on with only a tiny documented provider/launch hook in Quantum. Do not spread
WOPI, snapshot, Pi or citation logic through Quantum internals or modify its
OnlyOffice protocol. Maintain a small named patch series and upstream-update
contract tests. Prefer native upstream support and remove redundant adapters.

Agents must have full end-to-end References management and live Collabora
control, preserving the reviewer's previous Zotero-backed capabilities through
our own References API: project libraries/collections/items, metadata/abstract
search/import/enrichment, PDF resolution/attachments, citations/style/refresh/
bibliography and native save/export. User and agent share the same document as
distinct authenticated views. Prefer released `cool`/`scriptinterop`, but use
available native UNO (`com.sun.star` included) wherever needed for missing
operations. Legacy deprecation warnings require isolated adapters and pinned
upgrade checks, not disabled functionality. Only a gap in the actual available
native APIs justifies a narrow extension seam. `RemoteDocumentBroker` remains a
restricted read-only example and `/co/collab` a separate coordination route;
neither is the agent editing endpoint. See the plan's section 11.1 acceptance.

Latest editing clarification: native edits must work without requiring an open
editor web UI, but agents may open the same file in ordinary BashKitten tabs to
inspect rendering, preview and check native exports. Do not interpret this as a
ban on browser use. Test standalone modules while the early browser batch is
being prepared; all plan functions remain mandatory.

Browser-facing Files, Collabora and References use HTTPS and the existing
BashKitten certificate identity/trust owner, including ordinary tabs and exact
Chisel mappings. No certificate-warning bypass, global trust relaxation or new
certificate system. References privileges cover capture/browser-assisted
resolvers, not TLS bypass. Verify real HTTPS loading in installed BashKitten.
The chat-height repair preserves the existing two-row default; do not redesign
it as a single-line composer.

Always open Collabora with light UI **and light document canvas**, preserving
stored cell/font/slide colors. Use native `ui_defaults=UITheme=light;SavedUIState=false`
and WOPI browser settings for dark-background preferences; verify runtime toggle/
Interface Settings policy rather than assuming launch defaults lock the canvas.
Only a proven missing policy hook justifies a small isolated Collabora patch.

The user explicitly authorizes an early **browser integration iteration build**
after the small Files launch/References host hooks, clean old-viewer removal and
Android excessively tall default chat/message-window sizing fix. Inspect the
existing shared UI/viewport/autogrow owner and make the smallest correct fix;
do not assume the root cause or guarantee one line. Preserve folder pickers,
Git Changes, attachments and desktop/keyboard/rotation behavior. This narrowly
supersedes older no-partial-browser-build sequencing for that batch, allowing
pluggable backends to be completed/tested without rebuilding Mozilla repeatedly.
It is not complete feature acceptance; all backend/platform requirements remain.

## 19 October Android SDK removal and source updates

The user explicitly authorizes removing Android website WebPush and the bundled
Google Play Services/Firebase SDK dependencies. Preserve the browser's local
password saving/autofill and ordinary browsing, and retain standard WebAuthn
through the existing Android framework Credential Manager where supported.
Keep provider-origin/caller validation, cancellation and truthful capability
errors; no Google developer registration, proprietary SDK exception or substitute
authentication bypass. BashKitten's native agent notifications, replies,
questions and Callback remain required and independent of website WebPush.
Desktop WebAuthn remains unchanged. Verify actual dependencies, source/notices,
APK contents and installed flows; removing a preference alone is insufficient.

The user also requests checking all bundled/built components for newer official
releases and updating applicable sources/pins/dependencies, including Firefox,
Tor, Caddy and Authelia. Compare the matching released Tor Browser lineage for
Firefox security backports applicable to the Android base. Preserve the existing
release-source/import/patch/license discipline and frozen adapted donor history;
never follow moving tags or silently replace our adapted modules. Batch the
updates with SDK removal before the next full candidate builds. AI engine builds
remain daughter-CI-only. The dated amendments in the native plan record scope;
source presence and successful builds remain separate from installed acceptance.

The user also requests embedding the tested full-file-reading extension in the
existing bundled Pi extensions. Its agent-facing tool is exactly `full-read`,
with the companion `compact_context`. Keep complete UTF-8 reads, Pi's approximate
token/context accounting, the 70% per-file limit and 20,000-token headroom before
the selected model's compaction reserve. Enforce one tool call and one file at a
time. `full-read` never compacts; insufficient space requests a handoff through
`compact_context`, then one retry. Pi and the extension own compaction and
continuation; BashKitten remains the existing UI/RPC client. Do not add separate
compaction, provider or UI machinery. Ship the source through existing packaging,
without dependence on the prototype directory or its test fixtures/live logs.

Latest 19 October chat-header correction: show the working folder followed by
the existing usage, compaction, model/runtime and subscription status inline,
with separators and wrapping only when the available width is exhausted. Remove
the redundant header Stop/Resume control; retain the composer and backend power
controls and Files. Display Termux home as `~` and its descendants as `~/…`,
recognizing the owning backend's canonical and original home spelling without
changing actual cwd, file access or another backend's paths. Preserve styling.

## 10–11 October native environments and Display plan

Latest 11 October mobile toolbar/autostart correction: keep the clickable logo
left and Display, Configuration, native Firefox menu together on the right.
Display opens the local Termux viewport; Display setup stays in Configuration.
Add a shared Autostart page and missing startup hooks/controls to individual
service setup/settings, all editing the same authoritative saved choices.
Cover Local, individual containers/remotes, Telephone, LocalAI, publishing and
Display background startup. Allow editable named startup command configurations
for main desktop Local, Termux and each container, running inside that environment
under the existing lifetime owner. No duplicate startup stores, public management
routes, permission bypasses or independent permanent host services. Custom
commands obey Close versus Quit/crash below. The plan's latest amendment records
the complete user-authorized addition and its acceptance requirements.
Selected container chats must also expose that container's own provider logins,
LocalAI and backend settings through host Configuration over its private Unix
socket, without opening the guest browser. Keep each Pi profile independent.
Containers may publish remotes, but remote connections must still use the full
Tor/Chisel/Caddy/Authelia route and separate identities/authorization; never mix
that route with local container control or add a transport/authentication fallback.

Latest 11 October desktop lifetime correction: closing a Display tab or browser
window preserves work (window Close hides to the tray, or minimizes if unavailable).
Explicit Quit, including tray Quit, force-quit or a browser crash must stop all
BashKitten-owned Pi, LocalAI, publishing/auth/Tor, remote-client/Chisel,
container workloads, display/media helpers and the container service, including
when Local is Off. Keep saved rootfs/config/history and unrelated host processes;
disconnecting a remote never shuts down that remote host. Use the existing native
browser identity/kernel guard, with bounded nonblocking cleanup. This supersedes
older statements allowing containers to survive browser Quit/death and the
Close-as-Quit preference. Android's Termux background lifetime is unchanged.
No separate container-manager UI is requested. No OS/session restart is needed
for an outdated app-owned service. See the latest amendment in the plan.

The requested next architecture is recorded in
[docs/native-environments-display-plan.md](docs/native-environments-display-plan.md).
Its **User presentation amendment — 11 October 2026**, including the later
separate-gear correction, records the latest UI: BashKitten logo toggles the
responsive flat sidebar, a separate settings gear holds all BashKitten controls
plus Providers/general settings, and the far-right native Firefox menu retains
browser functions. Settings details render in protected Gecko views using the
existing native owners, not new public management routes. Repeat the reference
Codex-style Projects/Chats hierarchy under Local, desktop Containers and Remotes.
This supersedes earlier top-bar/native-menu placement below; use the existing
native styling, distinct icons and plain user-facing labels.
The agreed original is permanently pinned at commit
`f71686dcb76402ec43bac3e6a7db8979ef0fb119`, tagged
`bashkitten/plan/native-environments-2026-10-11`. Read the
[original plan at that exact commit](https://github.com/openresearchtools/BashKitten/blob/f71686dcb76402ec43bac3e6a7db8979ef0fb119/docs/native-environments-display-plan.md)
as well as the current plan before implementation and after compaction; pass
this baseline to delegated agents. Section "Agreed original baseline" gives
the local read command. Never amend/rewrite away the baseline, move/delete its
tag or weaken its GitHub protection. Keep progress, failures and completion
evidence in separate status records; do not rewrite requirements to fit what
was implemented. Later user-authorized changes belong in new commits with
explicit dated amendments explaining what changed and why. Preserve the
original intentions and compare final acceptance against them plus those
authorized amendments; an agent's plan rewrite is not authorization to cut scope.
Ordinary implementation fixes and evidence updates remain permitted; this
preserves requirements, not a frozen implementation. It is a researched plan, not an
implementation or acceptance claim. It specifies embedded Termux:X11 without a
separate X11 APK, Linux Podman/crun environments, a native environment/project/chat
sidecar, shared XFCE customization and the requested CPU display fallback.
Display is **local Termux and local containers only**, as explicitly clarified;
saved remotes retain the existing encrypted Agent/service route. The plan
supersedes older display/frontend/lifetime requirements only where stated, and
does not authorize transport/authentication fallbacks or a Pi reimplementation.
The Pi runtime update is now pinned below; installed acceptance remains pending.
All features in this plan are equally mandatory, including user-optional or
default-Off functions and their integration, packaging and acceptance. Except for the explicitly authorized 28 October browser-boundary iteration
build above, implement and integrate the complete feature scope before the first full BashKitten
Android/Linux candidate builds. Then test all features, fix blockers across
workstreams, batch the next necessary full builds and repeat until complete.
Do not run a 40–60+ minute full build/test cycle for one feature before starting
the next. Independently buildable XFCE/Termux/modules/helpers can be compiled
and iterated earlier/faster; these checks do not replace full product acceptance
or permit a partial main-app candidate. Keep AI-runtime builds in daughter CI.
Section 17 is a mandatory coverage checklist and shared implementation/build/
test/fix cycle, not a serial feature-gate schedule. Track every feature and
subfeature; stubs, unconnected controls, dispatched builds or one working feature
do not establish completion. Keep required verification and unresolved blockers
visible rather than dropping features to finish a milestone.
Full feature acceptance must use the installed BashKitten apps: Android through
Cuttlefish's web UI in the desktop BashKitten browser, plus the native Linux
candidate on Wayland and inside the required real-Xorg test VM. Exercise all
user flows and integrations, including nonblocking behavior under load; backend
calls, shell checks, donor probes and successful builds do not replace this.
Use ADB/direct Termux for setup and diagnosis, then repeat the repaired product
flows. Record actual candidate revisions, failures and missing coverage honestly.
At implementation start, read the relevant unfinished work and failures in
the local thread **Set up Bashkitten build environment**
(`01a11b1e-1ac8-7d61-859a-eeab97f02315`) and the separate
`/run/media/user/Data/BashkittenBuild` README/verification/acceptance records.
Reuse that build environment and caches. Reconcile historical evidence against
current source and installations, and fix remaining setup/product blockers
alongside this plan's features in the same batched cycle. The saved Android
dictation failure is explicitly outstanding evidence to revisit, not a pass.
Keep host credentials in private local storage outside repositories, build
inputs, artifacts, documentation and logs.
The 11 October execution environment reports ten concurrent agents including
the coordinator, giving nine subagent slots. Use as many as useful across clear
feature/file/interface boundaries, not all nine constantly; recheck capacity at
implementation start. Coordinate shared-file ownership, integrate continuously
and parallelize independent fixes/verification as well as implementation.
Embedded Termux:X11 starts with its selected official release/nightly's exact
commit in a dedicated pristine source-import commit, full licenses/notices,
checksums and materialized pinned dependency sources. Only subsequent focused
commits strip/adapt the reusable module, paired loader, private IPC and narrow
browser hooks, marking changes and preserving attribution. Keep the original
baseline recoverable in BashKitten history and use the existing pristine-source/
named-patch layout. Never import an already modified anonymous dump, upstream
Git ancestry, nested repository or a second Firefox tree; builds never follow
a moving nightly tag. This follows the Phone donor import/adaptation discipline.
The same plan's section 12 contains the whole Android Phone/MCP-to-CLI port.
This is a device-tools/controls port only: no donor MCP server/client/protocol,
provider connections, API-key/account/model setup or client onboarding. Existing
Pi owns all model/provider connections; Phone controls expose our authenticated CLI
path to the retained Android controls.
Bundle its backend module into the main APK; no companion APK. Add Phone beside
the native top-bar +. Its panel starts with independent Telephony and Replyable
messages On/Off, calling/contact setup and delivery/speech defaults, then the
divider and Phone controls On/Off, independent control switches, then
optional Accessibility-dependent switches greyed out when unavailable. Off must
remove handlers/discovery and stop collection, with native checks on every path
regardless of wider APK grants. Remove all `phoneuse` camera/microphone control and
generic intent/MCP bypasses. Expose a concise `phoneuse` CLI/skill only through
live local BashKitten-owned Pi worker authorization, with native grant registry,
short leases, revocation and correct fork/session adoption. Do not use a general
Termux/profile token or the inherited instance token as grant-issuing authority.
State the same-Termux-UID trust limitation accurately; do not claim hostile-code
isolation. Keep all work nonblocking. Import pinned MIT donor source/licenses,
then strip/adapt in focused commits; no automatic donor replacement. Audit every
bundled component/transitive runtime dependency for telemetry, external logs and
developer callbacks, including SheetJS and Podman; remove such reporting and
require source/artifact/traffic verification before release. These are planned
requirements, not claims that the module or expanded audit is already complete.
Section 13 merges the earlier calling/contact plan into this plan and supersedes
its companion-APK design. Import Phony v2.6 at its exact release commit with full
GPL notices, mark changes, then strip scheduling, fake-call UI, external triggers
and other unused code in focused commits. Keep a small native telephony library
module in the main APK, using supported Android 16/17 managed Telecom, contact/
recents callback and keypad APIs; no Mozilla core changes, separate APK, required
telephony hardware, root/ADB/Shizuku or default-assistant role for users. All setup,
call, transport and speech work is nonblocking. Telephony, Replyable messages and
Phone controls have independent master switches; cold Contacts/Recents binds must
honor Telephony Off. Posting/replying to our messages does not require the
phoneuse notification-listener grant, a PhoneAccount or microphone permission.
Use the tested SIP-shaped Kitten contact and normal contact editor, without
contacts/call-log access. Also offer optional contacts for the user's selected
phone-connected containers/remotes: one stable opaque alias per backend under
the same PhoneAccount, direct backend selection and matching callback identity.
Names can change without retargeting contacts; deleted/revoked aliases never
route to another backend. Verify incoming contact matching separately from the
earlier general-contact probe. Termux hooks reach the native module through the
authenticated private gateway; no per-call Gecko relay or broad worker token.
Call speech runs on the phone through its Termux LocalAI, including remote chats;
remote text/control stays on the existing Tor/Chisel/Caddy/Authelia route. Add the
requested Connect to phone registration and compact per-chat Phone selector after
Subagents: Off, Call-in only, Messages or Calls. Messages allows user-initiated
calls but never agent-initiated ringing. Main settings choose new ordinary/call
chat defaults; initially ordinary Off and call-created Calls. Call replies retain
the saved mode, including Messages. Finals/questions use one deduplicated outbox
owner across notifications, calls and per-backend voicemail; no transport fallback.
Use native MessagingStyle/RemoteInput for direct replies and Android Auto's own
voice review where supported; do not promise custom car confirmation controls or
LocalAI speech inside Auto. No unsolicited message TTS or SMS/carrier integration.
Call menus announce 0 for new, then a configurable 1–9 recent enabled chats
(initial count 5); stable project/title mappings, immediate keypad, spoken input
only after menu/beep. Selected chat actions: send, read last final, stream live
completed assistant text, excluding reasoning/tools. Reuse phone LocalAI and
package the missing Silero VAD helper/model through daughter CI. End dictation
by #, silence or either (default either, 4 seconds after speech). Always read
dictated text back and require Send/Change/Add more before dispatch; browser
auto-send never bypasses this. Preserve/append drafts and cancel stale audio work.
Star opens each backend's voicemail menu with diversion/listen/reply; unanswered
or diverted calls save once without repeated rings. Per-backend clear does not
delete Pi history. Store only voicemail delivery text/references for later
playback, not audio or a shadow chat history; replies still need their original
authorized backend. Off/revocation is not diversion. Hangup leaves Pi running.
Foreground/lifetime readiness and unsupported ROMs must be reported honestly;
the earlier probes are not integrated BashKitten/OEM/Android Auto acceptance.
Section 14 plans one narrow Pi ChatGPT usage extension based on pinned MIT
`llblab/pi-codex-usage` source. Use Pi's selected subscription OAuth/account,
without credential scraping, own refresh, account fallback or a Codex process.
Show actual available weekly/short windows and labelled remaining percentages
in Pi's terminal and the web UI, beside Pillama. Weekly reset has date/time;
five-hour reset has time only. Missing/failed data is unavailable or explicitly
stale. Preserve actual durations/buckets, coalesce async requests and keep status
out of transcripts; verify the source-observed endpoint against the updated Pi.
Section 15 plans a deferred `ask_user` tool and short `ask-user` skill. Return a
pending question immediately; show choices/custom reply inline while Pi works.
Use one backend resolution owner, a 120-second optional-question deadline and
attributed answer/expiry delivery through the existing queue and stock Pi RPC.
No reply means proceed with the best long-term solution, never permission approval.
Honor Stop/Off, session/fork identity, durable deduplication and held ambiguous
crash deliveries. Web, call, notification and voicemail share question resolution;
recording/read-back never extends the deadline. Late confirmed replies become
attributed follow-ups, not second answers; no duplicate turns or rings.
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
on/off/disconnect/delete and the requested Connect to phone registration, no
Display path/button or settings. Remote Off disconnects the client, not the remote
host. Impose no arbitrary container count.
Project creation uses a modal folder picker on its owning backend and stores the
selected working directory. New chats under that project inherit it automatically;
standalone chat folder/default logic stays unchanged. Regrouping or reopening an
existing chat never rewrites its native Pi cwd/history.
Add a concise, normally discovered `chats` Pi skill with one deferred read-only
list/search/read adapter. Reuse sidecar project/title/session mappings and Pi's
native history parser; no duplicate transcript store, background index, worker
startup or cross-chat messaging as a side effect of lookup. Explain backend-local
history locations; another backend requires an existing authorized access path,
not a new cross-machine discovery service.
Plan one shared XFCE desktop-use skill, named `termux-use` inside the owned
Termux backend and `computer-use` inside managed containers. Stock Pi discovery
must expose neither on ordinary Linux hosts/unmanaged backends; select by Pi's
execution role, not browser platform or DISPLAY. Use xdotool, scrot and a small
read-only AT-SPI/PyGObject tree inspector, with current owned X11/D-Bus context.
Teach inspect/capture, focus, input and verification with fresh coordinates;
no Sway CUA import, MCP server or hidden polling. Preserve the protected Agent
outside the controlled X server and keep Android `phoneuse` separate.
Name the shared desktop customization BashKitten OS, with a BashKittenOS `.deb`
and native Termux counterpart (`bashkitten-os` package identifier). Install its
BashKitten OS settings app in Applications and pin it by default in new desktop
profiles. Reuse existing scaling/two-app settings; retain later user pin/unpin
choices. This is the customization package within BashKitten, not a separate OS.
Use one XFCE workplace by default, not one per application. Add persistent
per-environment Manage window size, initially On: maximize eligible resizable
normal main windows within the workarea, while preserving Gnozzard-style
transient/type exclusions and Xfwm's parent/group-modal handling. Dialogs, file
pickers, utilities, menus, tray/launcher and in-app modals do not maximize or
dissolve a split; independent same-app main windows remain eligible. Off removes
the divider and all custom sizing enforcement, disables Two app mode while
retaining its saved choice, and leaves normal XFCE/app placement and user control.
Do not reset existing geometry or let stale callbacks reapply it. On resumes
without restarting apps or restoring a stale pair. Only another eligible main
window ends the active pair; size hints/fullscreen remain respected. Keep this
nonblocking and independent of scaling, appearance and display-resolution changes.
Its settings include a persistent per-environment Dark/Light preference for
applications to read through standard session/toolkit/portal settings. Keep
BashKitten OS's own dark/orange colors and user wallpaper unchanged; do not alter
the host's preference or force all apps dark with global theme overrides.
Automatically match guest display resolution to the actual Firefox Display tab
viewport on desktop and Android, including window/sidebar resizing, rotation
and keyboard insets. Preserve the user's independent desktop scaling choice;
reuse the Buzzard resize flow and embedded Termux:X11's native resize machinery.
The shared XFCE customization defaults to one normal bottom taskbar with an
Applications button with the existing BashKitten icon and running-window buttons
plus an application tray at the right, on both Termux and Linux. Replace the XFCE
icon with the proportionally sized kitten-with-glasses branding, superseding
the earlier text-only choice; no
clock/date, preseeded network/audio/power/status applets, workspace switcher or
Show Desktop button. This latest tray requirement supersedes the earlier no-tray
rule. Use the pinned stock systray plugin for StatusNotifier and legacy XEmbed,
with no app allowlist or second tray plugin; preserve user item/menu/hide/order
choices. Each tray uses its own guest X server/session bus, never the host bus.
The existing BashKitten tray is browser-window-owned; add the small guest-side
indicator needed for automatic container startup, with truthful status and the
existing authorized activation/lifetime path. Its Open targets that guest;
explicit Quit/Stop targets only its BashKitten service owner, never host-global
Quit or container deletion/shutdown. Indicator closure must not stop services.
Do not create a second protected
Agent in the controlled guest just to obtain its icon. Panel/window closure must
not stop the container. Underlying services remain available.
Remove the extra launcher dock, pinned taskbar shortcuts and default desktop icons;
use the stock tasklist with a narrow Two app mode patch, not a Docklike layout.
Apply defaults once, preserve user edits, and keep the bottom workarea correct
through keyboard/rotation/resize/scaling changes.
Start opens one maximized native launcher within the Display desktop workarea:
top search, ordered persistent pinned apps, one divider, then remaining apps in
an alphabetical left-to-right wrapping icon/title grid with vertical scrolling.
Reuse Gnozzard's simple search/pin/launch actions and exact dark/orange colors
for panel, Start, desktop defaults and Thunar. Preserve user wallpaper/placement
and appearance changes across launch, scaling, rotation, restart and upgrades.
The default wallpaper is #202225 with the existing transparent BashKitten logo
centered proportionally: shrink to fit when needed, never exceed its native
1254 × 1254 resolution. Preserve any subsequent user-selected wallpaper;
the small Applications-button logo remains separate from wallpaper selection.
This replaces the earlier built-in popup/Garcon patch and Firefox-gray palette;
pins belong inside Start, not the taskbar. All loading/search/helper work remains
nonblocking. Use the shared GTK package, not GNOME Shell or a second desktop shell.
Linux container desktops also get Gnozzard-equivalent application actions in
Thunar/XFCE: direct/persistently extracted AppImages, explicit no-sandbox mode,
`.desktop` launcher registration, `.deb` installation through passwordless guest
sudo with APT dependencies, and Applications menu/optional desktop shortcuts.
Reuse the donor helper functions and Buzzard's Thunar integration with one
implementation; no GNOME/Nautilus dependency, host installation or native Termux
Debian-package path. Keep all work off UI threads and preserve user custom actions.
No shortcuts/dock are preseeded; explicit Add to Desktop remains available.
Preserve Gnozzard's complete AppImage original-path, extraction-reuse, arguments,
no-sandbox-marker and registration/rename rules; Add to Desktop also registers
in Applications. Keep normal `.desktop` source/field-code behavior and all
applicable menu actions, using one helper shared with Thunar.
Track in this repository the release sources for everything we build/bundle,
including private Podman/crun/helpers and SheetJS/other JavaScript components.
Use latest official releases within the selected supported line, exact peeled
commits and source checksums; builds consume committed pins, never moving refs.
Materialize required dependency sources, keep patches/locks/provenance and full
licenses/notices, and preserve the compact Firefox history policy. Extend the
existing offline About/package license and matching source-archive delivery to
all direct/transitive components in the expanded app and container packages.
Missing source, provenance or full license texts must block release preparation.
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
The user's 19 October licensing clarification retains CUDA in the separate
MIT-licensed AI runtime repository. Do not apply the browser's source-only
release requirement to NVIDIA's closed toolchain/runtime components in those
optional downloaded engines. Record their exact versions, checksums, provenance
and full NVIDIA notices, and state when original implementation source is not
available; do not relabel NVIDIA code as MIT or bitcode as original source.
Source-available engine/dependency code still requires matching source and
notices. This does not permit proprietary SDKs in the browser APK/DEB or change
BashKitten's AGPL and inherited Mozilla MPL file licenses.
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

This branch reuses BashKitten's browser UI with unmodified Pi 1.3.0
(`71023aec1546d6d677a65669c5665c0927ce0dd0`). It contains no Rust backend or
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
