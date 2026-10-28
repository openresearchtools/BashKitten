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

Build-history reconciliation uses the existing BashkittenBuild README, current
verification/acceptance records and the build-environment thread. The README
contains older candidate identities; the 24 October records include newer
artifact-build and rollback evidence. The 11 October Cuttlefish audio-buffer
repair supersedes the earlier silent-input diagnosis for that old candidate,
but does not establish dictation acceptance on the forthcoming iteration build.

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

## Verified source capabilities, not implemented bridges

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
