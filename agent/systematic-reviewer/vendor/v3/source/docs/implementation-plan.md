# V3 implementation plan

## Intent

Rebuild Systematic Reviewer as a native Pi package on an orphan `V3` branch.
Do not inherit the Zotero app, V2, its database, its orchestration or its UI.
Keep useful research capabilities and live-citation interoperability, not the
old assumptions about where data must live or how an agent must perform work.

## Design

1. **One discoverable review skill.** An umbrella skill routes to attached
   capability skills for protocol design, harvesting, screening, extraction,
   appraisal, analysis and writing. Load bodies only on demand. These can be
   used independently, revisited, or delegated; they are not a state machine.
2. **Researcher-owned artifacts.** The agent chooses suitable files and tools
   with the researcher. Excel/CSV, narrative notes, scripts and optional data
   stores all work. Only citation interchange has a specified machine format.
3. **Thin native extension.** Register small citation and source-access tools;
   use Pi for models, permissions, session state, context and delegation. No
   background service, custom chat loop or compulsory third-party MCP stack.
4. **Markdown as durable writing.** Citation markers hold stable, scoped Zotero
   identities and optional locators. A deterministic renderer replaces only
   visible labels with CSL output. Ordinary Markdown viewers show citations.
   Exports retain identities and metadata as live Zotero fields, not flat text.
5. **Local reference integration.** Local Zotero's read-only API and offline
   CSL snapshots are independent sources. Harvest helpers
   remain standalone; neither network access nor a database is needed to write
   and export a report from an existing snapshot.
6. **Context-aware reading.** Prefer the host's existing full-read operation
   when a file fits. Use normal chunked reads through EOF otherwise. Do not
   replace the host's context estimator or create a second compaction system.

## Implementation slices and acceptance gates

- [x] Locate repository; create `V3` as an empty root; preserve legacy branches.
- [x] Write contributor instructions and this implementation plan.
- [x] Capability skills and attached guidance, with no required extraction
      schema or compulsory subagent workflow.
- [x] Installable Pi package and thin tools with cancellation, bounded output
      and explicit file-write behavior; verify native resource loading.
- [x] Citation grammar, validation, offline reference snapshots and read-only
      Zotero retrieval with library-qualified identities.
- [x] CSL rendering across a complete document: repeated references, clusters,
      locators, changed metadata, bibliography, missing references and code
      examples covered by tests.
- [x] DOCX export with live Zotero fields and document preferences; synthetic
      fixtures test ZIP/XML and reference preservation.
- [x] Small optional harvest utility with provenance and deterministic offline
      tests; no forced review store or dependency on the extension.
- [x] Documentation, end-to-end example, inactive Linux CI template and
      security/compatibility notes.
- [x] Run offline tests, syntax/resource checks, Pi discovery and office smoke
      tests; record exactly what was validated and what still needs Zotero.
- [x] Commit and publish `V3` without changing `main` or any V2 branch.

## Explicit non-goals

No predetermined review schema, automated unreviewed exclusion, opaque evidence
ranking, mandated meta-analysis, automatic bibliography fabrication, Zotero
profile modification, or replacement for methodological judgement. No copying
the legacy writer, browser automation or model runtime. No implied import of
legacy project databases; migration, if requested later, is a separate adapter.

## Risks and mitigations

- **Zotero/office interoperability:** validate fields and preference XML, inspect
  office conversion, and distinguish this from a successful Zotero Refresh.
- **Ambiguous IDs:** require explicit library scopes; snapshots are provenance
  records, not extraction databases. Fail closed on missing items.
- **Citation drift:** stable source markers survive label changes; render all
  clusters together with CSL rather than formatting each citation in isolation.
- **Destructive writes:** default to new output files, with explicit overwrite.
- **Context bloat:** one advertised umbrella, small optional tools, bounded
  responses, references and stage guidance loaded only when useful.
