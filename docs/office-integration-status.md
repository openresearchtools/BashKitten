# Files, Office and References status — 28 October 2026

Requirements are in [the integration plan](files-office-bibliography-plan.md).
This record separates research/temporary comparison evidence from implementation
and installed-product acceptance. It does not claim completed integration.

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
