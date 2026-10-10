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
- The desktop customization package provides PeGPU's scaling functions directly,
  a plain dark appearance matching BashKitten, Thunar and Xfce Terminal. PeGPU's
  initialization scripts and the old Buzzard shell/CUA stack are not imported.

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
| [Termux:X11](https://github.com/termux/termux-x11/tree/fa3a8b430e2896a19f44c99a9cb056254615ae06) | Official nightly resolves to `fa3a8b430e2896a19f44c99a9cb056254615ae06` | Reusable `lorie` Android library, native X server/rendering, input and loader. Pin the exact commit and native dependency gitlinks; do not build a moving nightly reference. |
| [PeGPU v0.1.106](https://github.com/openresearchtools/PEGPU/tree/aae5382fae02eaeb97ceeb7fcaa531f88009b081) | `aae5382fae02eaeb97ceeb7fcaa531f88009b081` | MIT scaling helper. Relevant scaling/package-choice files match inspected HEAD `8ecbb5d4fad90f7e74dd29351c37c4de9aada84b`. Actual apps are Thunar and `xfce4-terminal`, not Nautilus. |
| [XFCE Docklike](https://gitlab.xfce.org/panel-plugins/xfce4-docklike-plugin/-/tree/xfce4-docklike-plugin-0.5.1) | `1b53c5c722604fb517ee392d664782f08de11597` | Small external panel plugin suitable for the requested taskbar action with a narrow patch. Stock task buttons do not expose a verified arbitrary menu-extension hook. |
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
| Project ID | Optional stable grouping record on the owning backend, with an editable name. An absent project ID means a chat directly under that backend; it does not replace a working directory. |
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

Pin an official Podman release and matching required helpers after checking the
donor's actual usage: conmon, networking/storage helpers and any Buildah operations
that remain. Package private executables and explicit helper paths so runtime
behavior does not accidentally switch to an unrelated system installation.
Ship the full local Podman engine with build support, not `podman-remote`; a
separate Buildah executable is needed only if retained code actually calls it.
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

## 8. Shared XFCE customization package

Package the customization as a BashKitten `.deb` for Debian guests and a native
Bionic Termux package built from the same source. Reuse upstream XFCE/Xfwm and
the actual PeGPU apps: **Thunar + Xfce Terminal**. Nautilus is not XFCE's file
manager and is not what the inspected PeGPU setup installs. Do not pull in an
extra GNOME desktop stack on the assumption that the donor used it.

The package owns the small panel adaptation, event-driven layout/divider helper,
scaling module, settings and appearance assets. Native package dependencies and
normal desktop/session registration start those components. First-run defaults
are applied once to the owned desktop profile, then user changes persist. No
PeGPU account assumptions, login-time install scripts or repeated settings reset.

### Maximized apps and optional two-app layout

Keep stock Xfwm window management. Maximize normal resizable application windows
within the desktop workarea; preserve dialogs, file pickers, popups, tooltips,
panel windows and explicit fullscreen behavior. Do not force a modal dialog to
fill the desktop or claim a non-resizable application accepts arbitrary geometry.

Use one narrowly adapted upstream Docklike panel module, installed under a
BashKitten identity instead of replacing distro plugin files. In its taskbar
context menu, add exactly the requested **Two app mode** action, enabled by the
split-screen setting. Capture the current main window before the menu steals
focus, and use the clicked app's actual selected window when it has several.
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
settings code directly. Preserve their license and provenance.

The implementation coordinates Xft DPI, GDK integer factor, cursor/icons, panel,
desktop icons and titlebar sizing. Its profiles cover 100–300% in 25% steps.
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

Use BashKitten's actual dark semantic colors for GTK/Xfwm/panel and terminal/file
manager defaults. The inspected palette includes `#1e1e1e`, `#292929`, `#fafafa`
and `#c8c8c8`; compare against the built browser before finalizing assets. Use a
plain dark background, without new wallpaper/effects or appearance controls.

## 9. Agent desktop control and native boundaries

Use upstream X11 tools: xdotool/XTEST for pointer/key/window operations, an X11
screenshot implementation such as scrot, and AT-SPI for apps that expose a tree.
Provide the correct owned `DISPLAY`, X authority and session D-Bus environment
to that environment's agent. Keep one concise environment/skill description of
the actual installed tools; do not bring the Sway/wlroots CUA implementation,
seat controller or a new agent runtime into BashKitten.

XTEST input and X11 screenshots are display-wide authority, not per-window
security. AT-SPI coverage depends on the app; it is not created by XFCE for every
custom-rendered UI. Targeted `xdotool --window` events may differ from normal
focused XTEST input. Acceptance must check real focus, coordinates and results.

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
| `agent/src/web/web_ui.html` | Opened-chat view; remove replaced hierarchy/navigation while preserving existing chat/file functions. |
| Product-owned desktop customization source/package | Shared XFCE panel/layout/scaling/theme implementation with Linux and Termux packaging. |
| Directly merged BashKitten implementation | Needed Buzzard runtime/rootfs/media/lifecycle/sudo functions adapted into their BashKitten owners, with original source pins and notices; no parallel Buzzard app, updater or release chain. |
| Tracked external component source + patch series | Exact Termux:X11/native gitlinks, PeGPU scaling, panel dependency and licenses. |
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

Build Linux amd64/arm64 and Android/Termux aarch64/x86_64 components with their
correct libc, ABI, prefixes and native dependencies. A Linux `.deb` cannot be
installed into native Termux simply because both use the Debian archive format.
Termux's source recipes already include Docklike, Thunar, Xfce Terminal, PyGObject,
xdotool, scrot and AT-SPI components; their presence is a packaging starting point,
not runtime acceptance of this customization.

Retain component-artifact/compiler caches; key new component artifacts by source,
patches, toolchain and architecture so changing a panel helper does not rebuild
unrelated Gecko/native engines. Final release packages must use the same tracked
recipes in GitHub Actions and carry checksums/provenance; no workstation-only
library, package repository or executable path may enter a release.

Keep full offline notices and corresponding source. Termux:X11 declares GPLv3;
its input code and native dependencies retain their individual notices. PeGPU's
scaling module is MIT, Docklike is GPL-3.0-or-later, and XFCE components have
their own licenses. Do not relabel retained dependencies as AGPL-only or erase
donor attribution while removing product branding. Inventory actual linked and
packaged dependencies, including Podman/crun/helpers and X11 gitlinks; fail
packaging if required texts/source are missing. Preserve the testing-release
warning and existing application signing identity.

For upgrades, preserve user-written launch configuration and desktop settings.
Update an untouched generated Termux default to the new private loader, but do
not regex-rewrite arbitrary user scripts. Show the needed edit for custom commands.
Remove BashKitten's separate-X11-APK dependency/path; leave an independently
installed Termux:X11 and its command alone. Use fresh profiles for architecture
acceptance and separately check preservation with an explicit upgrade case.

## 12. Pi update and the Durable distinction

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

## 13. Ordered implementation and acceptance gates

Implement in focused, reviewable commits on main, with relevant checks and pushes.
Do not dispatch large browser builds before proving the new native boundaries
and compiling the changed components. A passing build is not feature acceptance.

| Gate | Work | Required evidence before proceeding |
| --- | --- | --- |
| 1. Sources and runtime contracts | Pin donor subsets, licenses and private Podman/helper matrix; update Pi through supported APIs. | Reproducible component inputs, no unexpected system runtime selection; Pi API/packaging checks. |
| 2. Native Display feasibility | Reusable module and own renderer child; Android adapted `lorie` + paired loader; Linux rootful Xwayland/XFCE + private gateway + native Firefox receiver. | Real cross-process viewport attachment/input/resize and child-failure containment. Linux GPU **and** software frames on X11/Wayland; Android UID/FD boundary and no separate X11 APK; small documented Firefox integration patch set. |
| 3. Persistent environments | User-data machine storage/name mapping, Containerfile, live preparation, saved Podman config, lifecycle/deletion/startup, guest BashKitten and interactive passwordless sudo. | Install/create/rename/start/stop/reopen/delete with correct data ownership, safe PTY/redirection/signal behavior and actual backend readiness. |
| 4. Shared desktop package | Maximize policy, two-app taskbar action/divider, direct scaling and dark appearance for Linux/Termux. | Real apps, dialogs, input, geometry and scale changes on both platforms. |
| 5. Native hierarchy | Listed backends, one + entry, per-backend toggles and container Settings/Display, optional projects and ungrouped chats, rename/move, selected-chat web view. | Existing histories/cwd unchanged by grouping; independent controls, no remote Display/settings, no large backend dropdown, no container-count cap or duplicate sidebar; subagent/draft/session ownership retained. |
| 6. Integration boundaries | Guest local socket, existing media/ports/settings, unchanged remote publishing and CUA scope. | Local/remote credentials remain separated; allowed remote flow and denied management paths; Agent excluded from desktop automation. |
| 7. Package/release readiness | All actual architecture artifacts, matching APK/loader, caches, complete offline source/notices, upgrade handling. | Installed native user flows plus recorded missing hardware coverage; no release claim based on a dispatched build. |

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
| Display module/process boundary | Verify a separate renderer PID for the native viewport; interrupt/terminate that child and confirm other tabs/chat remain usable and guest work survives. Reattach a fresh renderer. Audit that Firefox changes remain confined to the documented module integration hooks. |
| GPU limits | Actual supported devices and optional NVIDIA path verified; no physical-GPU claim from Cuttlefish, no guaranteed CUDA/game support from software rendering. |
| Sudo | Noninteractive `sudo -n` package work, interactive PTY programs and `sudoedit` work; redirected input/output, interrupt, Ctrl-Z/`fg`, terminal resize and terminal restoration remain correct; no host privilege gained. |
| XFCE behavior | App maximization, dialogs, taskbar pairing, divider drag, third app, pair member closing, disabled split mode, minimum sizes and viewport resize behave as specified. |
| Scaling | Saved profiles update owned XFCE settings and new app launches; browser palette matches; restart-needed apps are reported truthfully; no startup script resets user edits. |
| Sidecar/backend controls | One + routes to remote setup or Linux container creation; every container heading opens its own full Display tab and Settings; individual toggles affect only their backend; remotes have no Display/settings; no large selector or artificial machine-count cap. |
| Projects/sessions | Create chats with no project on every backend; create/rename projects, rename chats, move chats into/between/out of projects, retain subagents and reconnect; same native Pi history/cwd and correct effective model/reasoning/draft/queue ownership. |
| Local vs remote | Container socket works without Tor; publishing and a real saved-remote client still use existing encrypted/authenticated route; remote has no Display streaming option. |
| CUA scope | Screenshot/input/accessibility target the guest/Termux desktop and actual apps; host native Agent/auth UI and unrelated host desktop are not exposed by the new display connection. |
| Upgrade/package | Both ABIs use matching loader/APK/native libraries; existing custom commands/settings preserved; standalone Termux:X11 untouched; full licenses/source accessible offline. |

Record the exact candidate commit, platform, renderer and result for every gate.
The unproven engineering points are the Linux native frame receiver/gateway
adaptation, Android host-interface extraction, paired-window layout and the
complete private Podman/helper packaging. They are concrete implementation work,
not functionality claimed by this research plan.