- **External data:** no automatic uploads of local corpora; HTTP credentials
  stay in environment variables, not documents or model-visible output.

## Validation log

### Implemented alpha

- One advertised `systematic-review` skill and ten attached capability skills,
  including PDF text/page-image/agent-vision guidance. No new reading tool,
  mandatory review schema, database, custom Zotero plugin or agent loop.
- Four native tools: marker construction, complete-document CSL rendering,
  live-citation DOCX export and read-only Zotero API retrieval. Tool inputs and
  output summaries are structured; manuscript/reference files remain on disk.
- Pure JavaScript core, with CSL processing, CommonMark/GFM-table parsing and ZIP
  serialization. Standalone Crossref helper has no runtime dependencies.
- Bookmark mode by default for LibreOffice/Word exchange; optional Word fields.
  Embedded CSL itemData, canonical URIs, locator metadata, preference chunks and
  a live bibliography range are retained. Initial cached citation typography is
  plain text; the standard Zotero integration performs rich-text Refresh.

### Publication

`V3` was published to `openresearchtools/systematic-reviewer` from the empty root
commit `0199132`; it has no inherited `main` history. The implementation commit
is `4207c7c`. The remote `main` remained at `859824b`; no V2 branch was touched.
The inactive CI template is included in the published tree, not installed as an
Actions workflow. The original workflow-containing commit was never published.

### Checks actually run

- Native aarch64 Android Termux, Node 24.18.0, Pi 1.3.0.
- `npm test`: **64 passed**, zero failures/skips, fully offline with synthetic
  references and injected HTTP transports. Coverage includes disambiguation,
  numeric styles, code exclusions, scope collisions, long Unicode metadata,
  ZIP timestamps, cancellation, rate limits, pagination, secret-safe errors,
  size bounds, duplicate rejection and no-clobber publication races.
- `npm run check`: syntax checks for all 17 JavaScript modules, frontmatter for
  11 skills, package resource/peer declarations and local documentation links.
  This is a JavaScript syntax/resource check, not a TypeScript typecheck.
- `npm run smoke:pi` with the installed host SDK: real Pi package/resource
  loading, exactly one advertised skill, four tool registrations, direct native
  tool execution, Markdown rendering, DOCX export and overwrite/cancel guards.
  No model calls, API credentials, package installs or user settings changes.
- `npm run example`: synthetic manuscript rendered and exported in both modes.
- LibreOffice **26.8.1.1**: successful PDF export, DOCX re-save and ODT conversion
  using an isolated temporary profile. All **12 Zotero custom properties and
  four bookmark ranges** survived both document conversions unchanged. Inspected
  the rendered PDF visually and checked its text. Reproducible with
  `python scripts/verify-office.py output/example/manuscript.docx`.
- `npm pack --dry-run`: installable resources and supporting skill files present;
  no reference library, credentials, generated artifacts or platform binary.
- An actual Termux SELinux hardlink restriction was encountered and fixed:
  exclusive-copy fallback retains no-clobber behavior; full publication atomicity
  is not claimed for that fallback.

### Gates and limits at initial publication (22 October 2026)

This records the initial alpha's evidence. The dated follow-up below supersedes
the local-API and LibreOffice Refresh gaps; unlisted gates remain open.

- **Actual Zotero-toolbar Refresh remains unverified.** This backend has
  LibreOffice but no discoverable Zotero installation/standard integration.
  [The manual acceptance procedure](office-interop.md) is a separate gate; ZIP
  checks and office round trips must not be described as passing it.
- A [GitHub Actions template](ci/README.md) covers native Linux amd64/arm64 with
  Node 22.19/24 but is **not active**. GitHub rejected a workflow push because
  the current OAuth credential lacks `workflow` scope. Authentication permissions
  were not changed; the workflow was retained as a non-executable template.
  Until CI runs, those targets are supported by design, not locally verified.
