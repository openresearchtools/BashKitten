# Native environments implementation and acceptance

Requirements baseline: `f71686dcb76402ec43bac3e6a7db8979ef0fb119`, protected tag
`bashkitten/plan/native-environments-2026-10-11`. The original remains unchanged;
the current plan also records the user's explicit 11 October presentation
amendments. This record tracks evidence and does not reduce that combined scope.

## Current checkpoint — 11 October 2026

The original feature implementations were integrated across the nine workstreams.
The first whole-scope Android/Linux candidates have been built and installed; actual app
acceptance is in progress. Startup, provisioning and presentation failures are
being repaired together for the next candidate. No workstream is fully accepted;
component compilation and source review do not establish installed acceptance.
The later Autostart, selected-container configuration and mobile toolbar requests
are additional mandatory amendments. Their source is integrated in `fb867067e4`;
the combined `3c35d56d7c` Android/Termux/Linux development packages were built
and installed. Whole-feature acceptance remains in progress.

The current development candidate is
`005d3e5b2d45dcb899f57d40b22e92f9b7cc6a93`. Its Linux package is fully built,
source-verified and installed on the native Wayland host and real Xorg VM.
The matched Android APK and Termux package are now installed on Android 16/17
with BashKitten OS `0f16d716aa`. Installed APK hashes, backend revision, OS producer
stamp and standard file manifests match; package verification is clean and normal
postinst sets the paired loader to `0400` with the correct owner. Both Android
apps were left stopped after installation; their new UI acceptance is pending.
Installation receipts are `verification/android16-005d/installation.json` and
`verification/android17-005d/installation.json` in the Build repository. This candidate uses
the BashKitten OS package from `0f16d716aa`, private engine from `136d077c9f`
and the freshly built guest package from `47620b1f83`. The native Gecko producer
remains `609e82c200`, with exact input-equality and separate assembly receipts;
the Android loader producer remains `780540ddf7`. The Linux and Android guard
producers remain `9ffeedb41d` and `bb8061b0b9`, respectively.

The `005d3e5b2d` package/source checksums and full corresponding-source collector
passed. Independent inspection found 2,046 nonempty Linux offline notice records,
including all 619 private-machine notices and the corrected full Plotters texts.
It also found one package metadata defect: the recorded machine-archive checksum
was overwritten by a library checksum. Input-archive and executable/library
validation passed; runtime bytes are unaffected. `300e12d6bd` fixes that field
for the next package. The immutable `005d3e5b2d` package retains this documented
provenance limitation and is not a release-readiness claim.

Initial installed `005d3e5b2d` Xorg checks pass the Callback label and selected
Local page. Fresh machine creation succeeds, but its settings can race the older
catalogue response; reopening after refresh works. `bdb08fdb58` repairs that race
for the next candidate. The new machine is still preparing. A retained guest's
`Browser exited 0` was traced during a normal Start to automatic Firefox
Troubleshoot Mode after repeated crash tests, followed by a duplicate profile
attempt; its managed-launch repair is pending. Neither startup is accepted yet.
Raw code Download now reaches
the normal Save File dialog, with actual saved-content verification still pending.
These observations are recorded in
`acceptance/xorg-vm-control/candidate-005d-ui.json` in the Build repository.
The Wayland host also passes the visible Callback check, recorded in
`verification/desktop-005d/installation.json`; this is not a calling-flow pass.
The following committed source changes are
also outside the installed `005d3e5b2d` candidate: `f4ac3e519e` matches question
cards to chat styling; `a794347f3b` keeps the selected chat subscribed to turns
started through an external entry point; `79b55863d8` clears a prior call's error
when a new call begins; and `300e12d6bd` corrects package provenance above. Their
source checks do not establish installed results.

The previous combined development candidate was
`0cf34b8857d8d6faef040ca1135038bded74618c`, installed on the native Wayland
host, real Xorg VM and Android 16/17. Both Android installations have its matched
Termux backend and the separately installed BashKitten OS component from
`6a8fe303ce`. Normal installation sets the paired X11 loader to `0400`.
The desktop package also contains OS `6a8fe303ce`, the newly built private engine
from `136d077c9f`, the Linux lifetime guard from `9ffeedb41d` and a guest package
refreshed at `0cf34b8857` with the unchanged corrected `19e9e2702d` sudo binary.
The Android guard producer is `bb8061b0b9`; actual native Gecko producer
`609e82c200` and loader producer `780540ddf7` remain recorded separately through
exact source-equality checks. Full corresponding-source collection, package
checksums and expanded offline notices passed for this candidate. These are
build/source results, not release or whole-feature acceptance.

Actual `0cf34b8857` Wayland and Android 17 checks show separate General and
Providers pages, no old App/Providers subtab strip or legacy web footer, and
matching rounded fields/buttons/switches in light and dark. Firefox About and
package source/notice delivery remain available. The host appearance was restored
to its original default; Android 17 night mode was restored to `no` (light).
Android 17's Phone use page also passes the installed dark-theme retest for
`9ffeedb41d`. Apps can be enabled; master Off retains that choice and disables
the feature controls. Unavailable Accessibility options remain disabled, and
closing the page returns to Agent. These presentation/settings checks do not
establish the full tool authorization or revocation matrix.

The `005d3e5b2d` batch includes Display-only compact toolbars and viewport
toggles, Android Updates with exact APK/Termux package pairing, and `.local`
calling identifiers without development-address compatibility. The visible
calling destination is now **Callback**, separate from Phone use. Completed
questions are placed beside their originating native tool call, with the existing
native answer shown once; unanswered questions can be dismissed without stopping
Pi. These changes have source/build evidence; their complete installed acceptance
is still pending.
The public APT feed does not yet contain this development candidate's matching
packages, so a successful public-feed update cannot be claimed from local assembly.

