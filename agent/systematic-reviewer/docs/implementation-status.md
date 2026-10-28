# Reviewer and Pi adapter evidence — 28 October 2026

This is implementation evidence, not feature or installed-platform acceptance.
The immutable donor import is commit `09596561dd`; adaptations are outside
`vendor/`. The reviewed V3 working snapshot has 78 files, including 17 modified
tracked files and 31 untracked files. Its tracked binary delta matches the plan's
SHA-256 `98863cf33f642549599155a24ff31e1a0ce28ac145a2b5365b897a158c9ae595`.
The separate full JSON manifest SHA-256 is
`425705a5cdc3bf7e30ca4b58006ff81cc331d29bba333f892b5199621782deb3`.
All 78 materialized source checksums were reverified. The donor checkout was not
reset, stashed or committed.

## Implemented adapter boundary

- Deferred `references` and `office` tools use the existing Pi worker key/socket;
  the worker binds its active/adopted session before calling the existing backend
  owner. Requests/responses are bounded; cancellation propagates. No new server,
  provider, identity store, resolver queue or agent/context loop was introduced.
- `review_references` plus the four retained reviewer tool names, `/review-setup`,
  six CLI families and eleven research capability guides are bundled. The setup
  command writes private shared settings without putting keys in model messages.
- The donor Markdown grammar is shared with Office in `lib/citation-code.mjs`;
  the complete document scanner retains the donor mdast parser. References owns
  CSL and library operations; Office owns native edit/save/export.
- The semantic ranking implementation retains explicit endpoints/models, complete
  text recipes, stable IDs, dimensions/index checks, scoped hashes/caches and ties.
- The Pi package registers sibling runtime files through the actual stock package
  loader. Runtime packaging uses its declared files and the root pinned dependency
  graph, excluding development dependencies and donor source from loaded code.

## Focused checks performed

Evidence scripts and results are outside the product repository in the existing
`BashkittenBuild/verification/references-reviewer-20261028/` workspace.

- Node syntax checks passed for all 22 adapted/native bridge modules.
- All standalone CLI help paths passed without network or model activity.
- The actual stock Pi `DefaultResourceLoader` loaded the standalone reviewer and
  complete bundled Pi package without extension errors, warnings or skill
  diagnostics. All eleven advertised bundled skills, including References, Office
  and Systematic Reviewer, were present. The original four reviewer tool names,
  `review_references`, `references` and `office` registered as deferred tools.
- Sixteen retained embedding checks passed: explicit endpoint validation, complete
  text/provenance, deterministic ties, dimension/index validation, cache invalidation,
  bounded batches/streams, cancellation, no-clobber output and credential redaction.
- Seven focused adapter checks passed: scoped identity parsing, transport path
  validation, bounded pagination, complete metadata, wrong-project/backend refusal,
  whole-state citation handoff, plaintext bibliography, missing-result refusal and
  native registration. An initially accepted dot-segment identity was corrected.
- A direct real-service check passed with two synthetic records through References'
  SQLite worker, native schema and CSL renderer: pagination/cursors, full creators,
  canonical snapshot, project-scoped offline APA rendering without library writes,
  stale cursor/item-version rejection and cross-project rejection. No network call
  or real citation/PDF harvest was performed.
- A private Unix-socket check passed for worker-key transport, no caller-selected
  session/participant authority, no-UI native open, optional visual-tab failure
  retaining the native session, actionable uncertain-operation errors, cancellation
  closing the request and private setup not echoing the key in notifications.

## Remaining integration/acceptance work

These checks do not establish live native collaboration, snapshot/history flows,
Markdown promotion/import, static citation-unlinked export, full PDF parity,
three-editor round trips or native Termux operation. Their corresponding Office,
References, runtime/add-on, source/build and installed-acceptance owners retain
those gates. Review identified renderer wiring, error-detail propagation,
Writer table citation preservation and public/internal Office URL handling issues;
the responsible owners are repairing and verifying those seams. Do not describe
source registration or this bounded synthetic integration as full product acceptance.