- Real-library local/Web API retrieval has not been exercised here; deterministic
  API fixtures test request/response contracts without touching private data.
- No first-class Zotero write/import adapter, DOCX-to-Markdown import, native ODT
  generator, footnote/endnote style support, embedded images, universal Markdown
  rendering, or legacy project migration. These are separate future capabilities,
  not hidden fallbacks or requirements for review/extraction work.

### Main-profile live integration (24 October 2026)

- Reaffirmed the skills-first design: scientific methods, fields, sequence,
  artifacts and reference-manager choice remain with the researcher/agent.
  Helpers perform bounded operations. The extension still has exactly four
  tools; no new orchestration or background service was added.
- Added a standalone Zotero CLI for target inspection, search, selected-ID
  snapshots and explicit imports through the existing Connector HTTP importer.
  Metadata retrieval, identity verification and output publication stay separate
  from scientific decisions. Existing files are protected; imports are never
  automatically retried after an uncertain write response.
- Used the user's **main native Zotero 10.0.6 profile** and selected collection
  for two public test records: DOI `10.1136/bmj.n71` and
  `10.1371/journal.pmed.1000097`. The app's own importer saved Crossref RIS
  metadata; no database access or custom Zotero plugin was used. Retrieved both
  records through the local HTTP API with one-record pagination, then fetched
  their verified library-qualified identities into a citation snapshot. A
  mismatching selected-target guard rejected an import before writing.
- Rendered an APA manuscript from those actual records: three citation clusters,
  two bibliography entries, repeated references and a test page locator. Rendering
  was idempotent. Exported bookmark and Word-field DOCX variants.
- **Actual standard Zotero Refresh passed in main LibreOffice.** With LibreOffice
  26.2.6.3 and bundled integration 9.0.2, activated the Writer document and invoked
  the same standard UNO `refresh` entry point as the toolbar. Zotero rebuilt all
  deliberately stale citation/bibliography caches, resolved the canonical URIs
  to library items, and preserved Unicode and four live bookmark ranges. Saved,
  closed, reopened, refreshed again and saved successfully. Debug logging was
  disabled afterward. An earlier dispatch without an active Writer frame failed
  in the standard plugin; activating the frame fixed the test, with no exporter
  change needed.
- Separately ran LibreOffice DOCX re-save, ODT conversion and PDF export on the
  synthetic example: all 12 custom properties and four bookmark ranges survived.
  These structural checks remain distinct from the actual Refresh test above.
- Temporary app profiles created during initial setup were removed at the user's
  request. The real test papers remain in the user's selected Zotero collection.
  Generated documents, snapshots, receipts and validation evidence stay under
  ignored `output/live-zotero/`, outside the committed package.

Still unverified: Word integration, standard Add/Edit Citation and style-change
dialogs, embedded-only reference fallback, live Web API access, and Linux arm64.
The original native arm64 Termux evidence does not validate later code changes.
The GitHub Actions template remains inactive. No legacy database migration,
DOCX-to-Markdown importer, native ODT generator, images or footnote-style support
was added.

### Identifier, abstract and inline-citation follow-up (24 October 2026)

- Compared the original plugin at `main` commit `859824b`. Its native identifier
  payloads were DOI, PMID, arXiv and ISBN; the custom conversion was PMCID to PMID.
  The independent resolver now retains that distinction, normalization and
  provenance. HTTP imports use Zotero's existing RIS/PubMed XML/BibTeX translators.
  ISBN, explicitly versioned arXiv and PubMed books are directed to native Zotero
  lookup before any write, instead of building another translator service.
- Live checks converted `PMC2707599` to verified PMID `19621072` and its DOI.
  Imported PMID `100` and arXiv `1706.03762`, both without a DOI, plus PMID
  `26978244` (FAIR Principles), into the same main-profile collection. Five test
  records in total remain there. This tests metadata transport, not scientific
  recommendations or inclusion decisions.
