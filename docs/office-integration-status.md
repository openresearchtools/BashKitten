# Files, Office and References status — 28 October 2026

Requirements are in [the integration plan](files-office-bibliography-plan.md).
This record separates research/temporary comparison evidence from implementation
and installed-product acceptance. It does not claim completed integration.

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