Android 16's matched update was verified before handoff. Actual `0cf34b8857`
checks show the truthful enabled-but-not-started Messages guidance and the
correct **Notification reply** label on its saved RemoteInput turn. A notification
answer reached its original Pi chat once. One optional question expired at its
120-second deadline and produced one attributed timeout entry; the small local
model subsequently made distinct new question calls, rather than the application
replaying a delivery. Stop cancelled those new questions and prevented a late
reply from resuming Pi. Direct calling, a contact created through the normal editor
and Recents callback connected through the managed PhoneAccount. Hangup left Pi
running. A later, properly timed public-audio fixture on a second `0cf34b8857`
call ended recording on silence, progressed through the TTS review stage and
accepted explicit keypad **1** to Send. The original native Pi session contains
one resulting user message and one assistant final. Acoustic read-back was not
independently heard, so this is not full speech-review acceptance. The selected
idle chat did not display that externally started turn after its queue cleared;
`a794347f3b` addresses that subscription gap in source. Evidence is in the Build
repository's `verification/android16-0cf3/manual-progress.json`,
`call-retry-audio-metadata.json` and `call-native-history-read.json`; the stale
chat screenshots do not prove a displayed completed turn.

Those calls used the earlier development address; the new `.local` identity,
complete audio/review flow, cross-channel races and OEM/Auto behavior remain
separate gates. An actual diverted final reached the native voicemail
store, but the open mailbox view remained stale; `47620b1f83` repairs that display
refresh and is included in the installed `005d3e5b2d` packages, pending UI retest. Earlier
Android 16 observations retain their original revisions rather than becoming
automatic retests of this candidate.

Android 16's earlier `3c35d56d7c` actual Pi session successfully discovered
Phone controls and listed apps. Published llama and Whisper runtimes were
configured through Local AI, and the CPU model check passed and unloaded.
On the matched `75b5054c31` installation, the same live Pi session observed no
discoverable app commands after Apps was switched Off, and actual attempted
`phoneuse apps list` calls were denied. Master revocation, notification replies,
telephony and speech remain unaccepted.
`1286217ca6` corrects discovery wording to show the actual spaced CLI commands.

The earlier Xorg `0cf34b8857` candidate separately opens General and Providers,
keeps the settings view free of the composer/footer, and remains usable during
fresh container preparation. A General setting persisted through Done/reopen and
was restored after the check. The fresh `Xorg0cf3` machine completes creation in
5m26s, opens its software-rendered native Display and passes launcher/search,
noninteractive sudo, interactive Terminal input and redirected-I/O checks.
Closing the browser window during preparation leaves materialization running;
tray activation restores the same browser and the guest reaches running.
Ctrl-Z during `sudo -n cat` displays `^Z` without returning an ordinary shell
prompt. The source repair keeps the broker and foreground child in one PTY
session; installed `fg` and signal handling remain unaccepted. Both the fresh and
retained older guest then failed normal restart because their stopped browser's
socket remained. The source repair verifies ownership, stopped container identity
and socket liveness before retiring that stale socket. Neither rootfs was replaced
and no manual socket deletion was used to claim a pass. Thunar installation also
exposed missing APT lists, missing descriptor access for direct AppImages and
unwritable implicit profile parents; those repairs await a new installed guest.

Further actual Xorg `0cf34b8857` checks verified custom Autostart arguments,
directory and environment; disabling automatic start kept the current process,
and Remove stopped it. Window Close preserved the browser and work, while explicit
tray Quit stopped current owned services. Killing only the main browser during
guest startup and during active Pi inference stopped the observed workers,
inference, guest/auth/display processes and current owners. The separate legacy
Podman namespace helper still exists and is not covered by that cleanup claim.
The sidebar remained responsive at narrow width during inference. Width/height
and height-only Display resizing kept the terminal above the bottom panel.
Raw preview Download exposed a Blob CSP failure; `e455149bae` is the source fix,
with actual download rechecking still required.

Earlier Xorg `780540ddf7` checks include close-to-tray/reopen, custom-command
startup/removal, renderer-child crash/reopen, browser force-quit with Local On
and Off, and Unicode/image clipboard transfer through the native controls.
Observed application workloads stopped on browser death, but a legacy shared
Podman namespace helper survived. The private namespace/lifetime and bundled
catatonit repairs are now compiled and packaged in `0cf34b8857`; their complete
installed Quit/crash/unrelated-Podman matrix remains open. Persistent guest
LocalAI startup, Thunar installation actions and panel workarea after resize
have source/component fixes in this package; their corresponding installed
retests remain separate gates. The old interactive-sudo corruption is superseded
by the fresh-machine input result above; the separate job-control failure remains
open.
The retained older guest previously passed launcher search/scroll/pin/unpin,
Manage window size Off/On, preserved Two app mode choice and scaling changes;
those remain evidence for that recorded package only.

The previous `3c35d56d7c` desktop package was installed on the Wayland host and
real Xorg VM, with matching APK and Termux packages on Android 16/17.
Normal Termux installation now succeeds and its postinst sets the X11 loader to
`0400`, without a manual permission repair. The rebuilt APK excludes Adjust and
its signer library and includes the complete JNA notices; desktop packaging
includes the refreshed full Plotters grants. The source-only checksum repair
`cde3fb7177` also passed the full corresponding-source collector with nine
archives. These package/source results do not establish complete traffic,
architecture or installed-feature acceptance.

Actual Xorg `3c35d56d7c` fresh-container preparation now reaches a running XFCE
desktop in the native Display tab. Pointer input opens Applications, keyboard
search launches Terminal, and ordinary typed commands execute. The guest display
resizes from 1270×618 to 728×618; closing and reopening the viewport retains that
same Terminal. Broader OS, lifecycle, acceleration and Wayland-container checks
remain open. Android 17's Display opens with ordinary browser navigation; its
tab switcher and tab close return to Agent. The newer paired `75b5054c31`
Android 17 installation now renders the XFCE desktop in the viewport, without
the redundant Display header. Its ordinary tab tray, accessible Tor icon and tab
close return to Agent. A first taskbar tap did not visibly respond;
pointer/keyboard, resize and broader Display acceptance remain open rather than
being inferred from the first rendered frame.

