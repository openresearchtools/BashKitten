# Files, Office and References status — 28 October 2026

Requirements are in [the integration plan](files-office-bibliography-plan.md).
This record separates research/temporary comparison evidence from implementation
and installed-product acceptance. It does not claim completed integration.

## Live integration checkpoint — 29 October 2026

The current full Actions run is
[40815191205](https://github.com/openresearchtools/BashKitten/actions/runs/40815191205),
version **153.5.4**, from `16f0a0330ac7f800fba6c97b8aaf778d32922843`.
It includes guided/background model setup, the replacement citation commands and
the source/license corrections, plus the remote application URL and phone
viewport fixes. All seven related repository queues were checked clear after
cancelling the five older active runs. Normal preparation `40815045392` passed
without modifying the frozen source. Dispatch is not a build
or installed acceptance pass.

The preceding `40811847474` attempt used `aa79161e6956` and exposed a stale Termux
Search inventory checksum after the Rust runtime source-lock update. The inventory
now matches that lock (`a5296491b5`); the unchanged
pinned Termux archive was verified and extracted successfully from the offline
cache. Both Linux Node restore jobs also hit GitHub HTTP 502 while reading prior
producer job lists, before compilation; `c3b0cef2e6` adds bounded retries for those
idempotent metadata reads, retaining fatal authentication and integrity failures.
Files Termux ARM64 failed while Git tried to fetch the omitted root `.gitignore`;
`a1a1a8b336` includes it in the native sparse checkout. All four Office native
artifacts passed at that old source, separately from the failed Files job and
blocked final package collection. Old artifacts retain their original identity.

Strict checks on the actual `aa79161e6956` Linux ARM64 and Termux x86_64 Office
artifacts passed: all 66 original Python legal files are present, all 14
Windows-only launchers are absent, and native source inventories, fonts and
notices match. Matching published sources and final packaged About remain pending.

The previous full Actions run was `40787710453`, from
`eb56a3a10ebc5bbba76c364dac1273ed0458e418`. Both Linux and both Android browser
compiles passed. Android packaging exhausted its old 30-minute companion wait
while native Office builds were still running. The bounded shared wait
correction is committed in `a3c456e8a8` and deployed to the four builder repos;
it does not change those already-running workflows. Office Linux ARM64 and both
Termux targets subsequently passed. The Linux ARM64 complete candidate also passed;
Office Linux amd64 reached packaging before cancellation, with its compiler cache
saved; no completed artifact is claimed. The main amd64 collector lost its hosted
runner connection while its daughter build continued waiting for Office. These
are outcomes for the original source revision, not subsequent fixes. A coherent
candidate containing the later changes remains unverified.

Installed testing still uses the isolated `4be2563e5e` browser with explicitly
recorded component overlays. It is not acceptance of a newer complete package.
The existing Weston viewer/input seat was restored before continuing trusted
native input tests; earlier unfocused clicks are not successful UI evidence.

- Native Office first-use project/style binding and two-source insertion ran in
  Writer, Calc and Impress. Writer citation editing, bibliography and style
  changes were saved through the actual UI. Complete mobile, history and
  concurrent-edit UI coverage remains outstanding.
- A moved Office runtime exposed a stale native systemplate alias: the cache
  compared only the source revision, so kit font paths retained the previous
  installation prefix. `0ec5251785` includes the engine path in that existing
  cache key. Native setup then repaired the alias; the same saved document
  exported/downloaded successfully with embedded fonts, citations and bibliography.
  This uses upstream setup, not a separate rendering or font implementation.
- Real References capture retained the chosen project while another project
  became active, including the native multiple-item selector and cancellation.
  Capture `1.0.4` removes the donor's conflicting screenshot shortcut while
  retaining native user-configurable commands. Android capture on the older
  installed APK is absent; current-APK acceptance is still required.
- The ten-identifier resolver comparison and actual browser continuation are
  recorded separately. Native metadata-to-Extra preservation is committed in
  `25d5bd662e`; manual attachment parenting in `cf05cb3e15`. Further installed
  capture/manager flows, real remote routing and complete stock Pi Office work
  remain in progress, not accepted from source checks alone.
- Source collection now retains original Go proxy metadata (`421f46a879`).
  Search's exact Rust runtime sources/notices are recorded in `fe14e6d016`, and
  component-prefixed native notices reach offline About through `c78d90fe39`.
  These are corrections for the next complete source/package collection.

Later installed diagnostic checks passed native human/Pi co-editing: actual
keyboard input changed an ordinary Writer paragraph while the real bundled Pi
edited and refreshed an existing managed citation. Native inspection retained
both changes and the same citation field. The first attempt targeted protected
citation content and failed; it is not counted as a pass. The real Pi then saved
and exported the same document through native Office operations. The coordinator
downloaded that exact export through the existing trusted HTTPS authorization
flow; its 21,378-byte PDF retained both edits, the superscript citation and the
formatted bibliography in text and rendered inspection. The replacement compact
Citations menu remains in progress. `01f1d0b192` adds
native selection lookup and guards; six-format native module checks passed,
separate from the still-pending new desktop/phone menu checks.

The replacement plugin removes the visible Office References panel and exposes
labelled native Citations commands. One nonvisual native extension lifecycle
frame owns command dispatch and the existing modification listener; compact
dialogs reuse the shared chooser and document settings. Settings starts with
Library and shows catalogue style titles and friendly language names. Native
selection supplies the exact existing citation for Edit/Remove. Review caught
and corrected lifecycle cleanup and changes arriving during a busy operation.
The pinned frontend emit/strict/bundle checks and focused command/settings/
lifecycle checks pass. These checks do not replace the pending installed menu,
selection and phone-keyboard replay.

Actual phone replay found that the outer Office iframe retained the 783px layout
height while the keyboard reduced the visible viewport to 486px. `16f0a0330a`
fits that existing iframe to the visual viewport and corrects the native inner
flex direction. After revalidating the served stylesheet, the editor measured
486px and Settings actions occupied y=407–451px, fully above the keyboard.
Typing in style search and tapping Cancel passed. Save, complete citation flows
and the extreme landscape keyboard case remain separate pending checks.

Desktop capture now passes the installed single/multiple-item, cancellation,
website snapshot, recognized/raw PDF, manual attachment, collection preservation
and overlapping two-project capture flows. `7c460a72f9` preserves collection
membership when parenting; `b0896a3fb6` preserves it on Leave standalone. Both
repairs were reproduced and replayed through the actual UI. The retained profile
needed native unpin/re-pin to display the capture toolbar button; fresh-candidate
default placement and Android capture still require installed checks.

Remote References and Files passed through the enrolled Tor/Chisel route with
trusted loopback HTTPS and separate local/remote libraries. Actual Office
edit/save, ordinary PDF rendering, native 4 MiB download with exact checksum,
live revocation and saved reconnect also passed. A normal download click exposed
the isolated fixture's read-only default Downloads directory; a writable native
destination and ordinary-click replay remain pending. `860ac0c38a` fixes reopening
already mapped application URLs through the owning route, with 27 focused cases
and the full Android Java compile passing; installed API replay remains pending.
The two same-UID diagnostic owners required a serialized handoff of Quantum,
Office and its storage service; all previous states were restored. Long transfers,
cancel and sustained Office connection stability are not claimed accepted.
Evidence is in `verification/real-remote-apps-20261029/`, including
`real-https-references.json` and `real-https-files-office.json`.

Evidence lives outside Git under `BashkittenBuild/verification/`, including
`restored-native-seat-20261029`, `office-native-ui-20261029`,
`references-capture-ui-20261029` and `references-real-parity-20261028`.
The checkpoints below are historical: their earlier archive-retention statements
do not describe current Git storage. Dependency archives now use the verified
external source cache and matching corresponding-source artifacts; the completed
history cleanup is recorded separately in `docs/history/`.

## Implementation started — 28 October 2026

The user authorized implementation of the complete plan, parallel module work,
and the early browser integration iteration build. Editing needs no open editor
tab; agents can also open normal tabs to inspect rendering and native exports.
Module/UI/API iteration proceeds while the browser boundary is being prepared.

| Workstream | Current ownership / next integration evidence |
| --- | --- |
| Shared chat UI | Remove the internal Files manager; retain Changes/attachments/pickers; compact content-sized composer; normal Files launch |
| Native browser boundary | Delete prepared-document bridges; ordinary service-tab launch; small fixed References host on desktop and Android |
| Runtime | Existing lifetime/auth owners, lazy shared service startup, exact local/Chisel mappings and live project permission checks |
| Quantum/WOPI | Separately packaged upstream-derived add-on, source/account scopes, native saves/history and light editor launch |
| References | Separate project databases, native-derived translators/resolvers, bounded library UI and shared classic chooser |
| Capture extension | Pinned Connector save behavior, References branding, fixed-host contract and independently replaceable logic |
| Office API/plugin | Native agent session, three editor adapters, managed citations and snapshots-only comparison |
| Pi/reviewer | Frozen reviewer source/local delta, full References compatibility and live Office tools/skills |
| Build/package | Exact source/dependency graphs, ordinary Actions artifacts, native Linux/Termux recipes and early browser build |

Pristine source commits, before adaptations:

- `8bf5c7e61b` and `bccad2022c`: Quantum stable and selected upstream WOPI
  donor, including exact upstream ignored fixture/embed files. Per-file manifests
  were checked locally. Upstream fixtures are source provenance, not runtime data.
- `7db7e4b747`: Connector and its released translation/schema dependencies.
- `5e8d6eb05c`: References core/schema/translators, translation-server, classic
  dialog reference and CSL datasets. The desktop donor is source evidence and
  must not be included wholesale in the runtime package.
- `09596561dd`: Systematic Reviewer committed base, reviewed local delta and
  main-branch UI reference. The user's donor checkout was not changed.

An initial diagnostic against the temporary stock Collabora server succeeded:
an authenticated agent document session executed a native UNO text insertion,
received `.uno:Save` success and a WOPI save acknowledgement without an editor
tab. The preferred `cool.getActiveDocument().getBody().appendParagraph` call
failed in this release with an `XTypeProvider`/`findOverloads` error. The native
UNO compatibility path remains inside the independently replaceable adapter.
This proves one native operation, not complete editing/citation/platform support.

No new browser iteration build or installed integration acceptance is claimed
by this checkpoint. The sizing change still needs installed Android verification;
all acceptance groups in the plan remain open until their actual flows pass.

### Subsequent implementation checkpoint

The independent components now live at top-level `files/`, `office/` and
`references/` (`3ec354c0d4`). Existing imported file contents were preserved in
the move. Lifecycle/authorization adapters and Pi tools remain under `agent/`.
The agent's native Office connection uses existing backend authorization, with
no additional user account or login.

- Native capture adaptations were committed in `2cf37b2120`; its independent
  offline build passed. The ordinary capture extension and fixed privileged
  host are separate packages. Installed capture, challenge handling and signed
  independent update/rollback remain unverified.
- The backend HTTPS gateway diagnostic passed certificate validation against
  the existing backend CA, one-use launch, secure scoped cookies, nonce-replay
  rejection and origin checks. Evidence is outside the repository at
  `BashkittenBuild/verification/apps-boundary-20261028/https-gateway-evidence.json`.
  This does not establish normal-tab trust in the installed browser. The narrow
  native service-context trust changes require a new browser build.
- Native citation persistence diagnostics passed for DOCX, ODT, XLSX, ODS,
  PPTX and ODP after reopening saved copies. A separate check found missing
  native undo support for document metadata; the proposed generic native patch
  still needs compilation and runtime verification. UI, complete editing,
  concurrent users and mobile acceptance remain open.
- Native Linux Office compilation is in progress. All 121 selected engine
  dependency archives passed checksum verification. Large retained source
  archives use lossless parts for GitHub's individual-file limit.
- Landlock calls succeeded inside the real Termux app domain on the existing
  Android 17 emulator. Native engine/server porting and a running Termux Office
  server remain outstanding; this kernel diagnostic is not platform acceptance.
- The composer retains its original two-row baseline. Content sizing and resize
  remeasurement changes still need installed Android verification.

Upstream archive attributes omit 57 text schema files. The pristine source import
retains them, and release source collection now reads all tracked Git file
contents instead of applying those exclusions. This source-completeness change
does not substitute prebuilt executable binaries for native builds.

Build-history reconciliation uses the existing BashkittenBuild README, current
verification/acceptance records and the build-environment thread. The README
contains older candidate identities; the 24 October records include newer
artifact-build and rollback evidence. The 11 October Cuttlefish audio-buffer
repair supersedes the earlier silent-input diagnosis for that old candidate,
but does not establish dictation acceptance on the forthcoming iteration build.

### Native build and module checkpoint — 28 October 2026

The early desktop and Android browser compilations passed at
`4be2563e5efea3d396da2970a00e12885057cb10`. That revision fixes the desktop
generated-file jar syntax found in the first iteration. Package assembly is
separate: stale companion-source checks correctly stopped assembly, and the
companions are being rebuilt from the frozen source. Android OS and Display
companions have been rebuilt with the actual `153.5.2` version and verified
source/signing provenance. Neither compilation nor companion rebuilding is an
installed-browser acceptance claim.

The independently built Linux Files and Office components passed native
compilation. Generic native field-command undo and OOXML user-attribute
preservation are committed in `b24989fd68`; the Office plugin/API checkpoint is
`d76ed855d7`. The latter keeps distinct native participants, native token renewal,
the shared web citation chooser and explicit copied-reference import. Native
OOXML diagnostics preserved a 43,709-byte attribute payload through XLSX/ODS and
PPTX/ODP conversion and cross-document clipboard operations. Complete citation
undo/redo and human interaction still need the updated running artifact and UI.

The real native Termux Files component ran under the Android app UID and SELinux
domain. Listing, private-path rejection, PDF/video thumbnails, native SQLite and
the add-on health route passed; owned child processes exited. The single-frame
video seek edge case remains recorded. Evidence is in
`BashkittenBuild/verification/files-termux-20261028/native-termux-evidence.json`.
Native Termux Office engine/server compilation is still in progress; Files
success does not establish Office support on that platform.

The isolated native Linux gateway diagnostics exercised two project launches
sharing one Quantum process, native Pi editing/save/PDF export, project-scoped
References, managed citations, snapshot history/restore and stale-session
rejection. Backend shutdown removed its owned processes; reopening with
autostart disabled left heavy services stopped. Evidence is in
`BashkittenBuild/verification/apps-native-gateway-20261028/`. These are native
module/API diagnostics, not installed desktop/phone UI acceptance or real Tor
transport coverage. Mapped-origin browser forms and sockets are being checked
separately against the exact forwarded HTTPS origin.

References UI source now uses bounded uploads and paged range selection
(`508019e9eb`, `4beec00cb3`). Earlier available browser checks covered collection
navigation, metadata, classic citation controls and native reference import/export
with small local data. Bulk identifier resolution and a 100k-record benchmark
were not run. Same-machine native Zotero metadata/PDF parity, installed capture
and challenge flows, signed connector update/rollback, native browser TLS trust,
complete phone/desktop editing and final package acceptance remain open.

The authorized `office-builds` repository now builds Files and Office target
artifacts with ordinary Actions caches/uploads (`bb16c986ba` in the main source).
Development and early integration packages remain distinguishable from complete
release packages; missing native artifacts are not silently accepted by the
normal release collector. Hosted builds and the remaining architecture/runtime
coverage must still be recorded separately.

### Packaged iteration and native follow-up checkpoint

Linux, Termux and Android iteration packages have now passed build and package
checks at frozen browser revision `4be2563e5e`, version `153.5.2`. Exact paths,
hashes and the explicit `integrationIteration` designation are recorded in
`BashkittenBuild/verification/browser-integration-4be2563e5e.json`. These packages
include the independently installed module sources and capture boundary; native
Files/Office payloads were explicitly unavailable in that early iteration.
They are not complete release packages. Current module updates must retain their
own actual source and native artifact receipts rather than claiming the frozen
browser revision covers later changes.

Three independently sealed Files archives (Linux amd64 and Termux aarch64/x86_64)
passed the normal collector with source `12923eaccb`, `development: false` and
599 inventoried files each. Receipts are in
`BashkittenBuild/components/files/artifacts/sealed-receipts-20261028.json`.
The Linux Office development artifact includes the eight shared native patches
and full source/license inventory. The Termux port checkpoint is committed in
`09c02b18fa`; native Python/libffi, multiprocessing and shared-memory dependency
execution passed inside the Termux app. Full native Termux Office remains an
active compilation/runtime gate.

Updated native Office diagnostics now passed DOCX/XLSX/PPTX edits and citations
through whole-backend shutdown, restart and reopen. A fresh DOCX also passed
native insertion/edit undo and redo, preserving the expected occurrence ID,
locator, rendered text and metadata revision. The actual mapped HTTPS gateway
served editor forms, sockets, renewal and References requests at the forwarded
origin. Native export passed through the scoped normal-browser resolver and
returned a single-use PDF; an explicit text-citation copy had no active citations
while the master retained its citation. Evidence is under the existing
`apps-native-gateway-20261028` verification directory. Installed UI and actual
Tor/Chisel-route acceptance remain distinct and pending.

Fresh isolated installation preparation preserves the running host browser and
previous acceptance profiles. The dedicated Xorg VM has the new package. A
separate Android instance uses a fresh primary-user image with the prior image
preserved. These are setup results, not completed user-flow checks.

### Source, export and native-build follow-up

The earlier Files archive check covered payload inventory and source identity;
the subsequent full package license collector found incomplete dependency
notices. Final package assembly remains stopped. Exact upstream notices and
published SPDX declarations are being retained with their provenance, separately
from canonical license text. The three pinned Go dependencies without established
license coverage remain unresolved; licensed native replacements are under
review. No missing grant is inferred, and existing sealed artifacts are not
edited or relabelled. Evidence is in `verification/go-module-legal-20261028/`
and `verification/module-iteration-fa2-legal-check.json` under BashkittenBuild.

The earlier citation Undo result used the native `XUndoManager` API, not the
collaborative toolbar command. A subsequent `.uno:Undo` diagnostic found that
upstream UNO undo contexts had no document-view identity. The focused generic
patch assigns the current native document view while retaining collaboration's
ownership checks. It has compiled; same-view Undo and rejection from another
participant are being verified before claiming that command path works.

The native x86_64 Termux Office engine has compiled, including the shared Undo
patch. Online server dependencies/configuration and complete Android document
execution remain open. The ARM engine is still compiling. Dependency execution,
engine compilation and installed product acceptance remain separate results.

References exports now use bounded SQLite pages, a private input spool and one
native translator with its native file writer. Explicit selected, search,
collection, library and deleted-item scopes replace the earlier selection and
child-record ceilings. Focused native checks covered stale-version rejection,
cancellation, receipt recovery, 201 child notes and an 18.9 MB private download.
Formats that natively buffer a complete array/graph/document report that memory
behavior; no 100,000-record benchmark or mass provider retrieval was run.

Current native module/resource updates reuse the successfully compiled browser
boundary. The resource-only package refresh preserves its actual native binary
hashes and uses the normal source-revision checks; it is not a new full Gecko
build or a completed release package. Installed browser HTTPS, capture/update,
human/agent UI and full platform acceptance are still pending.

### Focused web UI and native server checks

The permitted in-app browser exercised the real standalone References service
with three local records. Whole-library and author-search RIS exports downloaded
three and one records respectively; their bytes and identities were checked.
The classic citation dialog displayed full creator names/year, multiple sources,
locators and manual source ordering. Native keyboard edits opened the regeneration
choice; keeping custom text, regenerating the APA citation and confirming with
Return passed. Evidence and screenshots are in
`verification/references-ui-20261028/`. This is independent web UI evidence,
not installed BashKitten TLS, capture or phone acceptance.

The export checkpoint `ee7cd40449` also fixes concurrent job reservation, saves
the versioned retry request before dispatch and preserves completed receipts on
late cancellation. Focused native diagnostics covered identical concurrent
requests, conflicting inputs, disconnect recovery, cancellation and archived
library exports. The normal archived-library write restriction remained active.

Shared native Undo patch `2ba8af2181` passed actual Writer commands from two
authenticated views: the owning view could Undo/Redo, while the other view was
rejected. Calc/Impress shape text and attributes exposed further native UNO Undo
gaps. A real active-shape check also reproduced an agent write being overwritten
when the human finished editing that shape. The focused native correction reuses
the existing undo factory and active-shape lock; its rebuilt runtime checks are
still pending. Full simultaneous editing is not yet accepted.

The native x86_64 Termux server and both kit launchers now compile/link, with
the normal capability, Landlock and seccomp configuration and upstream SBOM
check passing (`7c68da794b`). Earlier dependency probes used emulator serial
6520 under Termux UID 10123. New server/kit runtime checks target the separate
6522 instance, whose Termux UID is 10122. Keep those installations and evidence
distinct. Full document execution and ARM64 completion remain open.

Licensed native cache/logging/media dependency sources are retained in
`fa0c52d4b1`; their narrow adapters and complete Files build are being checked.
The obsolete unlicensed module archives are removed from current build/source
inputs while the original import remains recoverable in Git history. Final
package assembly still waits for the selected graph and artifact checks.

### Licensed Files and native Office follow-up

The Files dependency correction is committed in `8b4fa02c88`. Native Linux
amd64 and Termux aarch64/x86_64 builds passed with the selected licensed cache,
logger and media dependencies; their complete notices and linked module graph
were verified. Obsolete unlicensed archives are absent from current build and
source inputs. The normal final collector still requires a single coherent
source checkpoint before new accepted artifacts are sealed. Historical rejected
artifacts remain unchanged.

Shared native Office changes and both Termux server build inputs are committed
in `bbd5388fea`. The corrected native shape Undo implementation passed actual
`.uno:Undo`/Redo in Writer, Calc and Impress, restoring citation identities,
styles and metadata revisions. Another authenticated view was rejected by the
native collaboration ownership check. Copied bibliographies and unlink Undo/Redo
also passed. These are native module diagnostics, not installed toolbar checks.

The native active-shape guard rejects background text changes while a human is
editing the same shape; editing another shape and retrying after the human
finishes passed. Impress compound rollback was exact. Calc restored text and
metadata but moved a cell-anchored bibliography by 0.05 mm after an earlier cell
change and rollback, so all-target conflict preflight remains under investigation.
Native Calc cell input separately showed last-commit behavior with both UNO
setters and the ordinary EnterString command: a human's uncommitted input can
replace an agent's same-cell edit when the human commits. No separate cell-lock
system or stronger native guarantee is claimed.

Both complete Bionic engine/server builds and their upstream SBOM checks passed.
The new runtime diagnostic uses Android instance 6522, Termux UID 10122. ADB's
copy did not preserve executable modes and app-labelled symlinks; extracting the
verified artifact through the actual app UID repaired that setup problem without
changing SELinux policy. First Office startup then exposed a real launcher
boundary issue: native Office library paths were applied to the Node launcher
itself. Restricting those paths to its native children is being fixed and tested.
Successful native document execution on Termux remains unverified.

## Decision and planning work

The user selected Collabora Online after the temporary stock-server comparison. The active plan, AGENTS instructions and current native
plan amendment now cover Collabora, a maintainable external Quantum add-on,
light UI/document canvas and the immediate Android chat-height/browser-boundary
iteration build. The frozen original native plan/tag is unchanged. No browser
or backend integration build was dispatched for this documentation change.

## Temporary comparison evidence

Both stock services ran on the same Linux host, outside the repository. User
sample XLSX/PPTX/DOCX files were copied from Downloads, not edited in place.

| Component | Observed identity / memory snapshot |
| --- | --- |
| Collabora CODE | `26.04.5.2.1`, reported Online/kit hash `42745e44dd`; server 745.4 MB |
| Temporary Collabora file host | Separate SDK-derived WOPI test host, 78.4 MB |
| Collabora combined | About 823.8 MB |

Measurements are decimal container/service memory accounting, excluding browser
memory, with differing active documents/sessions. They are not matched-workload
RSS/PSS/peak benchmarks, not a fourfold guarantee and not native Termux results.
The CODE image digest observed was
`sha256:808410e77b8695a35b93c7638fbba07c10cf0ba8307141b460248f18ab6e5c55`.
This observation does not establish a source-complete distributable package pin.

Verified locally: Collabora displayed the BCT spreadsheet and saved a blank-
document edit through the temporary WOPI host. The user reported successful
Collabora use on the devices used for the comparison. Full installed-product
mobile acceptance, controlled performance testing and native Termux verification
remain pending. Earlier comparison observations remain in Git history.
The temporary host is not the planned production Quantum add-on and does not
prove its locking, history, source policy, authentication or lifetime acceptance.

## Research baseline before implementation

The following records the original source investigation; subsequent work and
remaining acceptance are tracked in the implementation checkpoints above.

- Released Collabora `cp-26.04.5-2`, commit
  `42745e44dd8530fac7acd5f46cb7571ceea63c6a`, contains native document WebSocket,
  UNO/script and experimental JS extension facilities. Complete Pi browserless
  live-edit/save/export/coedit acceptance is pending.
- Native history invokes a host UI/storage contract. The full-version store and
  minimum host chooser/restore adapter remain to be implemented.
- Writer's native Zotero integration has cloud-specific behavior, excludes
  small-screen initialization and is not a full local References or Calc/Impress
  solution. Full citation scope remains required.
- Quantum's pinned stable lacks Collabora, but upstream development has WOPI
  source and a signing correction. Reuse those pinned sources within the user's
  separately versioned add-on boundary; the module/hook is not implemented.
- Native light launch defaults and WOPI browser-background settings exist. A
  runtime always-light policy covering Interface Settings and all native toggles
  still needs implementation/verification; no document recoloring is permitted.
- Native Bionic Termux `coolwsd`/kit/engine operation remains unproved. The Android
  standalone app and Linux container do not establish this capability.
- Android's excessively tall default chat/message area is a reported regression;
  its root cause/fix is not established by inspecting the existing CSS alone.
