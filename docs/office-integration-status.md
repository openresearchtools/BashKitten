# Files, Office and References status — 28 October 2026

Requirements are in [the integration plan](files-office-bibliography-plan.md).
This record separates research/temporary comparison evidence from implementation
and installed-product acceptance. It does not claim completed integration.

## Live integration checkpoint — 29 October 2026

The latest binary batch is
[40823770402](https://github.com/openresearchtools/BashKitten/actions/runs/40823770402),
version **153.5.4**, from `cf62bf9be5cd068921f5941916099531cd3ce1a7`.
All eight native Office/Files jobs, both Linux packages, both Termux packages and
both Android APKs passed. This batch includes `550d52b0a2`, `f09b7d27bb` and the
native short-frame/collapsed-menu changes. The x86_64 APK's production signing
identity and exact-source backend/OS pairing were verified. The parent source
job was cancelled after its collection step ran for 1h 23m 44s; binary artifacts
were retained.
No corresponding-source or complete-candidate artifact/pass was produced; these
binary results do not establish source publication, prerelease completion or
full installed acceptance. The build receipt is
`verification/ci-monitor-cf62bf9be5cd-20261029.json`; staged identities are under
`Bashkitten-Acceptance/candidates/153.5.4-cf62bf9be5cd/`.

Later source-preparation correction `1eab4ec1df` adds native Git bulk backfill
before the existing collector. The exact workflow step passed a pinned shallow
partial-clone fixture; the existing exporter produced identical archive bytes
with one fetch process instead of 40. Source serialization and content are
unchanged. This is a focused source-fixture pass, not successful publication.
Receipts are under `Bashkitten-Acceptance/source-archive-backfill-20261029/` in
`workflow-step-verification.json` and `verified-run/verification.json`.
`9e64389692` adds disk/object-usage reporting around that native backfill;
it does not change source serialization or establish a publication pass.

The actual cf62 Linux amd64 DEB also passed the existing final-package audit:
all 3,056 full-text records matched the normal collector and offline About,
including both structured Go records, all compiled Gecko/capture notices and
installed Office branding. The actual production x86_64 APK passed all 2,918
full-text records against the native validator and exact offline About array,
preserving all 2,427 matching Termux companion records, four compiled Gecko
records and 26 capture records. Both Go 1.27.2 texts match their 38 pinned
original members and retain declared terms. Its SHA256 is
`7d397ad240ad08dcb6ea6fcbb5900ea25a37187800e2a2978badefc46302e275`.
The independent current-source receipts are `verification.json` and
`apk-verification.json` under
`Bashkitten-Acceptance/final-packages-legal-cf62-20261029/`.
These are artifact legal/About passes; matching source publication remains
separate, and the 16f0 evidence below retains its historical identity.

The preceding full Actions attempt was
[40815191205](https://github.com/openresearchtools/BashKitten/actions/runs/40815191205),
version **153.5.4**, from `16f0a0330ac7f800fba6c97b8aaf778d32922843`.
It includes guided/background model setup, the replacement citation commands and
the source/license corrections, plus the remote application URL and phone
viewport fixes. All seven related repository queues were checked clear after
cancelling the five older active runs. Normal preparation `40815045392` passed
without modifying the frozen source. The attempt ended with the source and APK
failures below; it is not complete installed-product acceptance.

That run subsequently passed all four Node jobs, both Termux Search jobs and all
eight native Office/Files jobs in daughter
[40815382518](https://github.com/openresearchtools/office-builds/actions/runs/40815382518):
each component passed Linux amd64/arm64 and Termux aarch64/x86_64. Both complete
Linux DEBs and both Termux packages also built. Both Android Gecko compilations
passed, but neither APK was produced: the ARM64 and x86_64 Gradle builds failed
at `stageBashKittenAbout` with `KeyError: 'licenses'`. The new native Go runtime
record supplies full `text` and `licenseFiles`; that About loop expected module
license filenames. `f09b7d27bb` updates the existing loop to accept both forms,
preserving declared terms and rejecting incomplete text. Its focused offline
receipt used the actual 16f0 remote Go metadata: 18 filename records plus the
Go 1.27.2 runtime record, retaining its 73,503-character text and all 38 original
member hashes. The existing attribution record also remained. That focused
receipt is generator verification; the later cf62 APK build passes are separate.

Source collection failed because it checked an original archive
against the checksum of a license member inside it. `550d52b0a2` corrects the
existing collectors to verify the archive and extracted notice independently;
no dependency pins or license texts changed. Independent retained originals
confirmed all 57 affected notice associations across 16 archives. The corrected
source/APK callbacks packaged all 624 native source records offline and rejected
damaged archives, members and retained notices. Those artifacts retain
`16f0a0330a`; the correction still requires a new successful normal source
publication. Build outcomes are recorded in
`verification/ci-monitor-40811847474-to-16f0-20261029.json`; the focused source and
Android About receipts are under `Bashkitten-Acceptance/` in
`android-notice-archive-16f0-20261029/owner-regression.json` and
`android-about-go-16f0-20261029/verification.json`.

The actual 16f0 Linux amd64 DEB passed the final packaged legal/About audit.
The unchanged collector reproduced all 3,056 full-text records, and the packaged
offline About contained that exact array. Native component inventories, all 30
compiled Gecko/capture notice records and installed Office branding matched.
Both structured Go runtime records retained their full text and 38 original
hashes; Office's 66 original Python legal files reached About. This package has
SHA256 `23da7e91d9980a716f1f9cf67ae78998afd43f97217fdea83d62429bd8b1250e`.
The receipt is `Bashkitten-Acceptance/final-deb-legal-16f0-20261029/verification.json`.
It establishes packaged notice coverage, not source publication or installed
feature acceptance. The later cf62 binary results do not relabel this 16f0 audit;
matching published sources and full installed acceptance remain outstanding.

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
notices match. Matching published sources and final packaged About for that
attempt remain unverified; the later 16f0 DEB check is recorded separately above.

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
are outcomes for the original source revision, not subsequent fixes. Later
binary batches and their remaining acceptance gates are recorded above.

The Office UI/Pi replays below use the isolated `4be2563e5e` desktop browser or
the older 153.5.2 Android APK with explicitly recorded component overlays.
They are not acceptance of a newer complete package. The separate cf62 Android
model-setup check is recorded in the native implementation status.
The existing Weston viewer/input seat was restored before continuing trusted
native input tests; earlier unfocused clicks are not successful UI evidence.

- Native Office first-use project/style binding and two-source insertion ran in
  Writer, Calc and Impress. Writer citation editing, bibliography and style
  changes were saved through the actual UI. The later command/history replays
  below are bounded checks; complete mobile and concurrent-edit UI coverage
  remains outstanding.
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
formatted bibliography in text and rendered inspection. `01f1d0b192` adds native
selection lookup and guards; six-format native module checks passed separately
from the later compact Citations menu replays below.

The subsequent actual bundled Pi 1.3.0/Qwen3.5-4B Calc/Impress run completed all
nine native calls with HTTP 200 and both `saved:true` acknowledgements. Calc
wrote/read cells and a formula; Impress opened/inspected the presentation,
inserted/read a text shape and saved. The normal Pi Stop ended the bounded test
after both saves, before a final model reply; no extra tool calls followed.
Earlier malformed model calls remain recorded failures. This is bounded native
tool proof on the diagnostic installation with overlays, not cf62 installed
acceptance or unprompted model reliability. The receipt is
`verification/office-native-ui-20261029/native-pi-calc-impress/calc-impress-native-results.json`.

The replacement plugin removes the visible Office References panel and exposes
labelled native Citations commands. One nonvisual native extension lifecycle
frame owns command dispatch and the existing modification listener; compact
dialogs reuse the shared chooser and document settings. Settings starts with
Library and shows catalogue style titles and friendly language names. Native
selection supplies the exact existing citation for Edit/Remove. Review caught
and corrected lifecycle cleanup and changes arriving during a busy operation.
The pinned frontend emit/strict/bundle checks and focused command/settings/
lifecycle checks pass. Installed diagnostic replays now cover the native commands
in all three desktop editors, using the recorded `3ed71534b2` plugin plus
`16f0a0330a` frontend overlay on the older signed browser:

- Writer Settings retained a style outside the initial catalogue page and friendly
  locale names; cancelling a library change preserved its binding. The chooser
  wrapped Title/Authors, showed Year, resized columns, kept Add fixed during
  horizontal scrolling and rendered 13 bounded visible rows. Native secondary
  click exposed Edit/Remove and reopened the exact selected two-source cluster.
  Real keyboard entry of a complete citation marker promoted it automatically,
  without clicking Convert, adding a second live native field.
- Calc's native Name Box focus selected A1 before Add/Edit preloaded its two
  sources. Remove cleared the cluster and bibliography entries; adding the two
  sources restored the managed cell citation and two bibliography entries.
  Impress shape and partial text selection both preloaded the exact cluster;
  confirming locator 21 preserved its native shape anchor and bibliography.
- Writer's native File → See history listed four versions. Retention changed
  50 → 51 → 50 through the UI. Open showed a native read-only snapshot in the
  same tab; Restore on the disposable UI document reopened an editable connection
  and retained both live anchors. This did not restore or alter the Pi documents.

The three receipts are in
`verification/office-native-ui-20261029/command-ui/` as
`writer-current-native-ui-evidence.json`, `calc-current-native-ui-evidence.json`
and `impress-current-native-ui-evidence.json`. They retain the diagnostic overlay
identity and do not establish fresh full-package or phone-format acceptance.

Native collapsed-menu patch `0025` (`84cb5faa8e`) also passed actual desktop
input at a 728px viewport: all six Citations labels appeared without the dummy
X, and Settings opened from the collapsed menu on a normal disposable document.
Library/style/language order and Cancel worked. This used a frontend-only
overlay with the old signed browser, native binary and plugin unchanged.
The receipt is
`verification/office-native-ui-20261029/command-ui/overflow-group/desktop-ui-evidence.json`.
A separate old-document restart exposed a surviving
WOPI lock; it is not a seamless restart pass.

Actual phone replay found that the outer Office iframe retained the 783px layout
height while the keyboard reduced the visible viewport to 486px. `16f0a0330a`
fits that existing iframe to the visual viewport and corrects the native inner
flex direction. After revalidating the served stylesheet, the editor measured
486px and Settings actions occupied y=407–451px, fully above the keyboard.
Typing in style search and tapping Cancel and Save passed with the portrait
keyboard open. Complete mobile-format coverage remains outstanding.

Later actual phone editing preserved a multi-source cluster when opening Edit
from a partial text selection, including the locator, prefix and suppress-author
settings. Native bibliography insertion produced two entries. These same anchors,
settings and rendered content survived a Cuttlefish restart. That restart recovered
the emulator's WebRTC process after its rotation sensor control crashed; it is
not an Office failure or a seamless-reconnect pass. Controlled Android landscape
then exposed a 45px visual viewport with clipped Settings actions.
`b263e805bd` applies a narrow named patch to the existing native extension frame
and shared Settings layout. Actual touch scrolling with the landscape keyboard
open then exposed Cancel and Save: Cancel closed a draft, and a separate Save
committed IEEE. Native read-only inspection under the same Termux UID 10122
confirmed revision 6, IEEE/en-US, the same two-source occurrence with locator,
prefix and suppress-author settings, and two bibliography entries with live
anchors. This was a short-frame overlay on the older APK; the controller update
required native Force Stop/reopen and does not prove seamless reconnect.
Phone evidence is `verification/office-command-phone-ui-20261029/evidence.json`;
the native state receipt is
`BashKittenOfficeBuild/20261028/diagnostics-6522/native-server/command-ui-20261029/writer-inspect-ieee-landscape-20261029.json`.
Later phone replay on that same older APK passed Writer's native history list,
immutable read-only Open, normal Back and Restore on the disposable proof file.
The restored snapshot predates the bibliography; no bibliography loss is inferred.
A typed citation marker automatically became a managed field, and selected
Remove preserved the original two-source cluster. Native PDF download completed
at 14,941 bytes. Calc and Impress each passed Settings, chooser, Confirm and Save;
Calc displayed the cell citation and bibliography. Impress's 12,471-byte PDF and
normal reopen contained the saved citation. Existing-shape editing, isolated new
shape insertion and a bounded inspector-lifecycle comparison later repainted
live; its two-entry bibliography also rendered and saved.

The initial Impress canvas missing-paint observation remains recorded and was
not reproduced by those bounded cases. The comparison inspector closed 841ms
before repaint, so a narrower callback race remains unexcluded. Default template
placeholders also overlap the native default insertion position; no layout
change was made during that investigation. Landscape chooser touch scrolling/
Confirm, zoom and fresh full-candidate Office acceptance remain open. These
results and native receipt links are in the same phone `evidence.json`; the final
state was portrait, unmodified, with no command drafts.

The unmodified cf62 Linux amd64 DEB also passed bounded Files GUI checks in the
real-Xorg VM: native folder launch, new folder/rename/copy/move/delete, GTK
TXT/PDF upload, text/native PDF previews and byte-exact TXT/ZIP downloads. Two
projects shared one Quantum process; closing one tab preserved that process and
the remaining Files tab reloaded. The retained project picker and actual Changes
untracked-file view passed. Normal Local Off/Quit preserved the custom main INI.
The receipt is
`Bashkitten-Acceptance/files-xorg-153.5.4-cf62-20261029/installed-acceptance-summary.json`.
Shared-chat attachment upload, capture toolbar and native Save-As naming were
not proven by this Files checkpoint.

Desktop capture now passes the installed single/multiple-item, cancellation,
website snapshot, recognized/raw PDF, manual attachment, collection preservation
and overlapping two-project capture flows. `7c460a72f9` preserves collection
membership when parenting; `b0896a3fb6` preserves it on Leave standalone. Both
repairs were reproduced and replayed through the actual UI. The retained profile
needed native unpin/re-pin to display the capture toolbar button; fresh-candidate
default placement and Android capture still require installed checks.

Fresh cf62 Android verification found the capture assets present but its add-on
absent from the native registry; only the privileged host was active. The APK
omitted every `_locales` directory despite the capture manifest's `default_locale`
requirement, which native Gecko rejects. The library now uses the same native
asset filter already used by Fenix. The actual cached Android SDK asset merger
reproduced zero locales with its default filter and all 37 with the correction.
The existing staging helper also carries the component's full runtime inventory
for self-contained final-APK verification; checks reject missing locales/assets,
changed bytes and malformed inventories, including in a sparse collector checkout.
No runtime registration or privilege workaround was added. Evidence is
`verification/references-capture-android-cf62-20261029/native-addon-state.json`.
Adjacent `native-asset-filter-result.json` and `apk-inventory-check-result.json`
record the packaging checks, not installation of a rebuilt signed APK.
Fresh rebuilt capture installation and GUI saving remain pending.

Remote References and Files passed through the enrolled Tor/Chisel route with
trusted loopback HTTPS and separate local/remote libraries. Actual Office
edit/save, ordinary PDF rendering, native 4 MiB download with exact checksum,
live revocation and saved reconnect also passed. A normal download click exposed
the isolated fixture's read-only default Downloads directory. After selecting a
writable destination through native Preferences, an ordinary 32 MiB Files
download completed with an exact source checksum, and native cancellation removed
the partial repeat. This bounded transfer does not establish arbitrary-duration,
stall or auth-expiry coverage. `860ac0c38a` fixes reopening
already mapped application URLs through the owning route, with 27 focused cases
and the full Android Java compile passing; installed API replay remains pending.
The two same-UID diagnostic owners required a serialized handoff of Quantum,
Office and its storage service; all previous states were restored. Extended stalls,
auth expiry and sustained Office connection stability remain unaccepted.
Evidence is in `verification/real-remote-apps-20261029/`, including
`real-https-references.json` and `real-https-files-office.json`.

The installed snapshot CLI passed six-format JSON and DOCX text output without
changing any of the nine input snapshots. OOXML used distinct retained versions;
the ODF fixtures had one retained version each, so those calls checked equal-version
handling alongside the earlier changed-version semantic checks. The bounded
desktop and phone Writer history/Open/Restore UI replays are recorded above;
remaining format and fresh-candidate coverage remain pending.
Evidence is in `verification/office-snapshot-diff-20261029/` and the ordinary
remote transfer follow-up is `real-remote-apps-20261029/ordinary-files-transfer-replay.json`.

`c348ac5092` changes the existing shutdown owners to wait for native Office saves
before stopping callback services. Source fixtures passed native-exit ordering,
Caddy callback drain and failure cleanup in
`verification/office-shutdown-20261029/{signal-result,caddy-result}.json`.
The first installed replay passed on the isolated older browser with the reviewed
controller overlay: a saved DOCX reopened immediately editable after Office-only
stop/start with the same add-on process. Native append/Save/inspect returned 200
before and after restart, both disk markers remained, and no forced termination
or unlock failure occurred. The receipt is
`verification/office-shutdown-20261029/saved-office-only-result.json`.
The subsequent c348-only dirty Local Off replay **failed**: native inspection reported
modified content before Off, but the new marker was absent on disk before Off
and remained absent after the native process exited. The file hash and size
were unchanged despite no forced termination or unlock failure. Source
`c348ac5092` alone was insufficient for dirty final-save acceptance. Exact disk/stop receipts are
`dirty-before-local-off-disk.json`, `after-local-off-disk.json` and
`dirty-local-off-existing-evidence.json` in the same shutdown directory.
This later source change is not part of the cf62 binaries.

Native named patch `0026`, committed as `fe4951b1d7`, records the missing
modifying activity for `executescript` through the existing native owner.
The diagnostic server was built from `305911e75a` plus the recorded patch inputs
(server SHA256 prefix `9df5fb0a`), with engine, frontend and plugin unchanged.
Its actual three-format dirty Local Off replay passed: all documents were
modified and their new markers absent on disk immediately before Off; normal
Off completed in 2.716s, preserving the DOCX text, XLSX cells/SUM and PPTX shape.
The original failed DOCX remained unchanged. Read-only inspection followed by
Office-only stop preserved all three files' hashes/sizes/mtimes/inodes,
immutable snapshots and storage manifests. A final normal restart reopened all
three editable, with the same add-on process, and DOCX edit/native Save passed.
Receipts are `dirty-local-off-result.json`, `readonly-office-only-result.json`
and `saved-office-only-result.json` under
`verification/office-shutdown-20261029/proof-0026/`.
The combined `result.json` and adjacent
`build-0026/committed-source-link.json` link those actual build inputs to
`fe4951b1d7` without relabelling the diagnostic build as that clean commit.
These are diagnostic native-overlay passes; fresh coherent build/platform
acceptance still needs the patch and does not relabel the cf62 binaries.

Likewise, `6b01947a60` uses native input semantics when clearing browser fields;
bounded helper/native-event checks are recorded in
`Bashkitten-Acceptance/browser-fill-clear-20261029/verification.json`.
Acceptance through a rebuilt installed actor and actual References query/export
scope remains pending.

`73f0b90e85` separately corrects secondary clicks to use the existing native
WebDriver `mousedown`, `contextmenu`, `mouseup` sequence. Ten component checks
preserve ordinary-tab/frame authorization and button cleanup. The actual Files
test had reproduced the missing API menu while physical right-click worked;
the rebuilt-actor replay remains pending. Its receipt is
`Bashkitten-Acceptance/browser-right-click-component-20261029.json`.

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
