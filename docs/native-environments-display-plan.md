# BashKitten native environments, desktop and Display plan

Requested and researched 10 October 2026. **Status: implementation plan only.**
No application code, package, installed runtime or working user flow is delivered
by this document. Research used BashKitten `a39f8b1d1ab8ab0ee202a5bb174f905578e83333`
and the pinned sources below; integration and acceptance remain future work.

This is the controlling plan for the requested native sidebar, local containers,
embedded Termux:X11 and shared XFCE desktop. It supersedes conflicting separate
X11 APK, external Display window, folder-only chat grouping and display-rendering
restrictions in the [browser plan](browser-integration-plan.md) and
[remote plan](remote-tunnel-plan.md). Other requirements in those plans remain.
The latest sidecar specification also replaces the large Local/remote selector
and global Agent power placement with listed backends and per-backend controls;
project membership is optional.
The Android Phone module and MCP-to-CLI port are part of this same plan in
[section 12](#12-android-phone-control-and-the-mcp-port), including optional
Accessibility, enforceable feature switches and owned-Pi session authorization.
The explicitly requested CPU display fallback does not authorize fallback in
Tor transport, authentication, AI runtimes or unrelated features.

**Latest clarification:** Display is for **local Termux and local containers
only**. Saved remotes keep agent chats and their existing service connections;
this plan does not add remote desktop streaming. Local container connections
use private Unix sockets. Publishing a container as a remote uses the existing
Tor/Chisel/Caddy/Authelia implementation without changing its intended route.

## 1. Result the user should get

- One scrollable, browser-owned sidecar lists Local, named container environments
  and saved remotes, with projects and ungrouped chats beneath each backend.
  One **+** offers **Connect to remote** and, on Linux, **Create container VM**.
  Remove the large Local/remote/container dropdown. Environment names, project
  names and chat titles are editable; no chat is required to belong to a project.
  There is no arbitrary limit on the number of containers a user can create.
  Creating a project opens a folder-picker modal to choose its working directory;
  new chats created under that project inherit the directory automatically.
  Standalone chats retain their current folder-selection/default behavior.
- Selecting a chat opens the existing shared chat UI. The native hierarchy owns
  navigation; the web UI becomes the opened chat, retaining transcript, composer,
  reasoning/tool streaming, subagents, Files/Changes and existing chat functions.
- Display opens a special native tab: Termux:X11 on Android, or the selected
  local container desktop on Linux. No separate Termux:X11 APK or desktop GTK
  viewer window is required. Browser tabs and the protected Agent remain distinct.
  Each container heading has a compact window/Display button that opens its full
  viewport tab, alongside Settings and that container's on/off toggle. Remotes
  have no Display path/button or settings button; their controls concern only
  connection on/off, disconnect and deletion of the saved remote.
- Creating a Linux container opens a preparation view with real installation
  output. The saved Containerfile and ordinary Podman launch configuration remain
  editable by the user or Local agent. GUI helpers edit that same configuration.
  Its user-chosen name maps to its own machine directory under BashKitten's
  existing user-data root, including the rootfs and all durable machine state.
  Retain the machine lifecycle helpers, including explicit machine deletion.
- Each container has its own BashKitten installation and private Pi profile.
  Its agent/browser runtime stays available while the container runs. Closing a
  Display tab or browser window does not stop the container. Each container has
  its own startup toggle and settings for launch configuration, existing ports,
  media/input integration and remote sharing.
- Termux runs the same customized XFCE experience without containers. Apps open
  maximized by default. An optional split-screen setting enables a taskbar
  **Two app mode** action and one draggable divider between the two apps.
  Both platforms use one bottom taskbar containing only an **Applications**
  button with the BashKitten icon and running-window buttons: no XFCE menu icon,
  clock/date, network/status widgets or system tray. Applications opens a
  maximized application launcher:
  search at the top, pinned apps beneath, one divider, then all remaining apps
  in an alphabetical left-to-right wrapping icon/title grid. It adapts to phone,
  tablet and desktop sizes and scrolls vertically. Omit the extra launcher dock,
  pinned taskbar shortcuts and default desktop shortcut icons.
- The desktop customization is named **BashKitten OS**, packaged as its own
  `.deb` (for example `BashKittenOS.deb`) and native Termux counterpart. Its
  **BashKitten OS** settings app appears in Applications and is pinned by default,
  providing the requested scaling and desktop settings. The package provides
  PeGPU's scaling functions directly, Gnozzard's exact dark/orange palette for
  the taskbar, background, Start menu
  and Thunar, plus Xfce Terminal. The default desktop background is the same
  dark color with the existing BashKitten logo centered, never enlarged beyond
  its native image resolution. Preserve later user wallpaper/appearance choices.
  PeGPU's initialization scripts and the old Buzzard shell/CUA stack are not
  imported.
- Display resolution automatically follows the actual Firefox tab's drawable
  size on Linux and Android, including host-window resize, phone rotation and
  keyboard appearance. The user's desktop scaling choice remains independent
  of that automatic resolution; no manual resolution selection is required.
- Linux container desktops also retain Gnozzard's application installation and
  registration functions through Thunar: AppImage running with or without
  persistent extraction, `.deb` installation with dependency resolution and
  passwordless guest sudo, and adding applications/launchers to the Start menu.
  Explicit user-created desktop shortcuts remain available; none are preseeded.
- Android's native top bar also has **Phone** beside **+**. Its simple settings
  panel controls a backend module bundled into the main APK: master On/Off,
  independent feature switches, then optional Accessibility-dependent switches.
  Local BashKitten-owned Pi sessions use the `phoneuse` CLI/skill. Disabled
  features have no active handlers, collection or command exposure; camera and
  microphone control are removed from this module. No companion APK is needed.

Product UI, executable/package names and new configuration use **BashKitten**.
Keep original donor names in licenses, copyright notices and provenance.
“Container VM” here means a persistent Podman desktop environment sharing the
host kernel; it is not a new hypervisor or a separately booted guest kernel.

### Implementation discipline: merge only the needed code

Write only the code needed to deliver these specified functions. Bring the
applicable BuzzardOS code directly into BashKitten and adapt its existing owners,
helpers and APIs; do not maintain it as a second product, require a separate
Buzzard installation/release, or build an elaborate compatibility/framework layer
to preserve its former product boundary. This is the requested product merge.
Retain the exact donor provenance and licenses while using BashKitten naming.

Reuse existing controllers and upstream facilities; keep new code limited to
the missing integration, native viewport/process boundary and requested behavior.
Remove replaced dropdowns, duplicate controls and superseded implementation paths
instead of running both designs. The Display module's narrow Firefox integration
is required for maintenance, not a reason to introduce a generic plugin system,
extra abstraction layers, options or features. Do not change unrelated work or
delete donor repositories/history as part of writing or implementing this plan.

## 2. Audited starting points

| Source | Verified starting point | Reuse or required change |
| --- | --- | --- |
| BashKitten | `a39f8b1d1ab8ab0ee202a5bb174f905578e83333` | Existing private controllers, protected Agent, per-session Pi workers, native remotes, display launcher and packaging. |
| [BuzzardOS, podman branch](https://github.com/openresearchtools/BuzzardOS/tree/6c1b89f25c196ae7ab4a8f20e166b27e4ee94cc0) | `6c1b89f25c196ae7ab4a8f20e166b27e4ee94cc0`, inspected in `buzzardospodman` | Persistent external rootfs, native runtime setup, private display/media gateways, settings and sudo bridge. Its current desktop is Sway-based and its host viewer is Wayland/GTK/DMA-BUF-only; those are not the requested final frontend. |
| [Podman v6.1.3](https://github.com/podman-container-tools/podman/releases/tag/v6.1.3) | `85b994955e0b4e30fbce9c8351cab85676140ede` | Latest official stable release verified 10 October 2026; vendor its release source and build the private local engine for both Linux architectures. |
| [crun 1.30.1](https://github.com/containers/crun/releases/tag/1.30.1) | `079ff6a7a16d029460af882f9ea44674e6a510b6` | Latest official stable release verified 10 October 2026; supersedes the donor's older crun pin for this implementation. |
| [Termux:X11](https://github.com/termux/termux-x11/tree/fa3a8b430e2896a19f44c99a9cb056254615ae06) | Official nightly resolves to `fa3a8b430e2896a19f44c99a9cb056254615ae06` | Reusable `lorie` Android library, native X server/rendering, input and loader. Pin the exact commit and native dependency gitlinks; do not build a moving nightly reference. |
| [PeGPU v0.1.106](https://github.com/openresearchtools/PEGPU/tree/aae5382fae02eaeb97ceeb7fcaa531f88009b081) | `aae5382fae02eaeb97ceeb7fcaa531f88009b081` | MIT scaling helper. Relevant scaling/package-choice files match inspected HEAD `8ecbb5d4fad90f7e74dd29351c37c4de9aada84b`. Actual apps are Thunar and `xfce4-terminal`, not Nautilus. |
| [Gnozzard](https://github.com/openresearchtools/gnozzard/tree/59ca6d56ef147dea820381036838e76645074d0e) | `59ca6d56ef147dea820381036838e76645074d0e`, checked against GitHub main | Installer/registration and search/pin behavior, exact dark/orange palette and persistent wallpaper defaults; adapt to Thunar/XFCE and the requested maximized grid. Code/CSS GPL-3.0-or-later; retained folder artwork has its own LGPL-3.0-only notices. |
| [XFCE panel](https://gitlab.xfce.org/xfce/xfce4-panel/-/tree/xfce4-panel-4.20.7) | `f4e21b14a389fa6b7cc4fd756cb92e0a822ed3e5` | Stock Window Buttons/tasklist for the normal bottom taskbar. Its per-window menus need a narrow source patch for Two app mode; the public plugin menu API is not a per-window extension hook. |
| [SheetJS CE v0.20.3](https://git.sheetjs.com/sheetjs/sheetjs/src/tag/v0.20.3) | `8a7cfd47bde8258c0d91df6a737bf0136699cdf8` | Existing `xlsx` spreadsheet parser; official annotated release tag peeled to this commit. Vendor the source and matching official release distribution with Apache-2.0/component notices. |
| [Pi v1.1.0](https://github.com/earendil-works/pi/releases/tag/v1.1.0) | Published 7 October 2026; `abe508e1b89912adde45528136c3221eb69acdd7` | Planned update from current v1.0.2. Durable is a separate experimental package, not an automatic change to BashKitten's stock RPC sessions. |

Research checkouts and notes are outside the product tree under
`/home/user/Bashkitten-Research/graphics-2026-10-10/`. The plan's source links and
pins are portable; implementation must not depend on that workstation directory.

## 3. Native module and ownership

Keep the integration in a product-owned Display module with thin platform hosts.
**It is a native viewport hosted like a tab, with its display frontend/rendering
in its own child process, separate from the browser UI process.** A worker thread
inside the UI process alone does not meet this requirement. On Android the host
embeds the child-owned native surface; on Linux it presents child-produced native
frame buffers through Gecko's existing graphics facilities. The browser owns tab
chrome, selection and the viewport slot, not the desktop renderer's execution.

Make the module reusable when rebasing to future Firefox versions. Keep its
display protocol, child-process renderer, input mapping and backend adapters in
one product-owned source/build module. Restrict Firefox/Fenix changes to small,
documented hooks for registering the native tab/viewport, lifecycle/focus/resize,
process launch/exit and asynchronous IPC/surface attachment. Keep those hooks as
a reviewable integration patch set; do not scatter desktop implementation across
tabbrowser, networking, layout, Agent web UI and general Gecko process selection.
Future upgrades should primarily adapt that small host contract and rebuild the
module, rather than port the feature by rewriting large parts of Firefox.

Use existing Gecko process/IPC/compositor machinery where it fits, preserving
ordinary tabs' process model and isolation. The exact native child launch and
surface integration must be proven in the first gate; a normal WebExtension or
setting a tab attribute does not automatically provide it. Firefox distinguishes
content and helper/GPU processes, so this native renderer need not masquerade as
an ordinary web document to get its own process. See upstream's
[process model](https://firefox-source-docs.mozilla.org/dom/ipc/process_model.html)
and [IPC documentation](https://firefox-source-docs.mozilla.org/ipc/index.html).
This is a maintained native module with narrow integration seams, not a promise
that upstream internal APIs never change.

The small browser-facing contract is: open/select/attach a display by environment
ID; supply the measured content viewport and focus; deliver input; detach on
tab closure; report readiness/failure. Explicit backend Start/Stop remain separate
controller actions. Ordinary web content cannot supply a socket path, command,
FD or native environment identity. Use existing native permission and controller
boundaries, with connection-generation checks for late asynchronous replies.

**Automatic display resolution:** the native tab host is the source of the
current drawable size, not a saved monitor resolution or the browser's outer
window size. Forward actual tab/window/sidebar/inset changes asynchronously to
the selected environment. On Linux, adapt Buzzard's native-window resize flow
to Firefox's tab and propagate it through the private gateway to rootful
Xwayland/XRandR. On Android, retain Termux:X11's native view/window-change flow
inside our embedded tab, including keyboard shrink/restore and rotation. Update
the guest's actual screen dimensions and matching input-coordinate transform;
stretching an unchanged desktop bitmap does not satisfy this requirement.

Coalesce rapid changes, keep geometry/frame replies tied to the current view,
and ignore stale or zero-sized hidden-tab measurements. Reattachment uses the
new tab's actual size without restarting the desktop/apps. Keep the saved
BashKitten OS UI/font scaling independent: a resize must not reset scale, pins,
wallpaper or app state. Recompute the panel workarea, maximized/split windows and
launcher grid from the accepted dimensions. No UI-thread wait, polling loop or
manual resolution selection is needed for this normal flow.

```text
Browser-owned sidecar
  Local / container / saved remote
       ├── chat (optional project) -> protected shared chat view -> stock Pi
       └── Display (local targets only)
             Android: native View <-> private Binder/FD handoff <-> Termux X11
                      (child renderer; browser hosts its viewport surface)
             Linux:   viewport <-> renderer child <-> private guest gateway
                                          <-> rootful Xwayland <-> XFCE/apps

Local container administration: native controller -> private Podman + crun
Local guest Agent:               private Unix endpoint -> existing Agent service
Published guest Agent/services:  existing authorized Tor/Chisel/Caddy/Authelia route
```

Do not mount the host's real X11/Wayland session, D-Bus session or unrestricted
PipeWire socket merely to show a guest desktop. Reuse the donor's private guest
endpoints and explicit media bridges. Each container has its own endpoint and
ownership record; one shared top-level directory can contain these endpoints,
but one container must not acquire another container's control channel.

The Display view can appear in native tab navigation without becoming an
arbitrary web page or a second copy of the Agent UI. Browser automation continues
to exclude protected Agent/authentication views. Display input is focused only
on the selected native surface; browsing retains normal browser shortcuts and
input when that surface is hidden.

Keep three lifetimes explicit: browser tab host, its disposable renderer child,
and the persistent Termux/container desktop service. A child crash or hang shows
an error for that view while other tabs, Agent and sidecar remain usable. Closing
the tab cancels its IPC and releases/terminates only that child and presentation
resources. It does not kill the Termux server or container gateway/Xwayland/Pi.
Reopening can attach a fresh renderer to the same running desktop. Pass only the
selected display's typed messages and required descriptors to the child, not
general native controllers, remote credentials or unrestricted browser state.

### Nonblocking UI, including the native Display surface

This is a requirement for every feature in this plan, not only installation or
backend jobs. The browser UI, native Display tab/window, sidecar and shared chat
must remain interactive while an environment is busy, slow, unavailable or
producing expensive frames. Moving a desktop into a native View does not exempt
its rendering path from this requirement.

- Keep filesystem/rootfs work, Podman/package operations, process launch/waits,
  socket/Binder I/O, display handshakes, frame copying/conversion/import and GPU
  fence waits off Android's UI thread and Firefox's main/UI event loop. Backend
  controllers also dispatch long or CPU-heavy work asynchronously so one machine
  cannot stall other requests. Reuse upstream render/worker threads inside the
  separate renderer child and normal asynchronous compositor interfaces;
  do not synchronously wait for a worker
  result from the UI thread.
- UI-thread work is limited to bounded input/state/layout updates and scheduling
  presentation. Use asynchronous completion with attachment/environment generation
  checks so a late frame or operation cannot update a closed tab or the wrong
  machine. Report preparing/reconnecting/errors in that surface without blocking
  the rest of the browser.
- Bound in-flight frame ownership to the renderer's buffer lifecycle and apply
  backpressure. Prefer the latest presentable frame rather than accumulating an
  unbounded backlog or copying stale frames on the UI thread. Preserve buffer
  release/fence correctness and ordered key/button transitions. Coalesce resize
  and redraw work without blocking input or silently losing a final key release.
- A blocked GPU, missing frame, stalled guest or disconnected IPC must not stop
  tab switching/closing, sidebar/chat interaction or browser window resizing.
  Detachment and cancellation return immediately to the UI while owned teardown
  finishes asynchronously. Preserve the specified independent guest lifetime.
  Hidden/detached views stop unnecessary presentation work; the retained gateway
  still services the guest protocol and releases buffers correctly.
- Apply the same asynchronous ownership to create/start/stop/restart/delete,
  settings reads/saves, project operations and live installation output. Progress
  delivery must not flood the UI event loop, and one pending operation must not
  serialize unrelated environments or browser navigation behind it.

Verify responsiveness in the actual product under active provisioning, mapped
rootfs deletion, rapid frame updates, software rendering, resize/rotation and a
deliberately stalled display/backend. Confirm that chat, navigation, tab closure
and cancellation still work. An asynchronous API name or a successful build is
not evidence of responsive behavior.

## 4. Sidebar, projects and stock Pi identity

### Backend headings and navigation

The sidecar itself is the backend list; selecting a chat or Display view selects
its owning backend. There is no second large backend dropdown to keep in sync.
The single **+** entry starts the existing remote-connection flow or local Linux
container creation. Android offers remote connection and retains Local Termux;
it does not offer unsupported container creation.

```text
+  -> Connect to remote / Create container VM (Linux)
Local                         [on/off] [local settings] [Display on Termux]
  Ungrouped chat
  Project
    Chat
Container name                [on/off] [Settings] [window/Display]
  Ungrouped chat
  Project
    Chat
Another container             [on/off] [Settings] [window/Display]
  Projects and/or ungrouped chats
Remote name                   [connect/disconnect] [disconnect/delete actions]
  Projects and/or ungrouped chats
```

This is a structural sketch, not a requirement to print the word “Ungrouped” or
add another heading for each individual chat. Keep controls compact and aligned
on each backend title row, using the existing matching icon design. The window
button opens/selects that container's full native Display viewport tab, not a
thumbnail or an embedded panel in the chat transcript; it does not force OS
fullscreen. Local Android's equivalent opens Termux Display. Linux Local does
not gain an unrelated host-desktop capture path.

| Backend row | Controls and ownership |
| --- | --- |
| Local | Its own on/off toggle and existing local settings/actions; Display only for Local Termux. Off stops Local's owned Agent/Pi/services/display/wake-lock group without stopping containers or disconnecting independent remotes. |
| Each local container | Its own on/off toggle, Settings and window/Display button. On/Off starts/stops that environment; Settings retains its config/startup/ports/media/sharing and lifecycle/deletion helpers. |
| Each saved remote | Connection on/off and saved-connection disconnect/delete actions only. No Display endpoint/button or remote settings button. Off disconnects this client's existing tunnel/mappings; it does not stop or power off the remote host. Delete forgets the saved connection through the existing removal flow, not the remote machine or its data. |

Use one remote toggle as the normal connect/disconnect action; if Disconnect also
appears in the existing row actions, it invokes that same operation. Do not add
duplicate standalone controls for the same action. Move the current global Agent
toggle to its owning backend heading and remove its superseded placement. Keep
container management accessible when Local Pi is off. Per-backend power is
separate from per-container startup preference and the application's existing
Quit behavior. Show actual starting/stopping/connected/error state asynchronously;
an Off backend remains listed with its saved identity. Already loaded remote chat
metadata may remain visible without implying that its disconnected state is live.

Remote rows do not become host-management surfaces. Preserve the existing
authorized remote Agent/service transport and its boundaries without adding a
generic settings entry to those rows. Local/container Share Local remains in
its owning native settings, as specified below.

### Optional projects and native session identity

Current `agent/src/web/web_ui.html::renderSessionSidebar` groups sessions by
`cwd`. Current rename already uses the worker's stock Pi `set_session_name` RPC.
Retain that operation; independently named project grouping is new metadata.

Use the existing native connection catalogue and session metadata rather than
introducing another transcript database:

| Identity | Meaning and owner |
| --- | --- |
| Environment ID | Stable native catalogue identity for Local, a local container or a saved remote; separate from its editable name and current socket/port. |
| Project ID | Optional stable record on the owning backend, with an editable name and selected working directory for new chats. An absent project ID means a standalone chat directly under that backend. Existing sessions retain their own recorded cwd. |
| Chat reference | Environment ID plus the existing BashKitten session ID; backend resolves its existing native Pi session reference. |
| Chat title | Pi's native session name through supported RPC; existing metadata is only its UI index. |

Projects optionally group chats within an environment. Users can create a chat
directly under Local, a container or a remote without creating/selecting a
project. Moving a chat into, between or out of projects updates only
its grouping reference, not its Pi JSONL path, working directory, credentials,
running process or history. It does not transfer a session to another machine.
Keep subagent parent/child references and queue/edit ownership intact. Future
calling hooks resolve the same stable environment/chat references; display names
must never become call-routing keys. Calling, contact, STT/TTS and phone-hook
implementation remain the separate calling work, not additions to this feature.

### Project creation and inherited working directory

Creating a project opens a modal folder picker using the existing working-folder
browsing/validation code. The user selects a directory on the **owning backend**:
Local's filesystem, the selected container's filesystem or the selected remote's
filesystem. A host path is not substituted for a guest or remote path. Save the
validated directory with the project's ID/name; cancelling the modal creates no
project. This selects an existing working directory, not a requirement to create
a repository, clone one or install dependencies.

New chats created under that project automatically use its saved directory as
the cwd passed to the existing stock Pi new-session flow. Do not ask the user to
choose it again or silently use the backend's standalone default instead. Recheck
that the directory is still permitted and usable when creating the chat; show
the actual error if it has disappeared or is inaccessible, with no substituted
directory. Keep folder listing/validation asynchronous and cancellable, using
the selected backend's existing authorization and platform folder scope.
Keep Termux choices within writable home directories and Linux choices within
home/explicitly configured project roots. The remote folder picker retains the
existing file-manager permission and live revocation checks; project creation
does not bypass them. Save/create validates the exact directory without the
folder browser's optional nearest-parent fallback.

Standalone chats keep exactly the current new-chat folder/default logic. Opening
an existing chat restores Pi's recorded cwd. Moving an existing chat into or out
of a project remains a grouping operation and does not rewrite that session's
cwd/history; automatic directory inheritance applies to **new** project chats.
Project creation does not change the backend's global default working directory.

Native controls call the existing session operations through the selected
backend's authorized connection. Project metadata operations use that same
authorization. Remote names/titles are untrusted text and confer no native
authority. Preserve the remote file-manager permission independently of chat
listing/grouping; renaming a project is not permission to browse its filesystem.

The native sidecar is scrollable and keeps the selected chat, expansion and
scroll position when session status changes. Desktop uses its sidebar; Android
uses the corresponding narrow-screen native drawer. Retain pagination and
asynchronous loading so an unavailable environment does not freeze Local or
another environment. A stopped/disconnected environment stays named and shows
its actual state rather than disappearing or silently selecting a different one.
Support as many container records as the user creates without a product-imposed
count limit; incrementally render/load the list rather than doing unbounded work
on the UI thread. Actual available disk, memory and OS resources still govern
whether another environment can start, with the real error shown.

Preserve explicit existing project associations, but do not turn every `cwd`
into a mandatory project. Chats with no explicit association remain directly
under their backend. Keep working-folder metadata independently, without altering
session history or automatically starting every worker. Remove the superseded
web hierarchy and its duplicate navigation handlers once native navigation is
wired; preserve chat-specific controls, folder selection and Files/Changes.
Keep the native draft/checkpoint behavior across chat and environment changes.

### Small Pi skill for finding and reading other chats

Ship one short, normally discovered **`chats`** skill on Linux and Termux so an
agent can find an earlier conversation when the user refers to it. Explain that
the sidecar's projects/titles are metadata around native Pi sessions, and that
each Local/container/remote backend owns its own chats. This is a small read-only
lookup/read facility, not a second agent manager or a semantic-search system.

Use the same environment/project/chat catalogue as the sidecar as the tiny router
from names to stable session references. Do not maintain a second title index or
copy transcripts. Reuse `common.mjs` session metadata and the native parsing
logic in `rpc/rpc.mjs::savedSession`, with Pi's parser and in-memory session view.
Use the already-loaded Pi SDK in a pure reader rather than invoking runtime/profile
bootstrap from lookup; even the current `loadPi`/runtime imports can initialize
profile files or runtime-selection metadata. Preserve the existing message-text
and attachment references when presenting parsed entries.
Do not route reads through helpers that import discovered sessions, update
metadata or start a worker as a side effect. Existing `discoverSessions` and
`savedView` have such mutations and are not read-only contracts to copy blindly.

Expose one small `chats` adapter through the existing Pi extension with stock
`exposure: 'deferred'` and `tool_search`, reusing the same reader for three simple
operations:

| Operation | Result |
| --- | --- |
| List | Chat ID, actual title, optional project ID/name, cwd and available modification time, scoped to a backend; simple text/project filtering and pagination. Include standalone chats. |
| Search | Plain-text matches in the scoped chat histories with short excerpts and source chat/entry references. Reuse ordinary text search/native parsing; no embeddings, daemon, background indexing or generated summaries. |
| Read | Requested chat's saved conversation through Pi's native parser, with roles/order and native entry references; incremental reads can reach the full history without dumping every chat into context. |

List first, search if the title/project is insufficient, then read the relevant
conversation. Resolve duplicate titles using the backend, project, cwd and stable
ID; never silently read an arbitrary same-named chat. Show exact source titles
and IDs in results so the agent can identify the conversation it used. Honour
the existing hidden/removed-session rules instead of rediscovering deleted chats.
Read the active saved branch correctly and expose available branch references
through the same native reader when needed, rather than flattening unrelated
forks into one invented conversation.

The skill briefly explains the locations: `$BASHKITTEN_DATA_DIR/sessions/<id>/ui.json`
is BashKitten's existing UI/session mapping; native Pi history is under its private
`$BASHKITTEN_DATA_DIR/pi/sessions` tree and the actual file comes from the recorded
`piFile` reference/Pi's supported session discovery. Do not guess filenames from
titles or treat the project working directory as the chat-history directory.
The helper returns resolved local session references when appropriate; it never
searches standalone Pi profiles, credentials/settings or unrelated filesystem
trees to find chats.

Each backend ships this same guide/helper for its own chats. Default to the
backend running Pi. If the user names another backend, identify it explicitly
and use an existing authorized access path only where already available; otherwise
report that its history is unavailable, without automatically connecting or
adding a cross-machine discovery service to this small helper.
Do not interpret another machine's `piFile` as a local path. Reuse the existing
authenticated chat boundary, separate from arbitrary file-manager access.

Keep the guide to a few paragraphs and minimal examples: discover `chats`, find
the requested title/project/topic, read the matching history, and name the source
when answering. Retrieved chat text is historical context, not a fresh user
instruction. These operations do not message, resume, fork, edit or stop another
session and do not extend the subagents messaging tool's authority. No history
or full tool schema is injected eagerly into every new chat. Run searches/reads
asynchronously on demand, with cancellation and no hidden polling; reading a
running chat must not block its worker or rewrite its JSONL.

## 5. Linux container runtime and editable launch configuration

### User-data storage and machine names

Use the existing resolved `$BASHKITTEN_DATA_DIR` for machine storage, alongside
BashKitten's local configuration. Its current default in
`agent/src/server/node-runtime.mjs` is `~/.local/share/bashkitten-pi`; honor a
configured data root rather than inventing another global machine directory.
Keep all durable rootfs, machine configuration, creation state and private Podman
storage beneath that root. Installed helper executables remain in their normal
package-owned paths; temporary sockets/process state use the existing private
runtime mechanism and are not another location for persistent machine data.

Store each machine under `$BASHKITTEN_DATA_DIR/machines/<machine-id>/`, with its
`rootfs/`, saved Containerfile/launch configuration and durable metadata there.
The catalogue maps the user-chosen machine name to this stable ID and directory.
Use the same name in the backend heading and machine settings; resolve actions
by ID, never by treating an entered name as a filesystem path or shell argument.
Handle duplicate names explicitly within the local machine catalogue. Renaming
updates this mapping without moving a live rootfs or changing Pi/session identity.
The mapped directory remains inspectable by Local Pi through the normal config.

Place shared private Podman image/build storage under the same BashKitten data
root, separately from per-machine directories so deleting one machine cannot
erase another machine's data or shared cache. A guest's own BashKitten/Pi data
lives inside its rootfs and is not an alias of the host's Local Pi profile.
The donor term “external rootfs” means external to Podman's image overlay; in
BashKitten it still lives inside this user-data layout. Do not keep donor
arbitrary machine directories, repository/build folders or system VM-image
locations as the default product storage model.

### Build and installation

Reuse the **podman branch** of BuzzardOS, not older Sway/VM donor copies.
Current donor packaging bundles crun 1.29.1 at
`f0d911de5587342cfeb16473bf32ecdfeaf25957` but depends on distro Podman/Buildah.
Building and packaging BashKitten's own Podman is therefore new work. Its current
package script also hardcodes amd64; add native Linux amd64 and arm64 outputs.

For the implementation, use the latest official release sources recorded above:
Podman **v6.1.3** and crun **1.30.1**, each at its exact peeled commit. Recheck
official releases when importing them; do not inherit the donor's older version
or replace a release with branch HEAD. Track those source trees in this repo as
specified in section 11. Pin matching required helpers after checking the donor's
actual usage: conmon, networking/storage helpers and any Buildah operations that
remain. Package private executables and explicit helper paths so runtime
behavior does not accidentally switch to an unrelated system installation.
Ship the full local Podman engine with build support, not `podman-remote`; a
separate Buildah executable is needed only if retained code actually calls it.
Podman v6.1.3 includes its Go dependency `vendor/`; retain that tree, `go.mod`,
`go.sum` and `vendor/modules.txt` and use its declared Go 1.26.0 toolchain.
For crun 1.30.1, materialize `libocispec` at
`872b8b0b7ccb1a121601ede0dcac8c6b8a1008a6`, including its `image-spec` at
`26647a49f642c7d22a1cd3aa0a48e4650a542269` and `runtime-spec` at
`d64c1d945da7cf6970061c7c9ff4391fafdf2a15`. A top-level source archive alone
omits those required nested trees. Resolve its actual json-c and selected native
library dependencies from this release's build configuration.
Give Podman private storage/runroot/configuration paths so it neither adopts
unrelated containers nor modifies the user's global container configuration.
Keep host kernel, user-namespace/subuid/subgid, `newuidmap`/`newgidmap` and device
requirements explicit; packaging Podman does not remove those OS prerequisites.
Missing prerequisites produce a
specific setup error, not an alternate runtime.

Provision a persistent Debian rootfs from the tracked Containerfile, with XFCE,
the customization package, Thunar, Xfce Terminal, Xwayland, native BashKitten and
the actual required guest services/libraries. Pin the Debian base release/digest
and record package/source provenance. Reuse optional NVIDIA/device integration
from the donor with compatible host drivers and architecture checks; do not
present GPU access as guaranteed merely because a checkbox was selected.

Retain donor rootfs persistence deliberately: it currently uses an external
writable rootfs bind at `/` with an empty `--rootfs` runtime anchor, not ordinary
image-overlay persistence. Keep package installations and user files across
container stop/start and browser upgrades. Do not replace that model by accident
when importing the Containerfile/build code. Preserve numeric ownership, ACLs and
xattrs through native Podman namespace operations, without recursive startup
chown. Changing UID/GID mapping for an existing rootfs needs deliberate ownership
handling; it is not an ordinary harmless launch-flag edit. Host-side `podman exec`
must use appropriate numeric users because the empty anchor cannot resolve guest
account names.

### One configuration the UI and agent both edit

The canonical launch definition contains the real Podman executable, argument
array, environment and working directory, plus the Containerfile/rootfs paths
and startup preference. Show it as the normal Podman command/configuration in
the native settings editor. Use real paths and Podman options, not a new command
language. Launch the recorded executable/arguments directly; a shell is used
only when the saved command explicitly chooses one.

GPU, port and existing media/input helpers modify that same saved configuration.
Preserve arguments they do not own. Do not regenerate and overwrite an agent's
custom command on every start. Validate syntax, ownership/endpoint consistency
and installed executable availability before launch; show the actual process
error if the saved command fails. Keep saved configuration separate from transient
PIDs, live sockets and generated credentials. For an unchanged definition, use
native start/stop on the same persistent container. Apply changed creation
arguments at an explicit stopped boundary, preserving its rootfs and identity;
do not rebuild or replace a running environment when settings are saved.
Use the upstream [Podman command options](https://docs.podman.io/en/latest/markdown/podman-run.1.html)
and [rootless setup requirements](https://github.com/containers/podman/blob/main/docs/tutorials/rootless_tutorial.md)
as the implementation contract, checked against the pinned release.

Local Pi can inspect and edit these files through its normal tools to help the
user configure an environment. Guest Pi operates inside its guest. Termux Pi
retains direct package installation and its existing display configuration;
there is no Android Podman UI or Android container installation path.

### Provisioning and lifecycle

Creation starts a backend provisioning operation and immediately opens the
native preparation view. Stream actual Containerfile/build/package stdout and
stderr with current phase and eventual exit status; never fabricate progress
percentages. The view can close and later reconnect to the same operation without
blocking browser navigation or restarting the build. A cancelled/failed creation
must not appear Ready or launch a partially installed desktop.

Use package installation and persistent configuration to establish the desktop.
At runtime, launch the packaged executables/session services directly. Do not
source PeGPU's provisioning scripts or reinstall/reset XFCE settings every boot.
One intentional user-editable Termux display command remains supported; this
does not authorize importing PeGPU's shell initialization machinery.

Separate the container's service lifetime from its viewer. Detached Podman and
the owned per-environment display/backend services must not inherit the browser
window's death guard. Reuse native process/service ownership; do not duplicate Pi
supervision. The guest's BashKitten backend and ordinary browser/control runtime
are started with the environment and kept available while it is on, even when
no Display view is attached. The private gateway must also survive: keeping only
the container alive is insufficient if its Wayland server exits and kills guest
Xwayland/X clients. Detachment must not send an xdg close or stop Xwayland; the
owned display service retains protocol/frame lifetime while the browser presenter
is absent. Reopening attaches to the existing instance.

| Action | Required effect |
| --- | --- |
| Close/hide Display or close browser window | Detach the viewer; keep container, guest desktop, guest BashKitten and work running. |
| Select another environment/chat | Change the view; do not stop the previous environment. |
| Per-container startup enabled | Start that saved environment when BashKitten starts, without duplicate instances; Off prevents automatic starts and does not stop an already-running container. |
| Explicit container Stop | Stop that environment's owned runtime safely, preserving rootfs, Pi sessions and configuration. |
| Container heading toggle Off/On | Invoke that same container Stop/Start owner, independent of Local and other backend toggles; preserve saved data and configuration. |
| Explicit Delete machine | Confirm the named machine and its stored data, stop its owned runtime, remove its container definition and private machine directory, then remove its catalogue entry. This is distinct from Stop or closing a view. |
| Local heading toggle Off | Stop only its owned Local group; do not kill containers or disconnect independent remote rows through inherited global power ownership. |
| Remote heading toggle Off | Disconnect that client's remote connection/mappings without stopping the remote host; retain its saved connection until Delete is explicitly chosen. |
| Browser shutdown/reopen | Release client connections and reattach to surviving container ownership; never treat closing a guest browser window as container Stop. |

Do not change unrelated independent CLI processes or existing remote service
lifetimes. Container startup preference is separate from host browser login
autostart and from a guest's individual published-service startup settings.

Retain the donor's applicable create/start/stop/restart/remove helpers behind the
native machine controls and the same controller used by Local Pi. Deletion must
hold the machine lifecycle lock to prevent concurrent start/delete operations,
use the resolved machine ID and ownership record, disable its startup and remote
publishing, close its owned display/media/control endpoints and stop its workers
before removing storage. Unmount its owned bind mounts before removing the
rootfs; never follow a guest symlink or traverse a user-shared host directory as
part of deletion. Use native namespace-aware removal for mapped rootfs ownership.
Keep unrelated machines, host Local Pi data, shared caches and external mounted
folders intact. If cleanup fails, retain enough registered state to show the
actual failure and retry the same deletion; do not report success while leaving
an active container or erase the ownership record first. Include guest files,
packages and its private Pi history in the deletion confirmation.
Reuse the donor helpers in `host/crates/buzzardos/src/operations.rs` and
`host/crates/wb-core/src/podman.rs`, but correct the donor's unregister-before-
tree-cleanup order; a failed removal must remain visible and recoverable.

### Passwordless virtual sudo, including interactive commands

Bring the later donor bridge, not an early pipe-only version. In
`guest/sudo-bridge/src/{main,transport}.rs`, the transport introduced at
`75b423830f5af94c9037c47b681ec457d6db6ddf` handles PTYs, redirected standard FDs,
signals, terminal resize and suspend/resume. Preserve its integration with the
guest's real sudo semantics. The audited donor currently defaults to password
authentication; BashKitten must explicitly select the requested passwordless
guest policy and validate it with `visudo`.

The requested result is both agent `sudo -n apt ...` and interactive terminal
sudo/package programs working without a guest password. Container root remains
inside the donor's rootless user namespace. Do not confuse passwordless guest
sudo with host sudo, or silently add Podman `--privileged`, host root access or
host namespace sharing. Do not carry donor whole-host privileged commands into
the bridge's guest-root operation.

## 6. Desktop display on Wayland and X11 hosts

Use one XFCE/X11 guest desktop on both host types. Run **rootful Xwayland** inside
the guest against the private display gateway, with XFCE/Xfwm managing the X11
desktop. Rootful means a single X root desktop window, not root privileges.
This replaces the donor's guest Sway shell; it does not import its Sway/wlroots
automation or rewrite wlroots into an X11 renderer.

The host browser's X11/Wayland backend and the private guest Wayland protocol are
separate choices. A private Wayland server can receive the rootful Xwayland
desktop while Firefox itself runs on X11. Remove the donor's mandatory real host
Wayland-socket requirement and its separate GTK viewer; do not mount that socket
into the guest as a shortcut. The existing Linux browser build is GTK with X11
and optional Wayland support; make both explicit build requirements for this
delivery, with an artifact/run check for each backend.

The first implementation gate must prove rootful Xwayland speaks the subset
supported by the adapted private gateway. Retain frame timing, buffer ownership,
resize, keyboard mapping, pointer and clipboard behavior needed by this desktop.
Drive its dimensions from the actual browser tab's drawable area, including
changes caused by browser chrome/sidebars, rather than a fixed host-screen size.
The donor currently lacks `wl_output`, rejects an empty DMA-BUF format list and
has Sway-specific bootstrap sizing. Supply actual output/scale/configure semantics
and allow a DRM-free software start. Negotiate GPU formats from the native
Firefox receiver rather than a required host Wayland connection. Do not assume
the donor's Sway-only client assumptions automatically fit Xwayland.

### GPU and CPU frame paths

| Path | Required implementation |
| --- | --- |
| GPU | Retain DMA-BUF negotiation, formats/modifiers, fence/release lifetimes and device selection. Deliver frames to a small native Gecko receiver rather than GTK `DmabufTextureBuilder`. Verify actual import on both host backends and relevant drivers. |
| CPU fallback | Accept validated primary `wl_shm` buffers, copy/map their pixels safely into a native Gecko software surface and present them in the same tab. Launch rootful Xwayland with its supported `-shm` option and use Mesa software rendering for guest GL where needed. |

Current Buzzard `guest_display.rs` advertises `wl_shm` for some uses but rejects
primary software frames, and `GuestFrame` carries only DMA-BUF. Its commit
`dd0dd7ce65af7716543e39f04ae9c4308e523bae` removed the earlier `ShmFrame` path.
Use that history as a reference, review its validation/lifetimes, and implement
the CPU path in the new Firefox receiver. Reverting one donor commit alone is
not a working BashKitten display integration.

Gecko already has `DMABufSurface`, DMA-BUF image support, `ImageContainer` and
`SourceSurfaceImage`; investigate those existing interfaces for the narrow
cross-process receiver. Keep display protocol handling and expensive frame work
in the module's child process, with only necessary attachment/compositor glue in
the browser. These are engine integration points, not a ready-made external-desktop
tab API. Validate FD ownership, stride/size, texture release, graphics-process
loss, resize and hidden-view behavior before committing to the final adapter.

The requested fallback activates when the accelerated display path cannot start,
with truthful software-rendering status and the original error available. Do not
overwrite the saved GPU configuration. A renderer failure after apps are running
must not silently destroy their X server/session to retry; report any required
display restart. A fully software-only start must work without a DRM render node
or a host Wayland compositor. Podman itself does not render pixels and has no
single flag that replaces this work.

The [Xwayland manual](https://manpages.debian.org/trixie/xwayland/Xwayland.1.en.html)
documents rootful geometry and `-shm`; Mesa documents
[`LIBGL_ALWAYS_SOFTWARE`](https://docs.mesa3d.org/envvars.html#libgl-environment-variables).
These establish available mechanisms, not the performance or GPU compatibility
of a finished product. CPU rendering does not promise that every game, Vulkan
application or CUDA application will work or run quickly.

## 7. Android: embed Termux:X11 without a companion X11 APK

Keep `com.bashkitten`, its current signer and independent Android UID. Shared UID
with Termux is unnecessary for Binder/FD transfer and would require matching
Termux's signer. Any supported installed `com.termux` remains usable through the
existing real UID/signing-identity approval flow.

Bundle the pinned `lorie` Java/resources/AIDL and native `libXlorie.so` in the
BashKitten APK for arm64-v8a and x86_64. It is an Android library but not a
drop-in isolated View: `LorieView`, input helpers and `MainActivity` currently
depend on the upstream Activity/Application. Extract a narrow frontend host
interface, preserving upstream native rendering and input. Fenix's Activity
stays in the browser process; it cannot be passed as an object to the renderer
child. Supply host-owned actions, lifecycle, preferences, insets and focus through
the small typed IPC adapter, with a child-owned window context. Do not
merge the standalone launcher/Application manifest wholesale or place a foreign
Activity inside a browser tab.

The proposed Android host is a non-exported bound service in an application-private
`:display` process. It owns the adapted `lorie` view hierarchy and native renderer;
the browser owns only its tab and a `SurfaceView` slot. Use Android's supported
[`SurfaceControlViewHost`](https://developer.android.com/reference/android/view/SurfaceControlViewHost)
to expose a `SurfacePackage` over the private Binder contract, embedding it with
`setChildSurfacePackage`. This supplies a separate address space; it is not a
claim that the native service inherits Firefox's web-content sandbox. Keep child
process startup minimal rather than initializing another browser UI there.

Forward viewport, configuration, selection/focus and input-host tokens deliberately.
Configuration forwarding alone does not resize the child: invoke its layout
operation with the actual measured bounds. Preserve Android's input/IME routing
instead of inventing a second keyboard protocol. The first gate must prove nested
`LorieView` surface composition, browser overlays/z-order, focus/input transfer,
IME composition/resize, pointer capture, clipboard and rotation on this boundary.
Releasing the browser's `SurfacePackage`, releasing the child's view host and
unbinding the service have different owners; clean each without issuing backend
Stop. See [surface lifecycle](https://developer.android.com/reference/android/view/SurfaceControlViewHost.SurfacePackage)
and [private service processes](https://developer.android.com/guide/topics/manifest/service-element#proc).
The API provides the mechanism; this integration remains to be implemented and
verified, including renderer-child crash/hang containment and reattachment.

The server continues to execute **under Termux's UID**. Upstream's Termux
`app_process` loader reads classes and `libXlorie.so` from the installed APK.
Its official loader hardcodes `com.termux.x11` and its signer, so ship a paired
BashKitten Termux loader from the same pinned source targeting `com.bashkitten`
and the existing BashKitten signer. The APK owns these native code payloads;
the Termux package owns the matching launcher plus desktop/runtime dependencies.
Detect a mismatched APK/loader pair and show the necessary package update.

Reuse the existing `bashkitten-display` backend owner, readiness checks, explicit
Start/Stop and user-editable launch command. Replace only the separate-APK
download/detection and external Open X11 path with native Display attachment.
Use the existing private browser/Termux IPC to hand off `ParcelFileDescriptor`
connections by adding a narrowly typed FD operation to its authorized Binder
bridge. Its existing JSON command method cannot carry that descriptor unchanged.
Do not accept arbitrary broadcast-supplied privileged binders.
Upstream's reconnect knock listener binds `INADDR_ANY`, separately from X11 TCP.
Replace discovery with the private handoff so embedding does not introduce a
LAN listener; `-nolisten tcp` alone does not address that listener.

Check 16 KiB ELF LOAD alignment and APK native-library zip alignment for
`libXlorie.so`, plus real `app_process` loading from both ABI packages. These
build checks do not establish 16 KiB-page runtime coverage on stock Cuttlefish.

### Actual tab viewport and input

- Reuse upstream `LorieView`, touchpad/direct-touch behavior, mouse buttons,
  wheel/hover, hardware keys/modifiers, IME composition, extra keys and clipboard
  handling. Route them only to the selected/focused Display surface.
- Size the X display from the measured tab content rectangle after browser
  chrome, cutouts, system bars, extra-key controls and current IME insets. Use
  one inset owner so Fenix and the embedded view do not subtract them twice.
- Wire upstream `setContentInsets`, viewport/input-transform updates and native
  window-change notification. Select dynamic/native resolution and keyboard
  resizing deliberately: the upstream keyboard-resize preference is not on by
  default. Opening the keyboard shrinks the desktop; dismissing it restores it.
- Recompute on orientation/window changes and update pointer coordinates from
  that same drawable rectangle. Preserve the desktop process and session.
- Hide/close releases the surface, input capture, held keys and view listeners;
  it does not stop Termux's desktop. Reopen creates/reinitializes the view and
  attaches to the same backend. Explicit Display Stop and the Local heading's
  Agent Off retain their Local owned-process meaning. Display failure does not
  terminate Pi chat work.

Keep headless Xvfb behavior separate. Do not require root, ADB, Shizuku, shared
UID or privileged system-key permissions in the shipped user flow. Development
setup/debugging still uses the authorized ADB/direct Termux workflow. Android
16/17 behavior and physical-device GPU support require actual acceptance.

## 8. BashKitten OS: shared XFCE customization package

Name this shared desktop customization **BashKitten OS**. Package it as
`BashKittenOS.deb` (with release version/architecture suffixes where required)
for Debian guests and as a native Bionic Termux `.deb` built from the same
source. Use the normal lowercase package identifier `bashkitten-os` in package
metadata. These are platform-specific packages, not interchangeable binaries.
This names the customization and its settings app within BashKitten; it does not
introduce a separate distribution, browser or bootable OS. Reuse upstream
XFCE/Xfwm and the actual PeGPU apps: **Thunar + Xfce Terminal**. Nautilus is not XFCE's file
manager and is not what the inspected PeGPU setup installs. Do not pull in an
extra GNOME desktop stack on the assumption that the donor used it.

The package owns the small panel adaptation, maximized application launcher,
event-driven layout/divider helper, scaling module, settings and appearance
assets. Native package dependencies and normal desktop/session registration
start those components. First-run defaults are applied once to the owned
desktop profile, then user changes persist. No
PeGPU account assumptions, login-time install scripts or repeated settings reset.

### BashKitten OS settings application

Install one native **BashKitten OS** application entry with the existing
BashKitten icon. It opens this environment's customization settings, including
the PeGPU-derived scaling controls and the requested optional two-app layout
setting, plus the application Dark/Light preference below. Reuse the same
settings/helper implementation described below; do not
add a second configuration store or duplicate controls. Ordinary XFCE appearance
and wallpaper settings continue to work and retain user changes. Container
lifecycle, launch commands and remote sharing stay in their existing native
sidecar Settings rather than being duplicated in this guest desktop app.

Seed this application's stable desktop-entry ID into the Start launcher's
ordered pins when the desktop profile is first initialized, on both Linux and
Termux. Other applications remain unpinned until chosen by the user. Preserve
the user's later pin order or explicit unpin across restart and upgrades; do
not reinsert it on every launch. The settings app is still listed/searchable
when unpinned. Its own app/menu entry and settings operations must remain
responsive, with expensive work delegated asynchronously as elsewhere in the
desktop package.

### Dark and Light preference for applications

Add a simple **Dark / Light** choice to BashKitten OS settings on both Linux
containers and Termux. This is the desktop session's advertised system/application
preference; BashKitten OS's own dark/orange panel, Start menu, settings styling,
Thunar customization, icons and wallpaper keep their existing colors. Changing
the preference must not recolor or reset those assets or change the host Linux
or Android system setting. Applications decide whether to follow the preference.

Persist the choice per environment using the existing settings owner. Default
new unset profiles to Dark; retain a saved choice across session restarts and
package upgrades. No automatic/scheduled mode or additional theme editor is
requested.

Expose the choice through the standard
[XDG Settings portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Settings.html):
`org.freedesktop.appearance` / `color-scheme`, with unsigned value **1 for Dark**
and **2 for Light**, and emit `SettingChanged` on a user change. Use the session's
XFCE/toolkit settings integration and a matching native portal backend; verify
the pinned backend exports this preference on both Linux and Termux. Reuse or
narrowly adapt that settings path, without pulling in a GNOME desktop or adding
a parallel preferences daemon/store. Keep its dependencies in the source/license
inventory. The guest session owns this value, not a forwarded host portal.

Keep toolkit preference paths consistent with that saved choice while preserving
the explicitly styled BashKitten surfaces. Scope our custom styling to its
intended components; do not force all third-party apps dark through a global
`GTK_THEME`, broad CSS override or theme reset that defeats Light. Apply changes
asynchronously through settings notifications, with no polling or app restarts
forced by BashKitten. Apps that do not follow system appearance can retain their
own theme; do not promise universal live switching.

### One bottom taskbar on both platforms

Ship the same layout on native Termux and Linux containers: one full-width
horizontal panel along the bottom edge containing only an **Applications** button
with the existing BashKitten icon for the launcher below and ordinary labelled
Window Buttons for running applications. Replace the XFCE menu icon with the
current kitten-with-glasses branding, keeping the Applications label. Size the
icon proportionally for the panel and its scale, using the existing branding
assets. This supersedes the earlier text-only button requirement on both Termux
and Linux. Include no clock/date, network,
audio, battery/power, notification/status tray, workspace switcher, Show Desktop
or other panel widget. This changes panel contents, not the underlying services.
Remove the default secondary launcher dock and its file-manager/terminal/other app
shortcuts; do not add pinned launchers to the taskbar. Pins belong inside the
Start menu only. The packaged desktop has no default shortcut icons. Applications
remain available through the Start menu, and open windows through the taskbar.
An explicit **Add to Desktop** action may create the user's chosen shortcut;
that does not restore the default launchers, device/home/trash icons or dock.

This layout belongs to the shared desktop customization package, not platform
startup scripts. Apply it as the owned profile's first-run default and preserve
later user edits. Keep the panel at the bottom through viewport resize, keyboard
appearance, rotation and scaling, and reserve its workarea so maximized/split
windows do not cover it. There is no second top panel or floating dock.

### Maximized Start menu: search, pins and application grid

On both Termux and Linux, clicking Start opens one launcher covering the desktop's
available workarea above the bottom taskbar. It looks maximized within the
Display viewport; it does not fullscreen the host browser or cover native chat
navigation. Use the actual resized workarea, including rotation and keyboard
changes. Keep this launcher out of the app-maximize/two-app policy and tasklist
so opening it does not rearrange the user's applications.

The layout is, from top to bottom:

1. One simple **Search applications** field, initially focused.
2. A **Pinned** block of clickable icons with titles, in saved pin order.
3. One horizontal divider.
4. All remaining visible applications, alphabetically by displayed name, flowing
   left to right and then onto the next row, each with a clickable icon/title.

The search stays at the top; the content area containing pins and remaining
apps scrolls vertically when needed. Both grids reflow to the available width
without horizontal overflow or an arbitrary app-count limit. With no pins, omit
the empty block/divider as Gnozzard does. Long titles remain readable with normal
wrapping/ellipsis and accessible full names. A single click/tap launches the
selected app and closes the menu. Start again or Escape closes it and returns
focus to the previous app; preserve normal touch scrolling and keyboard use.

Reuse Gnozzard's `ApplicationsMenu`/`ApplicationRow` data and action behavior from
`extension/gnozzard@openresearchtools/extension.js`: visible installed desktop
entries, simple case-insensitive name/description matching, short 90 ms search
debounce, alphabetical ordering and saved desktop-ID pins. Its pinned search
currently matches names only; use the same simple name/description match for
both blocks here. Pins appear only in their own block, not twice in the menu.
**Pin/Unpin** stores the ordered ID list per environment, initially containing
only the **BashKitten OS** settings app. Renaming an entry preserves its ID/pin
and explicit deletion removes its pin.
Unavailable entries are omitted without wiping saved selections on a transient
refresh failure. Clear search on close; retain pins across relaunch and upgrades.
Keep the donor's applicable AppImage/launcher management actions in the icon's
secondary-click menu, backed by the same helper used from Thunar.

The donor currently renders a narrow vertical popup with search/pins at the
bottom. The requested top-search, maximized grid is new frontend work. Implement
one small native GTK launcher in the shared customization package, using
[GtkFlowBox](https://docs.gtk.org/gtk3/class.FlowBox.html) and a scrolled content
area for responsive icon layout, existing GIO desktop-entry launching and
[AppInfoMonitor](https://docs.gtk.org/gio/class.AppInfoMonitor.html) for installed
application changes. Respect desktop visibility rules and actual native Termux
prefixes. Reuse the package's GTK/PyGObject dependencies; do not import GNOME
Shell actors, replace XFCE/Xfwm or create a second desktop shell.

The panel button only opens/toggles that one launcher process; scanning files,
reading/decoding icons and helper operations cannot run in the panel/browser
UI thread. Keep launcher input/scroll/close responsive too: load metadata/icons
asynchronously, apply results in small UI batches, coalesce search updates and
discard stale results after closing or changing the query. App changes mark the
catalogue dirty; refresh when shown, with no hidden polling or background grid
rebuild. Use normal toolkit windows/process ownership, not a new service framework.

This replaces the earlier stock Applications-menu/Garcon menu-patch proposal.
The new launcher directly owns its requested context actions; do not build two
Start menus or retain an unused Garcon fork. Stock Window Buttons and the narrow
Two app mode patch remain the taskbar implementation.

### Maximized apps and optional two-app layout

Keep stock Xfwm window management. Maximize normal resizable application windows
within the desktop workarea; preserve dialogs, file pickers, popups, tooltips,
panel windows and explicit fullscreen behavior. Do not force a modal dialog to
fill the desktop or claim a non-resizable application accepts arbitrary geometry.

Use stock XFCE Window Buttons/tasklist with one narrow tracked source patch to
its per-window context menu for exactly the requested **Two app mode** action,
enabled by the split-screen setting. Build that panel component through the
owned Linux/Termux package recipes, retaining its normal taskbar behavior. The
inspected `plugins/tasklist/tasklist-widget.c` constructs these menus internally;
the public plugin-menu API does not supply this per-window hook. Do not ship the
previously proposed Docklike alternative or create a second taskbar. Capture the
current main window before the menu steals focus, and use the clicked app's
actual selected window when it has several, including grouped-window submenus.
Reject identical, closed or ineligible windows. If both applications' minimum
sizes cannot fit the workarea, report that constraint and retain the current
layout rather than declaring a successful split.

An event-driven helper unmaximizes that pair, requests adjacent workarea-sized
rectangles and owns one small draggable divider. Dragging resizes both windows,
respecting frame extents, minimum sizes and size increments. Use native window
APIs/EWMH requests, not shell processes per drag event. Verify actual geometry
after asynchronous requests. Selecting a third app returns it to the normal
maximized view and removes the divider. Disabling split mode or closing one
member removes the divider and maximizes the remaining app. This adds no third
layout mode or extra button.

Use window/open/close/state and RandR/workarea events. Recalculate after tab
resize, phone keyboard/rotation or scale changes, preserving the split proportion
where both apps' size limits allow. Runtime XIDs are not durable identifiers.
`libxfce4windowing` offers useful window/events APIs, but the inspected X11
geometry wrapper skips negative coordinates; use an explicit-mask native EWMH
operation where needed rather than assuming that wrapper covers every geometry.
The custom pair/divider behavior is new implementation, not a stock XFCE setting.

### Direct PeGPU scaling reuse

Reuse the MIT functions in
[`Resources/Guest/scaling-app/src/pegpu_scaling.py`](https://github.com/openresearchtools/PEGPU/blob/aae5382fae02eaeb97ceeb7fcaa531f88009b081/Resources/Guest/scaling-app/src/pegpu_scaling.py):
profiles, normalization, scale planning, changed-value XFConf writes, cursor
resources, transaction and saved selection. Wire them into the customization's
**BashKitten OS** settings application directly. Preserve their license and
provenance.

The implementation coordinates Xft DPI, GDK integer factor, cursor/icons, panel
and titlebar sizing, including any explicitly user-created desktop shortcuts.
Applying scale must not restore the removed dock or default icons. Its
profiles cover 100–300% in 25% steps.
It uses `xrandr` for discovery, not framebuffer fractional resampling. Do not
describe it as universal per-monitor fractional scaling. Remove donor assumptions
such as `:0` meaning 200%, fixed `panel-1`, a hardcoded guest user or Linux-only
prefix/bus paths. Target the owned desktop's actual settings and session bus.

Apply current-session XSettings/Xfconf changes and make future app launch
environment agree with the saved choice. Environment variables cannot change
inside already-running processes; apps that cache scale may require relaunch.
Avoid the donor's unconditional shell `xfwm4 --replace`; use live settings where
supported and retain a session-owned restart only if acceptance proves necessary.
Preserve two-app geometry through a scale change.

### Gnozzard dark/orange appearance and persistent wallpaper

Use the exact Gnozzard palette from
[`extension/gnozzard@openresearchtools/stylesheet.css`](https://github.com/openresearchtools/gnozzard/blob/59ca6d56ef147dea820381036838e76645074d0e/extension/gnozzard@openresearchtools/stylesheet.css)
and [`data/90_gnozzard.gschema.override`](https://github.com/openresearchtools/gnozzard/blob/59ca6d56ef147dea820381036838e76645074d0e/data/90_gnozzard.gschema.override):

| Role | Color |
| --- | --- |
| Taskbar/panel | `#282828` |
| Start menu surface | `#222222` |
| Initial desktop background behind the centered BashKitten logo | `#202225` |
| Hover | `#3f3f3f` |
| Orange focus/selection/active indicator | `#ff7139` |
| Normal / subdued text | `#ffffff` / `#c8c8c8` |
| Text on orange | `#181818` |

Apply this consistently to the panel, launcher, GTK/Xfwm decoration and Thunar
styling in both environments. Bring the donor's orange folder artwork where
used, preserving its original notices and existing Adwaita/hicolor inheritance;
its SVG shades are `#ff7139`, `#ff9b73`, `#d94e17`, `#ffb397` and `#ffc8b2`.
Gnozzard supplies shell CSS and icons, not a ready-made Thunar/GTK body theme:
the small GTK3/Xfwm adaptation is part of our package. Do not substitute the
earlier Firefox-gray palette or another approximate orange.

The default XFCE wallpaper on both platforms uses that `#202225` background and
the current transparent kitten-with-glasses logo from
`browser/bashkitten/browser/branding/assets/bashkitten-logo-glasses-original.png`
(1254 × 1254 source pixels), preserving its branding license. Center it horizontally
and vertically with its aspect ratio intact. Keep the chosen display size at or
below the original dimensions in physical pixels, including at high DPI;
shrink it proportionally to fit a smaller
viewport, but never stretch, crop, tile or upscale it to fill a larger screen.
Use the original asset rather than enlarging a small generated app icon. Perform
any default-wallpaper sizing off the UI thread and only while this managed
default is selected. The Applications button uses a small panel-sized version
of the same BashKitten branding independently of the wallpaper.

Preserve Gnozzard's defaults-only wallpaper principle: it supplies an initial
solid background through schema defaults and does not overwrite the user's
desktop wallpaper during launch. Translate that to packaged XFCE defaults,
seeding our centered-logo default only in an unset owned desktop profile.
Thereafter the user's chosen image, image placement and appearance settings
remain authoritative.
Opening Start/Display, launching apps, scaling, rotation, desktop restart and
package upgrades must not clear or repaint over that choice. Do not copy the
donor's unrelated lock-screen handling or run settings-reset shell scripts.
Use XFCE's existing background/settings controls; no new wallpaper manager.

### Linux application installation and registration

Bring Gnozzard's existing application-management functions into the Linux guest
customization package, using XFCE and Thunar. This applies inside each selected
container, not to installing packages on the host or Debian binaries in native
Termux. Both Linux amd64 and arm64 guests use their actual package architecture.

The audited Gnozzard sources are
[`integrations/nautilus/gnozzard.py`](https://github.com/openresearchtools/gnozzard/blob/59ca6d56ef147dea820381036838e76645074d0e/integrations/nautilus/gnozzard.py),
[`helper/gnozzard`](https://github.com/openresearchtools/gnozzard/blob/59ca6d56ef147dea820381036838e76645074d0e/helper/gnozzard)
and `helper/gnozzard-deb-installer`; its GNOME extension supplies the associated
Applications-menu actions. BuzzardOS already adapts the five AppImage actions
to Thunar in `guest/assets/thunar-uca.xml` and merges their owned IDs without
discarding other custom actions in `guest/shortcut-helper/src/thunar.rs`.
Reuse that Thunar integration and Gnozzard's relevant helper functions directly
under BashKitten names. Keep one implementation of validation, extraction,
launching and registration, not parallel Gnozzard/Buzzard helpers or stores.
Do not import GNOME Shell, Nautilus, their extensions or the donor desktop shell.

Preserve these secondary-click actions for one applicable local file, with
format validation in the helper rather than trusting only the filename:

| Selected file | Thunar actions and behavior |
| --- | --- |
| `.AppImage` / `.appimage` | **Run AppImage**; **Extract and Run AppImage (Persistent)**; **Extract and Run --no-sandbox**; **Add AppImage to Applications**; **Add AppImage to Desktop**. |
| `.desktop` | **Run Desktop Launcher**; **Add Launcher to Applications**; **Add Launcher to Desktop**. Preserve the launcher's arguments, field-code handling and appropriate icon through the existing desktop-entry parser/launcher. |
| `.deb` | **Install Debian Package…**. Show the actual package/version and Install/Cancel confirmation, install with APT dependency resolution, and report the actual result. |

**AppImages.** Preserve Gnozzard's mode behavior: ordinary Run executes the
AppImage without extraction when no persistent directory exists; once explicitly
extracted, subsequent launches reuse the adjacent `<AppImage>.extracted/AppRun`.
Extraction uses `unsquashfs`, a temporary sibling directory and atomic completion;
failed/cancelled extraction cleans up its temporary output. Preserve `APPIMAGE`,
`APPDIR`, working directory and application arguments. The explicitly selected
`--no-sandbox` action retains the donor's per-extraction marker; never turn it on
automatically after a normal launch fails. Register the MIME/open handler so
ordinary opening and registered menu entries use the same helper and saved mode.

Preserve the donor's detailed rules, not just its action labels:

- Keep the original file in place and validate it on every launch, even when
  extracted. Reuse an existing extraction without silently refreshing it when
  the original changes. An invalid existing extraction is an error, never a
  reason to fall back to raw execution or re-extract over the user's files.
- Raw launch uses the original's parent as cwd. Extracted launch uses the
  extraction directory and sets `APPIMAGE` to the original path, `APPDIR` to
  the extraction and `OWD` to the original's parent.
- Reuse the first valid sorted top-level desktop entry's literal arguments as
  Gnozzard does: discard field-code tokens, turn `%%` into `%` and strip embedded
  `--no-sandbox` unless the explicit marker permits it. This applies to extracted
  AppImage arguments; normal `.desktop` launching below retains GIO field codes.
- The explicit no-sandbox action writes the private, user-owned, non-symlink,
  empty mode-0600 `.no-sandbox` marker. Later ordinary or Extract and Run launches
  preserve that choice. The donor does not display an extra approval dialog;
  do not invent one from its tooltip wording.

Direct operation needs the guest's working FUSE runtime/device integration;
reuse only the necessary Buzzard FUSE helpers and verify rootless Podman access.
An unavailable direct path reports its error; extraction remains a user-selected
action. Do not silently add host privilege or silently switch modes. Adapt the
donors' Wayland launch hints to the actual XFCE X11 session, preserving explicit
user overrides. If any Buzzard validator is reused, replace its x86-64-only
Type-2 assumption with validation for the actual supported guest architecture
and AppImage format. Gnozzard recognizes Type 1/2 headers but its persistent
extractor expects SquashFS; report unsupported formats accurately rather than
claiming either donor handles every AppImage. Do not add CPU emulation.

**Debian packages.** Replace Gnozzard's `pkexec`/`PKEXEC_UID` entry point with the
already-planned guest sudo bridge and its passwordless policy. Run the validated
local package through guest `sudo -n apt-get install -y -- <absolute-path>`;
do not use host APT or `dpkg -i` without dependency resolution. Retain file/package
validation and adapt caller ownership checks to the guest caller rather than
depending on Polkit environment variables. Normal package confirmation is not
a password prompt. Stream real APT output asynchronously in the guest UI; if a
package needs interactive input, use the existing guest terminal/PTY path.
Respect APT locks and report dependency, architecture and installation errors.
Installed package launchers become available through normal XDG menu discovery;
a CLI-only package does not get an invented GUI application entry.

**Applications and optional shortcuts.** Use the guest user's XDG applications
and icon directories, with stable BashKitten-owned entry identities, correct
Exec escaping, atomic updates and desktop-database refresh. AppImage registration
points to the user's file; it does not silently relocate/copy the application.
AppImage entry identity follows the original path, and re-registering preserves
its chosen name. Local `.desktop` registration keeps a wrapper referring to the
original launcher; GIO executes that original with forwarded targets so its
field-code/location behavior survives. Preserve the donor's handling of relative
sibling icons. Rename updates the menu name and an existing matching managed
desktop copy, without renaming the source, changing entry identity or losing pins.
Keep Gnozzard's **Rename…**, **Delete from Applications** for managed entries and
**Add to Desktop** for application entries, adapted to the XFCE menu. Removing
a managed menu entry removes only that registration/owned icon, not the source
AppImage, extracted application, installed Debian package or previously created
desktop copy. **Add to Desktop** also registers the AppImage/local launcher in
Applications, matching Gnozzard; do not substitute Buzzard's desktop-only variant.
Preserve unrelated menu entries and user files. Explicit desktop copies use
XFCE's launcher trust and execution behavior rather than assuming Nautilus's
`metadata::trusted` alone
is sufficient. Keep desktop file/launcher rendering available, seed no shortcuts
and hide special default icons such as Home, filesystem, trash and devices.
Explicitly created shortcuts then appear without restoring those defaults.

Inside the maximized Start launcher, retain **Open**, **Extract and Run** and
**Extract and Run --no-sandbox** for managed AppImages as well as **Pin/Unpin**,
**Add to Desktop**, and managed-entry **Rename…/Delete from Applications**.
Pass the actual validated desktop-entry identity to the shared helper. Linux
installation/extraction actions stay Linux-only; the shared Termux launcher
still offers normal installed-app launching/search/pins. Pins in this menu do
not add launchers to the taskbar. No Garcon context-menu patch is needed after
replacing the earlier stock-popup design with this launcher.

Keep Thunar/menu callbacks short: start the helper asynchronously, then perform
inspection, icon extraction, package operations and database updates outside
Thunar, the panel and browser UI threads. Surface progress and real errors,
including cancellation; stopping a package operation must use APT's normal
process handling, not kill it and claim rollback. Install/merge owned Thunar
actions once and on package upgrade by stable IDs, preserving unrelated user
actions; system defaults alone are insufficient when a user `uca.xml` exists.
Retain the donors' source/licenses and relevant dependencies only. Do not carry
arbitrary desktop-file/icon size quotas into the product; retain actual format
validation and bounded/streaming work consistent with the rest of this plan.

## 9. Agent desktop control and native boundaries

### One shared skill with backend-specific names

Add one concise shared XFCE desktop-use guide, curated into **`termux-use`** for
Pi inside BashKitten's native Termux backend and **`computer-use`** for Pi inside
a BashKitten-managed container desktop. Only the name, short description and
backend setup reference differ; keep one maintained workflow and supporting
scripts. This is planned work, not an already installed skill.

| Pi execution environment | Discovered desktop-use skill |
| --- | --- |
| BashKitten-owned native Termux backend | `termux-use`, controlling that backend's XFCE desktop |
| BashKitten-managed container backend | `computer-use`, controlling that container's XFCE desktop |
| Ordinary Linux host, standalone Pi, or other unmanaged backend | Neither guide |

Choose from where Pi actually executes, not the connected browser's OS or the
selected client tab. A remote connection does not grant host Pi a container
skill; a Pi already running inside an eligible backend retains its own guide
when accessed remotely. Never load both aliases or add either guide to ordinary
host Pi's initial context. Discovery initially adds only stock skill metadata;
Pi reads the instructions when desktop interaction is needed.

Reuse `agent/packaging/pi-skills.py`, the private Pi integration and stock Pi
package/resource discovery. Resolve the execution role before registering the
owned skill package/default selection through `ensureIntegration()`. Curate
role-specific manifests/selections: Termux includes its guide, managed container
provisioning includes its guide, and ordinary Linux host staging/defaults include
neither. Keep canonical/nonselected references outside automatic discovery. Use
stock package skill filters and global skill-disable behavior, preserving user
opt-outs and unrelated/custom skills; no custom loader, new tool catalog or Pi
patch. A container skill/data overlay must not require a separate Firefox build.

Do not substitute the installed Pi 1.0.2 `resources_discover` hook for filtered
registration: its returned paths can bypass package exclusions and `--no-skills`.
The existence of that API/example alone does not establish the required behavior.
Recheck normal package/discovery contracts during the planned Pi update.

The current platform adapter distinguishes Termux from Linux but not a managed
container from a host. Supply the execution role through owned container
provisioning/backend lifecycle and its stable machine identity. `DISPLAY`,
`/.dockerenv`, an arbitrary name or a browser connection is not this identity.
Unknown roles expose neither guide. Reconcile discovery on startup/reload and
do not leave an old managed selection exposed in an ineligible profile. This
is skill placement, not a sandbox preventing someone manually reading a file.

### Use the ordinary XFCE tool stack

Use [xdotool](https://github.com/jordansissel/xdotool) with XTEST for pointer,
keyboard, focus and window operations; **scrot** for fresh X11 screenshots; and
**AT-SPI** to read accessibility trees where applications expose them. Use stock
Pi shell execution and image/file reading. No MCP server, dedicated model,
screen-watching daemon or Sway/wlroots CUA/seat controller is needed.

Ship one small read-only tree-inspection script with the shared skill, using
Python/PyGObject's `gi.repository.Atspi` rather than making the agent repeatedly
write D-Bus traversal code. GNOME documents the
[direct introspection bindings](https://gnome.pages.gitlab.gnome.org/at-spi2-core/devel-docs/atspi-python-stack.html)
and [accessible object API](https://gnome.pages.gitlab.gnome.org/at-spi2-core/libatspi/class.Accessible.html).
It needs only application/window listing and inspection of a selected
application/subtree: names, roles, states, exposed text and component bounds.
Keep input in xdotool; do not grow this into a second automation service.

Install the native tools and bindings with the desktop dependency setup for
both architectures. The inspected Termux recipes at
`e446fad09f58f4355c8f45243ea831cf3545af47` include
[AT-SPI with introspection](https://github.com/termux/termux-packages/blob/e446fad09f58f4355c8f45243ea831cf3545af47/packages/at-spi2-core/build.sh),
PyGObject, xdotool and scrot; packaging availability is not proof of a working
session. Use the correct native Linux or Bionic packages, retain complete source
and licenses under section 11, and record the actual installed versions. Verify
scrot captures the complete owned rootful Xwayland/X11 desktop; do not assume
rootless host-Xwayland behavior supplies that framebuffer.

### Bind commands to the owning desktop session

The existing desktop owner must provide the actual `DISPLAY`, applicable
`XAUTHORITY`, session `DBUS_SESSION_BUS_ADDRESS` and AT-SPI bus context. Termux's
current Display owner records only `DISPLAY`; a `dbus-launch` child does not
automatically pass its bus back to a separately launched Pi worker. Extend that
owner's private context/command handoff, tied to the backend and desktop
generation, rather than adding a second desktop launcher or automation daemon.

Resolve the current context before each operation through that existing owner.
Refresh after desktop restart even when Pi stays running. Do not scrape unrelated
processes, create a separate D-Bus session for inspection, export host credentials
globally, use `xhost +`, or default to `:0`/another container after failure. A
stopped, missing or stale desktop is unavailable. `termux-display` remains the
Termux setup/launch guide; `termux-use` covers interaction after it is running.
Container creation/launch settings remain with the existing machine owner.

Run screenshots, inspection and input commands in short-lived child processes
with cancellation/deadlines, outside browser/UI threads. An unresponsive app's
AT-SPI calls must not hang the desktop or a native controller. Read only on
request: no hidden tree polling, screenshots, global event listeners or content
logs. Save requested captures/tree output privately; return paths and concise
previews, preserving the complete requested output or reporting incomplete
inspection explicitly. Clean up owned temporary files after use, without
deleting user-requested saved artifacts.

### What the skill teaches Pi

Keep the shipped instructions short, with examples using the packaged versions:

1. Check the owning desktop's readiness and current context, then identify the
   intended window (`xdotool search`, window title/class and geometry). Do not
   select the first ambiguous match or infer coordinates from an unseen screen.
2. Inspect the target's AT-SPI tree when available. Distinguish a missing bridge,
   stalled/disconnected bus and an app with no useful tree. GTK/Qt and custom
   widgets vary; neither XFCE nor AT-SPI guarantees coverage for every app.
3. Capture a fresh screenshot to a unique private path with scrot and read it
   with Pi's image-reading tool. Coordinates are pixels of the captured guest
   framebuffer, not the host browser window or resized screenshot preview.
4. Activate/verify the intended window before input. Show short examples of
   `xdotool windowactivate --sync`, `mousemove --sync`, `click`, wheel scrolling,
   `mousedown`/move/`mouseup`, `key` and `type`. Release held buttons/modifiers
   on cancellation; do not leave a drag or key held after command failure.
5. Use current exposed bounds or observed screenshot coordinates for clicks.
   Re-inspect after scrolling, focus changes, window moves, scaling, tab resize,
   phone rotation or keyboard insets. Stale tree objects/coordinates are not
   durable selectors. No invented tree or OCR-as-accessibility claim.
6. Verify the result with the next relevant tree read or screenshot. A successful
   command exit does not establish that the app completed the intended action.
   Use bounded waits for the actual state rather than repeated blind clicks.

Screenshot-based interaction and tree inspection are both explicit supported
methods. Say which is being used when an app lacks useful accessibility data;
do not silently treat a broken AT-SPI setup as successful inspection. The shared
X11 desktop has one pointer/focus: agents/subagents must coordinate actions on
the same desktop, not assume independent virtual seats. Ordinary terminal/file
work should continue through shell/file tools without screenshotting terminals.

XTEST input and X11 screenshots are display-wide authority, not per-window
security. AT-SPI coverage depends on the app; it is not created by XFCE for every
custom-rendered UI. Targeted `xdotool --window` events may differ from normal
focused XTEST input. Acceptance must check real focus, coordinates and results.
The upstream [xdotool manual](https://github.com/jordansissel/xdotool/blob/main/xdotool.pod)
documents this distinction; teach focused input instead of presenting directed
SendEvent as universally supported.

### Preserve native boundaries and verify discovery

`termux-use` controls the Termux X11 desktop, not Android applications. It does
not need Android Accessibility or enable `phoneuse`. The existing `browser`
skill remains for authorized browser tabs; desktop use does not relax its
protected Agent/authentication boundary. Host Wayland versus X11 does not select
different skills: the controlled environment is the same owned XFCE/X11 desktop.

Keep the native protected Agent outside the controlled desktop surface. On
Android it is outside Termux's X server. For containers, host-native sidecar/chat
owns the Agent view while the guest runs its own backend and ordinary browser
windows. Embedded-container operation must not create a second protected Agent
surface inside the X11 display exposed to unrestricted capture/input. Reuse the
existing browser/Agent separation: embedded-container browser wiring must route
Agent/auth activation to the host's protected frontend through the private
connection, rather than opening it inside the controlled X server. This is a
required native integration change, not a label applied to guest windows. Verify
it before enabling desktop CUA; a window-name filter alone is not sufficient.
Do not expose the host's entire desktop as the guest's X server to avoid this work.

Acceptance must show the correctly named guide in fresh Termux and managed
container Pi profiles, and neither name in ordinary host/unmanaged remote Pi.
Check startup/reload, user opt-outs and subagents without duplicating metadata.
Explicit package-skill exclusion and `--no-skills` must leave the guide unloaded.
In the real Pi UI, exercise app/window selection, fresh capture, focus, typing,
click/scroll/drag and result verification; inspect a supporting GTK/Qt app and
an app without a useful tree. Verify two-container isolation, stopped/restarted
desktop context, changed resolution, a stalled accessibility client and absent
protected Agent surfaces. Repeat native X11-host/Wayland-host container and
Termux acceptance; no claim that recipe presence alone proves those flows.

## 10. Per-environment sockets, settings and remote sharing

Mount only each guest's allocated private runtime endpoint directory into that
guest. Extend the existing native local connection adapter to select its Unix
endpoint and credential source, reusing the shared Agent service/session code.
Do not expose general container administration to web JavaScript or infer native
trust from an HTTP Host header or a loopback source address. The native browser
adapts the Unix service into its existing protected document loader locally;
this is not a Tor connection or a new remotely reachable listener. The Agent
HTTP backend already listens on a Unix socket, but Caddy currently supplies its
trusted proxy context and the browser uses HTTPS, instance identity and Secure
cookies. Preserve origin/cookie/CSRF rules, SSE, uploads/downloads and native
credential delivery in the per-environment adapter. A Unix peer is not by itself
an authenticated Agent, and a browser cannot navigate directly to that socket.
Verify UID-mapping-aware access: a guest-owned mode-0600 socket can be owned by a
subordinate UID on the host. Establish an explicit owned endpoint handoff/access
path without making the socket world-readable or assuming a private directory
alone solves its permissions.

The Settings button on each container's sidecar heading opens native settings
for that exact environment:
saved launch/Containerfile configuration, startup toggle, existing port mappings,
media/PipeWire/input integration and remote sharing. Reuse the donor's supported
controls and endpoint ownership; do not import unrelated desktop-shell features.
Keep media device selection/permissions distinct from the display's input stream.
The donor uses separate host/guest PipeWire graphs with per-machine loopback TCP
media endpoints, not a raw shared PipeWire socket. Preserve that existing media
mechanism and device choices; the requested private Unix link is for local
environment/control/display access, not a claim that donor media is already UDS.

The guest is its own BashKitten host. Its remote publishing has its own existing
identity/account/service definitions and uses the normal Share Local workflow
through the private local controller connection. Put that setup in the container
settings instead of creating a second remote-management web API. Local socket
access never weakens the published listener's TLS/mTLS/Authelia authorization.
Saved remotes continue using their current allowed service IDs and file-manager
policy. An offline container never becomes a reason to use another transport.

No remote Display service, video protocol, VNC/RDP/WebRTC transport or reverse X11
forwarding is included, following the user's explicit local-only clarification.

## 11. Source layout, updates and license delivery

Use the existing one-product repository and component-build workflow:

| Location/seam | Planned responsibility |
| --- | --- |
| `browser/bashkitten/browser/components/agent/` | Linux native sidebar/selection, private environment connection adapter and reuse of existing service settings/draft ownership. |
| Product-owned browser Display component | Separate renderer child, small Linux Gecko surface/input host, typed asynchronous IPC and special-tab lifecycle. Keep a narrow version-adapter boundary for future Firefox updates. |
| `browser/mobile/android/bashkitten/` plus narrow Fenix host/tab hooks | Native sidebar and embedded X11 View; replace `AgentDisplayDialog` external-app path, reuse `AgentRuntime` and Termux connection approval. |
| `agent/src/server/control.mjs`, platform adapters and new environment module | Native container setup/config/lifecycle, private guest sockets and streamable preparation status. No new remote administration routes. |
| `agent/src/server/common.mjs`, HTTP/session adapter and RPC worker | Project grouping metadata and existing stock session operations; no custom Pi history writes. |
| `agent/pi` extension/skills and `agent/packaging/pi-skills.py` | Concise `chats` guide and one deferred read-only list/search/read adapter over the sidecar metadata and native Pi history reader. |
| Android native Phone module, owned Pi worker launch and Termux CLI/skill packaging | Adapt the pinned MCP donor into a main-APK backend, native feature policy, worker-scoped authorization and clean `phoneuse` CLI. No companion APK or exposed MCP catalog. |
| `agent/src/web/web_ui.html` | Opened-chat view; remove replaced hierarchy/navigation while preserving existing chat/file functions. |
| Product-owned BashKitten OS source/package | Shared XFCE taskbar, maximized search/pins/app-grid launcher, initially pinned BashKitten OS settings app, layout/scaling and Gnozzard dark/orange styling with persistent wallpaper; Linux guest Thunar application installation/registration adapted from Gnozzard/Buzzard. |
| Directly merged BashKitten implementation | Needed Buzzard runtime/rootfs/media/lifecycle/sudo functions adapted into their BashKitten owners, with original source pins and notices; no parallel Buzzard app, updater or release chain. |
| Tracked external component source + patch series | Release source trees for Podman/crun and required helpers, embedded Termux:X11/native dependencies, XFCE custom components, spreadsheet/other JS components, patches, exact provenance and licenses. |
| Existing packaging/component builders | Private Podman/crun/helper builds, embedded X11 in the BashKitten APK and paired Termux loader, desktop packages, source/notices and architecture checks. |

Paths for new modules are proposed; reuse an existing owner rather than creating
parallel controllers with the same job. Merge needed Buzzard functions directly
and maintain the resulting code as part of BashKitten; do not retain its duplicate
product shell, branding, configuration/update machinery or separate build/release
requirements. Keep original attribution and a record of the source being merged.
For external components such as Termux:X11, XFCE and Podman/crun, retain pristine
upstream source with small named patches/adapters and exact provenance. Preserve Firefox's existing
compact source-history/update process. Do not import donor Git ancestry or a
second full browser tree just to get these components.

### Track every component we build and ship

The source must be **in this repository**, not just named in a download recipe,
linked to a sibling checkout or available in a workstation cache. Import upstream
release trees into the relevant existing component directory, with no nested
`.git` directory or imported upstream ancestry. Materialize required submodule
sources at their pinned gitlinks; an unresolved gitlink is not a complete source
snapshot. Keep pristine external source and small named patches separate. Direct
donor code merged into BashKitten retains its original pin/notices and a record
of our changes.

Use the latest official released version when adding/updating a component, within
the product's explicitly selected supported line (such as Node LTS/Firefox ESR).
Record upstream URL, readable version/tag, exact peeled commit, source checksum,
license/NOTICE paths, patches and build recipe. Annotated tag-object IDs are not
commit pins. Release jobs build the committed selection; they must not resolve
`main`, `master`, `latest`, moving tags or version ranges at build time. The
already-selected official Termux:X11 nightly is pinned to its exact source and
native dependencies; this does not authorize arbitrary branch builds elsewhere.

Apply this to Podman, crun and every helper/library we compile or bundle, as well
as embedded X11, the patched XFCE panel, native launcher and reused scaling/installer
code, private Node/Pi and bundled JavaScript/parser/viewer dependencies. Preserve
the corresponding dependency locks and vendor the required dependency sources
or integrity-verified source archives in the same tracked component layout.
Retain the release's exact transitive dependency graph, including upstream-locked
commit-derived versions; do not independently advance every nested dependency
or substitute arbitrary commits of our own.
Keep generated `node_modules`, build outputs, credentials and personal runtime
data out of Git. Ordinary declared distro dependencies remain package-managed,
with their package/source provenance recorded; if we begin building or embedding
one, it becomes part of this source inventory. The existing AI-engine daughter
repository remains the build owner for downloadable AI runtimes, with matching
release manifests/source/licenses consumed by BashKitten.

**Spreadsheet example:** the present preview code imports SheetJS CE `xlsx`
0.20.3 on the backend and renders the existing read-only grid. Currently
`agent/package.json`/lock refer to the official CDN tarball and
`agent/packaging/sources.py` collects it during release preparation. That is not
yet the requested in-repository source. Import its verified release tree and
matching release tarball, point packaging/dependency resolution to the tracked
copy, and keep lock integrity, full source and notices. The
[official installation guide](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)
documents this vendoring path and identifies its CDN as authoritative; do not
substitute the stale npm `xlsx` package or an unrelated spreadsheet widget.

Extend the existing component metadata, license collectors and source-packaging
scripts rather than adding a parallel registry. A clean checkout must resolve
product component sources from these tracked inputs. Make missing source,
unrecorded build-time source downloads, pin/checksum mismatches or missing license
texts fail release preparation. Reuse caches only when their source/patch/lock/
toolchain/architecture identities match. Publish matching source archives from
the same revision as each binary release.

### Complete licenses in the expanded product

Inventory what is actually shipped in the APK, Linux/Termux packages and provided
container environment, including compiled-in/transitive native libraries,
JavaScript bundles, fonts/icons/themes and retained donor assets. Ship full
license and applicable NOTICE/copyright texts, modification notices and source
provenance for those exact versions; a short SPDX name or upstream URL alone is
insufficient. Preserve upstream multi-license/component distinctions.

Extend the existing **offline About engine and bundled-component licenses** and
package notice/source outputs to cover every added component. The license view
must work without login, a running backend or a network connection. Include the
guest customization/runtime notices in its installed packages and make the
container component inventory available through the existing license surface;
retain distro package copyright files. Reconcile the installed artifact inventory
against the generated notices/source manifests on every target, and fail the
release if a shipped component has no complete attribution/source record. This
requirement covers existing bundled libraries as well as the new desktop work.
For the verified runtime pins, retain Podman's Apache-2.0 text and compiled
dependency notices; crun's GPL-2.0-or-later executable and LGPL-2.1-or-later
libcrun notices; libocispec's GPLv3 text with its parser-skeleton exception;
the OCI specifications' Apache-2.0 notices; and the included BLAKE3
CC0-1.0/Apache-2.0 license choices. Inventory actual selected linkage rather
than assigning the top-level project's license to all of its dependencies.

Build Linux amd64/arm64 and Android/Termux aarch64/x86_64 components with their
correct libc, ABI, prefixes and native dependencies. A Linux `.deb` cannot be
installed into native Termux simply because both use the Debian archive format.
Termux's source recipes already include XFCE panel, Thunar, Xfce Terminal, PyGObject,
xdotool, scrot and AT-SPI components; their presence is a packaging starting point,
not runtime acceptance of this customization.

Retain component-artifact/compiler caches; key new component artifacts by source,
patches, toolchain and architecture so changing a panel helper does not rebuild
unrelated Gecko/native engines. Final release packages must use the same tracked
recipes in GitHub Actions and carry checksums/provenance; no workstation-only
library, package repository or executable path may enter a release.

Keep full offline notices and corresponding source. Termux:X11 declares GPLv3;
its input code and native dependencies retain their individual notices. PeGPU's
scaling module is MIT; the XFCE panel/tasklist is GPL-2.0-or-later and its
`libxfce4panel` library is LGPL-2.1-or-later. Other XFCE components retain their
own licenses. Do not relabel retained dependencies as AGPL-only or erase
donor attribution while removing product branding. Inventory actual linked and
packaged dependencies, including Podman/crun/helpers and X11 gitlinks; fail
packaging if required texts/source are missing. Preserve the testing-release
warning and existing application signing identity.
The reused Gnozzard helper/integration/menu/CSS code is GPL-3.0-or-later and its
retained orange folder artwork is LGPL-3.0-only; Buzzard's Thunar integration
and helper code are AGPL-3.0-or-later. Preserve those component
notices and corresponding source instead of copying donor branding/dependencies
unrelated to the requested functions.

The [no-telemetry requirement](#no-telemetry-across-bundled-components) applies to
every component and transitive runtime dependency in this table and package
inventory, including Podman/crun, the spreadsheet viewer and Phone fork. Extend
source/license review with runtime network/logging review and external traffic
checks. No telemetry, external diagnostic logs or developer callbacks may ship;
unexplained reporting or missing review blocks release preparation.

For upgrades, preserve user-written launch configuration and desktop settings.
Update an untouched generated Termux default to the new private loader, but do
not regex-rewrite arbitrary user scripts. Show the needed edit for custom commands.
Remove BashKitten's separate-X11-APK dependency/path; leave an independently
installed Termux:X11 and its command alone. Use fresh profiles for architecture
acceptance and separately check preservation with an explicit upgrade case.

## 12. Android Phone control and the MCP port

Requested 10 October 2026. **Status: implementation plan only.** Bundle the
Android control backend into the **main BashKitten APK**, as explicitly selected
by the user. A native Phone panel controls an optional backend module; Termux
agents use a small CLI and the `phoneuse` Pi skill. No companion APK is required.

**Scope: port the device tools and controls only.** BashKitten's existing Pi
integration is the caller and continues to own model/provider connections,
credentials and agent execution. The Phone module must not implement an MCP
server/client, MCP session/protocol layer, provider connection setup, model
selection, API-key/account UI or donor client onboarding. Its authenticated
local transport serves only our Pi CLI and the native Android controls; it is
not a repackaged MCP endpoint or a connection to an external AI service.

It covers device control, not the separate calling/contact/voice-hook feature.
It does not change the protected Agent boundary, remote authentication, or the
Tor/Caddy/Authelia/Chisel route. Write only the integration and controls needed
here; reuse existing native controllers, Termux approval and packaging.

### Phone panel

Add a compact **Phone** button to the main native Android top bar beside **+**,
using the existing icon style. It opens the native Phone settings panel. This
button does not belong to the XFCE taskbar or the opened-chat web UI.

The panel contains one primary **On/Off** switch, independent feature switches,
then a divider and Accessibility-dependent switches. Master and new feature
switches default Off. Switching the master Off retains the user's choices but
makes every feature inactive. A later On restores only those saved choices whose
required Android access is currently available; it does not grant permissions.

Accessibility is optional. Its section stays greyed out until Android access is
enabled and the service is connected, with a concise explanation and the normal
Android settings route. Notification access and other missing grants have their
own availability indications and user-initiated Android permission flows. Never
require Accessibility to start notification, storage or other independent work.
No root, ADB, Shizuku, shared UID or default-assistant role is required by users.

The proposed grouping below keeps the donor's useful operations under separate
controls without reproducing its MCP settings UI. Final command names can remain
short, but every operation must have an explicit owner in this table.

| Panel section | Switch | Operations and access |
| --- | --- | --- |
| Independent | Applications and links | List visible launchable apps and request app/validated URI opening. Respect package visibility and background-launch rules. No unrestricted intent dispatcher. |
| Independent | Notifications | Read current notifications, open, dismiss, snooze, invoke an available action and reply through a current text RemoteInput action. Requires Notification access and a connected listener, not Accessibility. |
| Independent | Files and sharing | List/read/write/append/replace/download/delete within granted locations and receive deliberate Android shares. Retain per-location read/write/delete policy and SAF/URI/MediaStore ownership checks. Do not import public web-share links. |
| Independent | Clipboard | Write using application context; read only when Android actually permits it. Accessibility must not be an artificial prerequisite or a claimed bypass of clipboard restrictions. |
| Independent | Location | On-demand location through the native FOSS provider and granted access. The inspected donor requires precise location; do not silently claim approximate-only support or add continuous tracking. |
| Accessibility | Screen and elements | Read screen/tree state, inspect/find/wait for nodes and request a screenshot. Capture additionally requires the service's screenshot capability; no MediaProjection fallback. |
| Accessibility | Touch and element actions | Tap, long/double tap, swipe, scroll, pinch/custom gestures and supported node actions. |
| Accessibility | Text and keys | Append/insert/replace/clear text and supported key input through the available Accessibility input connection. |
| Accessibility | Navigation | Back, Home, Recents, notification shade, quick settings and keyboard dismissal. Opening the notification shade is distinct from reading notifications. |

Android provides broad service grants; the switches are additional BashKitten
authorization. Existing browser permissions never make a switched-off Phone
feature available. Ordinary notification replies do not require SMS/contacts
access and cannot send to arbitrary recipients outside a current reply action.
Respect Android's sensitive-notification redaction and work-profile restrictions.

### Fork and source provenance

Start from [Android Remote Control MCP v1.12.0](https://github.com/danielealbano/android-remote-control-mcp/releases/tag/v1.12.0),
release commit `3777403d148283c5a18a3e8122ff819da4eed808`, the release exercised by
the `mcp` thread. Preserve its MIT `LICENSE.md`, including the original copyright
**2026–2027 Daniele Salvatore Albano**, and dependency notices. BashKitten's own
code remains under its existing license; do not relabel the donor's files.

Import the original pinned source and provenance into a clearly identified
adapted component directory in a focused commit. Follow with separate commits
removing unneeded parts and adapting retained native Android operations to this module.
Record that this is a maintained BashKitten fork; do not automatically overwrite
it with mainstream donor updates. Preserve original source through the import
commit and source delivery, without compiling a second donor app. Keep original
and modified file provenance clear and ship full offline notices/source archives.

The research also inspected main commit
`16f39717ce0969aa81a4ec132ba1cad861ba46cc`. Its HTTP transport differs from the
tested release. Treat those findings as an audit checklist, checking each
against the release source; do not describe main as the tested release.

Remove from the shipped module:

- MCP server/catalog/SDK and generic `call`, `schema`, `tools` passthroughs from
  the research prototype. Retain useful native Android actions behind typed
  commands; do not retain MCP transport underneath the CLI.
- Donor provider/client connection integrations, account/API-key configuration,
  model selection and connection onboarding. Our existing Pi provider setup
  remains the sole model connection path; the Phone module needs none of these.
- All camera/microphone commands, providers, recording/audio options, schemas,
  settings, permission requests and dependencies used only by those features,
  including donor CameraX bindings. Check the merged APK manifest. Browser
  WebRTC/dictation permissions independently needed elsewhere remain separate
  and confer no Phone CLI authority to capture camera or microphone input.
- Donor app screens/onboarding, global Accessibility startup gate, OAuth/server
  configuration UI, remote icon fetching and its standalone product lifecycle.
- Cloudflare/ngrok transports and native payloads, public/LAN share URLs, event
  forwarding/webhooks, Claude channel plugin, location/geofence/Wi-Fi event
  channels, donor GitHub update jobs and boot paths that start disabled services.
- Persistent donor tool/activity logs and content logging. Return useful local
  errors without storing notification text, screenshots, UI trees, clipboard,
  files, credentials or command payloads in diagnostic history.

The donor's `close_app` uses
[`killBackgroundProcesses`](https://developer.android.com/reference/android/app/ActivityManager#killBackgroundProcesses(java.lang.String)),
which cannot kill other apps on Android 14+;
omit that unsupported command for the Android 16/17 target. Opening an activity
can be blocked even when the call returns normally. Report a request as requested
or unconfirmed unless its outcome is actually known; never announce success
merely because `startActivity` returned. See Android's
[background activity rules](https://developer.android.com/guide/components/activities/secure-bal).

### Backend authorization and lifecycle

Use one native policy owner shared by UI, command dispatch and Android service
entrypoints. Save policy in BashKitten's private Android data. Only the native
user settings flow changes it; the CLI cannot enable itself, grant permissions
or rewrite policy. Missing, corrupt or unknown policy/capabilities mean Off.

An operation is available only when **master On + its feature On + current
Android grant + live service readiness + existing caller/surface authorization**
all hold. Check this when discovering a command, accepting it and immediately
before effects or releasing sensitive results. Check compound operations against
every capability they use; switching off screen reading cannot be bypassed by
a node wait, and switching off Files cannot be bypassed by a shared URI.

Maintain a small explicit command-to-feature table with lazy provider factories.
Disabled providers are not instantiated; their handlers are not registered.
Do not reproduce the donor's default-on denylist, eager provider injection or
permission snapshot at server startup. Reconcile grant/service changes live,
without requiring an app restart or reusing a stale authorization decision.

**Off means inactive, undiscoverable and unusable**, not just a hidden button:

- Remove the feature from CLI help, capabilities, completions and command lookup.
  Cached clients, guessed command names, aliases and raw backend requests are
  still denied by the native policy. No alternate MCP/intent/debug path remains.
- Stop admitting work immediately; invalidate its policy generation, cancel
  queued work/waits, detach observers, stop sampling and release owned handlers
  and transient sensitive caches. Reject late results. Work already dispatched
  to another app cannot be undone; do not claim cancellation reversed an action.
- Master Off closes the Phone command listener and invalidates its credentials.
  It must not stop ordinary browser, Termux Pi, dictation or remote services.
- Notification, Accessibility, share-receiver and restart callbacks consult the
  same policy **before extracting or caching content**. OS callbacks may create
  a minimal service entrypoint even while Off; it must remain inert and must not
  initialize feature handlers. APK code and manifest declarations still exist.
- Where supported, unbind the unused notification listener; only request rebind
  after the feature is enabled and the user grant still exists. Accessibility
  events/caches must also stop when no dependent feature is active. Do not claim
  that a feature toggle silently revokes Android's user-granted special access.
- Boot, sticky/null-intent restart, package replacement and task removal cannot
  resurrect disabled features. Reconnected services recompute current policy.

Android documents notification connection readiness and
[unbind/rebind APIs](https://developer.android.com/reference/android/service/notification/NotificationListenerService).
The donor currently receives/caches notifications independently of its command
server; merely stopping that server would not satisfy Off. Accessibility tree
caches and share receivers need the same treatment.

### CLI and Pi integration

Use this path, without a web UI relay for each command:

```text
Local Termux Pi -> bundled Node phoneuse CLI -> authenticated local transport
               -> Phone backend module in BashKitten APK -> Android APIs
```

Package the CLI with BashKitten's native Termux runtime and use its private
bundled Node. Reuse the approved Termux/native-controller setup to deliver the
dynamic endpoint and credential privately. Termux and BashKitten keep separate
UIDs; matching signatures or filesystem access are not assumed. The research
verified literal localhost between those UIDs, not an Android cross-UID Unix
socket. No third application or repeated companion pairing is introduced.

#### Restrict access to BashKitten-owned Pi sessions

Only live **local BashKitten-owned Pi workers**, including their owned subagents,
may obtain Phone authorization. Installing the CLI, knowing the port, sharing
Termux's UID, using a particular executable name or setting `BASHKITTEN_*`
environment variables is not authentication. Standalone Pi, an ordinary Termux
shell, other Android apps, websites and remote/container Pi sessions receive no
Phone grant. No new per-chat permission UI is needed for this requirement.

Reuse the existing trusted native/Termux controller and worker lifecycle to
authorize a worker when it starts. Mint a random short-lived opaque credential
bound to the installation/backend instance, native Pi session, worker incarnation
and policy generation. Deliver it privately only to that worker's Pi process
and its tool subprocesses; never install a reusable all-session Phone token in
a general CLI configuration file or shell startup environment. Keep the native
credential-issuing authority out of the CLI and ordinary Pi environment.

Android owns the active-grant registry. Registration and renewal require the
trusted worker owner over its private controller path, not generic Termux
approval or a CLI-provided session/PID. The current `BASHKITTEN_INSTANCE_TOKEN`
is inherited by Pi and cannot serve as the Phone grant-issuing authority. Keep
that authority separate and explicitly exclude it from inherited Pi/command
environments. Each subagent worker receives its own scoped grant.

The CLI receives its worker authorization through the owned process environment
or private worker IPC supported by the existing launch path. Environment names
and session IDs are only routing metadata; an unguessable validated grant is
still required. Do not patch Pi or infer trust from a supplied PID. Renew only
through the authenticated owner while the worker is alive; revoke on worker
stop/replacement, controller disconnection, reset or master Off. Expiry fails
closed if a crash prevents clean revocation. Feature revocation takes effect
immediately through the native live policy, without waiting for token expiry.
Do not replay commands when reauthorizing. Reopening a chat with a new worker
requires a new grant; there is no transferable saved chat credential.

Use the existing `http/server.mjs` worker creation and `rpc/worker.mjs`/`rpc.mjs`
launch/lifecycle seams. `adoptSession()` can change the native session while the
Pi process stays alive. Rebind/rotate its Phone authority through that owner
transition, invalidate old-session work/results and let CLI requests obtain the
current grant through private worker IPC. A spawn-time `BASHKITTEN_SESSION_ID`
or static environment credential must not determine later session identity.
Native backend restart invalidates registrations; only the trusted live owner
can re-register. Never turn a stale command into an automatic retry.

Check the grant and its current worker/session scope on every request, including
help/discovery and result delivery. A guessed session ID or a grant from a stopped
worker must never authorize another session. Request origin/IP and the CLI's own
checks are not security boundaries. Any ordinary app can try localhost; it must
be rejected without valid authorization. Android Settings/Phone policy cannot
be changed with the same command credential.

This enforces **BashKitten session authorization**, with an explicit platform
limit: all programs inside Termux share its Android UID. Files, environments,
worker IPC and process inspection are not a strong isolation boundary against
malicious same-UID code or a credential deliberately leaked by an authorized
agent. Pi's shell commands/extensions also execute within its authority. Do not
claim cryptographic proof of the caller being the Pi binary or sandbox isolation
from hostile Termux programs; that would require a different execution/UID
boundary, outside this plan. Per-worker grants still prevent unprovisioned normal
callers and other Android UIDs from using Phone and limit credential lifetime.
This distinction follows Android's
[UID-based application sandbox](https://source.android.com/docs/security/app-sandbox);
our inference for Termux is that programs sharing its UID do not receive separate
Android application sandboxes merely because they are different executables.

#### Local transport and command contract

Reuse the existing authenticated local controller transport where practical;
keep any necessary dedicated Phone listener bound only to literal `127.0.0.1`
on a discovered port. Use a small versioned typed request/reply contract, no MCP
server or generic RPC framework. Authorize the worker's Phone grant against
the same live feature policy; never reuse provider credentials or expose a
credential in argv, URLs, logs, web pages or ordinary browser storage. Keep
Termux endpoint/worker IPC metadata private (directories 0700, files 0600); avoid
persistent command tokens. Rotate/invalidate on reset, installation identity
change and master Off. Reject unauthenticated requests, web-origin requests and
unexpected protocol/content types. Do not
follow redirects, resolve arbitrary controller hosts or fall back to LAN/tunnels.

Provide concise `phoneuse status`, `phoneuse capabilities` and feature-specific
help plus typed subcommands for enabled groups. Master Off reports unavailable;
it does not start the service. Help/capabilities expose only currently effective
commands. Detailed help is read on demand; no full MCP schemas enter Pi context.

The small `phoneuse` skill uses stock Pi skill discovery and ordinary shell/read
tools. Its initial guide explains status, enabled-capability discovery, concise
results, permission errors and cancellation; it does not carry a permanent
catalog of disabled operations. Keep recipes in capability-filtered CLI help.
No Pi patch, custom loader or automatically registered MCP tools are needed.
Install only into BashKitten's private Pi environment; preserve native Pi tools
and the standalone user's Pi configuration. This plan does not silently grant
remote backends a new phone-control endpoint.

Return structured small results and truthful unavailable/denied/cancelled errors.
Stream file data and put requested screenshots into private transient files,
returning paths instead of flooding context with base64. Support deadlines and
cancellation. Never blindly retry side-effecting commands after a timeout;
an unknown delivery result is not proof that an action did not happen.

### Preserve the control boundary

The main APK can reach its own components and holds permissions for unrelated
features. Do not expose arbitrary intent actions/components/services/broadcasts,
extras, reflection, shell execution or the prototype's generic tool invocation.
Keep app/URI opening typed and validated. Apply the same policy and protected
surface rules to notification PendingIntents, sharing and downloads. Remove
the donor's permissive TLS option; storage/network requests must follow their
existing authorized scope and cannot invoke private controller endpoints.

Phone control must preserve the existing protected Agent/browser/native-settings
automation boundary. Enforce it before screenshots, tree reads and actions,
including focus/window changes between inspection and action. The skill alone
is not an enforcement mechanism. Do not expose credentials or let an agent
toggle its own Phone access through Accessibility or a private native intent.
Honor Android secure-window restrictions; no screenshot/control fallback bypass.

### Nonblocking implementation

Implement this as a native backend module in the main APK with lifecycle-bound
background work. The Phone UI only submits settings changes and displays status.
Keep network, storage, tree processing, screenshots, serialization and teardown
off the browser/UI thread; Android callbacks do only the minimum platform work
before handing off. Do not import the donor's blocking service shutdown path.

Use ordinary supported Android service lifecycles and an accurately declared
foreground-service type/notification where required by the selected work. Do
not attach location permission or a location foreground service to notification
control. Missing service eligibility produces an accurate unavailable state,
not a hidden keepalive loop. No collection, periodic permission polling or
background work exists for disabled features. Phone control must remain responsive
under a slow provider, many notifications, service death and rapid toggle changes.

### No telemetry across bundled components

The requirement applies to **every built or bundled component and its runtime
dependencies**, including the Phone fork, SheetJS/spreadsheet viewer, Podman/crun,
guest customization, browser, Node/Pi and native libraries. No analytics, remote
crash reports, external logs, developer callbacks, unsolicited remote assets or
donor update/discovery traffic. User-requested browsing, model/provider calls,
downloads and existing explicit update flows retain their intended behavior;
they must not carry hidden diagnostic/content reporting.

Extend existing component source/license manifests with reviewed network/logging
behavior and the exact removal/configuration patches. Inspect sources and actual
packaged binaries, APK classes/native libraries, JS and transitive dependencies.
Remove unused reporters and callbacks; any retained upstream code path must be
disabled in the shipped configuration and unable to activate through inherited
donor defaults. Keep full license attribution even when removing product code.

In the Phone donor, review `EventDispatcherImpl`, `EventChannelService`, tunnel
providers/native payloads, `UpdateCheckScheduler`, `GithubReleaseChecker`, OAuth
`ClientIconUrl`, the channel plugin and `ServerLogRepositoryImpl`/segmented store.
Local donor logging is not evidence of developer uploads, but sensitive content
logging must also be removed. Existing Firefox telemetry preferences alone do
not establish compliance for the expanded package.

Use the existing packaging/license/source collectors and external traffic
observation during fresh-profile startup, idle, representative features, errors
and shutdown. Missing review/attribution, unexplained network reporting or
sensitive payload logs block release. This is a required release gate, not a
claim that the current whole product has already passed an audit.

### Implementation sequence and acceptance

1. Import the pinned donor source/licenses, then strip unused code in focused
   commits. Record the main-APK ownership, retained providers and command map.
2. Implement native policy/lazy lifecycle and private CLI transport together,
   with every entrypoint sharing the gate. Add the simple Phone panel and
   permission/status handling; remove replaced donor entrypoints.
3. Package the Termux CLI and concise `phoneuse` guide; deliver full licenses,
   sources and architecture-correct artifacts through normal release builds.
4. Complete the following acceptance on fresh Android 16/17 profiles using the
   real BashKitten UI for user flows. ADB is appropriate for setup/debugging and
   external negative checks, never a requirement of the delivered user flow.

| Check | Required result |
| --- | --- |
| Main APK setup | One Phone panel, no companion install; normal user approval routes, no Accessibility prerequisite for independent features. Ordinary browser/Pi startup works with Phone Off. |
| Only owned Pi sessions | A live owned local worker succeeds; standalone Pi, ordinary Termux shell without a grant, another Android UID, guessed session/PID, expired/revoked grant, old worker incarnation and remote/container sessions are refused. No general-shell/profile credential exists. Record the same-UID trust limitation rather than claiming those checks isolate hostile Termux code. |
| Session transitions | Fork/adopt a session without restarting Pi, renew the grant and restart the native backend. Only the authenticated current owner can update authorization; old-session requests/results fail and normal commands resume under the new binding without replay. |
| Notifications without Accessibility | Read and reply through a current notification; revoke access and observe immediate refusal without restart. Notification shade control remains unavailable. |
| Each feature Off | With wider APK grants still present, no handler/provider/observer/cache collection, help exposure or effect through direct/stale/alias/compound calls. Turning Notifications Off stops callback extraction, not merely HTTP access. |
| Master Off and restart | Stop/invalidate the Phone endpoint and queued work, clear transient state, preserve other app services. Boot, service death, package update and late callbacks do not restore disabled work. |
| Accessibility transitions | Independent features continue without it; dependent options grey out and pending work fails safely on disconnection/revocation. Re-enable only through actual user grant and current policy. |
| Boundaries and removals | No camera/microphone or generic intent/MCP backdoor; protected Agent/settings cannot be read or controlled. No unauthenticated, ordinary-web or unintended network path reaches the module. |
| Controls-only port | Packaged Phone code and dependencies contain only the retained Android controls, native authorization and our CLI integration. No MCP SDK/server/client/protocol, donor provider connections or AI-account/model setup; model calls still belong to existing Pi. |
| Platform outcomes | Background launch reports observed/unknown/denied state accurately; invalid RemoteInput, restricted clipboard, inaccessible URI and unavailable location are real errors, not simulated success. |
| Responsiveness | Slow requests, screenshots, service cleanup and repeated toggles do not freeze native UI, chat, browsing or Display. Cancellation releases owned resources without replaying actions. |
| Release contents | Correct sources/licenses, private bundled Node, concise skill discovery, no secrets or test artifacts; no unsolicited external reporting from any bundled component. |

The `mcp` thread's scratch research is under
`/run/media/user/Data/Repositories/bashkitten-android-control-research/2026-10-10/`.
Its `RESEARCH_RESULT.txt` and `reports/` establish notification read/reply from
the actual Termux UID with Accessibility disabled on Android 17 Cuttlefish,
and live notification-access revocation. Its CLI still used MCP internally,
the donor APK targeted SDK 34, and setup used research commands. Those results
support feasibility; they do not verify this rewritten module, production user
setup, current-target Android 16/17 behavior or physical OEM devices. Keep all
probes/fixtures outside the product repository and label those limits accurately.

## 13. Pi update and the Durable distinction

Add a focused dependency-update step from current
`@earendil-works/pi-coding-agent`/`pi-ai` 1.0.2 to the latest verified official
release, currently **1.1.0** at `abe508e1b89912adde45528136c3221eb69acdd7`.
Recheck the latest official release when implementation begins, pin its exact
commit/packages/lock integrity and update `agent/PI_UPSTREAM.md`. Check supported
RPC, ModelRuntime, extension/deferred-tool and subagent APIs against that release
before updating adapters. Preserve bundled Node and the entire private
`$BASHKITTEN_DATA_DIR/pi` profile, including npm configuration and extension paths.

Upstream announced [Pi Durable on 1 October](https://earendil.com/posts/pi-durable/),
and its [v1.1.0 package documentation](https://github.com/earendil-works/pi/blob/v1.1.0/packages/durable/README.md)
still calls it experimental. The verified latest Pi release date is 7 October,
not 10 October. Record the requested update without assuming that upgrading the
coding-agent package converts existing RPC/JSONL sessions to Durable storage.
This plan preserves stock sessions; it does not authorize a separate harness or
history migration. Verify the new release's session restore, effective model and
reasoning, fork, streaming and subagent communication in the existing integration.

## 14. Ordered implementation and acceptance gates

Implement in focused, reviewable commits on main, with relevant checks and pushes.
Do not dispatch large browser builds before proving the new native boundaries
and compiling the changed components. A passing build is not feature acceptance.

| Gate | Work | Required evidence before proceeding |
| --- | --- | --- |
| 1. Sources and runtime contracts | Track all built/bundled component source, official release commits, donor subsets, licenses and private Podman/helper matrix; update Pi through supported APIs. | Clean-checkout builds consume tracked source/locks; no floating refs, missing source/notices or unexpected system runtime selection; Pi API/packaging checks. |
| 2. Native Display feasibility | Reusable module and own renderer child; Android adapted `lorie` + paired loader; Linux rootful Xwayland/XFCE + private gateway + native Firefox receiver. | Real cross-process viewport attachment/input/resize and child-failure containment. Linux GPU **and** software frames on X11/Wayland; Android UID/FD boundary and no separate X11 APK; small documented Firefox integration patch set. |
| 3. Persistent environments | User-data machine storage/name mapping, Containerfile, live preparation, saved Podman config, lifecycle/deletion/startup, guest BashKitten and interactive passwordless sudo. | Install/create/rename/start/stop/reopen/delete with correct data ownership, safe PTY/redirection/signal behavior and actual backend readiness. |
| 4. BashKitten OS package | Shared `.deb`/native Termux packaging and initially pinned settings app, bottom taskbar, maximized search/pins/app-grid Start menu, no dock/default shortcuts, maximize/two-app behavior, direct scaling and exact Gnozzard styling; Linux Thunar installation/registration. | Matching responsive layouts and working settings on Linux/Termux, preserved later pin/unpin choices, real apps/dialogs/input/scaling; donor launch rules, passwordless APT, menu/shortcut management and user wallpaper. |
| 5. Native hierarchy | Listed backends, one + entry, per-backend toggles and container Settings/Display, optional projects with folder-picker creation and new-chat cwd inheritance, standalone chats, rename/move, selected-chat web view. | New project chats use their project's directory; standalone behavior and existing histories/cwd remain unchanged; independent controls, no remote Display/settings, no large backend dropdown, no container-count cap or duplicate sidebar; subagent/draft/session ownership retained. |
| 6. Integration boundaries | Guest local socket, existing media/ports/settings, unchanged remote publishing and CUA scope. | Local/remote credentials remain separated; allowed remote flow and denied management paths; Agent excluded from desktop automation. |
| 7. Phone module and CLI | Main-APK MCP port, native master/feature policy, optional Accessibility, owned-Pi worker grants, Termux CLI and `phoneuse` skill. | Complete section 12's user-flow and denial checks; no camera/microphone commands, companion APK, exposed MCP catalog or reusable general-shell token. |
| 8. Package/release readiness | All actual architecture artifacts, matching APK/loader, caches, complete offline source/notices, upgrade handling and every bundled component's network/logging audit. | Installed native user flows plus recorded missing hardware coverage; no unexplained telemetry/developer callbacks or release claim based on a dispatched build. |

Use ADB/direct Termux for Android setup, installation, permissions and debugging;
use the desktop BashKitten browser with Cuttlefish's web UI for actual feature
interaction. Keep external probes/evidence outside product source/artifacts.
Do not add BashKitten-owned scripted product tests. Use stock Android 17 native
KVM Cuttlefish with the existing 16 GiB/128 GiB SSD configuration, fresh browser,
backend and Pi profiles for architecture acceptance, and real devices for claims
about physical GPU behavior. Android 16 coverage must be recorded separately.

### Required native X11 host VM

As part of implementation verification, install **virt-manager/libvirt/QEMU-KVM**
and create a dedicated Debian or Ubuntu Linux test VM with an actual **Xorg/X11
desktop session**. A Debian XFCE installation is a suitable planned target;
select an image/session that really provides Xorg. Install the candidate native
Linux BashKitten package inside that VM and run its local Podman container and
embedded XFCE Display there. From the product's perspective this Linux VM is
the host system; its Podman environments are ordinary Linux containers and do
not require nested KVM. This test VM is external development infrastructure,
not another backend offered by BashKitten or a product dependency on virt-manager.

Verify and record the actual login session type, Xorg server, browser window
backend and renderer. A browser using Xwayland under a Wayland login does not
satisfy this X11-host gate. Exercise the real native sidebar, machine creation,
display/input/resize, lifetime/reopen, scaling/split-screen, sudo and deletion
flows in the VM. Prove the software path when acceleration is unavailable and
the accelerated path when the VM's virtual graphics supports it. Keep the
separate Wayland-host check. Virtual GPU results establish only that virtual
configuration; physical GPU/NVIDIA coverage stays separate. Store the test VM
and verification material outside the product repository/release artifacts,
without confusing that development disk with the product machine data layout.

| Manual case | Expected result |
| --- | --- |
| Android fresh install | Termux setup installs native dependencies/paired loader; Display opens inside BashKitten with no X11 companion APK and no shipped root/ADB requirement. |
| Android input/viewport | Real GUI app accepts hardware modifiers, Unicode/composing IME, touch/mouse/scroll; keyboard shrink/restore and portrait/landscape maintain correct pointer coordinates. |
| Android lifetime | Tab close/reopen, browser background/recreation and rotation preserve the desktop; Stop/Local heading Off stop only their owned processes; display crash leaves chats usable and independent remotes stay connected. |
| Linux preparation/config | Visible real package output while the browser stays usable; edited launch flags take effect; invalid config shows the real error without another runtime. |
| Linux persistence/startup | Guest-installed packages, files and Pi work survive viewer/browser-window close and later attachment; per-container startup on/off behaves independently. |
| Machine storage/name/delete | Default and configured BashKitten data roots contain the rootfs/configuration/state; chosen names resolve to the correct stable directory; rename preserves work; deletion removes only the selected machine and its owned data, preserving other machines/shared caches/host-mounted folders. |
| Host rendering | Same guest works in X11-host and Wayland-host sessions; deliberately unavailable acceleration selects the actual software path without modifying saved GPU choice. |
| Native X11 host VM | Installed candidate runs its local container Display inside a virt-manager-managed Debian/Ubuntu VM logged into real Xorg; session/backend/renderer and the native product flows above are recorded. Xwayland-on-Wayland alone is insufficient. |
| UI responsiveness, including Display | During provisioning/deletion, expensive GPU/software frames, resize/rotation and stalled display/backend I/O, chat/sidebar/navigation/tab close remain usable; no synchronous frame/fence/process wait blocks the UI. Detached views release work asynchronously without stopping their guest. |
| Automatic resolution | Resize the Linux host window and Firefox tab via sidebar/chrome changes on X11 and Wayland; on Android rotate and show/hide the keyboard. Verify guest X screen dimensions change to match the actual tab drawable area, with correct pointer coordinates, panel/workarea, launcher and app geometry. Switch away/reopen without a zero-size resize or desktop restart; preserve the selected UI scale and avoid merely stretching a fixed framebuffer. |
| Display module/process boundary | Verify a separate renderer PID for the native viewport; interrupt/terminate that child and confirm other tabs/chat remain usable and guest work survives. Reattach a fresh renderer. Audit that Firefox changes remain confined to the documented module integration hooks. |
| GPU limits | Actual supported devices and optional NVIDIA path verified; no physical-GPU claim from Cuttlefish, no guaranteed CUDA/game support from software rendering. |
| Sudo | Noninteractive `sudo -n` package work, interactive PTY programs and `sudoedit` work; redirected input/output, interrupt, Ctrl-Z/`fg`, terminal resize and terminal restoration remain correct; no host privilege gained. |
| XFCE layout | Fresh Termux and Linux desktops have one bottom taskbar containing only an Applications button with the proportionally sized BashKitten icon and normal running-window buttons. No XFCE menu icon, clock/date, network or other status widget, tray, workspace switcher, Show Desktop, dock, pinned taskbar launcher or default desktop shortcut. Window switching, resize, keyboard, rotation and scaling preserve the bottom workarea. Relaunch does not reset user edits. |
| BashKitten OS settings | Correct native package installs the BashKitten OS application/icon and seeds its Start pin once. Open it to change scaling/two-app settings in the owning environment; operations stay responsive and persisted. Unpin/reorder it, restart and upgrade: the user's choice survives, and the app remains searchable. Host/container-sharing controls are not duplicated here. |
| Application Dark/Light preference | Change Dark/Light on Linux and Termux; the owning session's portal reads 1/2 and emits the change, and representative apps that follow system appearance observe it. Save/restart/upgrade retains the choice. BashKitten's dark/orange surfaces, Thunar customization and user wallpaper stay unchanged, as do other environments and host settings. No UI stalls, forced app restart or hidden polling. |
| Maximized launcher | Start opens search at top, ordered pins, one divider and an alphabetical left-to-right wrapping icon/title grid of remaining apps. Phone/tablet/desktop widths and keyboard/rotation reflow without overflow; large app/pin sets scroll. Launch/search/pin/unpin/context actions/close stay responsive; pins survive rename/reopen/restart/update, appear once and disappear on explicit managed-entry deletion. No hidden grid polling, second Start menu, Garcon fork or split-layout disruption. |
| XFCE behavior | App maximization, dialogs, taskbar pairing, divider drag, third app, pair member closing, disabled split mode, minimum sizes and viewport resize behave as specified. |
| Linux application actions | Use real Thunar secondary-click actions on matching-architecture AppImages, `.desktop` launchers and `.deb` packages. Verify direct FUSE launch, explicit persistent extraction/reuse, explicit no-sandbox marker, icon/menu registration and rename/removal, requested desktop shortcuts and package dependencies through passwordless guest sudo. Menu/file names with spaces and percent signs work; source apps survive registration deletion. Check actual failure/cancel reporting, UI responsiveness, preservation of unrelated Thunar actions and no host/Termux installation. Record amd64/arm64 coverage separately. |
| Scaling | Saved profiles update owned XFCE settings and new app launches; launcher reflows and the exact Gnozzard palette remains consistent; restart-needed apps are reported truthfully; no startup script resets user edits. |
| Appearance/wallpaper persistence | Panel/menu/Thunar/default background use the recorded Gnozzard dark/orange colors on both platforms. The default wallpaper centers the existing BashKitten logo proportionally over #202225, shrinking when needed and never exceeding its 1254 × 1254 native pixels, including on high-DPI/large screens. Set a user wallpaper and placement through XFCE, then reopen Start/Display, rotate/resize, change scale, restart the desktop and upgrade the package; the saved image/placement and user appearance changes remain. No copied lock-screen override. |
| Sidecar/backend controls | One + routes to remote setup or Linux container creation; every container heading opens its own full Display tab and Settings; individual toggles affect only their backend; remotes have no Display/settings; no large selector or artificial machine-count cap. |
| Projects/sessions | Create chats with no project on every backend; create/rename projects, rename chats, move chats into/between/out of projects, retain subagents and reconnect; same native Pi history/cwd and correct effective model/reasoning/draft/queue ownership. |
| Project working directory | Create a project through the modal on each backend, then create multiple chats beneath it without another folder prompt and verify their actual Pi cwd. Cancel leaves no project; missing/inaccessible directories report an error. Standalone new chats retain current behavior; reopening or regrouping existing chats preserves their recorded cwd. |
| Chat lookup skill | Ask Pi about another standalone/project chat; it discovers the guide/tool, resolves title/topic to the correct backend/project/session, reads relevant history and identifies its source. Cover duplicate/renamed titles, regrouped chats, hidden sessions and unavailable remotes; no eager history dump, new worker, message, metadata/JSONL mutation or UI stall. |
| Local vs remote | Container socket works without Tor; publishing and a real saved-remote client still use existing encrypted/authenticated route; remote has no Display streaming option. |
| CUA scope | Screenshot/input/accessibility target the guest/Termux desktop and actual apps; host native Agent/auth UI and unrelated host desktop are not exposed by the new display connection. |
| Upgrade/package | Both ABIs use matching loader/APK/native libraries; existing custom commands/settings preserved; standalone Termux:X11 untouched; full licenses/source accessible offline. |
| Source/license completeness | Reconcile each actual artifact's direct/transitive components with tracked source, exact release commits, locks, patches and full notices. Include Podman/crun/helpers, SheetJS/other JS, X11/XFCE/launcher and Gnozzard code/CSS/folder artwork. A missing source/license or mismatched cache blocks release; offline About/package notices and matching published source archives work on every target. |

Record the exact candidate commit, platform, renderer and result for every gate.
The unproven engineering points are the Linux native frame receiver/gateway
adaptation, Android host-interface extraction, paired-window layout and the
complete private Podman/helper packaging. They are concrete implementation work,
not functionality claimed by this research plan.