- Added a standalone OpenAlex collector with source-preserving JSON, bounded
  pagination and reconstruction of `abstract_inverted_index`. Optional read-only
  Zotero enrichment requires exact DOI/PMID matches and rejects conflicting or
  ambiguous identities. Preserved the original metadata rule: retain Zotero text
  unless shorter than 100 trimmed characters and OpenAlex is longer. Raw OpenAlex
  metadata, Zotero source text and provenance remain available independently of
  the researcher's eventual extraction format.
- Live OpenAlex checks retrieved the PRISMA 2020 and FAIR records. Reconstructed
  the PRISMA abstract (877 characters) where the Zotero entry lacked one; for FAIR,
  matched the main-profile Zotero item by both DOI and PMID and selected its
  851-character abstract according to the inherited rule. Empty-source cases,
  malformed indices and conflicting matches also have offline regression tests.
- Added a render-only citation CLI using the existing `sr-cite:` link grammar.
  With live metadata in memory it updates one manuscript in place; offline
  snapshots and a separate output are optional alternatives. Real main-profile
  testing refreshed empty and stale labels, preserved ordinary brackets, an
  author/year-looking ordinary bracket and a literal code example, retained
  citation identities, and produced identical Markdown on a second refresh.
  Regression tests cover first/subsequent CSL rules and complete-document order.

### User-controlled service setup (24 October 2026)

- Added one user-invoked `/review-setup` Pi command, with service status,
  official account/key links, local key entry/replacement/removal, and guidance
  for hidden terminal entry. The four model tools remain unchanged in count.
  Pi's standard dialog echoes input while typing but passes it to the command
  handler without adding a model message. Noninteractive use reports CLI guidance.
- Added a shared per-user private credential file outside the project, using
  XDG configuration or the user's home directory. Environment variables take
  precedence. This is filesystem-protected plaintext, not an encrypted keychain.
  Status and errors omit values, suffixes and lengths. Local Zotero never needs
  these credentials or reads the Web configuration.
- OpenAlex harvesting, optional Zotero Web enrichment, the Zotero CLI,
  standalone citation refresh, and the Pi Zotero tool reuse configured keys.
  Pure library operations still accept explicit keys without a config dependency.
  Existing public/unauthenticated access remains available where supported.
- Tested private file permissions, malformed config, bounded hidden/stdin entry,
  cancellation, environment precedence, no secret output, and saved-key reuse
  across helpers. Exclusive mutation locks reject overlapping updates instead
  of silently discarding another service's key. Real registered-command testing uses the installed Pi loader;
  a real terminal prompt also saved/removed a synthetic key with no input echo.
  All setup tests use isolated synthetic credentials. No real account key was
  read, saved, or remotely validated; setup itself makes no network requests.

### Executable-source verification before service setup (24 October 2026)

| Target | Execution evidence |
| --- | --- |
| Linux x86-64, Node 22.22.1 | `npm test`: 116 passed, no failures/skips; `npm run check`: 28 JS modules and 11 skills; real Pi 1.3.0 package-loader smoke; synthetic Markdown and both DOCX modes; package dry run |
| Native Android Termux x86-64, Node 24.18.0 | Same 116 tests passed, no failures/skips; same checks and synthetic exports; executable-source hashes match final sources |
| Native Android Termux arm64 | Initial alpha's 64-test evidence above; this follow-up has not been rerun there |
| Linux arm64 | No execution evidence yet; inactive CI template includes this target |

The Android x86-64 run used the existing Android 17 Cuttlefish device, native
Termux Node under the Termux UID via `run-as` (SELinux `runas_app` context).
Its isolated code-test directory was removed; app profiles/settings were not
changed. No Pi peer was installed there, so that run does not claim Android
package-loader validation. The package dry run includes all helpers and supporting
skills and excludes generated outputs, reference libraries and credentials.

