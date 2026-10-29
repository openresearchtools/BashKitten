# Native environments implementation and acceptance

Requirements baseline: `f71686dcb76402ec43bac3e6a7db8979ef0fb119`, protected tag
`bashkitten/plan/native-environments-2026-10-11`. The original remains unchanged;
the current plan also records the user's subsequent presentation, lifecycle and
14 October amendments. This record tracks evidence and does not reduce that combined scope.

## Current build and lifecycle checkpoint — 29 October 2026

The 153.5.4 binary batch at `cf62bf9be5cd068921f5941916099531cd3ce1a7`, parent
[40823770402](https://github.com/openresearchtools/BashKitten/actions/runs/40823770402),
passed all eight native Office/Files jobs, both Linux packages, both Termux
packages and both Android APKs. The staged x86_64 APK's production certificate
and exact-source backend/OS pairing passed normal verification. Actual cf62
amd64 DEB and x86_64 APK legal/About checks also passed, with 3,056 and 2,918
complete records respectively; the APK preserves all 2,427 matching companion
records. Receipts are under `Bashkitten-Acceptance/final-packages-legal-cf62-20261029/`.
The parent source job was cancelled after its collection step ran for 1h 23m 44s;
binary artifacts remain retained, but no corresponding-source or complete-candidate artifact/pass
was produced. Binary success is not complete source publication or installed
acceptance. Its receipt is
`verification/ci-monitor-cf62bf9be5cd-20261029.json`. The earlier 16f0 APK/source
failures and later corrections retain their original identities in
[the Office status record](office-integration-status.md).

Later workflow correction `1eab4ec1df` bulk-fetches missing pinned Git blobs
through native Git before the existing source collector. The exact workflow
step and exporter fixtures passed with identical archive bytes, reducing 40
fetch processes to one. This changes preparation only, not source serialization
or content; complete normal source publication is still unverified. Receipts are
in `Bashkitten-Acceptance/source-archive-backfill-20261029/`.
`9e64389692` adds disk/object-usage observability around that native backfill,
without changing source content or claiming successful publication.

Native Office command checks now include the desktop collapsed Citations menu,
phone Writer history/conversion/removal/PDF and saves in all three editors, with
explicit older-browser/module overlay identities. Actual bundled Pi also
completed nine Calc/Impress native calls and both saves; normal Stop ended the
bounded test after the acknowledgements, without a completed final model reply.
Landscape chooser Confirm and the initial unreproduced Impress repaint
observation remain open. Detailed receipts and limits are in the Office record;
these checks do not establish fresh-candidate Office acceptance.

The unmodified cf62 real-Xorg Files checkpoint passed bounded CRUD, native
TXT/PDF upload/previews, byte-exact TXT/ZIP downloads, the project picker and
actual Changes view. Two project tabs shared one Quantum owner, and closing one
left the remaining Files view healthy. Normal Local Off/Quit preserved the
custom main INI; attachment upload/capture and Save-As naming remain unproven.
Its receipt is
`Bashkitten-Acceptance/files-xorg-153.5.4-cf62-20261029/installed-acceptance-summary.json`.

`c348ac5092` updates the existing shutdown owners to drain native Office saves
before callback services stop. Source fixtures passed signal/exit ordering,
callback drain and reload-failure cleanup in
`verification/office-shutdown-20261029/{signal-result,caddy-result}.json`.
The first installed saved-DOCX Office-only restart passed on the isolated older
browser with the reviewed controller overlay: immediate editable reopen, the
same add-on process, native write/Save/inspect 200 and both disk markers retained,
without forced termination or unlock failure. Its receipt is
`verification/office-shutdown-20261029/saved-office-only-result.json`.
The later c348-only dirty Local Off replay **failed**: native content was modified before
Off, yet the new marker remained absent on disk after native exit, with the same
file hash/size. No forced termination or unlock failure was observed. The exact
receipts are `dirty-before-local-off-disk.json`, `after-local-off-disk.json` and
`dirty-local-off-existing-evidence.json` in the shutdown directory. Native
That earlier failed DOCX is retained unchanged; c348 alone was insufficient.

Native patch `0026` (`fe4951b1d7`) corrects missing modifying-activity tracking
for `executescript`. A recorded diagnostic native build from `305911e75a` plus
those patch inputs, server hash prefix `9df5fb0a`, passed dirty Local Off for
DOCX, XLSX and PPTX: modified flags were true and new markers absent immediately
before Off; 2.716s later the native exit left the text, cells/SUM and shape saved.
Read-only stop preserved file metadata, snapshots and manifests exactly; the
final saved Office-only restart reopened all three editable and accepted a
native DOCX edit/Save. Receipts are under
`verification/office-shutdown-20261029/proof-0026/` in
`dirty-local-off-result.json`, `readonly-office-only-result.json` and
`saved-office-only-result.json`. These are explicit older-browser/native-overlay
checks, not fresh cf62 or all-platform shutdown acceptance.
The combined `result.json` and sibling
`build-0026/committed-source-link.json` retain the exact diagnostic build and
reviewed committed-input identity.

`6b01947a60` separately
changes native browser field-clearing semantics; rebuilt installed-actor
and actual References query/export-scope acceptance remain pending. Its bounded
source/native-event receipt is
`Bashkitten-Acceptance/browser-fill-clear-20261029/verification.json`.
These source changes postdate the cf62 binaries.

## Guided local models — 29 October 2026

`7054f1a59b` replaces detailed model-builder menus with guided model/device/context
controls and an explicit custom router INI mode. It reuses the existing native
router, downloads, setup jobs and Pi provider import. The requested Qwen quant
matrix is pinned with matching projectors and full model notices; existing exact
defaults remain. Different quants share the model folder/projector, and reused
verified bytes count toward progress without another download or routine full
checksum pass. Prior guided INI entries remain routable for existing Pi chats.

Focused source checks passed configuration preservation, custom ownership races,
paired assets, download reuse/repair and readable progress. Browser component
checks passed compact 360px presentation, a keyboard-sized viewport, stable
download-control focus and preservation of edits during asynchronous responses.
These component fixtures are not installed product acceptance.

An installed diagnostic native-controller check changed only the existing model's
context from 32,768 to 65,536. Native llama.cpp and bundled Pi both reported the
new context and text/image input, with the matching projector, CPU selection and
current Pi model/thinking preserved. The controller stayed running. A read-only
native slots request during real Pi generation confirmed that the selected
release exposes actual processing state without another launcher flag.

Default downloads already queue through fresh desktop Local autostart and after
normal Termux setup completes. The automatic Settings-opening hooks are removed
on both platforms; an explicitly opened settings page observes that existing job.
Seven focused source fixtures passed fresh desktop/Termux startup with Settings
unopened, saved Local autostart Off, custom configuration/import opt-out, saved
Pi choices, cancellation/retry and concurrent configuration edits. They use the
real setup/job/download owners with tiny synthetic streams and stubbed runtime
installation/process boundaries, so they are not installed first-launch proof.
Fresh installed Linux acceptance now covers the unmodified amd64 `153.5.4`
package from source `16f0a0330ac7f800fba6c97b8aaf778d32922843`, daughter run
`40815438167`, SHA-256
`23da7e91d9980a716f1f9cf67ae78998afd43f97217fdea83d62429bd8b1250e`.
The retained real-Xorg VM was upgraded after normal GUI Quit, preserving its old
profile/data, then launched through the desktop with an empty separate profile.
With Settings never opened and only the new chat tab visible, the native owner
automatically downloaded both runtimes, Qwen3.5 4B XL and its F16 projector,
Parakeet Q4_0 and Pocket assets; setup completed without error. Settings opened
later showed all three defaults downloaded, CPU, 65,536 / 262,144 tokens and no
available GPU. Actual asset rows showed fractional completed/total MB or GB,
percentage and speed. The real router INI contains the matching projector,
65,536 context and Q8 K/V settings. The authenticated installed `/api/models`
returned the bundled Pi default as available with context 65,536 and text/image
input. This confirms provider discovery/configuration, not new image inference
or physical GPU execution.

The installed dropdown downloaded and applied an alternative Whisper model.
A separate immediate cancellation through the installed native controller kept
the previous selection. Normal GUI Quit/relaunch preserved that cancelled job,
all download records, the nondefault speech choice, and the exact custom INI
hash/comment saved through the GUI editor. Custom mode visibly disabled only
llama guidance. Explicit retry through the speech dropdown then completed while
preserving the custom INI. The installed run exposed two UI defects: terminal
preparation rows with no byte total displayed pending progress, and status polls
returned a manually scrolled model list to its keyboard cursor. Their focused
renderer corrections and component checks are separate from this unchanged
`16f0` installed receipt.

The same unchanged 16f0 installation also passed saved Local autostart Off with
empty data: no default download started. Separate replays preserved both Local
and llama autostart Off, and preserved an independently enabled llama autostart
while Local stayed Off and downloads remained unchanged. The existing custom
INI and cancellation/retry receipts retain that desktop source identity.

Android setup now has separate actual cf62 evidence on fresh Cuttlefish instance
4/6523. The production x86_64 APK and matching backend/OS pair completed normal
Copy/Open Termux/permission/return setup using a locally staged native APT fixture.
Default Qwen3.5 2B plus F16 projector, Parakeet and Pocket transfers started while
Settings was closed. Opening Settings later observed complete first-run setup,
the voice asset and VAD readiness. The actual router INI contains CPU selection,
65,536 context, Q8 K/V and the matching F16 projector; the authenticated bundled
Pi catalogue reports the available text/image model with that context. This is
installed setup and configuration proof, not model inference, physical GPU,
speech quality or published-APT network onboarding acceptance.

An actual unmodified cf62 Android GUI Retry/resume of a cancelled download was a
no-op. Existing-owner fix `12ee699af3` passed a later GUI retry under a recorded
one-file diagnostic overlay: the 264.48 MB transfer completed while the original
cancelled guided job and newer selected speech model stayed unchanged. This is
overlay proof, not an unmodified cf62 retry pass. Explicit GUI dropdown
application then completed, and the Parakeet selection was restored. Receipts are
`retry-overlay-receipt.json`, `overlay-gui-retry-started.json` and
`overlay-gui-retry-complete.json`, plus `overlay-explicit-selection-complete.json`
and `restored-parakeet-before-dictation.json`, under the Android cf62 evidence directory.

The default Pocket CPU runtime produced a valid 1.2s mono 24 kHz PCM WAV through
the existing synthesis API after 44.205s; this is not speech-fidelity, GUI preview
or call/playback acceptance. Actual GUI Parakeet dictation of the public JFK
sample was inaccurate and partial. A direct native comparison of the same 11s
PCM returned the complete expected text in 18.237s. The GUI sample window had
73 Android HAL silence insertions and 28 read errors; this failed attempt remains
recorded separately from the subsequent replay.
Receipts are `native-tts-audio-validation.json`, `native-direct-asr-result.json`
and `gui-audio-hal-diagnostic.json` in the same evidence directory.

The subsequent actual GUI replay returned the complete expected JFK sentence.
Only instance 4's WebRTC process was moved to the test environment's already
documented CPU affinity, and the recording window was shortened; no app or model
change was made. The sample window had zero ALSA read errors and 17 short-buffer
warnings. This establishes the bounded public-sample GUI path, not error-free
HAL behavior, isolated causality, physical-microphone quality or general speech
reliability. The fixture enters stock Cuttlefish WebRTC and traverses Android
AudioRecord and the actual app encoder/transcription path. Defaults and auto-send
were restored, the draft cleared and the fixture removed. See
`gui-dictation-replay-summary.json` and `gui-replay-visible-text.json`.

Optional large model weights were not downloaded or claimed tested. Actual Q8
KV execution, physical GPU and broader installed flows remain separate gates.
The failed 16f0 Android build remains historical; it is not relabelled as cf62.
The parent source-collection state also prevents final published-source acceptance.
External receipts and screenshots are under
`/home/user/Bashkitten-Acceptance/localai-153.5.4-16f0-20261029/`, including
`first-launch-settings-closed.json`, `ready-status.json`,
`installed-pi-model-catalog.json`, `after-restart-preservation.json` and
`after-gui-retry.json`; `installed-acceptance-summary.json` also links the three
saved-Off replays. The Android cf62 receipts are under
`android-localai-153.5.4-cf62-20261029/`, including
`settings-closed-initial.json`, `settings-closed-models.json`,
`settings-observer.json`, `native-model-catalog.json` and the final
`installed-acceptance-summary.json`.
Earlier diagnostic/overlay and source-fixture evidence
remains separately identified under `audio-guided-20261029` and `audio-ui-20261029`.

## Operation ownership corrections — 20 October 2026

This checkpoint supersedes the earlier in-progress runtime/build statements below.
It does not claim complete product acceptance or change the frozen requirements.

- `a4e74b5a99` keeps per-machine Autostart exclusion while releasing the global
  catalogue queue during guest I/O. `263f527355` replaces a verified idle legacy
  service through the existing update/lifetime owners. Busy work and an actual
  pre-package CLI request remain pending; current lock waiters do not block the
  replacement. The private runtime directory is prepared without rewriting a
  still-running old owner's configuration.
- `b1bc35ce84` connects the protected Sign out gesture to cookie logout and the
  existing native OAuth/mapping cleanup on Android and Linux. Cleanup is bounded
  and reports failures without changing ordinary disconnect behavior. Import
  cancellation reaches enrollment persistence and selection; cancelled changes
  are restored within the existing serialized owner before later operations.
- `62f0f9d2ff` captures each Send/Stop/queue edit's chat and draft before asynchronous
  work. The existing message endpoint owns worker startup; the duplicate composer
  resume/subscribe preflight is removed. Completion cannot dispatch to another
  selected chat or restore attachments there. Draft initialization precedes chat
  opening I/O, accepted edits/removals settle their matching held draft, and
  current-view observation is restored when returning during a send. Native
  logout errors expose explicit Sign in while retaining the actual error.

Bundled Node syntax/whitespace checks, compilation of the four changed production
Java files against cached Android 37/product dependencies, and native Go package
builds pass. Independent source reviews traced the actual worker/Pi, native
logout, enrollment and machine update callers and resolved their concrete
follow-up findings. These checks are not installed acceptance. Required repeats
include navigation during stopped-chat startup, failure draft recovery, queued
edit/remove/Stop across navigation, return-to-chat observation, retained native
drafts, remote logout with open service mappings, interrupted import, and busy
versus idle service replacement on the complete candidate.

The user explicitly rejected the additional blocking native source-audit layer
in the separate MIT AI-runtime daughter repository. Daughter `b6da0ee0` removes
that layer and the arbitrary library classifier while retaining release pins,
checksums, sources, full notices and the existing executable/ABI/alignment/VAD
checks. Its first two runs failed because the workflow still invoked a removed
source-audit test. `91df28f1133b249dbd08002ae31d2b1aec7cd8ff` removes that stale
invocation. Replacement all-target, publishing-enabled runs are
[llama 39337603129](https://github.com/openresearchtools/bashkitten-localai/actions/runs/39337603129)
and [Whisper 39337605512](https://github.com/openresearchtools/bashkitten-localai/actions/runs/39337605512).
At the checked checkpoint, both Linux Vulkan llama jobs and all four Vulkan
Whisper jobs passed; remaining Android llama/CUDA jobs were still building.
No publication or installed runtime pass is inferred from this state. Browser
source/license obligations and the CUDA notice boundary remain unchanged.

Premature main run `39336986772` was cancelled; it is not the integrated candidate.
The existing Linux 153.5 browser producers and separate SSD local native builds
retain useful compiler work and their actual source identities. Native logout
changes affect packaged browser and remote-helper inputs, so final candidates
must use the integrated source and normal incremental/cache comparison rather
than relabel earlier binaries. Local source/object/cache preparation lives under
`/home/user/Bashkitten-Acceptance/local-candidates-e6c96a-20261019`; final packaging
and installed Android/Wayland/real-Xorg acceptance remain pending. All other
unclosed plan acceptance groups remain required.

## Inline header and combined-candidate follow-up — 19 October 2026

Later licensing follow-up: the retained Mozilla source audit against pristine
Firefox 153.5 found no lost MPL notice in modified non-artwork files. Completely
replaced artwork has its replacement-artwork license; BashKitten's AGPL does
not overwrite inherited file-level notices. The user also clarified that the
MIT-licensed daughter runtime repository retains CUDA with NVIDIA's own
component notices and explicit source availability. The dated plan amendment
records that boundary without changing the frozen original.

Daughter source imports and linkage diagnostics are pushed through `511454d5`;
corrective run `39330013225` is in progress. Its Linux arm64 Vulkan engine
compiled and passed startup/VAD checks, then packaging rejected a valid dotted
CPU-backend library name. That classifier repair is being batched with the
authorized CUDA notice/source-status correction. No new runtime publication or
installed-app acceptance is claimed from these intermediate build results.

`6f62397ee2` puts the working folder and session/runtime metrics in one flowing
header, wrapping only when the available width is exhausted. It removes the
redundant header Stop/Resume control and retains the composer control and Files.
`521c0ec768` supplies the owning backend's original home-path alias alongside its
canonical home; the shared formatter displays either as `~` or `~/…` using
directory-boundary matching. Commands, stored paths and file permissions are
unchanged. Source/layout checks include 320–1440-pixel widths, short landscape,
long paths and backend alias/isolation cases. These changes are not yet an
installed candidate pass. Their authorized requirements are recorded in the
current plan's dated amendment, without changing the frozen original.

Complete 153.5 candidate run `39325866928` uses prepared source
`8a2c720a561ad85ef5a279db4007422e5d2aad62`, before these UI changes. Its Linux
amd64/arm64 browser producers are still compiling at this checkpoint. The old
Android workflow selects Go 1.27.1 while the retained source requires 1.27.2,
so its client build cannot pass that source check. `c94c02060e` fixes the managed
template to select the compiler from the committed source manifest; the matching
Android builder workflows are pushed. Preserve the source/toolchain check. A
replacement complete package run must include this fix and the UI changes,
retain unpublished version 153.5 and wait for eligible completed Linux browser
producers so their unchanged compiler fingerprints can reuse those archives.
Android still requires fresh APK assembly and the matching Termux packages.
No successful build, cache write or installation is inferred from dispatch.

The four daughter Vulkan artifacts passed binary/checksum/ABI checks, but their
Android corresponding-source audit found missing NDK libc++ sources. The
daughter source closure repair remains in progress; the existing unpublished
runtime run is not release approval. Keep runtime builds in daughter CI.

CVD6520 now has verified KeePassDX Libre 4.5.6 installed and selected through
ordinary Android consent, with a disposable encrypted vault and explicit trust
for the installed BashKitten signing identity through the provider's UI. Normal
vault lock/reopen succeeded using Cuttlefish in the isolated BashKitten browser.
Credentials and backups remain outside repositories in private local storage.
This is provider setup only: actual 153.5 create/sign-in/cancel and password/
notification acceptance remain pending, including comparison of its signer.
Evidence: `Bashkitten-Acceptance/framework-passkeys-153.5-20261019/setup-receipt.json`.

The installed `bd393` real-Xorg container also exercised Pi-driven GUI launch.
The first attempt failed: Mousepad was absent and the model substituted Thunar.
With an explicit correction, Pi installed Mousepad through guest passwordless
APT, but then its foreground GUI command was killed by the desktop helper's
operation timeout. A further correction used the existing `gio launch` desktop
entry path; Pi opened the requested README, verified the real window title and
focus using the current owned context, and the window remained visible in the
native Display tab after the launcher returned. The README hash stayed equal
to its earlier Files acceptance hash. Shared desktop guidance now documents
this persistent-application launch method, without changing the bounded helper
or introducing a separate service. This proves the corrected installed path,
not unguided model reliability or installed discovery of the newly edited guide.
Evidence: `Bashkitten-Acceptance/desktop-agent-context-20261019/acceptance.json`.

## Integrated release refresh — 19 October 2026, final source batch

Firefox 153.5 ESR is merged in `feb8fd576c`; `e69a687bb0` records the matching
Tor Browser 16.0a14 release and verifies all 15 applicable existing security
backports. The compact source tag is pushed and the frozen requirements tag
still peels to the original baseline. The merged Linux/Android Rust bridge
checks, adblock's 217 tests and memchr's 142 tests pass. This is not a full
browser build or an installed 153.5 result.

The integrated batch also contains Tor 0.4.9.14, official Pi 1.3.0, Linux Node
24.22.0, private Podman 6.1.4, compatible search/helper dependencies and the
released embedded X11 dependencies. Both X11 native ABIs link with 16 KiB
alignment; Mozilla's selected ESR toolchain still requires NDK r29. The exact
source/import and bounded-build details are in
[the native runtime record](component-runtime-refresh-20261019.md) and
[the Pi record](pi-runtime-refresh-2026-10-19.md). Caddy, Authelia, Chisel and
the other checked current releases retain their supported pins. Imported
release dependency graphs remain their upstream-tested cohorts.

Android SDK removal `46d0877c63` and framework WebAuthn `5cf8cd5475` are now
implemented. The resolved 252-coordinate Android graph has no missing sources;
all 519 Maven notice records resolve, and the scanned dependency classes contain
none of the removed runtime SDKs. Production Java/JNI/Kotlin and native checks
pass. This supersedes the historical unresolved-source discussion below; actual
new APK class checks and installed password/provider/notification flows remain
required. lxml's upstream Linux wheels intentionally use libxslt 1.1.43 with
the retained security backport; `815895883b` records that exact release recipe,
adds its previously missing libiconv/zlib sources and fixes the source lock
binding. It does not relabel those wheels as libxslt 1.1.45.

The user-requested `full-read` and `compact_context` extension is registered in
the existing Pi package in `2c1eea5c44`. Deterministic stock Pi 1.3 SDK/RPC,
private-profile discovery and Linux/Termux staging checks pass, including full
reads, context refusal, compaction/resume and Stop. No paid context-fill test
was repeated. GUI guidance also uses the existing current-desktop helper rather
than copying only a display number. The combined candidate must still verify
these integrations through the installed apps. No complete-product acceptance
or new publication is claimed here.

## Release refresh and continued installed checks — 19 October 2026, later evening

The user's later authorization removes the remaining Android Google Play
Services/Firebase runtime SDKs and website WebPush while preserving local saved
passwords/autofill, native agent notifications/replies and Callback. Android
passkeys use the public framework with its real provider trust/error behavior;
desktop WebAuthn is unchanged. The dated plan amendment supersedes the earlier
unresolved source-policy discussion below. This batch is being integrated with
the requested official component release refresh; it is not yet an installed
replacement for `bd393` or a whole-product acceptance claim.

Further real-Xorg `bd393` flows passed in the previously created owned container.
Project rename, chat rename, ungrouping and moving into a different project
preserved the existing Pi session identity and original cwd. Chat rename added
exactly one stock Pi `session_info` entry; subsequent regrouping left its bytes
unchanged. Canceling project creation created nothing. A new chat under the
second project inherited `/home/user` without another folder prompt. Asked to
find the earlier renamed/regrouped chat, Pi discovered the `chats` skill/tool,
listed and read that history and correctly reported its original cwd and README
contents. The earlier JSONL remained byte-identical after lookup. The receipt
now has 11 scoped cases and 59 checked evidence references:
`Bashkitten-Acceptance/xorg-fresh-container-bd393-20261019/acceptance.json`.
Duplicate titles, unavailable remotes, fork/queue identity and other backends
remain separate cases.

Android `bd393` Callback follow-up passed six scoped cases through the installed
app: local diversion without ringing, voicemail listen and reviewed reply to
the original Pi chat, unanswered ringing saved once, clearing the mailbox
without changing Pi history or deduplication, Messages-mode finals without
ringing, and user call-in/reply retaining Messages mode. Unanswered delivery
settled after 45.14 seconds and did not ring again during the subsequent
20.99-second observation. All temporary permissions and phone settings were
restored; models and LocalAI/Pi configuration were unchanged. Evidence:
`Bashkitten-Acceptance/voicemail6520-bd393-20261019/result.json`.
This found a real presentation defect: identical dictated text from different
channels can label a later call reply as a voicemail reply. Dispatch and saved
mode were correct; source-attribution repair and rebuilt acceptance remain
required. No remote/OEM/Android Auto or full concurrency pass is inferred.

The user's standalone Pi conflict was traced to an old BashKitten package entry
in its global settings, written at 10:07 UTC on 8 October, before private-profile
isolation commit `b6c435807f` at 10:55 UTC. The installed/current BashKitten
launcher sets its private `PI_CODING_AGENT_DIR` before SDK loading. Only the
stale BashKitten registration was removed from this host's standalone settings,
with a private backup outside repositories; standalone Pillama/accounts/sessions
were retained. The installed standalone resource loader then loaded its three
own extensions with zero errors and no BashKitten extension, without changing
settings. This is a local repair, not an automatic migration of users' profiles.

Runtime updates must also preserve speech integration. `PhoneSpeech.vadFiles`
now reads the installed runtime's `VAD-SOURCE.json` model path instead of fixing
the filename to Silero 6.2.0. Production-method filesystem checks cover both
6.2.0 and 6.2.3 records, malformed/missing records and missing models, with no
version substitution. Actual newer VAD inference/call acceptance requires the
daughter CI artifact and rebuilt candidate.

## Complete-candidate follow-up — 19 October 2026, evening

The complete `bd393bd7ec59eebd3f540072dc9511917520de9c` / 153.4.6 CI
assembly finished with all 53 producer jobs green. The final release audit
passed 204 checks over 43 assets, including both Android ABIs, both Linux
architectures, matching Termux/OS packages and reconstructable corresponding
source archives. This is artifact/build evidence, not release approval or full
installed acceptance. The audit is retained at
`verification/combined-candidate-20261019/prepublication-complete-release-audit.json`.
No new public release was published by this audit.

A fresh container was created through the installed complete Linux candidate
inside the owned real-Xorg VM. Provisioning completed in approximately 157 seconds
with its menu still usable. The matching guest backend/OS packages, actual
passwordless package installation and interactive `sudoedit`, window/viewport
resize, and Display detach/reattach were exercised. Closing Display preserved
all 46 recorded guest PID/start identities. Observe blocked the test keyboard
input and Interact restored it. A project created through the compact modal and
guest folder picker supplied the correct cwd to a real Pi `bash` call. Guest
Files rendered Markdown, exposed raw content and downloaded identical bytes.
A second Pi turn read that guest file and its clickable answer opened the same
ordinary preview with Download retained. These are scoped software-rendered
amd64/Xorg passes, not all layout/input/GPU cases. The stock GTK Save Contents
dialog was usable at the observed 980-by-700 window; the earlier narrow/tall
chooser finding remains open. Receipt with 45 checked evidence references:
`Bashkitten-Acceptance/xorg-fresh-container-bd393-20261019/acceptance.json`.

The matching publisher-signed Android x86_64 candidate and Termux backend/OS
passed the core Callback flow in Cuttlefish 6520 through the desktop BashKitten
viewer: native calling setup, keypad routing, Parakeet/Silero/Pocket dictation
and speech, silence review, Add more, Change, explicit `#`, and confirmed Send.
Native Pi history contained exactly one resulting user entry. Hangup left the
turn working; its final produced an incoming backend-identified call, and the
answered call spoke the saved final. Calls Off removed foreground reception.
Models and LocalAI/Pi configuration hashes were unchanged after cleanup. This
required an authorized clean native install after a signing-key mismatch and
one recovery of a Cuttlefish WebRTC process crash. It does not establish an
upgrade, the reserved signed updater path, all section-13 cases, physical/OEM
behavior or Android Auto. Receipt:
`Bashkitten-Acceptance/callback6520-bd393-20261019/result.json`.

The fresh-profile About/Licenses/Quit flow exposed a real shutdown defect.
Settings imported the runtime owner through its window's module global,
instantiating another shutdown/remote owner chain. Fix `1f15c34afc` uses the
existing shared module owner. A private copied browser with only that module
changed exited normally in 0.52 seconds versus the matched unchanged candidate's
71.8-second watchdog crash. The attempted dispatch-only fix failed the same
comparison and was removed. The independently verified duplicate preference
registration fix is `17e4eb6dff`. Shared installed binaries were not patched by
these comparisons; both fixes require the next complete candidate. Evidence:
`verification/quit-barrier-20261019/README.md`.

User-requested sidebar fix `597cdc2962` removes redundant steady-state labels,
retains pending progress/errors and makes power switches reflect confirmed
backend status, including Android background Local. Source render/state tests,
Java compilation and JavaScript syntax checks passed; installed UI acceptance
is still pending. Receipt:
`verification/sidecar-power-state-20261019/receipt.json`.

Current source has eight unresolved Android runtime source gaps after removing
unrequested product-service dependencies and verifying the annotations source.
The source/packaging gates continue to reject those gaps before publication.
The [dependency record](android-dependency-source-status.md) now explicitly
separates repository source-policy approval from actual AGPL/GPL compatibility:
notices or a policy waiver alone cannot resolve conflicting license terms.
No proprietary-retention exception, provider approval, Google developer account
registration or reduced browser authentication contract is authorized here.
Open FIDO/framework and push integrations have been researched, not implemented
or accepted as equivalent replacements. The user has explicitly rejected Google
developer registration. External approval requests have not been submitted.

All post-`bd393` fixes remain outside that complete candidate. Full feature and
cross-platform acceptance remains unfinished; the immutable baseline, subsequent
user amendments and existing coverage matrix remain mandatory.

## Recovery and integrated follow-up — 19 October 2026

All three retained Android 17 Cuttlefish instances and the owned real-Xorg VM
were restored after the host reboot. The separate Intel Wayland desktop accepts
actual native input again; its container returned to Running through its normal
sidecar switch, retiring the saved prior Podman pause-PID error. No manual
runtime deletion or permission change was needed. The ordinary host browser
shows only the view-only desktop and background Cuttlefish pages; desktop test
input stays inside the dedicated test user or owned Xorg VM. Recovery evidence:
`Bashkitten-Acceptance/environment-recovery-20261019/android-xorg-readiness.json`.

Actual Android remote Send with Files Off passed on 18 October through the
normal QR, password, Tor/mTLS, Authelia TOTP and consent flow. A new chat under
an existing publisher project completed with the expected answer, while its
folder/file-manager controls remained disabled. Client/backend `cab1310f182`
and publisher `31073761ca` both include the two Files-Off source repairs.
No alternate transport, authentication bypass or provider/model change was used.
This closes that particular Send regression; Files On, live revocation and
the remaining authentication/service lifecycle matrix remain open. A stale
earlier OAuth TTL sidebar message was observed after the successful connection.
Subsequent fix `8e67e0161b` leaves connection errors in the authoritative backend
state instead of copying them into the sidebar's persistent action notice;
unrelated operation errors and actual readiness timeouts remain visible. The
focused production-classpath Java compile passed; installed recovery and
unrelated-notice regression checks remain pending. Exact scope and mixed-component identities:
`Bashkitten-Acceptance/android6522-remote-files-off-20261018/acceptance.json`.

Selected-container configuration was exercised through the host UI while host
Local was Off. General settings saved the container's working folder, and the
container Providers and Local AI views loaded without enabling host Local.
Only the guest settings file changed; host settings and both native Pi
settings/authentication hashes stayed unchanged. The guest folder was restored
through the UI, and host Local was restored On after recovery. The guest tray's
normal Stop action restored its prior Agent Off, leaving the container and
Display alive. This does not claim a completed provider OAuth or all Local AI
settings test. Evidence:
`Bashkitten-Acceptance/xorg-container-settings-20261018/acceptance-recovery-20261019.json`.

The guest tray's saved Agent-Off state exposed a missing recovery action in the
host view. `07bc82680c` adds **Turn on Agent** to that existing disconnected
state, using the private guest controller. Selecting a stopped guest preserves
Off; the explicit action starts only its Agent, without restarting the container
or enabling host Local. Syntax/diff checks passed and the fix is pushed;
installed acceptance belongs to the next combined candidate.

Follow-up `90b0b79977` carries the existing 180-second explicit Agent-start
deadline through both private container-control layers. Previously either
intermediate 30-second deadline could reject a still-starting guest. Other
operations retain their existing deadlines; errors are not retried. Ten
controlled asynchronous IPC cases and syntax/diff checks passed. This fix is
later than the running `bd393bd7ec59` candidate and still needs installed
recovery acceptance. Receipt:
`verification/guest-agent-start-timeout-20261019/results.json`.

The private Intel Wayland container's XFCE preference tests resumed after the
reboot. Light, window management Off and the selected wallpaper survived recovery.
The actual guest portal reported Light, then Dark after restoring that choice in
the UI. Turning window management On maximized the existing normal Terminal
within the guest workarea without restarting it. The original OS, toolkit and
wallpaper settings were restored through normal controls and exactly match the
saved baseline; the centered logo again has a uniform background. This is scoped
mixed-component evidence, not complete desktop/modal/split or Android acceptance.
Receipt: `verification/xfce-settings-20261018/continuation-receipt-20261019.json`.

The real-Xorg host Local AI UI successfully checked the saved Qwen3.5-4B model
in CPU mode and reported **Check passed. Model unloaded.** Process observation
confirmed that the temporary router, model child and directory disappeared while
the original normal router stayed alive. A second check was cancelled through
**Stop load check**; the UI reported cleanup and the final process/directory
snapshot matched the original baseline. Both saved configuration hashes were
unchanged. During a third check, the native Configuration menu opened while the
UI still showed model loading and process snapshots confirmed both temporary
children were active. That check also completed and cleaned up without changing
the configuration or normal router identity. These checks use the existing mixed
candidate; they do not establish all navigation/chat or stalled-display
responsiveness, GPU/Android behavior or the complete 153.4.6 candidate. Evidence:
`Bashkitten-Acceptance/xorg-model-check-20261019/acceptance.json`.

The same Xorg installation verified the shared Local AI startup choice in both
directions: disabling llama.cpp startup in Autostart appeared Off in Local AI;
enabling and saving it in Local AI appeared On in Autostart. The original
configuration bytes were restored exactly, with no model/provider changes.
This covers that saved-choice integration, not all startup services or platforms.
Receipt: `Bashkitten-Acceptance/xorg-autostart-authority-20261019/acceptance.json`.

The installed Xorg question flow returned pending in 11 ms and completed an
independent Bash tool while the question remained unanswered. Actual UI actions
sent a custom reply once and dismissed another pending question once. An
unanswered question expired at its original 120-second deadline; dismissing its
expired control preserved the original single expiry delivery and timestamp.
Settled cards appeared beside their originating tool calls in the expandable
work history, with attributed replies/notices in chronological chat history.
The small local model made three separate question tool calls despite the
one-question instruction and emitted a premature acknowledgement; these model
behaviors are explicitly distinguished from backend delivery evidence. This is
mixed-candidate coverage, not the cross-channel/Stop/crash race matrix. Receipt:
`Bashkitten-Acceptance/xorg-question-dismiss-20261019/acceptance.json`.

Android Phone acceptance exposed two lifecycle failures. Granting notification
access while its feature was Off could race two listener-unbind requests and
crash the process. `ef145317f2` makes unbinding connection-scoped and immediately
revokes availability, handling the expected lost Binder token without accepting
notifications while Off. `4342ac5e58` restores the Phone owner link after verified
Local reconnect or late listener registration, without starting a saved-Off
backend or invalidating live grants on repeated connected refreshes. It also
replaces the misleading Local-Off message for a disconnected owner link.
Production Java compilation and controlled lifecycle/authentication regressions
passed, including reproduction against the unfixed source. Both fixes are later
than `bd393bd7ec59`; installed repair acceptance remains required. Evidence:
`verification/notification-listener-race-20261019/` and
`verification/phone-owner-recovery-20261019/`.

GitHub preparation run `39302677649` prepared version **153.4.6** at exact
`bd393bd7ec59eebd3f540072dc9511917520de9c`, then dispatched full package run
`39303133963` with all Linux, Android and Termux architectures and the required
source/notices artifacts. No partial-target flags were used. The existing
`v153.4.5` testing publication remains unchanged. Dispatch is not a successful
build, publication or installed acceptance result.
The later sidebar-notice fix `8e67e0161b` is not in that immutable build head;
it is retained for the next batched candidate, without replacing running inputs.
The available-artifact audit subsequently verified 20 GitHub archive digests and
the complete corresponding-source archive: 519,718 tracked paths, 153 npm source
archives with their existing full-notice supplements, 128 native source archives,
673 Android source/notice inputs and all four Node/search target pairs. The two
source-byte differences exactly reproduce declared Git archive conversions
(CRLF and export-subst); no unexplained mismatch remains. Final binaries,
APK/Termux pairing, remaining component inventories, traffic audit and installed
acceptance are separate pending checks. This is not a release-complete claim.
Receipt: `verification/combined-candidate-20261019/prepublication-audit-status.json`.

The full run subsequently completed successfully: all 53 jobs passed, including
both Android architectures, both Linux architectures and matching Termux packages.
Both APK audits passed signatures, native alignment, exact backend/OS pairing
and offline notices, but each failed the corresponding-source check for 15
runtime SDK dependencies. License texts do not supply missing implementation
sources. Publication remains blocked; the final assembled release inventory is
being checked separately. Receipt:
`verification/combined-candidate-20261019/android-runtime-source-release-blocker.json`.

The complete audited Linux `153.4.6` / `bd393bd7ec59` DEB was installed normally
on the host and owned Xorg VM. On Xorg, an actual UI-configured Local startup
command ran once per browser lifetime with its exact working directory,
environment and literal argument. Local Off and window Close/reopen preserved
the same browser, command and child identities without another launch. Explicit
native Quit while Local was Off removed those identities; the observation
completed within 0.6 seconds. A new owner ran the command once, and Remove in
Autostart stopped its parent and child without deleting its files or stopping
the browser. The original empty startup configuration was restored byte-for-byte.
This covers Local custom commands, not container/Termux commands, crash cleanup
or the entire startup matrix. Receipt:
`Bashkitten-Acceptance/xorg-autostart-command-20261019/acceptance.json`.

Restarting the dedicated headless test browser exposed a stale private control
socket after its owner exited. The fixture was recovered only after verifying
the dead owner, socket identity/ownership and `ECONNREFUSED`. Source fix
`160a106413` adds the same bounded asynchronous recovery and identity-checked
shutdown cleanup; live peers, timeouts, symlinks, foreign owners and replacement
paths remain protected. Baseline reproduction and 15 helper cases passed. This
fix is later than `bd393bd7ec59`: manual fixture recovery is not installed repair
acceptance. Evidence: `verification/control-stale-socket-20261019/` and
`Bashkitten-Acceptance/operator-browser-20261019/stale-control-socket-bd393.json`.

The retained private Wayland desktop passed scoped same-application window
pairing, divider dragging with minimum/increment hints, parent-dialog exclusion,
member-close recovery, Manage Off after a drag, manual placement while Off and
On without restoring a stale pair. Applications preserved pin order and separate
main/Pinned scrolling with fixed bottom search. Original OS/toolkit/wallpaper
choices were restored exactly. A GTK Save Contents chooser still opens wider
than the compact viewport even with fresh chooser defaults and management Off;
this remains an explicit usability finding, not a demonstrated custom-layout
regression. These are retained mixed-component results, not complete-candidate
or all-platform acceptance. Receipt:
`verification/xfce-window-launcher-20261019/receipt.json`.

## Installed follow-up and remaining blockers — 18 October 2026

The private Intel Weston desktop repeated real native resize, Display tab close,
sidecar reopen and Applications input with helper `800e6fc078`. Ten captured
guest process identities were unchanged. The centered transparent wallpaper
remained proportional with uniform background across both viewport sizes.
Image clipboard transfers passed in both directions through the native toolbar:
an ordinary browser image pasted into guest Writer, then Writer's selected image
copied into a host Local chat draft. That draft was removed without sending.
These checks used main `31073761ca`, actual Gecko producer `05becb3ab6` and guest
launcher candidate `1e1a9648a0`; they are not a rebuilt combined-package pass.
Build receipt: `verification/desktop-800e-wayland/receipt.json`.

The guest initially rendered through software despite the outer GPU label.
The cause was systemd's guest-user switch dropping the supplementary device
group retained by rootless crun. `cb0314b308` preserves those inherited groups
while dropping all user/group IDs to the guest account and clearing inheritable
and ambient capabilities before either existing session owner starts. Actual
Display and whole-container Off/On checks passed with the two candidate units:
XFCE, browser, backend and the existing llama process run as guest UID/GID 1000
with zero effective/permitted/inheritable/ambient capabilities. GLX reports
`Mesa Intel(R) Graphics (ARL)`. Only selected Intel `/dev/dri/renderD128` was used;
host device permissions, ACLs and NVIDIA were untouched. Host BashKitten and
Podman remain rootless. Evidence is in the private desktop's
`diagnostics/gpu-groups/summary.json`. The separate document-portal FUSE error
was subsequently repaired in `154540f00e`: the guest package uses the pristine
pinned libfuse native helper at a private guest path, removes the replaced Python
broker and safely diverts/restores the distro command. Actual private Wayland
portal mounting, Thunar direct AppImage launch/unmount, persistent extraction
reuse, package removal/reinstallation and normal container Off/On passed with
that focused guest component. Host BashKitten/Podman remain rootless and host
permissions were unchanged. The full matching candidate and Xorg repeat remain
required; evidence: `verification/fuse-portal-20261018/repair-result.json`.

Actual Xorg container testing passed code, rendered/raw Markdown and PDF previews,
text Download, an existing assistant file citation with matching raw download,
and compact project creation followed by a real Pi `pwd` in that project folder.
Native Quit removed all 76 captured owned process identities. PDF row Download
failed because Gecko's internal PDF handler attempted a protected Agent popup.
`f537f6cb02` routes explicit trusted file downloads through the existing native
forced-save helper while preserving the popup guard and document/URL checks.
An installed three-module diagnostic overlay then passed PDF Download and text
Download with the original bytes, plus the ordinary 19-page PDF View. The fresh
log contains no protected-popup abort. This is an overlay check, not a rebuilt
combined-package pass; Android regression remains separate. Evidence:
`Bashkitten-Acceptance/xorg-files-project-20261018/acceptance-final.json` and Build
`verification/files-native-download-20261018/acceptance.json`.

The signed Android upgrade failure was a missing bootstrap runtime: the old
153.4.4 backend has no bundled Node at the new updater's expected path.
`177b9185b4` adds a fixed APK helper that obtains the exact authenticated APT
backend archive, validates its release/architecture, privately stages only its
bundled Node and invokes the existing updater owner/idle/install path. Focused
Java, source and lifecycle checks passed, as did inspection of actual old APIs
and the published runtime's ELF dependencies. It neither uses system Node nor
manually upgrades the old fixture. A rebuilt signed APK with matching signed APT
packages is still required for installed acceptance; CVD 6523 preserves the
original failure. `39e3aa00e7` additionally persists the real updater child
identity before supplying its request, preventing preparer death from retiring
an executing staged runtime. Real-child fault checks at the three handoff
boundaries passed; they do not replace the signed-device update. Build receipts:
`verification/signed-upgrade-bootstrap-20261018/` and
`verification/review-updater-pdf-20261018/handoff-parent-death.json`.

An independent Android Callback test found another real blocker: an in-app call
works, but a call from the saved Kitten contact reaches Telecom and is rejected
when its microphone foreground service starts from the background. Recording
permission is already granted. `21127c4495` now retains the enabled reception
owner as a microphone-type foreground service without recording while idle.
An answered call adds the call type; hangup returns to reception and Calls Off
stops it. Source compilation and focused lifecycle checks passed. An external
Android 17 probe demonstrated unsilenced recording for ordinary Contacts calls
and incoming Phone Answer after explicit reception enable, with no active idle
recorder. Its zero emulator input is not intelligible-speech evidence. The
integrated Callback/LocalAI/Pi and Off-state tests await the combined signed APK;
no privileged workaround or completed Callback claim is made. Evidence:
`verification/telecom-background-fgs-20261018/result.json`.

The external `verification/remaining-installed-acceptance-20261018/matrix.md`
reconciles 17 remaining groups against the frozen plan, amendments and existing
scoped evidence. Its Files-Off Send row is superseded by the successful scoped
repeat above; its other outstanding cases remain required. Full feature
acceptance remains open.

## Resumed installed testing and signed publication — 18 October 2026

The existing Android 17 instances, dedicated Intel Weston desktop and owned
real-Xorg VM were restored after reboot. Desktop input remains confined to the
isolated test user or the owned Xorg VM. The unrelated private llama VM was not
used. Zero-length loose Git objects left by the interruption were recovered
hash-exactly from the pushed history; full `git fsck` subsequently passed.
No working-tree reset or history replacement was performed.

The combined Linux development package at `31073761ca` passed payload/source
checks and was installed through APT. Its actual native Gecko producer remains
`05becb3ab6`; cached native bytes were not represented as a new Gecko compile.
The matching guest browser/backend, guest service and OS were also installed in
the two test containers. The Wayland Configuration menu now opens its target
through a real pointer click. Actual Xorg checks passed Start icons, search,
pin/unpin persistence, the native clipboard toolbar without an inner bar, text
copy/paste in both directions, and Observe input/clipboard restrictions.
Large, smaller and portrait Xorg viewports kept exposed background pixels at
`#202225`, with a centered proportionally fitted logo and the saved scale/pins.
These are scoped observations, not the complete Display/lifetime matrix.

Retained Android `cab1310f182` with the independently updated `31073761ca` OS
shows Start icons and the corrected wallpaper. Its first apparent rotation
failure followed an Android phantom-process trim of the Termux runtime guard.
After restoring the explicitly authorized emulator process settings, actual
Local recovery and portrait/landscape/portrait testing preserved the same
browser, backend, Pi and Display process identities. This is a modified CVD
fixture, not unchanged-default Android or physical/OEM lifetime acceptance.
Original rotation lock 0 was restored. Evidence is in the Build workspace's
`verification/os-3107/installed-termux/rotation-readiness/`.

Desktop default Qwen3.5 4B vision correctly identified the attached synthetic
red square, green circle and blue triangle through the normal chat flow.
The `3107` Local AI Generate speech UI produced the requested Pocket TTS phrase
with unchanged CPU defaults. Diagnostic CPU Parakeet transcription of that WAV
returned “Hello from Bash kitten.” Evidence includes the isolated desktop's
`default-vision-result.json` and Build
`verification/desktop-3107/wayland-generated-voice-asr.json`.

Two installed desktop failures were retained and traced. A black inner browser
was reproduced with the original guest launcher, while starting after the owned
XFCE session reached IDLE painted correctly. `1e1a9648a0` waits asynchronously
only for the canonical shipped XFCE command; custom commands keep their existing
timing and ownership. A restored-original comparison reproduced the failure;
the repaired default passed twice, and a custom non-XFCE command remained usable.
Separately, closing a Display tab preserved guest processes but reopening could
discard a retained frame after a geometry-generation change. `9d29e5ec77` keeps
one outstanding lease per frame ID; `800e6fc078` also drains the retained static
frame when receiver capacity returns. Focused native protocol/component checks
and mixed-helper installed tests are distinct from a rebuilt combined candidate.
Final combined acceptance remains required. Exact `3107` Xorg normal Quit before
helper replacement did remove the captured browser, gateway and guest identities;
active remote/publishing and force-kill/crash cases remain separate.

The normal GitHub publication run `39076145026` published testing prerelease
`v153.4.5` from exact `26ba97cd4a4f806e9457f9e2533a69fc7e045613`.
All 43 published asset hashes match the audited collector: both signed APKs,
ten DEBs and 23 source archives/parts, with complete matching source/notices.
Normal APT run `39077323994` published the verified signed nightly catalogue
using the existing signing key and the corrected case-sensitive asset selection.
This release does not include later `3107` or 18 October development fixes.
The separate signed `153.4.4` Android fixture found and downloaded the exact
published x86_64 APK through its normal update UI, then Android's installer
accepted the update. Automatic Termux reconciliation subsequently reported
“Termux command failed. Check Termux setup and retry.” This is an outstanding
installed-upgrade blocker; publication and APK installation are not a passing
backend update. The original failure is preserved under Build
`verification/android17-published-update-26ba/` for diagnosis and repaired retest.

## Isolated installed follow-up — 17 October 2026, evening

Desktop input now uses only the dedicated `bashkitten-acceptance` user, its own
systemd user manager/session bus and Intel Weston screen. The ordinary host's
BashKitten viewer is view-only; test input does not target the host keyboard,
pointer or focus. This resolves the earlier private-session systemd limitation.
The user's private llama VM remains outside the test environment.

On installed Linux `cab1310f182`, actual sidebar container creation reached
Running. The packaged Podman ran as host UID 1001 in its own user namespace,
mapping container root to UID 1001 and subordinate IDs to 165536–231071. Its
private AppArmor profile was loaded; neither the browser nor Podman ran as host
root. Display opened the actual guest desktop. Observe blocked a typed probe,
Interact accepted it, and closing/reopening the Display tab preserved the same
guest browser and draft. Manage window size Off disabled Two app mode while
retaining its saved choice; On re-enabled the control. A too-small two-app
viewport reported its constraint and is not counted as a successful split.
Evidence is under `Bashkitten-Acceptance/isolated-wayland-20261017`, including
`diagnostics/cab1-container-namespace-monitor.json` and the matching screenshots.

The Applications acceptance reference is the plan's **Applications list
reference — 15 October 2026**, superseding the older top-search/grid wording:
vertical icon/title rows, bottom search, independently scrolling lists and pins
using natural height up to 60%. The observed vertical list is expected. Icon
visibility and the complete launcher behavior remain under verification.

Two installed failures remain explicit. Display service Off reported “A display
endpoint is still in use”; On removed the error but the guest area remained
black. Native Firefox-menu Quit stopped the container service and the observed
owned Pi/AI/display/network helpers, then the browser lingered and crashed with
exit 139. No forced termination was used. The private Weston remained running.
These are not Display restart or successful Quit acceptance. The sanitized
diagnostic receipts include `cab1-before-native-quit.json` and
`cab1-after-native-quit-extended.json`; raw crash data stays private.

`26ba97cd4a` repairs the Configuration gear's native input event contract. The
normal local Linux package passed 128 payload checks, retained 2,049 full notices
and verified all 11 corresponding-source artifacts. Native Gecko bytes retain
their actual `05be` producer; no native relink was claimed. It was installed
through APT and relaunched only in the private desktop with `--purgecaches`.
Actual repaired menu interaction and startup/security traffic verification are
pending; package/source tests do not establish either. The preceding Backup and
RemoteSettings changes have 12 passing native regression cases, with seven
failures reproduced on the prior source.

Android 17 development installations now have matching `cab1310f182` APK,
Termux backend and OS packages. The retained-profile upgrade preserved the
model/router/Pi configuration hashes. On a separately cleared browser/backend
profile, ordinary setup permissions were accepted through Cuttlefish in
BashKitten, and first-run setup automatically downloaded Qwen3.5-2B-Q4_0 plus
vision projector, Parakeet v3 Q4_0, Pocket TTS plus projector/reference voice,
and their runtime/source/license records. The UI reached Ready and the generated
router explicitly selected CPU with GPU/projector/KV offload disabled. No model
settings were copied or manually seeded. Evidence:
`verification/android17-fresh-cab1/automatic-defaults-ready.json` in the Build
workspace. The subsequent installed checks below cover the starter models.
This local package setup does not replace public signed update testing.

Actual Android `d39` and Linux `cab` About flows exposed the central AI runtimes
and models license entry, original upstream attribution and full saved license
texts. Their bounded receipts do not claim every artifact/offline/traffic case.
The full GitHub matrix at `26ba97cd4a`, run `39070407786`, includes Android ARM64
and x86_64 plus both Linux architectures. Publication and signed device upgrade
remain pending artifact verification and installed acceptance. All earlier
unresolved acceptance rows remain required.

Follow-up in the same isolated session: the `26ba` Configuration row still
dismissed without opening settings on a real pointer click. Captured trusted
events stopped before any row event reached the DOM. `65f30efd8f` now uses
Firefox's existing PanelMultiView owner for popup focus and keyboard navigation;
its focused checks pass, but actual pointer/keyboard acceptance remains pending.
`a7a3735571` independently fixes the Display-stop race: a packaged gateway probe
reproduced Unix endpoint rows briefly surviving the owned process's stopped
state. Bounded asynchronous release verification retains live-endpoint and
inode/owner checks; persistent or replaced endpoints still fail. Installed
Off/On and black-viewport recovery remain pending the combined candidate.

The fresh Android CPU chat returned exactly `READY`, and actual Dictate captured
the public JFK WAV through a Cuttlefish WebRTC fixture, transcribed it correctly
with the default Parakeet and used the configured automatic-send behavior.
Native Pi history contains exactly one original prompt and one transcribed
message, using Qwen3.5-2B-Q4_0. No physical microphone was opened by the test
fixture. Evidence: `verification/android17-fresh-cab1/model-and-dictation.json`
and `native-session-proof.json`. The normal Android attachment picker then
selected a synthetic image, and the default Qwen model with its downloaded
projector correctly identified the red square, green circle and blue triangle.
Local AI's Generate speech produced “Hello from BashKitten” using the untouched
Pocket TTS CPU defaults. Independent diagnostic transcription of that generated
WAV recovered the requested phrase. Evidence: `vision-and-synthesis.json` and
`generated-voice-asr.json` in the same directory. These checks establish the
fresh defaults on Android 17 x86_64 Cuttlefish, not physical-device microphones,
GPU behavior, all Callback flows or whole-app acceptance.

A separate `26ba` native Quit returned exit 0 with the container already stopped
and no Display opened during that launch. Diagnostic logging shows all four
quit-application blockers and the later BashKitten cleanup blockers completed.
The earlier `cab` crash is specifically Gecko's AppShutdownConfirmed watchdog
inside the quit-application async shutdown phase. Its exact pending blocker was
not recoverable from that core. This narrower successful repeat does not close
the failure after active Display Off/On; that sequence must be repeated on the
combined candidate. Raw logs and core data remain private.

The later `5151ba20ce` package was installed normally in the isolated Wayland
session and the real-Xorg test VM. Configuration keyboard activation now works
on Wayland, but its actual pointer row still dismisses without opening the view.
Xorg pointer and keyboard activation work. The Wayland-specific native popup
positioning path is under investigation; no synthetic activation counts as a
repaired pointer flow. Display Off/On now reports stopped/running correctly
while preserving the container. An initial black guest-browser area on restored
Display remains a separate observed failure. Real-Xorg native Quit with Local
Off removed all 70 captured owned process identities; this pass had no active
remote connections or publishing and does not close those lifetime cases.

Start menu rows lacked icons because the guest did not have the optional Python
Cairo bridge used by the image conversion. `3cf1855cb1` sends the asynchronously
loaded image directly through GTK's icon API. Real GTK component checks cover
1×/2× scale, themed/file/default icons, drawing and cancellation. Installed OS
package verification is pending. Default wallpaper asset/render checks passed;
actual installed logo visibility remains under inspection without changing saved
wallpaper choices.

The full CI artifact audit at `26ba97cd4a` verified all ten DEBs and the signed
ARM64 APK with its exact Termux/OS pair. It found the APT repository's
case-sensitive asset filter omitted both `BashKittenOS` DEBs. APT commit
`d00a8c8e984f2698b073e702b59dafb6021e9dee` changes only that source's pattern;
normal selection-loop checks now include all ten packages in stable and nightly.
No publication or signed device upgrade is claimed by this artifact check.

## First-run defaults and isolated desktop testing — 17 October 2026

The empty desktop AI inventory came from the preserved 11 October acceptance
profile, which already contained Local AI configuration and was correctly excluded
from fresh enrollment. That was not valid fresh-install acceptance. A genuinely
new browser/backend profile on the installed `bab3f4eba8` candidate automatically
downloaded both runtimes and the Qwen3.5 4B vision, Parakeet and Pocket TTS presets
in 40.944 seconds, including projector/reference-voice assets. All three engines
were configured for CPU and stock Pi's saved default selected Qwen. Evidence:
`verification/desktop-first-run-20261017/automatic-download-complete.json` in the
separate Build workspace. This establishes automatic setup, not completed chat,
vision or speech acceptance.

The installed test exposed two UI regressions: stale removed license-control
references stopped the Local AI form from rendering, and closing setup left the
new-chat model selector stale until a later focus refresh. `430cdb8167` removes
the obsolete references; `f6fae59cc3` refreshes through the existing protected
navigation path while preserving explicit choices. The full renderer's 159 cases
and 14 default-refresh groups pass. The normal Linux `f6fae59cc3` package was
installed with the completed model/router/Pi configuration hashes unchanged;
installed repaired-flow acceptance remains pending.

A second fresh backend under the same home exposed a separate collision in the
old implicit `~/models` destination. `d39ae27680` initializes the existing model
settings store to that fresh backend's own `models/files` directory. Existing
settings, custom destinations, previous jobs and failed/cancelled setup are not
retrospectively changed. Nine filesystem scenarios, five enrollment cases and
twelve configuration checks pass, including independent data directories, save
races and the owned destination outside home. The actual failed setup is retained
and a new installed fresh-profile run is required after packaging this fix.

At the user's request, desktop UI automation is moving to an isolated Intel
Wayland screen with a view-only browser viewer; no host keyboard, pointer or focus
injection is permitted for these tests. Cuttlefish interaction remains through
the desktop BashKitten browser. Weston and the private test browser were verified
against Intel `renderD128`, with no NVIDIA device/library use. The first private
session lacked the systemd user manager needed for containers; that is an
unresolved test-environment limitation, not a container acceptance pass. Its
viewer also exposed an inherited handshake timeout causing idle disconnects;
the external test helper was corrected and automatic reconnection added. These
environment records do not replace real-Xorg or full container acceptance.

## Compact phone layout and installed follow-up — 17 October 2026

The normal Android upgrade to local candidate `e226372894` installed its matching
backend and OS package while preserving the existing model/router/Pi settings.
Installed Cuttlefish acceptance through the desktop BashKitten browser confirms
the `bba43be57d` composer correction at 411- and 360-CSS-pixel widths, both with
the keyboard open and closed: attachment, model, reasoning, Agents, Phone,
dictation and Send occupy one row, with roughly 2-CSS-pixel gaps, no overlap and
no reserved spacer. The closed model truncates; the native dropdown shows its
complete name. Original device density was restored. Evidence:
`verification/composer-installed-single-row-20261017/installed-result.json`.

Cold notification navigation also passes on this candidate. After selecting a
different stopped chat, the test killed only the verified Android browser main
process and tapped the actual COMPACT READY notification. It opened the original
Messages chat without the previous false "Chat is unavailable" error; Pi stayed
stopped, and the native history retained exactly seven user messages. Evidence:
`verification/notification-cold-e226-20261017/installed-result.json`. The preceding
local-model reply completed normally: 19.2 seconds loading, then 162.5 seconds CPU
inference for the existing long conversation, not a readiness/control deadlock.
See `verification/llama-readiness-e226-20261017/verification.json`.

The independently built Linux OS package at `48f0d3c73f` passes the actual real-Xorg
third-main-window regression without manually reactivating the window. A newly
launched Terminal maximizes and removes the existing split; a native modal file
chooser instead preserves that split and its divider. Normal APT installation
and native Display Off/On loaded the new OS session; the guest browser/backend
remain `c1826669d1`. Light appearance, 125% scale, management/two-app preferences
and pins were preserved. Existing chooser-size and initial split-constraint
observations remain in the receipt rather than being hidden. Evidence:
`acceptance/xorg-vm-control/candidate-os48f-xorg-window-management.json`.

These are specific installed passes, not whole-plan or final release acceptance.
The local `e226372894` source collector failed its stale retained Search binding;
`a07059facf` repairs that binding and its normal GitHub source collector and both
Search builds pass. No collector bypass makes the earlier candidate releasable.
The later license centralization and attribution changes still require their
combined installed candidate and final public artifact verification.

## Reboot recovery, update channels and resumed acceptance — 17 October 2026

The existing Wayland desktop, Android 17 Cuttlefish instances and owned real-Xorg
test VM were restored after the host reboot. Installed acceptance below uses
`c1826669d1`, including its matching Android/Termux packages and retained test
profiles. The user's separate private llama VM was not used. Historical setup
and candidate records remain historical; this recovery does not establish a
whole-app acceptance pass.

Android now has the persisted **Include pre-releases (nightly)** Updates control
in `8b94712f24`. Stable excludes prerelease APKs; either choice only offers newer
APK version codes. Managed APT transactions follow the selected signed channel
while retaining the installed APK's exact backend/OS versions and repair path.
The shared signing key, user APT configuration and model/Pi settings are retained.
Java compilation, renderer behavior and signed isolated APT simulations passed,
including switching channels, preserving exact nightly packages under Stable,
repairing an incompatible external package upgrade and preserving unrelated
preferences. Installed channel/update acceptance remains pending. Component
evidence: `acceptance/update-channels-20261017/verification.json` in the separate
Build workspace.

On installed Android 17, the saved TTS CPU-thread control was set to two through
Local AI. Actual native calls through the desktop BashKitten Cuttlefish UI passed
dictation/read-back, Add more preserving both segments, Change replacing the
draft, `#` completion, explicit Send and hangup preserving active Pi. The final
native chat and Pi history contain exactly one revised user message. The test
turn was then stopped normally. Input was the public JFK fixture through WebRTC;
no physical-microphone, OEM or Android Auto acceptance is inferred. One attempt
lost its synthetic input and is explicitly excluded. Successful recovery left
an obsolete no-speech notice visible; `7eac3fe544` clears only the captured
same-call error after successful transcription, preserving newer/other failures.
Actual Java compilation and race/ownership checks pass; installed retest remains.
Evidence: `verification/callback-c182-20261017/installed-result.json`.

Installed Xorg passes the selected-container reconnect after publishing startup,
guest-only browser Quit/relaunch, and Display tab close/reopen cases. Container
text, ODT-to-native-PDF and XLSX-grid previews pass. Killing only the positively
identified Display renderer preserved the other 87 captured owned process
identities, Pi completed its requested final, and reopening created a new
renderer against the same guest. The apparent disabled-download confirmation
was caused by the screenshot helper activating the parent browser. With dialog
focus preserved, both Files Download and preview Download raw saved the expected
39-byte file with the correct hash; no product change or focus-protection bypass
was needed. Receipts: `acceptance/xorg-vm-control/candidate-c182-xorg-resume.json`,
`candidate-c182-xorg-files-renderer.json`, and
`acceptance/c182-download-focus-20261017/verification.json`.

The normal GitHub prerelease candidate at `8b94712f24` encountered two removed
Termux dependency URLs before Node assembly. `75ee892b1c` replaces only those
URLs with an officially listed mirror; all original package hashes, versions,
source and license inputs remain unchanged and passed an empty-cache fetch.
`fdaa823c46` splits oversized corresponding-source release archives into verified
parts without dropping source, and `b6ad9dcdbb` avoids duplicate artifact download
and staging bytes. The next complete candidate must include these repairs and
the call-notice fix. Publication, signed nightly APT verification and installed
normal update/pairing/recovery flows remain required; dispatch and component
passes are not release or full-feature acceptance.

Follow-up checks installed the matched development APK/backend/OS at `07ee98d8c4`
on Android 17. Stable and Nightly checks completed through Updates, retained the
exact installed package pair and allowed closing/reopening settings during package
work. A normal package update installed ten dependencies successfully, but left
the old available-update count visible. `1c0ef98b3c` clears that stale result before
maintenance and recomputes it afterwards without another network refresh; syntax
and actual-function success/failure/cancellation checks pass. Its installed retest
remains pending. Existing model/router/Pi configuration hashes were unchanged by
the APK/backend upgrade. Public-release download/install and interrupted-update
recovery remain separate pending acceptance cases.

Replyable notifications on `c1826669d1` passed background final delivery, native
RemoteInput reply to the same session exactly once, and a further reply/final
with Calls Off and Messages On. The small local model's final wording in the last
case differed from the exact-output request; this is retained in the receipt.
Tapping a notification body did not open its chat. `94def3bd8a` adds an immutable
event-specific Activity intent and reuses the protected sidecar's exact saved
backend/chat navigation, with registration/revocation and delayed-selection
checks. Java/Kotlin compilation and 26 focused checks pass; installed tap tests
are pending. Evidence: `verification/callback-c182-20261017/notification-installed-result.json`
and `verification/notification-open-20261017/verification.json`.

The user's further mobile composer correction is in `c2c873a131`: compact closed
model selection with full native dropdown labels, grouped responsive rows and
visible send controls. Forty-four Chromium/Firefox layout cases and selection
checks pass; installed mobile visual acceptance remains pending. No model IDs,
provider choices or settings were changed. Evidence:
`verification/composer-polish-20261017/verification.json`.

A separate clean Android 17 instance now has the production-signed public
153.4.4 APK and its public signed Termux backend, installed using the app's exact
onboarding command. An initial ADB run-as Perl execution-context failure was
corrected by running the same command through Termux's own documented service;
that setup-method failure is preserved, not counted as a product failure. The
normal bootstrap completed successfully and returned to BashKitten. Its old
backend has the new APK updater's required installed APIs. This is the baseline
for the real published upgrade, not an update acceptance claim. Evidence:
`acceptance/production-update-20261017/public15344-bootstrap-installation.json`.
The final prerelease must include both signed Android ABIs, their matching native
packages and signed APT catalogues, all Linux packages and corresponding sources.
Superseded queued/redundant builds were cancelled while useful native producers
were retained; a successful partial job is not publication.

The subsequent matched development candidate `f727109a91` passed the installed
Updates refresh/recheck: both operations completed, the obsolete ten-update count
became zero, Nightly remained selected and the page retained the exact-package
match. Normal production-signed APK upgrade and interruption recovery remain
pending on the separate 153.4.4 baseline. Evidence:
`verification/update-channels-f727-20261017/installed-result.json`.

Notification body tapping on that candidate passed with an existing Activity:
the original chat opened, its stopped Pi stayed stopped and its five user messages
remained five. A cold-process test exposed a startup race: the original six-message
history was restored without a duplicate turn, but navigation checked its target
before the initial chat catalogue loaded and left a false unavailable error.
This is a failed cold-tap case, not acceptance. `0c7b7fc022` waits for the
coalesced initial catalogue before native navigation reports readiness, with
the existing authentication/selection rechecks. Nine production-function
scenarios and 33 compiled native-method assertions pass; installed warm/cold
retesting remains required. Evidence:
`verification/notification-open-f727-20261017/installed-result.json`.
Component receipt: `verification/notification-cold-ready-20261017/verification.json`.
`2f1711a1c1` separately prevents saved Callback configuration from trying to
synchronize through a transport that has never been requested to start; requested
connection failures remain visible. Its installed check is still required.

The user rejected `c2c873a131`'s forced two-row composer and reserved spacing.
`bba43be57d` supersedes it with one compact row on normal phone widths, shortening
the closed model label while preserving full native dropdown options. The exact
markup/style passed 162 Firefox and 162 Chromium cases, including all delivery
modes, short views and unchanged selection behavior. These are component checks;
the installed `f727109a91` still has the rejected layout. Evidence:
`verification/composer-single-row-20261017/verification.json`.

An independent actual-artifact license audit identified seven concrete gaps:
URL-only Android notices, omitted X11 legal preambles, an invalid ICU notice,
missing PeGPU text, incomplete libfuse and siphasher grants, and missing exact
AppServices native source. `79b9b8df28`, `2c1a392ead`, `e42d5c91c1` and
`7cded0d31b` repair those source/collector paths. Independent recheck preserved
all 2,014 original Android entries, resolved all 447 URL-only notices, verified
the missing full grants and all selected Pixman assembly/XKB grammar notices,
and verified 666 committed native-source inputs with the actual APK libraries.
The native source closure retains 617 registry packages and four Git sources;
that inventory also includes build/test/other-target inputs, not a claim that
all are linked. Existing APKs remain historical and must not be published as
repaired. The final artifacts must regenerate the inventories and corresponding
sources, then pass actual-package and offline-view checks. Evidence:
`verification/license-recheck-e42d-20261017/verification.json`.

`12930558ff` includes downloaded runtimes' separate Android NDK notices.
`101504de71` transfers complete runtime records through the existing private
Termux command using bounded responses and revision checks, with asynchronous
assembly and cancellation when settings close. This addresses the measured
runtime notice exceeding Termux's individual-result limit; it imposes no document
size quota and leaves desktop records complete. Seven backend check groups,
209 Java assertions and complete Activity compilation pass. Actual installed
notice viewing remains required. Evidence:
`verification/runtime-record-chunks-20261017/`.

The full GitHub candidate at `e226372894` caught a stale retained Termux Search
lock binding after the siphasher legal-source additions. Both Search architecture
jobs rejected it before compilation. The repair updates only that inventory's
lock digest; the framework commit/archive hash, runtime versions and strict
verification remain unchanged. The exact workflow extraction passes locally;
an independent check found the other ten retained lock bindings current. Keep
useful completed producer outputs/caches, then run the corrected full matrix.
The failed run is `39060987072`; it is not a publishable candidate.

## Cross-feature corrections and full-scope review — 15 October 2026

The subsequent integration-fix batch includes `65500cd704` (independent Display
readiness and complete owned-container cleanup), `ddeecebf0c` (background service
Stop while Local is Off), `7e993117d4` (nonblocking launcher helpers and bounded
search rendering), `df19cde51d` (speech cancellation ownership and unrestricted
model/projector selections), `a58b765838` (queued browser command delivery,
cancelled-copy cleanup and Parakeet startup), `03fc2d075b` (bounded native Display
teardown), `990daffb18` (authenticated remote phone settings), `46e45380a6`
(user-owned Pi providers and durable Stop/question semantics), `5d902a22ac`
(embedded Display cache invalidation), and `5c8c950062` (phone lifecycle,
delivery acknowledgements, ringing deduplication and grant/share revocation).
Focused source/component checks pass and remain in the external verification
workspace. These commits require a combined build and installed acceptance;
the changed native Display module must actually be recompiled and linked.

Fresh Android 17 CVD03 completed first-use setup on the earlier `e7f74f5fa8`
candidate through the installed desktop BashKitten Cuttlefish UI. Qwen3.5-2B-Q4_0
was selected automatically, reasoning was Off, and a first chat requesting
`READY` returned `READY`. Saved llama, speech-recognition and synthesis backend
preferences are all CPU. Evidence: `verification/android17-fresh-e7f7/first-use-result.json`.
This establishes starter downloads/default selection/first chat, not speech,
vision, cancel/resume, or acceptance of the later corrections above.

The bounded review reports preserve exact scopes and uncovered areas under
`verification/whole-spec-audit-20261015/`. Broad review work has ended; confirmed
repairs, combined builds and installed cases are the current work. The legacy
pre-ownership container service's restart message and stale current-architecture
documentation remain recorded follow-ups; they are not silently marked fixed.

The authenticated Android remote Send attempt under a saved project failed with
Files Off: the session-creation route incorrectly required file-manager permission
when `projectId` was present. The draft was retained and no Pi turn was accepted.
Commit `3540cfb3d9` removes that unrelated gate; ordinary remote authentication,
saved project directory validation and file-manager authorization remain intact.
The publisher's Files permission is Off for the required installed retest. Source
checks reproduce the old failure and verify project/standalone chat creation,
attachments, image responses, metadata operations and message handling separately
from the file-manager policy. These checks do not establish installed acceptance.
Evidence: `verification/remote-chat-files-off-20261015/` in the Build workspace.

Commit `58bc423622` fixes the shared New chat button passing its DOM event as a
project ID, keeps saved/project working-folder controls consistent when Files
policy events arrive, and restores the desktop remote heading's requested Connect
to phone action through its existing settings owner. Commit `9b28ec63e7` removes
two unused development deletion aliases while retaining the used session-group
route and its confirmation checks. No new permission, transport or compatibility
path was introduced. Installed verification remains required.

Both frozen `e7f74f5fa8` builds passed package/source checks: Linux in 7m56s and
Android in 10m39s (Gradle 6m34s). They include the preceding sizing/Display repairs,
but predate the three corrections above. Their exact handoffs are
`verification/desktop-e7f7/handoff.json` and
`verification/android-termux-handoff-e7f7.json`; they are development candidates.

The user's full-code/full-plan review request is being tracked separately under
`verification/whole-spec-audit-20261015/`. A path inventory or search hit is not
read coverage; truncated output does not count as a completed read. Findings
must map to the immutable baseline plus authorized amendments, actual code paths,
and installed verification. The app is not yet verified against the whole scope;
all unfinished mandatory requirements below remain open.

## Phone desktop sizing and Applications list — 15 October 2026

Source `1e9dd194ad` implements the latest layout amendments: a shared vertical
icon/name list, independent alphabetical and pinned scrolling, fixed bottom
search, and natural pinned height capped at 60% of list space. Taskbar button
frames are removed. First-use Termux selects 300% with touch-sized window
controls; container desktops retain 100%. Existing saved choices and the separate
Termux:X11 profile are preserved.

Installed ea7c diagnosis exposed two concrete defects: loaded launcher icons
were scaled twice, and generated 2x/3x XPM themes lacked their format header and
failed the actual Termux image decoder. Both are repaired in the source above.
Thirteen preservation checks, six real GTK geometry/filter/activation cases,
all generated XPM decoding, and an isolated Xfwm rendering check pass. The latter
reports positive 126-pixel title height and 126-pixel touch-button surfaces at 3x.
Evidence: `verification/os-first-use-scale-20261015.json` and
`verification/termux-scale-20261015/`. These component checks do not establish
installed mobile/desktop acceptance; the next matched package batch is required.

The real Android17 ea7c encrypted remote retry now passes QR import, connection
password, Authelia username/password/TOTP and consent, and displays the retained
Xorg guest's actual Agent history through the connected remote. The prior SOCKS
TTL timeout did not recur. Publisher identity/account remain unchanged and remote
file-manager permission remains Off. Evidence:
`verification/remote-route-20261014/android17-ea7c-authenticated-route.json` and
`xorg-ea7c-publisher-readiness.json` in the same directory. New requests, file
permission/revocation, phone registration and remaining route cases are still
open; the retained guest is an older candidate and needs later matched coverage.

## Installed ea7c candidate and remaining repairs — 15 October 2026

Matched `ea7cf13ac4df05aeb277c1d4dce412da9092286c` development packages are
installed on the Wayland host, real Xorg test VM and Android 16/17, including the
separate fresh Android 17 instance. Matching build/source/license receipts are
`verification/desktop-ea7c/handoff.json`,
`verification/android-termux-handoff-ea7c.json`,
`verification/source-release-ea7c.json` and
`verification/source-release-android-ea7c.json` in the external Build workspace.
The Android release build took 6m15s; unchanged native producer identities and
bytes remain recorded separately. Both existing Android profiles retain identical
Local AI config, router INI and Pi settings hashes after the package upgrade.
These are development-signed packages, not a completed production release.

Installed Wayland Autostart now passes the reported stale-notice case: a missing
executable added through the UI produces a nonblocking error, and both disabling
it and removing it clear that notice immediately without restarting the browser.
A separate custom program added using the documented installed
`bashkittenctl autostart-status` / `autostart-save --stdin` interface appears in
the same settings UI and starts with the exact configured folder/environment.
Normal native Quit removes all 25 captured process identities, including its
parent and child; abruptly killing the test browser removes all 30 identities in
that run. Removing the live command through the UI also ends its parent/child.
All fixture entries were removed, the saved command list is empty, and no fixture
process remains. Evidence: `verification/autostart-ea7c/installed-result.json`.
This closes these targeted desktop cases, not the full cross-platform lifecycle
matrix or unrelated service tests.

The installed Android Display icons are visible in light and dark mode, including
the unchecked Observe icon. Evidence is under `verification/android17-ea7c/`.
The fresh Android profile selects `bashkitten-llama` / `Qwen3.5-2B-Q4_0` without a
manual model choice, but its protected UI exposed a missed counterpart in the
draft-path repair: Java generated the bounded identity hash while Gecko still
validated the old raw fingerprint/UUID name. Commit `a7f714b996` uses the same
SHA-256 derivation in Gecko. Eleven checks using the extracted actual Java and
Gecko methods verify acceptance and rejection boundaries; installed acceptance
is still pending. No identity/cookie checks or transport requirements were relaxed.
Fresh setup and model cancellation/resume must be repeated after that repair.

Real Xorg testing confirms saved guest Agent Off survives container restart while
Display reaches generation-verified readiness without a browser channel. The
minimized ordinary-window target now restores directly through Two app mode;
settled geometry and the complete application-action matrix are still being
checked. Actual Thunar package installation reaches guest APT normally; installing
a development package with the same version correctly reports no version upgrade,
so actual new guest bytes were subsequently installed through normal APT reinstall
before testing. Exact receipts remain under `acceptance/xorg-vm-control/`.

Xorg restart exposed saved Display tabs appearing beneath Agent or as raw chrome
pages when their container stayed stopped. Commit `a662d27d4a` preserves native
tab presentation through asynchronous restore and unavailable backends, respects
subsequent user navigation, and reconnects only from a current verified descriptor.
Observe mode and close/open semantics stay unchanged. Fourteen focused check
groups pass; installed restoration/recovery remains pending.

The earlier remote PAR error was a Tor SOCKS reply `TTL expired`, emitted before
successful PAR issuance. Pinned source maps it to connection timeout; existing
evidence cannot distinguish circuit trouble from publisher availability. It is
not evidence that OAuth PAR lifetime should be changed. No speculative retry,
authentication change or transport fallback was introduced. The normal encrypted
route needs a fresh UI run with time-correlated availability evidence; see
`verification/remote-route-20261014/ttl-source-diagnosis-20261015.json`.
All other incomplete requirements in the registers below remain mandatory.

## Installed efe9 candidate and acceptance follow-ups — 14 October 2026

Matched `efe9f7444a1a96ea841922016f9db147e799a469` packages are now installed
on the Wayland host, the real Xorg test VM and Android 16/17. Build and matching
source receipts are `verification/desktop-efe9/handoff.json`,
`verification/android-termux-handoff-efe9.json`, `verification/source-release-efe9.json`
and `verification/source-release-android-efe9.json` in the separate Build workspace.
The Android build took 5m38s; unchanged native inputs retain their actual producer
identities. These are local development candidates, not publisher-signed releases.

Installed desktop Configuration omits phone-only controls, opens within the
window, and scrolls to General settings in the Xorg test's 640 × 180 window.
The compact desktop project picker and initial Display toolbar now pass after
purging the reused development browser's startup cache. The release packaging
already requires increasing application versions; no native build identity was
forged to refresh development chrome. An actual 500-pixel desktop composer keeps
its controls visible; Android's portrait composer wraps and its landscape
Configuration scrolls to the final General entry, which opens successfully.
Existing Local AI, router and Pi settings remain byte-identical after normal
upgrades/startup on both Android versions and the Wayland host. Genuine first-run
Local AI setup is a separate pending test on a fresh Android 17 instance.

The earlier single UI Send of Android 16's held sibling message was checked in
stock Pi history after settling: exactly one matching user entry exists, with a
later assistant completion. No resend was performed. Android 17's repaired
clipboard now accepts the native launch-command text copied before Display
reattachment. A repeated Observe → Interact cycle also passes: Observe retains
the desktop clipboard, then actual viewport Clear/Paste imports the distinct native
Copy prompt after Interact. Clipboard preference-Off and in-flight races remain
separate gates. The installed Android Display toolbar exposed black pencil/gear
icons in dark mode; `e9f27eca18` applies the existing native theme color to those
and unchecked toggles, pending installed retest.

Actual host Autostart testing ran an enabled command once with its saved working
folder/environment, kept its child alive across window Close, left a disabled
command unstarted, and reported a deliberately missing executable without
blocking the UI. All three fixtures were removed through Autostart. The missing
executable's old sidebar error nevertheless remained: commit `aaaab242b2` retires
obsolete command errors and refreshes only that owned notice. It also supplies
agents concise guidance for the existing config/controller interface. This repair
has focused checks; its installed retest is pending, and the fixture's natural
exit does not establish custom-command Quit/crash cleanup.

Xorg testing exposed another startup issue: a saved guest Agent Off was overridden
by session startup, and readiness always required an Agent browser channel.
Commit `2f9c9e5803` preserves the saved choice, permits generation-verified Display
readiness with Agent Off, and keeps the managed guest's existing private controller
available after Agent Stop. Explicit shutdown/container lifetime cleanup remains.
Focused readiness/lifetime checks pass; installed retests are pending. The observed
Agent On/browser-readiness timeout is still unresolved and must not be declared
fixed by the Agent Off changes. An old retained guest lacked its expected Thunar
package action; upgrading that guest through its package manager is maintenance,
not acceptance of the missing action.

The same Xorg test isolated a minimized target whose window manager temporarily
removes resize/maximize actions. Manual restoration followed by Two app mode
passes. Commit `cb862d879e` restores before checking those actions and preserves
normal size/type exclusions; 17 focused checks pass, installed retest pending.
A retained guest predating the corrected image recipe has root-owned `.local`
parents, blocking AppImage registration. The fresh guest has correct ownership.
Official extract-and-run from an original filename containing spaces and `%`
opens the real application, but the complete Thunar/Start registration flow remains
open. No global ownership repair or compatibility fallback was added.

The live Termux Pi worker also lacked its current owned desktop-context path.
Commit `79ee5a8503` supplies that path for Termux workers, preserves the managed
container context and strips it for ordinary hosts. Existing helper validation
still checks generation and process identity on each use; installed worker
verification remains pending.

A separate fresh Android 17 test launcher initially used generated userdata as
its own input and lost a synthetic marker on restart. The launcher now uses a
stable input image outside assembler output; a new marker survived two scoped
stop/start cycles with native KVM, 16 GiB RAM and 128 GiB storage. No application
profiles existed during this repair. This is test-environment evidence, not a
BashKitten feature pass. The user's private llama VM remains untouched.

Fresh Android 17 first-run setup now downloaded the published Vulkan-capable
runtimes and all pinned Qwen 2B vision, Parakeet and Pocket TTS weights. The UI
reported Ready, the CPU router ran, and all five installed weight/projector files
matched their pinned hashes with offline notices/source records present. This
does not establish inference, cancellation/resume or the full published installer
flow: exact candidate packages and the installer’s final Termux bridge setup were
prepared with authorized ADB; native permission/enrollment and setup were exercised
through the desktop BashKitten Cuttlefish UI. Stop setup was not accepted as tested
because the moving progress layout and quick completion prevented a confirmed stop.

The first fresh composer nevertheless had no default model: normal Pi package
registration created settings.json between enrollment and download completion.
Commit `cb741e34a9` seeds the pinned default once before that registration, keeping
existing-file, explicit-value and durable once-only guards. Later downloads and
updates never reseed a cleared selection. Focused actual-Pi checks pass; a fresh
installed retest remains required. A separate generic draft database error was
traced to the local context being hex-encoded into a 316-byte quota directory
component. The app-level identity hash now bounds it to 242 bytes, retaining full
identity separation and scoped cleanup without Gecko core changes. Source and
filesystem checks pass; installed draft persistence remains pending. See
`verification/android17-fresh-efe9` and
`verification/android17-draft-context-20261015`.

Detailed current observations are under `verification/desktop-efe9`,
`verification/android17-efe9`, `verification/android16-efe9`,
`verification/autostart-status-20261014`,
`verification/container-display-only-20261014` and `acceptance/xorg-vm-control`.
The container desktop also exposed its single-client private Wayland gateway to
ordinary XFCE/Firefox children. Actual historical guest logs show Firefox trying
that endpoint and falling back to X11. The guest session now passes that endpoint
only to Xwayland and removes inherited Wayland endpoint variables from GUI/activation
environments. Isolated production-coroutine checks pass. This corrects the X11
launch environment but does not prove the separate Agent On timeout resolved.

The complete register below, immutable original and all authorized amendments
remain required; the unresolved remote, call/audio, permissions, rendering,
lifecycle, first-run and release gates remain open.

## Installed repair candidate and remaining blockers — 14 October 2026

Candidate `a947f076b18e5c7f89869f8bd29c8997867167b6` is installed on the
Wayland host, real Xorg test VM and Android 16/17. Its immutable package/source receipts are
`verification/desktop-a947/handoff.json` and
`verification/android-termux-handoff-a947.json` in the Build workspace.
The Android release build completed in 7m27s. Unchanged native components retain
their actual producer identities, verified against their source and bytes.

Actual desktop testing now passes the Tor notice's visibility, ordinary-tab
isolation and dismissal. Android's compact project picker fits with its keyboard
open. The desktop picker still stretched vertically and compressed folder rows:
the next repair restores intrinsic dialog height and content-height list rows.
An initial desktop Display toolbar disappearance was traced to Firefox moving
the native control into its overflow list. The next repair keeps that control
in the toolbar; its initial installed appearance still requires verification.
Neither result is accepted from source checks alone.

Android 16's real subagent test produced one attributed child report. Stopping
the parent while its child was working held the later child result as a draft
without resuming the parent. That held state survived the matched update, and
explicit Send delivered the child report exactly once. A separate 120-second
question expiry delivered one timeout and one later attributed user follow-up.
Android 17's clipboard copied before Display
reattachment still requires repair and installed verification; Observe and the
clipboard preference must continue to gate both directions.

The same repair batch now includes cold-model reasoning preservation, Android's
private-settings native theme, extracted AppImage launch environment and explicit
restoration of a minimized second split-window target. Actual contact-editor
testing also exposed a synthesized Phone row that Android reduced to cellular
digits; the next candidate keeps only the authorized SIP address row. These have focused source
checks; installed retests remain pending. The settled Xorg wallpaper shows its
complete logo, so an earlier resize screenshot is not proof of persistent clipping.

The user's first-run Local AI amendment is integrated for the next combined
build: published runtime downloads, curated pinned Qwen vision and small speech
models, CPU defaults with a quick GPU choice, retained advanced settings and
offline notices for fetched weights. Existing and concurrently edited settings
must be preserved. GGML/llama.cpp and Unsloth are preferred model sources where
available. The user selected Parakeet TDT v3 0.6B Q4_0 as the default transcription model;
Whisper remains an optional smaller download. A genuinely fresh setup and existing-configuration preservation are
additional installed gates, not replacements for the complete register below.

A scoped native Xorg browser-crash check stopped all 136 recorded owned process
identities within 10.8 seconds. This does not cover unrelated workloads or every
other lifecycle case. The initial independent Observe/Pi test was inconclusive
after model tool-use errors and a confirmed global OOM in the 8 GiB test VM.
Only that owned Xorg VM was increased to 16 GiB, retaining its identity, disks,
four CPUs and existing profiles; the user's private llama VM was not touched.
The subsequent real Pi input test passed: the agent typed into the guest terminal
while Observe was enabled, and local viewer typing remained blocked. Guest tray
Stop also left its container and Display running while stopping that guest Agent.

The next batch additionally restores Display tab ownership using stock Firefox
session metadata containing only a stable container ID and its input mode. It
waits for an already-authorized startup, obtains fresh private connection details,
and never starts an Off container or Display itself. A new-chat composer refreshes
its model choices on return from setup without polling or replacing an explicit
user selection. Both changes have focused source checks; installed verification
remains required.

Android 17's normal calling-account setup and SIP contact connection passed.
Speech readback, transcription, confirmation and delivery remain unverified.
Android 16 additionally passed stopped-peer message holding and explicit follow-up
without releasing the older held message; the final held-message Send still
requires verification before another send is attempted.

The complete feature register below remains mandatory. These are scoped
installed results, not completion of the broader call/audio, permissions,
startup, rendering, remote, lifecycle or release acceptance obligations.

The composer now allows its controls to wrap instead of compressing every
dropdown onto one row. Exact production markup and styles rendered in installed
BashKitten passed 280, 320, 360, 420, 780 and 1280 px viewport checks: two rows on
the narrow cases, one on the wider cases, and no control outside the viewport.
Both native Configuration menus already inherit Firefox's bounded scrolling;
no menu styling was changed. Installed narrow-window menu scrolling remains an
acceptance check, distinct from this source inspection and composer fixture.

Configuration now omits desktop Callback and Notifications, which only showed
phone registration status rather than desktop controls, and desktop-only phone
connection shortcuts are removed. Android retains its phone controls. Local AI,
Display setup and Performance entries are shown only where their selected backend
supports those controls. The desktop Configuration popup now opens after the
button's starting edge and uses Firefox's native constraint rectangle to stay
inside its owning window. Installed popup placement and small-window scrolling
still need verification in the next candidate.

The desktop chat's Phone selector is hidden unless its backend reports a recent
phone connection with Calls or Messages enabled. The existing session refresh
updates that capability; hiding the selector never clears saved chat delivery
choices. Android retains its phone selector. Fresh Local AI enrollment also
records whether Pi settings existed and makes its default-model decision only
once. Existing, explicitly unset and subsequently changed Pi choices are kept
across setup resume and app updates. Installed fresh-setup and upgrade tests
remain required for these guards.

## Installed combined candidate and acceptance repairs — 14 October 2026

Combined source `e31a4c30ac5df7d226c32d4b915c5923b7e7acfa` was built and
installed on the Wayland host, real Xorg test VM and Android 16/17. The Linux
native build took 6m30s and the Android release build 6m27s. Package identities,
matching Termux backend/OS, actual native producers, private loader permissions
and full source/notices were checked. Installation is not full acceptance.

Actual Android 17 checks now cover simultaneous embedded and standalone
Termux:X11, independent service stops, tab close/reopen, held-key release on
Observe, blocked viewer input with continued rendering, viewport resize on
rotation and Follow device appearance. Independent agent input and the remaining
IME/clipboard cases are separate checks. Android 16's saved question answer and
dismissal now display readable attribution without rewriting native Pi history.
Real question delivery and agent-tool tests continue. Small-model instruction
failures are recorded separately from product failures.

In the Xorg container, real Pi final-message file citations opened Python and
Markdown previews, including names with spaces, Unicode and punctuation.
UTF-16/BOM/raw Markdown and unsupported-file downloads matched their originals;
the 2,000-row Markdown table retained its last row and horizontal scrolling while
ordinary tabs remained responsive. Guest Files still denied a host-only path.
These cases do not stand in for the remaining formats, nested content or remotes.

Installed testing and the full-plan review found defects for the next combined
candidate: the native Display and Tor notices used unsupported owner-window
references; Android protected settings lacked the existing native select handler;
the complete fresh guest package list also needs the matching official ATK
introspection backport. The normal retained guest upgrade with that dependency
succeeded, while fresh creation reproduced the uncorrected recipe failure.
Container Display now has its own saved startup choice in both container settings
and unified Autostart; starting the Agent with that choice Off does not require
a guest browser. Toolbar On/Off remains the current service control.

The same repair batch covers correct chat targeting and scoped withdrawal for
queued call events, bounded spoken choices with invalid-option clarification,
and preserves the primary startup error while attempting all
owned cleanup steps. The first retained-container autostart timeout's exact cause
is still unconfirmed; a second normal Start succeeded in three seconds. Source
diagnostic improvements are not proof that this intermittent cause is resolved.

The user's additional project-dialog requirement is part of this implementation:
compact, content-sized Project name and folder selection, Create underneath,
header close button, existing styling, and bounded scrolling on small screens.
No large empty folder panel or fixed modal height. Both platform changes require
installed visual verification in the next combined build.

Bounded payload-free observations on the installed candidate found local
inference connections on Android 16 and no decoded external destination on
Android 17. Desktop observations included DNS/WebRTC route-related events whose
complete attribution remains unverified. Startup gaps and unconnected UDP mean
these checks do not close the full no-telemetry gate. Detailed evidence is in
`verification/desktop-e31a`, `verification/android16-e31a`,
`verification/android17-e31a`, `verification/android17-display-next`,
`verification/network-observer/installed-e31-observation-20261014.json` and
`acceptance/xorg-vm-control`, outside the repository. The complete register below
continues to apply; the immutable requirements baseline remains untouched.

## Restart and pre-build checkpoint — 14 October 2026

The Data drive and existing Android 16/17 Cuttlefish environments are restored.
Both retain the exact installed `656abcd94b` APK/backend; native KVM, 16 GiB RAM,
128 GiB userdata and the 1080 × 2400 viewport were verified. The separate real
Xorg test VM is available. The user's private llama VM is excluded from all
implementation and test operations. The host browser currently uses its existing
profile for ordinary Cuttlefish tabs; a second-profile launch was refused by the
product's single-profile launcher and is not claimed as a separate test instance.

The next combined candidate adds actual Display service controls and Interact /
Observe on both platforms, isolated embedded Termux X11 configuration, independent
Linux guest Agent and Display lifetimes, the editable guest Display command,
ordinary Markdown file citations using the existing View/Download route, cleaner
question delivery attribution, the Tor privacy notice, and Follow device theme
synchronization. It also includes the interrupted call-menu/speech readiness fixes
(`bff3c1b126`), complete guest notice placement (`1833a422ca`) and the official
fixed AT-SPI dependency (`6e4c022512`). These changes require source integration,
matching packages and installed acceptance; they are not accepted merely because
focused compilers or source checks passed. The earlier expired-question dismissal
and authorized settings-handoff fixes remain part of this same candidate.

The retained Xorg candidate passed actual Display close/reopen, two-app layout,
normal child-dialog behavior and window-management Off/On checks. Its container
Files view opened guest code and downloaded the exact original 39 bytes; a path
that exists only on the test VM host returned ENOENT from the guest. This confirms
that particular container Files route, not new file citations or the full format
matrix. An official standalone Termux:X11 APK and exact matching companion DEB
were installed on Android 17 for simultaneous-session testing; they have not yet
been launched together with the new embedded implementation.

Evidence lives outside the product repository in the Build workspace:
`verification/test-environments-restart-20261014.json`,
`verification/termux-x11-coexistence-setup-20261014/setup.json`,
`acceptance/xorg-vm-control/resume-20261014-656.json`, and the dated Display,
file-citation, question-presentation, phone-repair and Tor source-check directories.
The broader pre-build review also identified a live-worker Stop issue: automatic
peer/subagent results could resume a stopped chat. The repair retains those
messages as held drafts, preserves arrivals during Stop itself, and still permits
explicit follow-up or user Send. Focused checks cover delivery/retry/race cases.
Android's Glean initializer now uses a terminal no-network uploader: disabled
collection alone still allowed an inherited deletion-request ping. Compilation
and source review confirm the uploader cannot send or retry; this is not a full
installed traffic-audit pass.

The preview audit repaired original-byte downloads (including BOM, UTF-16 and
line endings) inside the existing authorized snapshot transfer. Large top-level
Markdown tables now arrive as separate 32-row render chunks; byte fixtures and
2,000-row chunk checks pass. Installed responsiveness, including large nested
Markdown structures, remains a separate acceptance requirement. Standalone XFCE
must also skip BashKitten OS autostart/layout controls when outside an owned
Termux or container role; the changed panel patch requires a real component build.

The complete feature and acceptance register below remains mandatory. No feature
has been removed or deferred by narrowing the current build to one regression.

## Previous installed checkpoint — 11 October 2026

The original feature implementations were integrated across the nine workstreams.
The first whole-scope Android/Linux candidates have been built and installed; actual app
acceptance is in progress. Startup, provisioning and presentation failures are
being repaired together for the next candidate. No workstream is fully accepted;
component compilation and source review do not establish installed acceptance.
The later Autostart, selected-container configuration and mobile toolbar requests
are additional mandatory amendments. Their source is integrated in `fb867067e4`;
the combined `3c35d56d7c` Android/Termux/Linux development packages were built
and installed. Whole-feature acceptance remains in progress.

The current installed development candidate is
`656abcd94b180ce52bee5b27a77b4e704ec5ed13`. Its Linux package is installed on the
native Wayland host and real Xorg VM. The matched APK and Termux package are
installed on Android 16/17. Package hashes, exact backend revision, OS producer,
bootstrap metadata, guard and paired loader are verified; normal postinst sets
the loader to `0400` and package verification is clean. These installations
preserved the existing acceptance profiles; they are upgrade evidence, not fresh
architecture acceptance.

The candidate contains BashKitten OS from `0f16d716aa`, private engine from
`136d077c9f` and a guest package built at `656abcd94b`. Its guest launcher prevents
automatic crash-count Troubleshoot Mode for the managed browser through the
supported environment setting; other browser launches are unchanged. The native
Gecko producer remains `609e82c200`, with exact input-equality and separate
assembly receipts. Android loader producer `780540ddf7`, Linux guard producer
`9ffeedb41d` and Android guard producer `bb8061b0b9` remain recorded separately.
The complete matching source collector and package checks passed. Linux includes
2,046 nonempty full notice records; Android includes 2,014. These are build and
provenance results, not a whole-product traffic or release acceptance claim.

Actual Android 16 `656abcd94b` question cards now use the shared font, surfaces,
rounded choices and custom-reply field in both explicit Light and Dark themes.
The settled card appears beside its original tool call. A separate Follow device
issue remains: changing Android night mode updated the native toolbar but left
the open Agent page light; selecting explicit Dark updated it correctly. The
original Follow device/light setting was restored. Saved screenshots are
`verification/android16-656a/question-light.png` and
`question-explicit-dark.png`. This presentation result does not establish every
question delivery or dismissal case.

The previous `005d3e5b2d` installed Xorg candidate passed fresh machine creation,
actual native Display frames/input, compact Display chrome and ordinary tab
navigation. Interactive guest sudo passed Ctrl-Z, `fg`, further input and Ctrl-C
with a restored shell and empty jobs list. Thunar installed a real `.deb` and its
APT dependencies without a password. A real KeePassXC AppImage launched through
FUSE without an extracted-directory fallback. CSV showed its Unicode content;
code and raw Markdown downloads reached the native Save File dialog and saved
matching bytes. These are specific flow results, not the complete application,
preview or desktop matrix. Evidence is in
`acceptance/xorg-vm-control/candidate-005d-ui.json`.

Android 16 `005d3e5b2d` showed Callback, matching installed Termux packages and
Pi 1.1.0 in Updates. Its normal contact editor saved
`kitten-phone@bashkitten.local`; calling that contact reached the managed call UI
and normal hangup worked. The retained per-Local test alias still contains the
old development address and is correctly rejected. There is no migration or
transport fallback, and no fresh per-backend contact pass yet. A pending question
was dismissed through its visible ×; subsequent distinct model questions were
stopped normally. Because Stop interrupted queued delivery, that check does not
establish complete dismissal acknowledgment. The public APT feed still lacks
this development release, so local pairing does not prove a public-feed update.
Evidence is in `verification/android16-005d/manual-progress.json`.

A severe Xorg test-VM slowdown was independently traced to the installed
AT-SPI 2.56.2 GTK bridge leaking dead process descriptors. The test host was
repaired through its already configured official Debian backports packages and
a normal VM reboot. Its previously busy desktop processes then showed no leaked
pidfds and negligible sampled CPU. This is test-host maintenance, not a product
patch or an inference-speed claim. New product guest dependency selection is
being checked separately. The retained older guest also received the exact
nested `656abcd94b` backend/guest and OS packages through normal APT/dpkg in its
correct user namespace. Installed payloads and stable data/configuration were
verified; normal native Start now reports Running and produces Display frames.
Neither manual installed-file changes nor replacement rootfs/profile data were
used to obtain that result.

Candidate `656abcd94b` includes the new-container catalogue race fix, selected-chat
external-turn subscription fix, prior-call error cleanup and machine-archive
provenance correction. Their complete installed retests remain in progress.
The older `005d3e5b2d` archive metadata recorded a library checksum instead of its
validated input archive checksum; the runtime bytes were unaffected. That
immutable artifact retains its documented limitation.

Two further source fixes are committed and pushed but are outside installed
`656abcd94b`: `a392e89b7c` permits hiding an expired question after historical
Stop while retaining current ownership/branch checks, and `b2a0338e04` allows an
already authorized settings response to return after an Android settings handoff
only to the same registered document. New actions still require visibility.
Their syntax and independent source reviews passed; installed retests await the
next integrated candidate.

Current receipts in the Build repository include
`verification/combined-desktop-656a.json`, `source-release-656a.json`,
`android-termux-handoff-656a.json`, `desktop-656a/installation.json`,
`android16-656a/installation.json`, `android17-656a/installation.json`,
`retained-guest-656/installation.json` and
`xorg-atspi-005d/post-reboot-baseline.json`.

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
| Container lifecycle / private Podman | Persistent owner, private engine/namespace lifetime, guest lifecycle/sudo and desktop context packaged; managed-launch correction in `656abcd94b` | Fresh Xorg creation/Display and sudo job control pass on `005d3e5b2d`; upgraded retained guest runs and renders on `656abcd94b`; full lifecycle matrix pending |
| Native sidecar / projects / chats | Android hierarchy committed; desktop hierarchy, project folder ownership and private container connection integrated | Partial Xorg project/cwd/move/draft and one subagent completion path; Android/full matrix pending |
| BashKitten OS / XFCE | Shared launcher/settings, layout, tray, scaling, application actions and role-specific CUA skills committed; Linux/native Termux packages built; fresh Termux initialization passes | Partial Xorg launcher/settings/input observations; remaining Termux/Linux desktop matrix open |
| Phone controls / phoneuse | Main-APK module, live worker grants, revocation and CLI committed; Android-only configuration | Android 16 earlier Apps discovery/list and feature-Off denial; current Android 17 themes/master-choice retention observed; complete authorization/revocation matrix pending |
| Telephony / contacts / messages / voicemail | Native library, private gateway, confirmed call speech, encrypted remote hooks and shared question delivery committed; integrated Java compilation passes | Pending |
| Pi release / usage / ask_user | Pi 1.1.0, selected-account usage and deferred questions integrated using stock APIs | Pending |
| Sources / licensing / telemetry / packages | `656abcd94b` package/source checks and expanded offline notice collection pass with distinct native producers retained | Full architecture, traffic and installed release acceptance pending |

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
| Maximized launcher | Apply the 15 October Applications-list amendment: vertical alphabetical icon/title rows, Pinned immediately above fixed bottom search, independent scrolling and natural pin height capped at 60% of available list space. Phone/tablet/desktop widths and keyboard/rotation reflow without overflow. Launch/search/pin/unpin/context actions/close stay responsive; pins survive rename/reopen/restart/update, appear once and disappear on explicit managed-entry deletion. No hidden polling, second Start menu, Garcon fork or split-layout disruption. | Pending |
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
