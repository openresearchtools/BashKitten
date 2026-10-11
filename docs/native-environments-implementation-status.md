# Native environments implementation and acceptance

Requirements baseline: `f71686dcb76402ec43bac3e6a7db8979ef0fb119`, protected tag
`bashkitten/plan/native-environments-2026-10-11`. The agreed plan remains unchanged.
This record tracks implementation and evidence; it does not reduce its scope.

## Current checkpoint — 11 October 2026

All nine workstreams are active. The first full Android/Linux app builds are
held until all modules, private transports, UI, packages and runtime dependencies
are integrated. Component compilation is not installed feature acceptance.

| Area | Source integration | Installed acceptance |
| --- | --- | --- |
| Android Display / paired Termux loader | In progress; separate renderer service and typed UID-authorized FD bridge | Pending |
| Linux Display / persistent gateway | Rust gateway compiles; Xwayland CPU connection probe passes; Gecko receiver integration in progress | Pending Wayland and real Xorg |
| Container lifecycle / private Podman | Independent user-service and guest package implemented; packaging in progress | Pending |
| Native sidecar / projects / chats | Written; protected container connection integration in progress | Pending Android/Linux |
| BashKitten OS / XFCE | Shared package, launcher, layout, tray and application actions in progress | Pending Termux/Linux |
| Phone controls / phoneuse | Android module compiles; native grants and worker bootstrap integrated; review in progress | Pending |
| Telephony / contacts / messages / voicemail | Android module compiles; private gateway, speech and encrypted remote hooks in progress | Pending |
| Pi release / usage / ask_user | Pi1.1.0 API/source update and extensions in progress | Pending |
| Sources / licensing / telemetry / packages | Exact donor imports committed; transitive source packaging and audit in progress | Pending artifact/traffic verification |

Cuttlefish is running with the existing native-KVM configuration. A separate
Debian13 XFCE/Xorg libvirt VM is being provisioned. Neither is current candidate
acceptance. Prior Android composer dictation returned `[BLANK_AUDIO]` despite
measured Android input; diagnosis and a successful real voice flow remain open.
Prior remote/file-viewer results must be reconciled with the new installed
candidate. AI engines and VAD build only in daughter GitHub Actions.

## Required cases retained from the agreed plan

Every case below is pending integrated installed verification. Record exact
candidate revisions, platforms, observations and unresolved blockers per case;
never infer physical GPU/OEM/Android Auto coverage from Cuttlefish.

