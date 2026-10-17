# Installed isolated Wayland verification — 17 October 2026

This is a partial acceptance record, not completion of the native-environments
plan. Requirements, including the pinned original baseline, are unchanged.

## Environment and input boundary

The installed app ran as a dedicated temporary Linux user with its own home,
real systemd user manager, session D-Bus, rootless Podman storage and subordinate
UID/GID range. Its backend used the supported independent listen-port setting;
the host user's browser/backend and private VM were not adopted or controlled.

The private desktop uses official Weston14's VNC GL backend, loopback only,
1440×1000. The compositor and app launch environment explicitly select the Intel
iGPU/renderD128 and Mesa. Earlier d39 process/FD receipts verified Intel and no
NVIDIA device/library use. This does not establish NVIDIA, full host-GPU,
physical Android or required real-Xorg VM acceptance.

The live browser viewer is server-enforced view-only. Automation uses a private
Unix socket and the viewer's **single** authenticated RFB upstream, with paced
keys and an exclusive lease. It does not create another Weston input seat.
Captures read that viewer's actual framebuffer. No host keyboard, pointer,
activation or host-screen capture is used. The earlier15-second viewer timeout
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
| Same cab | Applications and the initially pinned BashKitten OS settings opened. Manage window sizeOn, Two app modeOff, Dark and100% defaults were visible. ManagementOff retained the saved Two-appOn choice and ignored an attempted toggle while disabled. The taskbar action truthfully reported that the current viewport could not fit both windows; a successful split/divider test remains pending. |

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
  acceptance. The PanelMultiView correction `65f30efd8f` needs installed input
  verification.
- Cab Display serviceOff left the container running but showed **A display
  endpoint is still in use**. Ordinary On retry showed a taskbar with black
  guest browser content during the bounded follow-up. No socket was forcibly
  removed. Endpoint-release correction `a7a3735571` needs actual Off/On retest.
- Native Quit after the cab Display sequence stopped owned workloads and the
  machine service, then left Gecko until a watchdog SIGSEGV. The safe core
  reason was **Shutdown hanging at step AppShutdownConfirmed**; the nested
  annotation was **AsyncShutdown Spinner for quit-application**. The retained
  stdout warning reported `Conditions: [] Barrier: quit-application`. No forced
  signal was sent.
- One26ba repeat, with `toolkit.asyncshutdown.log=true`, exited normally
  (coordinator launch exit0; absence verified within25seconds). Its four logged
  quit-application blockers and later BashKitten blockers completed. That launch
  had Cuttlefish WebRTC tabs, an already stopped container and **no newly opened
  container Display**. It does not resolve the earlier crash. Repeat the actual
  Display Off/On → Quit sequence after the combined fixes, retaining diagnostics.
- Scoped26ba HTTP logs contain four original Mozilla newtab-wallpapers-v2 URI
  initializations. Security/certificate services remain allowed; wallpaper
  startup requires correction. The capture used a retained profile and active
  Cuttlefish pages. Generic URL occurrences, including NEL header URLs, are not
  treated as requests. A genuinely fresh browser startup with scoped request
  evidence remains pending; quiet logs/prefs are not a pass.

Portal picker latency, larger-viewport geometry/divider behavior, appearance
portal, scaling, tray protocols/actions, guest application integration, project
cwd flows and remaining architecture coverage are still pending. Android and
real-Xorg acceptance remain separate records.

## External receipts

Sanitized private-output screenshots, selected process/namespace observations,
safe crash annotations and explicit partial-result JSON are retained locally:

- `/run/media/user/Data/BashkittenBuild/verification/desktop-d39a/isolated-wayland-evidence/manifest.json`
- `/run/media/user/Data/BashkittenBuild/verification/desktop-cab1/isolated-wayland-evidence/manifest.json`
  —44 files; manifest SHA256 `8b27b3b09f42cf070abbd14b39ed729245c7f4c854ae9c5f3b52017ede514518`.
- `/run/media/user/Data/BashkittenBuild/verification/desktop-26ba/isolated-wayland-evidence/manifest.json`
  —21 files; manifest SHA256 `2d76a5e2461df494a1f982a3c2cc5a016193abf78ecb305a4830373d72cd7011`.

Each manifest records per-file hashes. Raw profiles, headers, credentials and
cores are excluded. Initial failures remain preserved alongside later results.
