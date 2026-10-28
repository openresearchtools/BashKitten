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
5. **Optional adapters.** Local Zotero's read-only API, Zotero's authenticated
   Web API and offline CSL snapshots are independent sources. Harvest helpers
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

### Remaining integration gates / deliberate limits

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