Additional regressions cover exact-identifier conflicts during enrichment,
malformed indexed abstracts, source edits during citation refresh, and import
preflight matching Zotero's accepted RIS/BibTeX/XML grammar. Metadata-only imports
reject attachment fields and unexpected extra records before Connector writes.

### Final verification including service setup (24 October 2026)

- Linux x86-64, Node 22.22.1: **142 tests passed**, no failures or skips;
  resource/syntax checks passed for **34 JS modules and 11 skills**. Pi 1.3.0's
  installed loader discovered one umbrella skill, four tools and the setup
  command. Synthetic setup exercised the actual command, saved-key Web fallback,
  local mode independence, and secret-free outputs without a network or model call.
- Native Android Termux x86-64, Node 24.18.0: the same **142 tests**, resource
  checks and synthetic Markdown/bookmark-DOCX/Word-field-DOCX example passed.
  Executable/package hashes matched the tested snapshot. The isolated code-test
  directory was removed; no application profile or setting was changed. The
  setup run used a temporary config override, never the user's credential file.
- The Linux synthetic example passed in both DOCX modes; the 65-file package
  dry run includes setup libraries, helpers and guidance and excludes generated
  review outputs and credentials. `git diff --check` passed.
- Latest ARM64 execution and Android Pi-loader checks remain unverified. The
  real main-profile Zotero/LibreOffice checks above are separate evidence; this
  setup follow-up does not claim live account authentication with a real API key.

### Optional browser setup and inventory (24 October 2026)

- At the user's explicit request, added a narrow exception to the architecture
  boundary for a temporary credential setup page. `setup.mjs set SERVICE --web`
  focuses one service; `setup.mjs serve` opens both. The CLI prints a capability
  URL for the user or their agent's browser. It does not launch a browser or
  become a daemon, and it adds no dependencies or model tools.
- The page uses the same credential library, showing account links and safe
  status, password entry, save/replace/remove and Done. Existing credentials are
  never returned or prefilled. It binds only `127.0.0.1`, expires within ten
  minutes, and stops on Done or interruption. Requests have size/time bounds;
  capability routes, exact Host/Origin checks and restrictive response headers
  protect the local credential endpoint. A remote browser needs an explicitly
  configured route to the host's loopback address.
- Actual in-app browser testing used a temporary synthetic config: saved a fake
  key, reloaded to verify status persistence and empty password input, removed
  the key, and selected Done. The CLI exited successfully. Screenshot evidence
  is under ignored `output/setup-web/`; the temporary config directory was
  removed and real credentials/profiles were untouched.
- **157 tests passed** on Linux x86-64 (Node 22.22.1) and native Android Termux
  x86-64 (Node 24.18.0), with no failures/skips. Checks passed for **37 modules
  and 11 skills**. HTTP tests exercise actual loopback requests, origin/host
  rejection, malformed/oversized/slow bodies, expiry and cancellation. Android
  executable hashes matched the tested sources and its temporary directory was
  removed. Current ARM64 code and Android Pi-loader validation remain untested.
- Installed Pi discovery still passed with one umbrella skill, four model tools
  and the setup user command. Synthetic Markdown and both DOCX modes passed.
  The 69-file package dry run includes the server and inventory docs, excluding
  generated outputs and credentials. Added [the complete capability inventory](capabilities.md)
  to distinguish model tools, helper CLIs and optional research guidance.

### Local-only Zotero (24 October 2026)

- The project owner confirmed their native Zotero port is apt-installable in
  Termux and requested local-only integration. Removed Zotero cloud endpoints,
  API-key use, model-tool mode selection, CLI `--mode`, and Zotero credential
  controls from terminal, Pi and browser setup. All live Zotero operations use
  the running application's loopback HTTP API; offline snapshots remain valid.
  Earlier dated Web-API setup/validation entries above describe retired work.
