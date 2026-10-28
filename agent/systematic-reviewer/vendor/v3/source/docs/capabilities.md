# Tools, commands and skills

V3 exposes four model-callable Pi tools and one user command. Six standalone
CLIs handle bounded setup and research operations. One advertised skill loads
eleven supporting capability guides only when useful. Choose the methods, fields,
order and artifacts for the research question; none of these lists is a workflow
to complete in sequence.

## Pi tools

These tools are registered by [the extension](../extensions/index.js).

| Tool | What it does | Output or external effect |
| --- | --- | --- |
| `review_zotero` | Searches one bounded page or retrieves selected verified references through Zotero's local API. | Writes a requested CSL reference snapshot; does not modify Zotero. |
| `review_citation` | Builds a durable Markdown marker from verified Zotero identities, with optional locators and affixes. | Returns marker text; does not write a file or fetch references. |
| `review_render_citations` | Renders the complete Markdown manuscript with an offline snapshot and CSL style, preserving citation identities and document order. | Writes rendered Markdown and an optional bibliography. |
| `review_export_docx` | Renders and exports a manuscript with Zotero citation metadata, document preferences and bibliography support. | Writes DOCX in cross-office bookmark mode or Word field mode. |

Rendering/export defaults to the bundled minimal author-date style, not APA.
The live-citation bridge currently targets Zotero. Other reference managers can
be used through their available APIs, tools or exports; the package does not
provide universal live-citation interoperability. See [citations](citations.md).

## User command and standalone helpers

`/review-setup [status|openalex]` is a user-invoked Pi command, not a model
tool. It shows OpenAlex status and account links and supports local key entry,
replacement/removal, hidden terminal guidance and browser-setup instructions.
Keys do not enter model messages. Local Zotero needs no API key. See
[service setup](setup.md), including the optional temporary browser form.

Run the following from the package directory; `--help` documents current
arguments. They also work independently of Pi.

| CLI | What it does | Operations and limits |
| --- | --- | --- |
| [`scripts/setup.mjs`](../scripts/setup.mjs) | Manages the optional OpenAlex key and explains local Zotero access. | `status`, `set openalex`, `remove openalex`; hidden terminal entry, `--stdin`, or optional `set openalex --web` / `serve` browser setup. `OPENALEX_API_KEY` overrides the saved key. [Guide](setup.md) |
| [`scripts/openalex.mjs`](../scripts/openalex.mjs) | Searches/filters OpenAlex, reconstructs indexed abstracts and optionally enriches them from exactly matched existing Zotero records. | Saves bounded JSON with provenance; does not import items or decide eligibility. [Guide](openalex.md) |
| [`scripts/harvest.mjs`](../scripts/harvest.mjs) | Searches Crossref and saves original metadata with query/page provenance. | Up to 1,000 records; independent `harvestCrossref` library function; no full-text retrieval or Zotero import. [Guide](harvesting.md) |
| [`scripts/zotero.mjs`](../scripts/zotero.mjs) | Reads references, attachment lists and cached text; resolves identifiers and explicitly imports supported metadata. | `search`, `snapshot`, `attachments`, `attachment-text`, `target`, `resolve`, `import`, `import-doi`; imports write to the selected library/collection and can create duplicates. Cached-text coverage is reported separately from source completeness. [Guide](zotero-cli.md) |
| [`scripts/citations.mjs`](../scripts/citations.mjs) | Refreshes citation labels and an existing bibliography in one Markdown file. | `render` uses an offline snapshot or live local Zotero metadata; writes a new file or explicitly updates in place. It does not export DOCX. [Guide](citations.md) |
| [`scripts/embeddings.mjs`](../scripts/embeddings.mjs) | Embeds titles and abstracts through an explicitly selected compatible endpoint, caches vectors and ranks papers against a topic by cosine. | `rank`; retains original records, missing-text flags and provenance. No automatic eligibility cutoff, vector database or model download. [Guide](semantic-search.md) |

