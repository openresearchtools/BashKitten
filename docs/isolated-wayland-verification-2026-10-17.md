# Installed isolated Wayland verification — 17 October 2026

This is a partial acceptance record, not completion of the native-environments
plan. Requirements, including the pinned original baseline, are unchanged.

## Environment and input boundary

The installed app ran as a dedicated temporary Linux user with its own home,
real systemd user manager, session D-Bus, rootless Podman storage and subordinate
UID/GID range. Its backend used the supported independent listen-port setting;
the host user's browser/backend and private VM were not adopted or controlled.

The private desktop uses official Weston 14's VNC GL backend, loopback only,
1440×1000. The compositor and app launch environment explicitly select the Intel
iGPU/renderD128 and Mesa. Earlier d39 process/FD receipts verified Intel and no
NVIDIA device/library use. This does not establish NVIDIA, full host-GPU,
physical Android or required real-Xorg VM acceptance.

The live browser viewer is server-enforced view-only. Automation uses a private
Unix socket and the viewer's **single** authenticated RFB upstream, with paced
keys and an exclusive lease. It does not create another Weston input seat.
Captures read that viewer's actual framebuffer. No host keyboard, pointer,
activation or host-screen capture is used. The earlier 15-second viewer timeout
was removed; actual idle survival and automatic reconnect across the dedicated
desktop switch were separately verified. The input lease was closed after this
pass; Weston/viewer remained available.

Reusable external infrastructure is under
`/run/media/user/Data/BashkittenBuild/bin/isolated-intel-wayland/README.md`.
Its source commits include `ac8a792` (single-seat relay/recipe) and `8380caa`
(private child diagnostic-file umask). The Build repository has no remote, so
these infrastructure commits are local. Credentials, profiles and raw cores/logs
remain outside source and evidence commits.

## Installed observations

| Candidate | Actual observed result |
| --- | --- |
| `d39ae276802b834094b1e27e227827a61a986546` | Genuinely fresh dedicated browser/backend/Pi enrollment completed automatic runtime/model downloads. CPU defaults and Qwen3.5-4B selection were visible before the chat worker. Actual composer request “Reply with exactly READY. Do not use tools.” returned **READY**. Read-only file hashes/provenance corroborate the UI; they do not replace it. |
| `cab1310f18215337d4f92455b15da495c5808912` | Normal APT install. Actual Retry creation completed the retained failed container and its sidebar became running. Observation of that UI-triggered Podman process proved the separate rootless UID map/namespaces and scoped packaged AppArmor profile. No global policy bypass was applied. |
| Same cab | Native Firefox About → Licenses → AI runtimes and models opened while creation continued. Installed runtime/model entries, original Qwen/Unsloth, NVIDIA/ggml-org and Kyutai/EryriLabs attribution were visible. Original Qwen Apache2 top/end, Parakeet CC-BY4 top and reference-voice CC0 legalcode top were inspected. This is not an exhaustive scroll of every transitive notice. |
| Same cab | Container Display opened the actual guest desktop. Observe suppressed a typed guest address-bar probe; Interact accepted one. Closing/reopening the Display tab retained the running container, guest browser and unsent field. |
| Same cab | Applications and the initially pinned BashKitten OS settings opened. Manage window size On, Two app mode Off, Dark and 100% defaults were visible. Management Off retained the saved Two app mode On choice and ignored an attempted toggle while disabled. The taskbar action truthfully reported that the current viewport could not fit both windows; a successful split/divider test remains pending. |

The **15 October Applications list reference** is authoritative: vertical
icon/title rows, independently scrolling lists, Pinned above fixed bottom
search. An initial comparison against the superseded top-search/grid layout was
retracted. App icons were not visible beside the rows in this capture; that
visual follow-up remains separate from the correct list/search positions.

## Failures and bounded follow-up

- Configuration → Local AI dismissed without opening its protected view on cab
  and on installed `26ba97cd4a4f806e9457f9e2533a69fc7e045613`, including a new
  app process with `--purgecaches`. One Down/Enter attempt did not select or
  activate a row. A temporary, coordinator-authorized event capture observed
  trusted gear events and popup dismissal, **no row input/command event**, and
  no settings view. Listeners were removed; no synthetic command is counted as
  acceptance. The subsequent installed PanelMultiView results are recorded below.
- Cab Display service Off left the container running but showed **A display
  endpoint is still in use**. Ordinary On retry showed a taskbar with black
  guest browser content during the bounded follow-up. No socket was forcibly
  removed. Endpoint-release correction `a7a3735571` was subsequently exercised
  in the 5151 Off/On test below.
- Native Quit after the cab Display sequence stopped owned workloads and the
  machine service, then left Gecko until a watchdog SIGSEGV. The safe core
  reason was **Shutdown hanging at step AppShutdownConfirmed**; the nested
  annotation was **AsyncShutdown Spinner for quit-application**. The retained
  stdout warning reported `Conditions: [] Barrier: quit-application`. No forced
  signal was sent.