The host's first `3c35d56d7c` restart omitted the acceptance data-directory
setting and selected an older default backend. The retained browser correctly
reported that different identity; restoring the intended launch directory loaded
Local without replacing trust. This was a test-launch error, not upgrade-driven
certificate regeneration. Source review also found a real Local cleanup defect:
an onion-only certificate API was called on loopback. `f93ac418f6` separates that
cleanup and adds automatic recovery from an app-managed Local data reset, using
matching private controller/session identities and a fresh isolated browser
context. Source review and syntax passed; installed reset/recovery remains open.
The user's subsequent styling, sidecar corner, redundant Display-header removal
and Tor tab-icon corrections are included in `780540ddf7`/`75b5054c31` above;
the full installed presentation matrix remains open.

Earlier Android 16/17 checks used APK `0753b2edfc`; shared settings cases below also
cover Android 16 and native Linux `e375826bff` on Wayland and real Xorg.
At that checkpoint both Android backends used `a807ba48ed`, with OS source
`609e82c200`, and desktop `0753b2edfc` was installed on the Wayland host and Xorg
VM. Its corrected Configuration menus were observed on Wayland and Android 17.
Fresh Xorg guest preparation progressed past the unsupported launcher arguments
but exposed profile-validation, desktop bus environment and stale display-socket
failures; the fresh `3c35d56d7c` guest result above supersedes those blockers.
External receipts retain full commits,
checksums, distinct native producers and assembly revisions, source-equivalence
records and matching notices. These are development candidates.

The shared settings/sidebar implementation in `609e82c200` received actual
cached native builds on both targets: desktop 8m37s and Android 9m47s. Installed
checks found incorrect static-asset placement, then a module CORS failure after
`fb1111c5d5` corrected the archive placement and icon sizing. `e375826bff` uses
Gecko's existing non-linkable about-page chrome module path, retaining the
unprivileged content principal, scoped CSP and native authorization. Actual
shared Local AI settings now load on the Wayland host and Xorg VM; Android 16
also renders the Phone controls page and its optional Accessibility guidance.
This verifies those entry/rendering paths, not all controls or authorization
cases. The logo-only toolbar and Configuration gear are visible; the written
BashKitten pill is removed.

`0753b2edfc` applies the latest user correction: desktop Configuration has no
Computer use/Termux use settings; the execution-role Pi skills/tools remain.
Phone use configuration is Android-only. Display setup remains in Configuration,
separate from the existing Display action that opens the desktop. The installed
Wayland `0753b2edfc` Configuration menu shows Local AI, Notifications, Remote
Connections, Telephone, Performance, Providers and General settings, without a
Phone/Computer Use entry. Android 17's installed menu has Display setup and Phone
use. These are menu checks, not a retest of every destination. At that checkpoint,
the subsequent right-hand Display/gear/menu placement in
`c9f4572d5c` had only source evidence; later installed presentation checks are
recorded above, with the complete rotation/keyboard matrix still open.

Installed Xorg checks passed the flat hierarchy, corrected icons, wide/narrow
sidebar behavior, draft preservation and Providers/General navigation. A real
question card remained visible after the final reply and delivered one answer
to its original chat; other question cases remain pending. The installed
`e375826bff` candidate refused creation through a legacy machine daemon,
showing the session/OS-restart requirement added by `84af6f3685`. The user
rejected that requirement; `2b11aef9b3` replaces it with owned application
shutdown and the new browser-lifetime guard, without an OS/session restart.
After a normal VM reboot, actual UI Retry completed the Debian/XFCE image build,
rootfs export and materialization, then visibly failed at guest browser startup.
`c4aab21296` removes unsupported guest `--no-remote`/`--profile` arguments.
The `0753b2edfc` DEB contains the actually rebuilt `739e9944a7` guest package,
verified against its launcher source and nested package hash; this package
integrity result does not establish successful guest startup or Display.
Active-guest update/drain behavior also remains unverified.

Android 16 is a separate official API 36 KVM guest with fresh Termux and no
copied Pi profile. Normal setup now completes and the empty chat reports Model
and Reasoning **Not set**, Agents Off and Phone Off. Android 17's old controller
was diagnosed with an outbox watcher feedback loop: read scans changed directory
attributes and scheduled more scans. `a807ba48ed` removes those read-side
mutations, filters file events and coalesces scans. After installing the fix,
the actual Android 17 Local Off/On flow terminated the old controller/HTTP group
and reached ready with a new group. Installed file hashes match `a807ba48ed`.
The new controller and HTTP processes then remained sleeping near 98/97 MiB,
with five/three CPU ticks and slightly lower RSS across a 32.47-second diagnostic
window. This supports repair of the observed immediate busy loop; it is not an
endurance/no-leak proof or acceptance of phone delivery and wider lifecycle cases.

A fresh Android 17 Display attempt reached the native viewport but failed to
attach: Android rejected the packaged loader JAR as writable before its Java
entry point. The browser returned to chat normally. `da996b644e` made generation
atomic/read-only, but its read-only package payload then failed ordinary Termux
dpkg upgrade during deferred writeback. `ef6057afa0` follows the donor's correct
installation pattern: payload `0600`, changed immediately to `0400` in postinst.
Android 16 was left with a fully installed/auditable prior backend after cleanup.
The subsequent normal `3c35d56d7c`/`75b5054c31` upgrades and Android 17
rendered Display result above supersede this installation blocker. The current
`0cf34b8857` package retains that normal postinst permission handling; broader
input/resize/lifetime acceptance remains open.

Android 16's `0753b2edfc` Phone controls page exposed a 63-pixel settings touch
offset. `c9f4572d5c` moves system insets to GeckoView's parent so rendering and
input share an origin. The narrow Java compilation passed. Later normal Android
17 control taps are recorded above; the full Android 16 input/rotation matrix
remains open. With the observed offset compensated during the earlier diagnosis, Phone
master Off retained saved feature choices and disabled their controls; optional
Accessibility groups stayed unavailable without its grant. Notification permission
was requested normally, and absent Android Auto was reported honestly. This is
settings evidence, not Phone tool authorization, call or message delivery acceptance.

`2b11aef9b3` binds Local, independent containers and helper cleanup to the actual
desktop browser identity, including Local Off. Normal window Close keeps work
in the tray or minimized window; explicit Quit and browser death stop owned
workloads. Independent source review covered pending-launch cancellation,
legacy cleanup deadlines and pipe shutdown. The old idle host service was
stopped directly without a desktop restart. None of these observations replaces
the required installed Quit/force-kill/crash matrix for the new implementation.