- OpenAlex retains its optional key and browser setup. Zotero now has only local
  connection guidance. Legacy stored Zotero fields are ignored, hidden and left
  intact during OpenAlex updates; no real credential file was read or changed.
  Old cloud requests fail before fetching rather than silently reading a local
  library. Local library scopes, groups, canonical identities, server checks,
  identifier imports and citation refresh are preserved.
- Updated active documentation, capability guidance and contributor boundaries
  for the owner's native Termux port without guessing package repositories or
  claiming a new Zotero installation test. A real read-only Connector check
  still reached the user's running main Linux Zotero profile and its C1 target.
- **162 tests passed** with no failures/skips on Linux x86-64 and native Android
  Termux x86-64; checks passed for **37 modules and 11 skills**. Installed Pi
  discovery, local-only tool execution, synthetic Markdown and both DOCX modes
  passed. Android executable/package hashes matched and its temporary code-test
  directory was removed without changing app profiles/settings. Package dry-run
  and `git diff --check` passed. Current ARM64 and Android Pi-loader coverage
  remain unchanged from the limitations recorded above.

### Ten-paper use trial and semantic ranking (24 October 2026)

Acceptance for this follow-up includes an actual model-driven Pi run, ten real
local Zotero references, source-grounded extraction and a complete cited report,
an audited office refresh, and real local embeddings over a mixed corpus. The
report is a bounded methods demonstration, not a validated systematic review.
All real references, source text, model logs, embeddings and report outputs stay
under ignored `output/trial-10-papers/`; they are not package fixtures.

- Real OpenAlex retrieval exposed malformed abstract positions that caused a
  whole harvest to fail. Decoding remains strict, but an affected record now
  retains its original metadata and an explicit `abstractIssue`, empty decoded
  abstract, and warning count. Other records remain usable. Invalid identities,
  pages and request failures still abort publication; no words are invented.
- Added a read-only Zotero attachment manifest and cached-text helper. It
  verifies the library and parent relationship, exposes pagination and indexing
  coverage, and distinguishes missing, empty and partial text. It does not
  download, copy or index PDFs. Live trial items had no attachments, so actual
  cached-text success is a separate unfulfilled gate; synthetic tests cover it.
- Added an optional standalone embedding/cosine helper and capability guide.
  Combined titles and abstracts retain stable IDs, original metadata, missing
  text flags, explicit model/prefix recipe and reusable vectors. No threshold
  chooses eligibility. The guide calls for inspecting multiple texts around and
  below any proposed boundary, including lower/random bands, missing abstracts
  and relevant exceptions; a negative sample does not prove the unseen tail empty.
- At the owner's explicit request, configured the existing native llama.cpp
  router and downloaded a pinned Apache-2.0 Nomic embedding GGUF into the user's
  model cache. This is a local test runtime outside the package, not a bundled
  model, automatic installer, mandatory daemon or Pi replacement. The extension
  still exposes four tools and one umbrella skill; eleven capability guides
  and six standalone research/setup CLIs are now available.

- Imported ten selected methods reports into the main local Zotero collection,
  verified canonical identities, and retrieved six full XML article texts plus
  four abstracts. A linked erratum was retrieved and added as an eleventh
  supporting reference; the sample remains ten main reports. Original metadata
  and article texts remain unchanged. Source checks found a publication-year
  mismatch and an internally inconsistent table aggregate, recorded separately
  from software defects. Figures/PDFs and linked supplements were not inspected.
- Pi 1.4.0 with the user's existing `openai-codex/gpt-6.1-sol` configuration ran
  actual model/tool calls through its installed RPC client. The initial run read
  all sixteen designated evidence text files through EOF in bounded chunks, then
  used all four native review tools to produce extraction, Markdown and DOCX.
  Revisions incorporate separate agent audits and the supporting correction;
  this is not independent human validation.