- One 26ba repeat, with `toolkit.asyncshutdown.log=true`, exited normally
  (coordinator launch exit 0; absence verified within 25 seconds). Its four logged
  quit-application blockers and later BashKitten blockers completed. That launch
  had Cuttlefish WebRTC tabs, an already stopped container and **no newly opened
  container Display**. It does not resolve the earlier crash. A second 26ba
  native Quit removed the browser and owned workloads, but its coordinator
  launcher returned **143**, so it is not recorded as a normal-exit pass.
- Scoped 26ba HTTP logs contain four original Mozilla newtab-wallpapers-v2 URI
  initializations. Security/certificate services remain allowed; wallpaper
  startup requires correction. The capture used a retained profile and active
  Cuttlefish pages. Generic URL occurrences, including NEL header URLs, are not
  treated as requests. A genuinely fresh browser startup with scoped request
  evidence remains pending; quiet logs/prefs are not a pass.

## Subsequent installed 5151 test

Candidate `5151ba20ce574f77f69b43eb1439b93d42202b48` was installed normally by
APT and launched with `--purgecaches`, retaining the dedicated test data and
private asynchronous-shutdown diagnostics. PID/start-time verification preceded
input. The existing sole-seat relay was used throughout and its exclusive input
lease was closed when the test ended.

- Configuration pointer activation still failed: gear opened the popup, but the
  Local AI row click dismissed it without opening the protected view. One bounded
  array capture found the expected row geometry and enabled pointer events after
  animation, yet no row input/command event. The capture listeners were removed.
  Source correction `49a3610a28` awaits installed Wayland pointer verification.
- Keyboard navigation improved: gear → Down → Enter opened the actual Local AI
  view and full llama.cpp controls; Close → gear → Down → Space also opened it.
  Down/Up navigation, repeated reopen and Escape dismissal worked. Space after
  dismissal did not establish keyboard opening of the gear because its focus
  was not visible; that case remains unverified.
- With the container running, Display Off showed the expected message that the
  container and agent remained running. On restored the taskbar and responsive
  Applications without the earlier endpoint-in-use error. Observe prevented a
  typed launcher-search probe; Interact accepted `Term` and filtered the list.
  Closing/reopening the Display tab retained that search and the running desktop.
- Application title rows still lacked icons. The guest browser/content region
  remained black while the launcher and taskbar rendered. After ordinary
  Ctrl+Alt+D, the launcher disappeared and the black region remained. Read-only
  guest state selected the existing generated 821×860 default-wallpaper image;
  its initial-wallpaper marker was absent. No saved selection/cache was edited.
  Without an independent window-manager desktop-state query, this does not
  conclusively isolate a wallpaper-only failure. OS correction `3cf1855cb1`
  requires installed guest upgrade/icon verification.
- **Native Quit with the active container and Display passed this bounded
  sequence.** Actual Firefox menu Quit → Close 2 tabs was confirmed at
  22:14:41 UTC; the exact browser PID/start identity was absent by 22:14:49.211.
  Coordinator launch session 55211 returned **0**. No signal was sent. Owned
  browser/backend/container/display workloads and Display endpoints were gone;
  the dedicated machine service was inactive/dead with MainPID 0. Weston and
  the view-only viewer remained running. The private stderr completed
  `quit-application` and all later BashKitten shutdown blockers. This does not
  erase the cab watchdog/26ba launcher failures or cover the remote, publishing,
  Local-Off and crash cleanup matrix.

The diagnostic console also showed stock `PictureInPictureChild.sys.mjs` errors
for a null toggle and an actor accessed after destruction. These were reported
without suppressing them or changing the live product.

Portal picker latency, larger-viewport geometry/divider behavior, appearance
portal, scaling, tray protocols/actions, guest application integration, project
cwd flows and remaining architecture coverage are still pending. Android and
real-Xorg acceptance remain separate records.

## External receipts

Sanitized private-output screenshots, selected process/namespace observations,
safe crash annotations and explicit partial-result JSON are retained locally:

- `/run/media/user/Data/BashkittenBuild/verification/desktop-d39a/isolated-wayland-evidence/manifest.json`
- `/run/media/user/Data/BashkittenBuild/verification/desktop-cab1/isolated-wayland-evidence/manifest.json`
  — 44 files; manifest SHA256 `8b27b3b09f42cf070abbd14b39ed729245c7f4c854ae9c5f3b52017ede514518`.
- `/run/media/user/Data/BashkittenBuild/verification/desktop-26ba/isolated-wayland-evidence/manifest.json`
  — 21 files; manifest SHA256 `2d76a5e2461df494a1f982a3c2cc5a016193abf78ecb305a4830373d72cd7011`.
- `/run/media/user/Data/BashkittenBuild/verification/desktop-5151/isolated-wayland-evidence/manifest.json`
  — 32 files; manifest SHA256 `ea8920671e7c3768b7f623810c1aecc03ca0d5fbd07a15ce6974e24fafe7bde1`.

Each manifest records per-file hashes. Raw profiles, headers, credentials and
cores are excluded. Initial failures remain preserved alongside later results.