`87c53d93da` removes the unused Adjust reporting dependency and retains complete
JNA 5.18.1 sources and full native/libffi notices; retained archive/license hashes
pass. Those fixes are now present in the `0cf34b8857` artifacts: Adjust and its
signer library are absent, JNA has complete offline grants/source, and refreshed
search artifacts carry all three full Plotters grants. Complete network-traffic
and all-architecture release acceptance remain open.

`fb867067e4` adds the unified Autostart page and individual startup hooks,
config-based custom commands under the existing owner, and selected-container
LocalAI/settings/provider login through the private Unix controller. Container
provider callbacks remain bound to their live Pi attempt and enrolled browser tab,
including Firefox browsing-context replacement. Container publishing still uses
its separate Tor/Chisel/Caddy/Authelia identity and route. Remote file-manager
protection includes startup and machine configuration/storage. Display setup can
manage a background desktop while Local is Off; its viewport retains ordinary
browser tab navigation. Shared/native JavaScript and embedded script syntax,
75-source Android Java compilation, Kotlin checks and source review passed.
Those source/compiler checks preceded the installed candidates above. Specific
startup/Display observations are recorded at their actual revisions; the full
startup, provider callback and selected-container matrix remains open. The frozen
plan's scope is unchanged.

Actual installed observations:

- Fresh Android setup now reaches the chat UI with an owned empty Pi profile;
  model and reasoning correctly show **Not set**. A too-long Phone Unix socket
  path blocked Termux startup and was repaired in `a9dc65607a`.
- Enabling Messages requested notification permission without enabling Calls or
  requesting call/microphone permissions. Message delivery and call flows remain
  unverified.
- The real Debian 13 Xorg VM runs the Linux candidate with X11 and software
  WebRender/llvmpipe. Local chat and offline Podman notices work. Actual project
  creation, renaming, moving chats between projects and back to standalone, and
  cancellation passed. Successful Pi turns verify that new project chats inherit
  their directory and moving an existing chat preserves its original directory.
- The Xorg candidate downloaded the managed llama v0.6.0-r1 Vulkan runtime and
  Qwen3.5-2B Q4_0 through LocalAI, configured CPU router execution, passed the
  optional load check with confirmed unload, and imported the model into owned
  Pi. The first send without credentials retained its draft; that work completed
  after configuring the local model. With the shared Gecko replacement at
  `e375826bff`, actual Xorg UI then downloaded Qwen3.5-4B Q4_K_M, added/edited its
  router entry with CPU execution and context 16384, passed Check model load,
  confirmed unload, and exposed the imported model in Pi's picker. This covers
  that CPU flow, not the complete GPU/runtime/model matrix.
- Deferred chat discovery/list/read returned the correct project, renamed chat,
  original directory and native entry references without modifying its history.
  Unnecessary system bootstrap text was exposed by read; `8bfc038b2c` removes it
  from lookup results and awaits installed retest. On `e375826bff`, a real 4B
  model turn with Agents On spawned Directory check under ProjectTwo. The child
  ran `pwd` in the inherited project directory, and exactly one attributed
  completion reached the original parent through the normal queue. The child
  source link returned to that parent. Peer messages, follow-ups, Stop, crash,
  fork and race cases remain separate unverified gates.
- A real optional question returned pending in 11 ms while Pi continued, survived
  chat switching and delivered one attributed answer to its original session.
  The next question produced exactly one expiry notice, but its visible card was
  not verified at the absolute chat bottom. `d928978af1` repairs source-level
  bottom-follow, idle state refresh and pending-question event lifetime; installed
  expiry/card, Stop and race coverage remains pending.
- Container creation displays real preparation output while other UI remains
  usable. The explicit stock-panel conflict and missing schema compiler are fixed
  by `c64c0ccff0`; `bed281f5a5` repairs materialization from a stopped container
  export. The later fresh `0cf34b8857` machine completes preparation and opens
  Display as recorded above. Retained-guest startup and the full Display/OS
  matrix remain open; the earlier materialization-only result is historical.
- The Android sidebar's floating popup, pink buttons and ambiguous icons failed
  the user's design review. `acfa9df6ba` restores the flat sidebar and embeds it
  below the toolbar. The user's final direction is a BashKitten logo/sidebar,
  separate settings gear, unchanged Firefox menu and repeated flat Local,
  Containers and Remotes sections. Shared protected Gecko settings and native
  adapters are integrated, including removal of the superseded forms. The
  installed `e375826bff` toolbar/shared settings now render; `0753b2edfc` carries
  the later Android-only Phone use correction. Notification preferences retain
  their existing private controller and serialized settings-file updates.
  Complete visual/rotation/keyboard checks remain required. The cached
  intermediate `d3919f88c9` build was not installed because it predates the final
  placement decision.
- Desktop startup/resource failures were repaired in `ba248b7d1b` and
  `7ecea9955c`. Local asset-only repackaging with a reused development profile
  requires clearing Gecko's startup cache. Wayland shared-settings entry/rendering
  is now observed, but its full Display/lifecycle acceptance remains pending,
  separately from the real Xorg results.
- Actual Xorg Files > View on `e375826bff` opens Markdown in an ordinary preview
  tab with rendered heading/table and a working Raw toggle. DOCX converts on the
  backend and opens in Gecko's native PDF viewer while Agent activity/navigation
  continues. CSV renders a scrolling grid and Download saves the expected file
  through the native dialog. These are specific document flows; large-file,
  cancellation, remote authorization and the complete supported-format matrix
  remain unverified.

The full plan's feature, failure, lifecycle and platform matrix remains required.
Android 16's remaining feature flows, physical-device/OEM/Android Auto coverage
and the complete artifact/traffic audit are not established by the checks above.

Checkpoint receipts are under `/run/media/user/Data/BashkittenBuild/`:

| Record | Confirmed scope |
| --- | --- |
| `acceptance/combined-0cf3/host-install.json`, `settings-presentation.json` and screenshots | Exact current Wayland install; separate General/Providers, no legacy footer, rounded light/dark presentation and original appearance restored. |
| `verification/android17-0cf3/installation.json` and General/Providers/Phone screenshots | Exact matched Android 17 APK/backend plus OS `6a8fe303ce`; current presentation and Phone use dark-theme/settings observations above. |
| `verification/android16-0cf3/installation.json` and `input-integrity.json` | Matched Android 16 update verified; app stopped for its acceptance owner, not a complete feature retest. |
| `acceptance/xorg-vm-control/candidate-0cf3-ui.json` and `0cf3-*` screenshots | Current Xorg settings, fresh-machine Display/input, close-to-tray during preparation and partial sudo evidence; retained-guest startup and Ctrl-Z job-control failures kept separate. |
| `verification/combined-desktop-0cf3.json`, `android-termux-handoff-0cf3.json` and `source-release-0cf3.json` | Exact package checksums, source/static-asset/native component reconciliation and complete matching source collection; not whole installed or traffic acceptance. |
| `acceptance/xorg-vm-control/candidate-e375-ui.json` | Actual settings, safe legacy-update refusal/reboot retry, CPU LocalAI load/unload, subagent parent/child/cwd delivery, Markdown/Raw, DOCX/PDF and CSV preview/download cases; explicit partial/pending limits. |
| `acceptance/shared-settings-e375/host-localai.png` | Actual Wayland shared Local AI page rendering. |
| `acceptance/shared-settings-0753/host-install.json` and `host-configuration-menu.json` | Exact Wayland installed package and corrected native Configuration menu; underlying chat selector options in the raw accessibility array are not menu entries. |
| `verification/android16-e375/installation.json` | Matched APK/backend installation, normal setup and actual empty-chat/Phone controls rendering; remaining cases listed. |
| `verification/phone-watch-feedback/diagnosis.json` and `verification/termux-package-a807.json` | Watcher cause, focused source repair and exact installed-package input hashes; not phone functionality acceptance. |
| `verification/phone-watch-feedback/android17-a807/summary.json` and `idle-samples.json`, plus `acceptance/shared-settings-e375/android17-restart.png` | Actual Android 17 Local Off/On, old-group exit/new ready state, matched installed watcher source and short idle diagnostic; no endurance or Phone-flow acceptance. Earlier install/idle records alone were passive diagnostics. |
| `verification/guest-launch-component-739e.json` and `verification/guest-desktop-package-0753.json` | Historical rebuilt guest launcher/source equality and actual nested guest in the `0753b2edfc` DEB; later fresh-machine observations are recorded above. |
| `verification/shared-settings-desktop-package-0753.json` and `verification/settings-phone-use-only-20261011/source-check.json` | Actual packaged settings source and focused Android-only Phone use removal review; not installed acceptance. |

| Area | Source integration | Installed acceptance |
| --- | --- | --- |
| Android Display / paired Termux loader | Separate renderer and approved UID/FD bridge committed; matched current APK/backend/OS installed | Partial Android 17 rendered viewport/navigation; input/resize/lifetime matrix pending |
| Linux Display / persistent gateway | Native module committed; current native helper/package source checks pass | Partial actual Xorg fresh-machine Display/input; complete Wayland/Xorg matrix pending |
| Container lifecycle / private Podman | Persistent owner, private engine/namespace lifetime, guest lifecycle/sudo and desktop context packaged in `0cf34b8857` | Fresh Xorg creation/Display/interactive input pass; retained-guest startup and Ctrl-Z failures open; full lifecycle pending |
| Native sidecar / projects / chats | Android hierarchy committed; desktop hierarchy, project folder ownership and private container connection integrated | Partial Xorg project/cwd/move/draft and one subagent completion path; Android/full matrix pending |
| BashKitten OS / XFCE | Shared launcher/settings, layout, tray, scaling, application actions and role-specific CUA skills committed; Linux/native Termux packages built; fresh Termux initialization passes | Partial Xorg launcher/settings/input observations; remaining Termux/Linux desktop matrix open |
| Phone controls / phoneuse | Main-APK module, live worker grants, revocation and CLI committed; Android-only configuration | Android 16 earlier Apps discovery/list and feature-Off denial; current Android 17 themes/master-choice retention observed; complete authorization/revocation matrix pending |
| Telephony / contacts / messages / voicemail | Native library, private gateway, confirmed call speech, encrypted remote hooks and shared question delivery committed; integrated Java compilation passes | Pending |
| Pi release / usage / ask_user | Pi 1.1.0, selected-account usage and deferred questions integrated using stock APIs | Pending |
| Sources / licensing / telemetry / packages | `0cf34b8857` package/source checks and expanded offline notice collection pass with distinct native producers retained | Full architecture, traffic and installed release acceptance pending |

Cuttlefish remains on stock Android 17 build 16373615 with native KVM, 16 GiB RAM
and 128 GiB SSD userdata. The separate libvirt test VM
`bashkitten-test-debian13-xorg` now runs a real Debian 13 LightDM/Xorg login session.
Neither environment has accepted the new whole-plan candidate yet.

The earlier Android composer `[BLANK_AUDIO]` failure was traced to Cuttlefish's
native tinyalsa buffer returning ALSA EIO after several seconds. The supported
AOSP period multiplier setting repaired capture: a 40-second native capture and
the installed old APK's real composer permission/record/stop/transcription flow
passed. The public speech sample produced the expected unsent draft, which was
cleared. Evidence is outside the product tree in the build workspace's
`config/cuttlefish-audio-capture.json`; the fresh candidate must repeat the flow.
This emulator configuration is not a shipped app requirement or physical-device
microphone acceptance.

Daughter Actions run 38148970357 published Whisper r2 for the required target
matrix, including the pinned Silero VAD helper/model. The downloaded Android
x86_64 helper passed framing, speech/silence probability and clean shutdown
checks under the actual Termux UID. At that earlier checkpoint, the fresh
acceptance profile had no selected runtime. Later Android 16 LocalAI setup is
recorded above; integrated phone STT/TTS and the full runtime/model matrix remain
mandatory. No AI engine was built on this workstation.