- The native CUDA router ranked 153 distinct OpenAlex records with Nomic Embed
  Text v1.5: 154 paper/query inputs, 768 dimensions, explicit task prefixes and
  pinned weights. The exact-input tokenizer audit found a maximum of 1,189
  tokens, within the configured 2,048-token limit. Twenty records initially
  lacked usable abstracts; no score-based exclusions were made.
- An identical live cache rerun made zero requests and reproduced every score.
  Adding the verified missing abstract to one record recomputed one vector,
  reused 153 and left all other vectors/scores unchanged. Its score decreased
  from 0.7789 to 0.7653 (rank 33 to 38), reinforcing that completeness and
  scientific eligibility cannot be inferred from a universal numeric boundary.
- **191 offline tests passed** with no failures/skips on Linux x86-64 and native
  Android Termux x86-64. Checks passed for **42 modules and 12 skill files**;
  installed Pi discovery, synthetic Markdown and both DOCX modes passed. The
  Termux source snapshot matched the tested executable files and its temporary
  code directory was removed. The 76-file package dry run excluded credentials,
  model weights, source corpora and generated outputs; `git diff --check` passed.
  Current ARM64 execution and Android Pi-loader coverage remain unverified.

- Separate source/claim reconciliation passed after revision. The final Markdown
  has 31 citation occurrences, exactly 11 verified scoped Zotero identities and
  11 bibliography entries; a second render is identical. A second audit verified
  that root's final status-only prose edits preserve every substantive finding,
  limitation and identity. Actual Pi artifacts, final hashes, source checks and
  read-coverage logs are retained separately in the ignored trial directory.
- Semantic assessment scanned all 153 titles and recorded 53 judgments: 33
  complete available abstract/description fields and 20 missing-abstract cases.
  It found 15 relevant, 10 off-topic and 28 uncertain records, leaving 100
  available abstract fields unread. Six relevant records fell below the explored
  0.80 line, including one at 0.7456. Band/tail/random sampling, exact text and
  judgments were independently checked. No records were excluded and no recall
  estimate or human adjudication is claimed. Supporting files and overlapping
  versions are distinguished from independent studies.
- Independent code review of the embeddings library/CLI, all sixteen tests and
  shared request/file helpers found no material functional defects; the sixteen
  embedding tests passed again. Server-side token truncation and changed weights
  behind an unchanged model alias remain explicit external limitations.
- The first actual main-profile Office/Zotero pass rebuilt all 31 citation labels
  and 11 bibliography entries, retained the scoped identities, and passed a
  save/reopen/refresh challenge. Six-page visual inspection found two pagination
  defects: a single-line paragraph start and a reference DOI stranded on the next
  page. Added normal-paragraph widow/orphan control and kept bibliography entries
  together in the exporter. All 191 Linux tests, checks, installed Pi discovery,
  synthetic examples and package dry-run passed again. The regenerated DOCX is
  the only report artifact whose content/hash changed.

- Native Termux x86-64 reverification of the final pagination code also passed
  all 191 tests, checks and both synthetic DOCX modes. Executable/package hashes
  matched; the temporary test directory was removed. Durable results and hashes
  are retained in the trial's ignored verification directory.

- The corrected report passed genuine Zotero Refresh and save/close/reopen/Refresh
  in the user's main LibreOffice/Zotero profiles. Each challenge deliberately
  invalidated visible caches and observed all 42 text runs restored. All 31
  citation occurrences, one bibliography bookmark, eleven canonical references,
  ordered citation metadata and document preferences survive the round trip.
  The exported source is unchanged. Saved DOCX/PDF and detailed evidence remain
  in the ignored `office-validation` directory; the initial pass is preserved.
- All six final PDF pages were visually inspected with separate agent review.
  The body orphan and lone DOI were resolved, with no clipping, overlap or
  missing glyphs. Zotero Refresh applies its own bibliography style, so one
  reference still splits normally with two lines on each page; the exporter
  does not dictate the refreshed application's paragraph layout. This report has
  no tables, so this visual check does not extend table coverage.