Zotero identifier resolution accepts DOI, PMID, PMCID, arXiv and ISBN, retaining
input mappings and provenance. It normalizes native identifiers and converts
PMCID to PMID when needed. Helper imports support DOI, PubMed articles and
unversioned arXiv metadata; ISBN, PubMed books and versioned arXiv require Zotero's
native Add by Identifier. Neither resolver nor import requires every reference
to become a DOI. Imported metadata contains no PDFs or attachments.

## Skill and capability guides

`/skill:systematic-review` loads the single advertised
[umbrella skill](../skills/systematic-review/SKILL.md). It routes to the following
guides when their guidance is relevant. They are instructions for the agent,
not executable screening, extraction or analysis engines, and are not separately
advertised Pi skills.

| Capability | Guidance it supplies |
| --- | --- |
| [Protocol](../skills/systematic-review/capabilities/protocol/SKILL.md) | Frame questions, methods, eligibility criteria and explicit amendments without imposing a schema or registration. |
| [Harvesting](../skills/systematic-review/capabilities/harvesting/SKILL.md) | Design and document searches, retrieve sources, resolve identities, deduplicate conservatively and update collections. |
| [Semantic search](../skills/systematic-review/capabilities/semantic-search/SKILL.md) | Explore embedding rankings and inspect multiple actual titles/abstracts across score bands; retain uncertainty about unreviewed records and missed relevant papers. |
| [Full text and PDF](../skills/systematic-review/capabilities/full-text/SKILL.md) | Use available text extraction and page rendering, inspect with vision where useful, and retain page coverage and provenance. |
| [Evidence reading](../skills/systematic-review/capabilities/evidence-reading/SKILL.md) | Interpret and verify source passages, tables, figures and supplements, distinguishing excerpts from full-text reading. |
| [Screening](../skills/systematic-review/capabilities/screening/SKILL.md) | Apply agreed criteria, retain evidence and uncertainty, and reconcile decisions without unreviewed exclusions. |
| [Extraction](../skills/systematic-review/capabilities/extraction/SKILL.md) | Capture the study characteristics, values or findings needed for the question, with source locators and explicit derivations. |
| [Appraisal](../skills/systematic-review/capabilities/appraisal/SKILL.md) | Apply the chosen design-appropriate appraisal or certainty framework and explain domain judgements. |
| [Analysis](../skills/systematic-review/capabilities/analysis/SKILL.md) | Perform reproducible quantitative, narrative, qualitative or mixed-evidence synthesis with explicit assumptions and dependencies. |
| [Writing](../skills/systematic-review/capabilities/writing/SKILL.md) | Draft evidence-grounded reports in chosen artifacts, preserve citation identities and use the Zotero bridge when requested. |
| [Verification](../skills/systematic-review/capabilities/verification/SKILL.md) | Audit evidence, decisions, counts, calculations, citations, exports or delegated handoffs to the extent required. |

PDF tools, vision, office applications and subagents are optional capabilities of
the host environment. The package does not bundle an OCR service, statistical
engine, research database or separate agent loop. Researchers can use spreadsheets,
Markdown, CSV, JSON, scripts or an optional database, and retain their chosen
review process.

## Development and verification entrypoints

These maintain or test the package; they are separate from research capabilities.

| Entry point | Purpose |
| --- | --- |
| `npm test` | Runs the offline synthetic Node test suite. |
| `npm run check` / [`scripts/check.mjs`](../scripts/check.mjs) | Checks JavaScript syntax, package registration, skill metadata and local documentation links. |
| `npm run example` / [`scripts/example.mjs`](../scripts/example.mjs) | Generates a fictional Markdown manuscript and both DOCX modes in a new output location. |
| `npm run smoke:pi` / [`scripts/smoke-pi.mjs`](../scripts/smoke-pi.mjs) | Exercises the installed Pi package loader, registration and representative operations with synthetic inputs. |
| [`scripts/verify-office.py`](../scripts/verify-office.py) | Uses an installed LibreOffice and isolated temporary profile for DOCX/ODT round-trip checks. It does not establish actual Zotero Refresh behavior. |

See the [validation log](implementation-plan.md) for checks actually run and
[office interoperability](office-interop.md) for the distinction between archive
structure, office round trips and live Zotero validation.