Detailed component records are retained outside the repository under
`/run/media/user/Data/BashkittenBuild/verification/` and `native-environments/`.
Source/license collection and limited offline Pi process traces are not a
whole-product telemetry audit. Actual candidate artifact reconciliation and
external traffic checks remain release gates, along with the required UI flows.
Prior remote/file-viewer results must also be reconciled with the new candidate.

The final authored JavaScript pass at `6efcc833e2` checked 51 modules, the embedded
chat script, 585 local named imports and 28 Pi API declarations. Main Android
Java and the four changed Fenix Kotlin files compiled with their real dependencies.
The retained-source check independently verified 2,558 file digests across five
auth/search manifests. These source checks do not execute or accept product flows.

## Complete feature and acceptance register

Every row below still has incomplete integrated installed verification; partial
passes in the checkpoint do not close an entire row. Keep the exact candidate
revisions, platforms, observations and blockers with each case.
The first table covers feature integration; the second records the expanded
acceptance matrix. Physical GPU/OEM/Android Auto coverage cannot be inferred
from Cuttlefish. Additional detailed cases remain mandatory in the frozen plan.

| Required workstream | Work | Acceptance evidence | State |
| --- | --- | --- | --- |
| 1. Sources and runtime contracts | Track all built/bundled component source, official release commits, donor subsets, licenses and private Podman/helper matrix; update Pi through supported APIs. | Clean-checkout builds consume tracked source/locks; no floating refs, missing source/notices or unexpected system runtime selection; Pi API/packaging checks. | Pending |
| 2. Native Display feasibility | Reusable module and own renderer child; Android adapted `lorie` + paired loader; Linux rootful Xwayland/XFCE + private gateway + native Firefox receiver. | Real cross-process viewport attachment/input/resize and child-failure containment. Linux GPU **and** software frames on X11/Wayland; Android UID/FD boundary and no separate X11 APK; small documented Firefox integration patch set. | Pending |
| 3. Persistent environments | User-data machine storage/name mapping, Containerfile, live preparation, saved Podman config, lifecycle/deletion/startup, guest BashKitten and interactive passwordless sudo. | Install/create/rename/start/stop/reopen/delete with correct data ownership, safe PTY/redirection/signal behavior and actual backend readiness. | Pending |
| 4. BashKitten OS package | Shared `.deb`/native Termux packaging and initially pinned settings app, single-workplace default, Manage window size, bottom taskbar/right application tray, maximized search/pins/app-grid Start, no dock/default shortcuts, main-window maximize/two-app behavior, scaling and Gnozzard styling; Linux Thunar actions. | Matching responsive Linux/Termux layouts, On/Off behavior and parent-dialog exclusions, both tray protocols and guest BashKitten icon/activation, preserved user choices, real apps/input/scaling; donor launch rules, passwordless APT, menu/shortcut management and wallpaper. | Pending |
| 5. Native hierarchy | Listed backends, one + entry, per-backend toggles and container Settings/Display, optional projects with folder-picker creation and new-chat cwd inheritance, standalone chats, rename/move, selected-chat web view. | New project chats use their project's directory; standalone behavior and existing histories/cwd remain unchanged; independent controls, no remote Display/settings, no large backend dropdown, no container-count cap or duplicate sidebar; subagent/draft/session ownership retained. | Pending |
| 6. Integration boundaries | Guest local socket, existing media/ports/settings, unchanged remote publishing and CUA scope. | Local/remote credentials remain separated; allowed remote flow and denied management paths; Agent excluded from desktop automation. | Pending |
| 7. Phone module and CLI | Main-APK MCP port, native master/feature policy, optional Accessibility, owned-Pi worker grants, Termux CLI and `phoneuse` skill. | Complete section 12's user-flow and denial checks; no camera/microphone commands, companion APK, exposed MCP catalog or reusable general-shell token. | Pending |
| 8. Calls, messages and contacts | Pinned Phony native module, independent Telephony/message setup, per-backend contacts/mailbox, recent-chat/keypad menus, Termux gateway and LocalAI VAD/capture/review/live speech, remote registration and per-chat routing. | Section 13's Android 16/17 flows and complete acceptance table: native notification/Auto reply, mandatory call review, voicemail, cold-bind Off, foreground/audio/lifetime/auth/expiry checks, intended remote route and no duplicate delivery; record OEM/Auto gaps. | Pending |
| 9. Usage and questions | Narrow Pi subscription usage/status adapter and deferred nonblocking questions with one web/call/notification/mailbox resolution owner. | Sections 14–15's selected-account/window checks, immediate tool return, idle/busy/deadline-during-review/late-reply/race/Stop/reconnect cases; no Pi patches or duplicate delivery. | Pending |
| 10. Package/release readiness | All actual architecture artifacts, matching APK/loader, caches, complete offline source/notices, upgrade handling and every bundled component's network/logging audit. | Installed native user flows plus recorded missing hardware coverage; no unexplained telemetry/developer callbacks or release claim based on a dispatched build. | Pending |