| Source | Verified starting point | Reuse or required change |
| BashKitten | `a39f8b1d1ab8ab0ee202a5bb174f905578e83333` | Existing private controllers, protected Agent, per-session Pi workers, native remotes, display launcher and packaging. |
| [BuzzardOS, podman branch](https://github.com/openresearchtools/BuzzardOS/tree/6c1b89f25c196ae7ab4a8f20e166b27e4ee94cc0) | `6c1b89f25c196ae7ab4a8f20e166b27e4ee94cc0`, inspected in `buzzardospodman` | Persistent external rootfs, native runtime setup, private display/media gateways, settings and sudo bridge. Its current desktop is Sway-based and its host viewer is Wayland/GTK/DMA-BUF-only; those are not the requested final frontend. |
| [Podman v6.1.3](https://github.com/podman-container-tools/podman/releases/tag/v6.1.3) | `85b994955e0b4e30fbce9c8351cab85676140ede` | Latest official stable release verified 10 October 2026; vendor its release source and build the private local engine for both Linux architectures. |
| [crun 1.30.1](https://github.com/containers/crun/releases/tag/1.30.1) | `079ff6a7a16d029460af882f9ea44674e6a510b6` | Latest official stable release verified 10 October 2026; supersedes the donor's older crun pin for this implementation. |
| [Termux:X11](https://github.com/termux/termux-x11/tree/fa3a8b430e2896a19f44c99a9cb056254615ae06) | Official nightly resolves to `fa3a8b430e2896a19f44c99a9cb056254615ae06` | Reusable `lorie` Android library, native X server/rendering, input and loader. Pin the exact commit and native dependency gitlinks; do not build a moving nightly reference. |
| [PeGPU v0.1.106](https://github.com/openresearchtools/PEGPU/tree/aae5382fae02eaeb97ceeb7fcaa531f88009b081) | `aae5382fae02eaeb97ceeb7fcaa531f88009b081` | MIT scaling helper. Relevant scaling/package-choice files match inspected HEAD `8ecbb5d4fad90f7e74dd29351c37c4de9aada84b`. Actual apps are Thunar and `xfce4-terminal`, not Nautilus. |
| [Gnozzard](https://github.com/openresearchtools/gnozzard/tree/59ca6d56ef147dea820381036838e76645074d0e) | `59ca6d56ef147dea820381036838e76645074d0e`, checked against GitHub main | Installer/registration and search/pin behavior, exact dark/orange palette and persistent wallpaper defaults; adapt to Thunar/XFCE and the requested maximized grid. Code/CSS GPL-3.0-or-later; retained folder artwork has its own LGPL-3.0-only notices. |
| [XFCE panel](https://gitlab.xfce.org/xfce/xfce4-panel/-/tree/xfce4-panel-4.20.7) | `f4e21b14a389fa6b7cc4fd756cb92e0a822ed3e5` | Stock Window Buttons/tasklist and right-aligned systray supporting StatusNotifier and legacy XEmbed. Per-window menus need a narrow source patch for Two app mode; the public plugin menu API is not a per-window extension hook. |
| [SheetJS CE v0.20.3](https://git.sheetjs.com/sheetjs/sheetjs/src/tag/v0.20.3) | `8a7cfd47bde8258c0d91df6a737bf0136699cdf8` | Existing `xlsx` spreadsheet parser; official annotated release tag peeled to this commit. Vendor the source and matching official release distribution with Apache-2.0/component notices. |
| [Pi v1.1.0](https://github.com/earendil-works/pi/releases/tag/v1.1.0) | Published 7 October 2026; `abe508e1b89912adde45528136c3221eb69acdd7` | Planned update from current v1.0.2. Durable is a separate experimental package, not an automatic change to BashKitten's stock RPC sessions. |
| Backend row | Controls and ownership |
| Local | Its own on/off toggle and existing local settings/actions; Display only for Local Termux. Off stops Local's owned Agent/Pi/services/display/wake-lock group without stopping containers or disconnecting independent remotes. |
| Each local container | Its own on/off toggle, Settings and window/Display button. On/Off starts/stops that environment; Settings retains its config/startup/ports/media/sharing and lifecycle/deletion helpers. |
| Each saved remote | Connection on/off and saved-connection disconnect/delete actions, plus **Connect to phone** for the scoped registration in section 13. No Display endpoint/button or remote settings button. Off disconnects this client's existing tunnel/mappings; it does not stop or power off the remote host. Delete forgets the saved connection through the existing removal flow, not the remote machine or its data. |
| Identity | Meaning and owner |
| Environment ID | Stable native catalogue identity for Local, a local container or a saved remote; separate from its editable name and current socket/port. |
| Project ID | Optional stable record on the owning backend, with an editable name and selected working directory for new chats. An absent project ID means a standalone chat directly under that backend. Existing sessions retain their own recorded cwd. |
| Chat reference | Environment ID plus the existing BashKitten session ID; backend resolves its existing native Pi session reference. |
| Chat title | Pi's native session name through supported RPC; existing metadata is only its UI index. |
| Operation | Result |
| List | Chat ID, actual title, optional project ID/name, cwd and available modification time, scoped to a backend; simple text/project filtering and pagination. Include standalone chats. |
| Search | Plain-text matches in the scoped chat histories with short excerpts and source chat/entry references. Reuse ordinary text search/native parsing; no embeddings, daemon, background indexing or generated summaries. |
| Read | Requested chat's saved conversation through Pi's native parser, with roles/order and native entry references; incremental reads can reach the full history without dumping every chat into context. |
| Action | Required effect |
| Close/hide Display or close browser window | Detach the viewer; keep container, guest desktop, guest BashKitten and work running. |
| Select another environment/chat | Change the view; do not stop the previous environment. |
| Per-container startup enabled | Start that saved environment when BashKitten starts, without duplicate instances; Off prevents automatic starts and does not stop an already-running container. |
| Explicit container Stop | Stop that environment's owned runtime safely, preserving rootfs, Pi sessions and configuration. |
| Container heading toggle Off/On | Invoke that same container Stop/Start owner, independent of Local and other backend toggles; preserve saved data and configuration. |
| Explicit Delete machine | Confirm the named machine and its stored data, stop its owned runtime, remove its container definition and private machine directory, then remove its catalogue entry. This is distinct from Stop or closing a view. |
| Local heading toggle Off | Stop only its owned Local group; do not kill containers or disconnect independent remote rows through inherited global power ownership. |
| Remote heading toggle Off | Disconnect that client's remote connection/mappings without stopping the remote host; retain its saved connection until Delete is explicitly chosen. |
| Browser shutdown/reopen | Release client connections and reattach to surviving container ownership; never treat closing a guest browser window as container Stop. |
| Path | Required implementation |
| GPU | Retain DMA-BUF negotiation, formats/modifiers, fence/release lifetimes and device selection. Deliver frames to a small native Gecko receiver rather than GTK `DmabufTextureBuilder`. Verify actual import on both host backends and relevant drivers. |
| CPU fallback | Accept validated primary `wl_shm` buffers, copy/map their pixels safely into a native Gecko software surface and present them in the same tab. Launch rootful Xwayland with its supported `-shm` option and use Mesa software rendering for guest GL where needed. |
| Role | Color |
| Taskbar/panel | `#282828` |
| Start menu surface | `#222222` |
| Initial desktop background behind the centered BashKitten logo | `#202225` |
| Hover | `#3f3f3f` |
| Orange focus/selection/active indicator | `#ff7139` |
| Normal / subdued text | `#ffffff` / `#c8c8c8` |
| Text on orange | `#181818` |
| Selected file | Thunar actions and behavior |
| `.AppImage` / `.appimage` | **Run AppImage**; **Extract and Run AppImage (Persistent)**; **Extract and Run --no-sandbox**; **Add AppImage to Applications**; **Add AppImage to Desktop**. |
| `.desktop` | **Run Desktop Launcher**; **Add Launcher to Applications**; **Add Launcher to Desktop**. Preserve the launcher's arguments, field-code handling and appropriate icon through the existing desktop-entry parser/launcher. |
| `.deb` | **Install Debian Package…**. Show the actual package/version and Install/Cancel confirmation, install with APT dependency resolution, and report the actual result. |
| Pi execution environment | Discovered desktop-use skill |
| BashKitten-owned native Termux backend | `termux-use`, controlling that backend's XFCE desktop |
| BashKitten-managed container backend | `computer-use`, controlling that container's XFCE desktop |
| Ordinary Linux host, standalone Pi, or other unmanaged backend | Neither guide |
| Location/seam | Planned responsibility |
| `browser/bashkitten/browser/components/agent/` | Linux native sidebar/selection, private environment connection adapter and reuse of existing service settings/draft ownership. |
| Product-owned browser Display component | Separate renderer child, small Linux Gecko surface/input host, typed asynchronous IPC and special-tab lifecycle. Keep a narrow version-adapter boundary for future Firefox updates. |
| `browser/mobile/android/bashkitten/` plus narrow Fenix host/tab hooks | Native sidebar and embedded X11 View; replace `AgentDisplayDialog` external-app path, reuse `AgentRuntime` and Termux connection approval. |
| `agent/src/server/control.mjs`, platform adapters and new environment module | Native container setup/config/lifecycle, private guest sockets and streamable preparation status. No new remote administration routes. |
| `agent/src/server/common.mjs`, HTTP/session adapter and RPC worker | Project grouping metadata and existing stock session operations; no custom Pi history writes. |
| `agent/pi` extension/skills and `agent/packaging/pi-skills.py` | Concise `chats` guide and one deferred read-only list/search/read adapter over the sidecar metadata and native Pi history reader. |
| Android native Phone module, owned Pi worker launch and Termux CLI/skill packaging | Adapt the pinned MCP donor into a main-APK backend, native feature policy, worker-scoped authorization and clean `phoneuse` CLI. No companion APK or exposed MCP catalog. |
| Android product-owned telephony library module and existing native/Termux service owners | Import the pinned Phony source/licenses, then reduce it to managed Telecom calls, contact setup, keypad events and the authenticated Pi voice gateway. Same APK and Phone panel, independent of `phoneuse`; no Mozilla core changes. |
| `agent/pi` extensions, existing RPC worker/status/queue and notification outbox | Narrow ChatGPT usage adapter with terminal/web status; deferred `ask_user` plus concise `ask-user` skill and durable question resolution. Reuse native Pi APIs and existing chat/phone delivery owners. |
| `agent/src/web/web_ui.html` | Opened-chat view; remove replaced hierarchy/navigation while preserving existing chat/file functions. |
| Product-owned BashKitten OS source/package | Shared XFCE taskbar with right application tray and guest BashKitten indicator, maximized search/pins/app-grid launcher, initially pinned settings app with Manage window size, layout/scaling and Gnozzard dark/orange styling with persistent wallpaper; Linux guest Thunar application installation/registration adapted from Gnozzard/Buzzard. |
| Directly merged BashKitten implementation | Needed Buzzard runtime/rootfs/media/lifecycle/sudo functions adapted into their BashKitten owners, with original source pins and notices; no parallel Buzzard app, updater or release chain. |
| Tracked external component source + patch series | Release source trees for Podman/crun and required helpers, embedded Termux:X11/native dependencies, XFCE custom components, spreadsheet/other JS components, patches, exact provenance and licenses. |
| Existing packaging/component builders | Private Podman/crun/helper builds, embedded X11 in the BashKitten APK and paired Termux loader, desktop packages, source/notices and architecture checks. |
| Panel section | Switch | Operations and access |
| Independent | Applications and links | List visible launchable apps and request app/validated URI opening. Respect package visibility and background-launch rules. No unrestricted intent dispatcher. |
| Independent | Notifications | Read current notifications, open, dismiss, snooze, invoke an available action and reply through a current text RemoteInput action. Requires Notification access and a connected listener, not Accessibility. |
| Independent | Files and sharing | List/read/write/append/replace/download/delete within granted locations and receive deliberate Android shares. Retain per-location read/write/delete policy and SAF/URI/MediaStore ownership checks. Do not import public web-share links. |
| Independent | Clipboard | Write using application context; read only when Android actually permits it. Accessibility must not be an artificial prerequisite or a claimed bypass of clipboard restrictions. |
| Independent | Location | On-demand location through the native FOSS provider and granted access. The inspected donor requires precise location; do not silently claim approximate-only support or add continuous tracking. |
| Accessibility | Screen and elements | Read screen/tree state, inspect/find/wait for nodes and request a screenshot. Capture additionally requires the service's screenshot capability; no MediaProjection fallback. |
| Accessibility | Touch and element actions | Tap, long/double tap, swipe, scroll, pinch/custom gestures and supported node actions. |
| Accessibility | Text and keys | Append/insert/replace/clear text and supported key input through the available Accessibility input connection. |
| Accessibility | Navigation | Back, Home, Recents, notification shade, quick settings and keyboard dismissal. Opening the notification shade is distinct from reading notifications. |
| Check | Required result |
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
| Choice | User can select this chat when calling its backend | Agent final/question delivery |
| Off | No | None through this feature. |
| Call-in only | Yes | No unsolicited call/message; the user calls when wanted. |
| Messages | Yes | Replyable notification; the agent never starts a call. |
| Calls | Yes | Call from that backend's identity, or its voicemail when diverted/unanswered. |
| Action | Draft behavior |
| 1 / Send | Submit this reviewed draft once through its original backend/session owner. |
| 2 / Change | Beep and capture replacement; retain the old draft until replacement transcription succeeds, then read/review the new draft. |
| 3 / Add more | Beep and capture another segment; append it to the existing draft without rewriting earlier words, then read/review the complete combined text. |
| Case | Required evidence |
| Setup/lifetime | Incoming/outgoing/contact/Recents calls, cold bind while Off, denied/missing services, multiple calling accounts, UI closure, foreground/Doze/process death, muted/changed audio routes and hangup leaving Pi running. |
| Independent routes | Messages with Telephony Off and no microphone/PhoneAccount; Call-in only never rings; Messages allows user calls without enabling agent calls; Calls obeys diversion; all masters and phoneuse notification access stay independent. Saved defaults apply only to new chats; explicit Off wins over old capture/retries. |
| Correct menu/backend | Two contacts and duplicate/renamed backend/project/chat names; 0 starts the correct backend's normal new chat, 1–9 freeze eligible recency mapping; configured count, no eligible chats, vanished session and backend revocation. Keypad interrupts the first prompt; spoken selection starts only after it finishes. |
| Capture/review | Both Whisper and Parakeet, actual pinned VAD, speech pauses around four seconds, all #/silence modes, no-speech/mute, digits/words, ambiguity/negation and beep/echo isolation. Send/Change/Add more retains/replaces/appends correctly; no automatic send from silence, browser auto-send setting or hangup. |
| Responsiveness/races | Keypad during read-back/model loading, repeated digits, cancelled STT/TTS finishing late, busy shared speech service, stalled IPC and hangup before/after Send. Navigation remains responsive; queued audio stops, uncertain submissions stay held and Stop is not undone. |
| Live/read-last | Busy/idle/finished chats; native completed assistant text between tools, exclusion of reasoning/tools, full final once, slow TTS and action interruption; no model turn caused by listening. |
| Voicemail | Divert without ringing, no answer/decline saved once under correct backend, star menus, unread/played/replied states, reply/clear, restart/replay, diversion Off without backlog ringing, saved-message playback while remote is unavailable and no unauthorized reply; already answered/expired questions. No audio archive or duplicate Pi history. |
| Notifications/Auto | Correct backend/session/question reply from phone direct reply and a real Android Auto installation; delayed listen, host read-back/edit/send, mark-read without answer, renamed chat and newer question without retargeting an old action. Verify sideload setup, denied notification permission and no unsolicited TTS. |
| Shared question owner | Call/web/notification/mailbox races, 120-second expiry during recording/review, late confirmed follow-up, fork/adoption/Stop/Off and stale/replayed events. One answer or expiry, no double prompt/ring, unchanged encrypted remote route. |
| Required workstream | Work | Acceptance evidence |
| 1. Sources and runtime contracts | Track all built/bundled component source, official release commits, donor subsets, licenses and private Podman/helper matrix; update Pi through supported APIs. | Clean-checkout builds consume tracked source/locks; no floating refs, missing source/notices or unexpected system runtime selection; Pi API/packaging checks. |
| 2. Native Display feasibility | Reusable module and own renderer child; Android adapted `lorie` + paired loader; Linux rootful Xwayland/XFCE + private gateway + native Firefox receiver. | Real cross-process viewport attachment/input/resize and child-failure containment. Linux GPU **and** software frames on X11/Wayland; Android UID/FD boundary and no separate X11 APK; small documented Firefox integration patch set. |
| 3. Persistent environments | User-data machine storage/name mapping, Containerfile, live preparation, saved Podman config, lifecycle/deletion/startup, guest BashKitten and interactive passwordless sudo. | Install/create/rename/start/stop/reopen/delete with correct data ownership, safe PTY/redirection/signal behavior and actual backend readiness. |
| 4. BashKitten OS package | Shared `.deb`/native Termux packaging and initially pinned settings app, single-workplace default, Manage window size, bottom taskbar/right application tray, maximized search/pins/app-grid Start, no dock/default shortcuts, main-window maximize/two-app behavior, scaling and Gnozzard styling; Linux Thunar actions. | Matching responsive Linux/Termux layouts, On/Off behavior and parent-dialog exclusions, both tray protocols and guest BashKitten icon/activation, preserved user choices, real apps/input/scaling; donor launch rules, passwordless APT, menu/shortcut management and wallpaper. |
| 5. Native hierarchy | Listed backends, one + entry, per-backend toggles and container Settings/Display, optional projects with folder-picker creation and new-chat cwd inheritance, standalone chats, rename/move, selected-chat web view. | New project chats use their project's directory; standalone behavior and existing histories/cwd remain unchanged; independent controls, no remote Display/settings, no large backend dropdown, no container-count cap or duplicate sidebar; subagent/draft/session ownership retained. |
| 6. Integration boundaries | Guest local socket, existing media/ports/settings, unchanged remote publishing and CUA scope. | Local/remote credentials remain separated; allowed remote flow and denied management paths; Agent excluded from desktop automation. |
| 7. Phone module and CLI | Main-APK MCP port, native master/feature policy, optional Accessibility, owned-Pi worker grants, Termux CLI and `phoneuse` skill. | Complete section 12's user-flow and denial checks; no camera/microphone commands, companion APK, exposed MCP catalog or reusable general-shell token. |
| 8. Calls, messages and contacts | Pinned Phony native module, independent Telephony/message setup, per-backend contacts/mailbox, recent-chat/keypad menus, Termux gateway and LocalAI VAD/capture/review/live speech, remote registration and per-chat routing. | Section 13's Android 16/17 flows and complete acceptance table: native notification/Auto reply, mandatory call review, voicemail, cold-bind Off, foreground/audio/lifetime/auth/expiry checks, intended remote route and no duplicate delivery; record OEM/Auto gaps. |
| 9. Usage and questions | Narrow Pi subscription usage/status adapter and deferred nonblocking questions with one web/call/notification/mailbox resolution owner. | Sections 14–15's selected-account/window checks, immediate tool return, idle/busy/deadline-during-review/late-reply/race/Stop/reconnect cases; no Pi patches or duplicate delivery. |
| 10. Package/release readiness | All actual architecture artifacts, matching APK/loader, caches, complete offline source/notices, upgrade handling and every bundled component's network/logging audit. | Installed native user flows plus recorded missing hardware coverage; no unexplained telemetry/developer callbacks or release claim based on a dispatched build. |
| Manual case | Expected result |
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
| XFCE layout | Fresh Termux and Linux desktops have one workplace and one bottom taskbar with Applications/kitten icon, normal running-window buttons and right-aligned application tray. No XFCE menu icon, clock/date, preseeded network/audio/power widgets, workspace switcher, Show Desktop, dock, pinned taskbar launcher or default desktop shortcut. Switching, resize, keyboard, rotation and scaling preserve the bottom workarea. Relaunch does not reset user edits. |
| Application tray | Real StatusNotifier/AppIndicator and legacy XEmbed applications appear with working activation/menus; newly installed apps require no allowlist. Automatic guest BashKitten startup supplies exactly one real guest indicator, accurate status and the existing protected host activation path. Panel restart, browser closure, explicit Quit, icon hide/reorder and resizing behave correctly; no shared host bus, duplicate runtime, second protected Agent in the guest, injected system applets or UI stalls. |
| BashKitten OS settings | Correct native package installs the application/icon and seeds its Start pin once. Manage window size defaults On; Off relinquishes layout and disables Two app mode while retaining its saved preference. Scaling/appearance/tray remain independent. Changes are responsive and persist across restart/upgrade; pin/unpin choices survive. Host/container-sharing controls are not duplicated here. |
| Application Dark/Light preference | Change Dark/Light on Linux and Termux; the owning session's portal reads 1/2 and emits the change, and representative apps that follow system appearance observe it. Save/restart/upgrade retains the choice. BashKitten's dark/orange surfaces, Thunar customization and user wallpaper stay unchanged, as do other environments and host settings. No UI stalls, forced app restart or hidden polling. |
| Maximized launcher | Start opens search at top, ordered pins, one divider and an alphabetical left-to-right wrapping icon/title grid of remaining apps. Phone/tablet/desktop widths and keyboard/rotation reflow without overflow; large app/pin sets scroll. Launch/search/pin/unpin/context actions/close stay responsive; pins survive rename/reopen/restart/update, appear once and disappear on explicit managed-entry deletion. No hidden grid polling, second Start menu, Garcon fork or split-layout disruption. |
| XFCE behavior | Normal main windows maximize within the workarea; in-app modals, separate/late parent dialogs, file pickers, utilities, menus and fullscreen keep native behavior and do not dissolve a pair. Independent same-app windows remain main windows. Check pairing/drag, third main-window activation, member close, minimum sizes and viewport changes. Toggle management Off during queued resize/drag: divider disappears, pending enforcement stops, user moves/resizes normally, and no stale callback reapplies layout. On resumes without restarting apps or resurrecting a stale pair; no automatic extra workplace allocation. |
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