| Manual case | Expected result | State |
| --- | --- | --- |
| Android fresh install | Termux setup installs native dependencies/paired loader; Display opens inside BashKitten with no X11 companion APK and no shipped root/ADB requirement. | Pending |
| Android input/viewport | Real GUI app accepts hardware modifiers, Unicode/composing IME, touch/mouse/scroll; keyboard shrink/restore and portrait/landscape maintain correct pointer coordinates. | Pending |
| Android lifetime | Tab close/reopen, browser background/recreation and rotation preserve the desktop; Stop/Local heading Off stop only their owned processes; display crash leaves chats usable and independent remotes stay connected. | Pending |
| Linux preparation/config | Visible real package output while the browser stays usable; edited launch flags take effect; invalid config shows the real error without another runtime. | Pending |
| Linux persistence/startup | Guest-installed packages, files and Pi work survive viewer/browser-window close and later attachment; per-container startup on/off behaves independently. | Pending |
| Machine storage/name/delete | Default and configured BashKitten data roots contain the rootfs/configuration/state; chosen names resolve to the correct stable directory; rename preserves work; deletion removes only the selected machine and its owned data, preserving other machines/shared caches/host-mounted folders. | Pending |
| Host rendering | Same guest works in X11-host and Wayland-host sessions; deliberately unavailable acceleration selects the actual software path without modifying saved GPU choice. | Pending |
| Native X11 host VM | Installed candidate runs its local container Display inside a virt-manager-managed Debian/Ubuntu VM logged into real Xorg; session/backend/renderer and the native product flows above are recorded. Xwayland-on-Wayland alone is insufficient. | Pending |
| UI responsiveness, including Display | During provisioning/deletion, expensive GPU/software frames, resize/rotation and stalled display/backend I/O, chat/sidebar/navigation/tab close remain usable; no synchronous frame/fence/process wait blocks the UI. Detached views release work asynchronously without stopping their guest. | Pending |
| Automatic resolution | Resize the Linux host window and Firefox tab via sidebar/chrome changes on X11 and Wayland; on Android rotate and show/hide the keyboard. Verify guest X screen dimensions change to match the actual tab drawable area, with correct pointer coordinates, panel/workarea, launcher and app geometry. Switch away/reopen without a zero-size resize or desktop restart; preserve the selected UI scale and avoid merely stretching a fixed framebuffer. | Pending |
| Display module/process boundary | Verify a separate renderer PID for the native viewport; interrupt/terminate that child and confirm other tabs/chat remain usable and guest work survives. Reattach a fresh renderer. Audit that Firefox changes remain confined to the documented module integration hooks. | Pending |
| GPU limits | Actual supported devices and optional NVIDIA path verified; no physical-GPU claim from Cuttlefish, no guaranteed CUDA/game support from software rendering. | Pending |
| Sudo | Noninteractive `sudo -n` package work, interactive PTY programs and `sudoedit` work; redirected input/output, interrupt, Ctrl-Z/`fg`, terminal resize and terminal restoration remain correct; no host privilege gained. | Pending |
| XFCE layout | Fresh Termux and Linux desktops have one workplace and one bottom taskbar with Applications/kitten icon, normal running-window buttons and right-aligned application tray. No XFCE menu icon, clock/date, preseeded network/audio/power widgets, workspace switcher, Show Desktop, dock, pinned taskbar launcher or default desktop shortcut. Switching, resize, keyboard, rotation and scaling preserve the bottom workarea. Relaunch does not reset user edits. | Pending |
| Application tray | Real StatusNotifier/AppIndicator and legacy XEmbed applications appear with working activation/menus; newly installed apps require no allowlist. Automatic guest BashKitten startup supplies exactly one real guest indicator, accurate status and the existing protected host activation path. Panel restart, browser closure, explicit Quit, icon hide/reorder and resizing behave correctly; no shared host bus, duplicate runtime, second protected Agent in the guest, injected system applets or UI stalls. | Pending |
| BashKitten OS settings | Correct native package installs the application/icon and seeds its Start pin once. Manage window size defaults On; Off relinquishes layout and disables Two app mode while retaining its saved preference. Scaling/appearance/tray remain independent. Changes are responsive and persist across restart/upgrade; pin/unpin choices survive. Host/container-sharing controls are not duplicated here. | Pending |
| Application Dark/Light preference | Change Dark/Light on Linux and Termux; the owning session's portal reads 1/2 and emits the change, and representative apps that follow system appearance observe it. Save/restart/upgrade retains the choice. BashKitten's dark/orange surfaces, Thunar customization and user wallpaper stay unchanged, as do other environments and host settings. No UI stalls, forced app restart or hidden polling. | Pending |
| Maximized launcher | Start opens search at top, ordered pins, one divider and an alphabetical left-to-right wrapping icon/title grid of remaining apps. Phone/tablet/desktop widths and keyboard/rotation reflow without overflow; large app/pin sets scroll. Launch/search/pin/unpin/context actions/close stay responsive; pins survive rename/reopen/restart/update, appear once and disappear on explicit managed-entry deletion. No hidden grid polling, second Start menu, Garcon fork or split-layout disruption. | Pending |
| XFCE behavior | Normal main windows maximize within the workarea; in-app modals, separate/late parent dialogs, file pickers, utilities, menus and fullscreen keep native behavior and do not dissolve a pair. Independent same-app windows remain main windows. Check pairing/drag, third main-window activation, member close, minimum sizes and viewport changes. Toggle management Off during queued resize/drag: divider disappears, pending enforcement stops, user moves/resizes normally, and no stale callback reapplies layout. On resumes without restarting apps or resurrecting a stale pair; no automatic extra workplace allocation. | Pending |
| Linux application actions | Use real Thunar secondary-click actions on matching-architecture AppImages, `.desktop` launchers and `.deb` packages. Verify direct FUSE launch, explicit persistent extraction/reuse, explicit no-sandbox marker, icon/menu registration and rename/removal, requested desktop shortcuts and package dependencies through passwordless guest sudo. Menu/file names with spaces and percent signs work; source apps survive registration deletion. Check actual failure/cancel reporting, UI responsiveness, preservation of unrelated Thunar actions and no host/Termux installation. Record amd64/arm64 coverage separately. | Pending |
| Scaling | Saved profiles update owned XFCE settings and new app launches; launcher reflows and the exact Gnozzard palette remains consistent; restart-needed apps are reported truthfully; no startup script resets user edits. | Pending |
| Appearance/wallpaper persistence | Panel/menu/Thunar/default background use the recorded Gnozzard dark/orange colors on both platforms. The default wallpaper centers the existing BashKitten logo proportionally over #202225, shrinking when needed and never exceeding its 1254 × 1254 native pixels, including on high-DPI/large screens. Set a user wallpaper and placement through XFCE, then reopen Start/Display, rotate/resize, change scale, restart the desktop and upgrade the package; the saved image/placement and user appearance changes remain. No copied lock-screen override. | Pending |
| Sidecar/backend controls | One + routes to remote setup or Linux container creation; every container heading opens its own full Display tab and Settings; individual toggles affect only their backend; remotes have no Display/settings; no large selector or artificial machine-count cap. | Pending |
| Projects/sessions | Create chats with no project on every backend; create/rename projects, rename chats, move chats into/between/out of projects, retain subagents and reconnect; same native Pi history/cwd and correct effective model/reasoning/draft/queue ownership. | Pending |
| Project working directory | Create a project through the modal on each backend, then create multiple chats beneath it without another folder prompt and verify their actual Pi cwd. Cancel leaves no project; missing/inaccessible directories report an error. Standalone new chats retain current behavior; reopening or regrouping existing chats preserves their recorded cwd. | Pending |
| Chat lookup skill | Ask Pi about another standalone/project chat; it discovers the guide/tool, resolves title/topic to the correct backend/project/session, reads relevant history and identifies its source. Cover duplicate/renamed titles, regrouped chats, hidden sessions and unavailable remotes; no eager history dump, new worker, message, metadata/JSONL mutation or UI stall. | Pending |
| Local vs remote | Container socket works without Tor; publishing and a real saved-remote client still use existing encrypted/authenticated route; remote has no Display streaming option. | Pending |
| CUA scope | Screenshot/input/accessibility target the guest/Termux desktop and actual apps; host native Agent/auth UI and unrelated host desktop are not exposed by the new display connection. | Pending |
| Upgrade/package | Both ABIs use matching loader/APK/native libraries; existing custom commands/settings preserved; standalone Termux:X11 untouched; full licenses/source accessible offline. | Pending |
| Source/license completeness | Reconcile each actual artifact's direct/transitive components with tracked source, exact release commits, locks, patches and full notices. Include Podman/crun/helpers, SheetJS/other JS, X11/XFCE/launcher and Gnozzard code/CSS/folder artwork. A missing source/license or mismatched cache blocks release; offline About/package notices and matching published source archives work on every target. | Pending |

## Native-sidecar cross-feature source review — 11 October 2026

Scope: the native-sidecar workstream compared the frozen plan's section 17 at
`f71686dcb76402ec43bac3e6a7db8979ef0fb119` and the current plan against the shared
source checkout at `dbcc7b2352e34132b1047999260c2fbc448ce181` plus ongoing integrated
changes. This is a source-wiring review, not a candidate revision, exhaustive
security audit, build pass or installed acceptance. It does not change the
coordinator's matrices above.

| Plan workstream | Source connections inspected |
| --- | --- |
| Sources/runtime contracts | Pi 1.1.0 release metadata and stock SDK adapter; tracked OS/private runtime source inventories; private bundled Node wrappers and role-specific package registration. No alternate system-Pi runtime path was added. |
| Native Display | Main-APK `:display` renderer service and paired loader, native Display entry point and Fenix hooks; Linux module spawning the packaged renderer child, persistent gateway, native frame receiver and explicit GPU/software startup. The Termux launcher now uses `bashkitten-x11`; the remaining old launcher reference is exact-default migration and a preserved-custom-command advisory, not an external-APK launch route. |
| Persistent environments | Machine controller dispatch, user-data rootfs/config/image storage, editable Containerfile/launch arguments, operation output and retry, stable named deletion, startup, guest service and sudo helper packaging. |
| BashKitten OS | Shared package/defaults, launcher/pins, layout settings, appearance/scaling, guest tray activation and Thunar helper integration. Linux provisioning invokes first-use initialization. The missing Termux initialization connection is recorded below. |
| Native hierarchy | Desktop/Android native sidecars, protected navigation adapters, per-backend controls, container-only Display/settings, projects and owning-backend folder picker, cwd inheritance, rename/move, native session parser, per-chat drafts and queue-edit identity. |
| Integration boundaries | Native container TLS byte relay over its allocated socket, separate saved-remote route, guest browser relay and host-filesystem guards; media/port configuration and actual declared helper dependencies. `xclip`, X11 inspection/input tools and accessibility helper are present in the guest recipe/package paths. |
| Phone controls | Main-APK panel, independent policy/Accessibility choices, lazy command registry, live worker grant/CLI path and package launcher; `phoneuse` is omitted from desktop discovery. Shared desktop guides are selected by execution role, not the attached browser platform. |
| Calls/messages/contacts | Phone panel, registration/status, per-chat selector, project/title mapping, backend aliases, notification/question outbox, direct Termux gateway and local speech adapter. Published Whisper r2 supplies the required VAD helper/model; this publication is component evidence only. |
| Usage/questions | Deferred extensions are registered in the Pi package; selected-account usage reaches extension status, and questions reach web cards plus the same phone outbox/resolution owner. Deadline, held delivery and Stop-generation paths are present. |
| Package/release readiness | Android module dependencies, Linux module registration, matching guest packages, Termux loader/OS inputs, architecture release recipes and expanded offline notice/source collectors. Actual packaged inventory and traffic verification remain required. |

Concrete review findings and follow-up:

- Fixed backend retry when desktop selection has no browser, and Android Local
  heading/chat selection when the selected Local backend is Off. Readiness waits
  issue read-only snapshots; they never replay a navigation mutation.
- Fixed folder-picker reads and creation to check the original backend and
  browser/document (Android GeckoSession) before dispatch, including a backend
  change while an earlier dialog remains open.
- The OS owner removed the unresolved `BACKEND_SETUP` skill placeholder. The
  Phone owner reconciled panel controls with authoritative settings and made
  Local Connect to phone wait for gateway readiness.
- Phone finals no longer disappear from the backend outbox merely because five
  minutes elapsed. Messages remain deliverable; expired call invitations route
  to voicemail. Questions retain their independent authoritative deadline.
- Fresh Termux setup did not invoke `bashkitten-os initialize`, so the shared
  defaults would not be seeded. The package owner added that invocation to
  `agent/packaging/termux/install.sh` after package installation and before the
  native setup-complete return. It is explicit setup provisioning, preserves
  existing files and does not add a reset script on every desktop start.
- The container owner added the guest context owner's process start tick,
  matching Termux's stale-process check so a recycled PID after an unclean
  shutdown is not accepted as the original desktop owner.

Owned JavaScript syntax and Java parsing passed after the navigation changes;
the separate combined Android compiler check remains with its owner. No full app
build was launched by this review. Fresh-profile Cuttlefish/Wayland/Xorg flows,
previous composer dictation failure, physical GPU/OEM/Android Auto coverage and
whole-artifact telemetry/source/license reconciliation are still separate
acceptance obligations, not inferred passes from the connections listed here.
