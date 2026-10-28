# Systematic Reviewer V3

**A native Pi package for flexible, traceable evidence work.** This is a fresh
rewrite on the orphan `V3` branch, not the Zotero application's UI or another
agent harness. The original application remains on `main`.

## Design

- **One umbrella skill**, with attached capabilities loaded only when needed:
  protocol, harvesting, semantic search, PDF/vision reading, screening, extraction, appraisal,
  analysis, writing and verification. These are capabilities, not a fixed workflow.
- **Your artifacts, your tools.** Excel, CSV, Markdown, JSON, scripts or an
  optional database; no compulsory columns, store, model, OCR provider or subagent.
- **Pi owns the harness:** models, sessions, context, tool use and optional
  delegation. Existing full-read/chunked-read capabilities are reused.
- **Existing local Zotero APIs**, no new Zotero plugin. A read-only adapter retrieves
  verified identities and CSL metadata; an offline snapshot works too.
- **Readable Markdown, live office citations.** Render author/date or numeric
  labels alongside durable Zotero identities, then export Zotero-linked DOCX.
  Use Zotero's standard LibreOffice/Word integration for Refresh and style changes.
- **Small separable tools.** Crossref and OpenAlex collectors work independently of
  Pi; the Zotero CLI resolves identifiers and explicitly imports metadata through
  Zotero's HTTP interfaces. Citation libraries run without an office process or
  network. Helpers serve the user's chosen methods, fields and artifacts.

## Install into Pi

Requires Node **22.19+** and Pi with the current `@earendil-works` extension API
(tested with Pi 1.3.0 and 1.4.0). Install the package, not a second harness:

```sh
pi install git:github.com/openresearchtools/systematic-reviewer@V3
```

Start a new Pi session or `/reload`, then:

```text
/skill:systematic-review
```

Describe the review task and existing files. The agent loads only the relevant
attached guidance. For a local checkout:

```sh
npm ci --ignore-scripts --legacy-peer-deps
pi install /absolute/path/to/systematic-reviewer
```

Use `pi install -l ...` for project-scoped installation. Package dependencies
are pure JavaScript; there are no lifecycle downloads, native addons, daemons,
or global settings changes by the extension. Pi supplies its SDK and TypeBox
as peer dependencies.

For OpenAlex, run `/review-setup` in Pi. It shows account links and lets you save
or remove its API key locally. `node scripts/setup.mjs set openalex` provides hidden terminal entry;
add `--web` for an optional local browser form, or use
`node scripts/setup.mjs serve` for the same setup page. Open the URL printed by the
helper and enter the key yourself. The browser must reach the helper on the same host.
Helpers reuse the same private file outside the repository; `OPENALEX_API_KEY`
overrides the saved key. Zotero uses only its running local application's
HTTP interfaces and needs no key. See [service setup](docs/setup.md).

## Tools

| Tool | Purpose |
| --- | --- |
| `review_zotero` | Search one bounded page or retrieve selected references through Zotero's existing local API into a JSON snapshot |
| `review_citation` | Build a citation marker from verified IDs and optional locators/affixes |
| `review_render_citations` | Render the complete Markdown manuscript with CSL, preserving identities and optional bibliography |
| `review_export_docx` | Export a manuscript with embedded Zotero metadata; cross-office bookmarks by default, optional Word fields |

These are the four model-callable Pi tools. The
[complete tools and skills inventory](docs/capabilities.md) also lists the
`/review-setup` user command, six standalone helper CLIs, eleven capability guides,
and development checks. Skills guide the agent's work; they do not impose a
sequence, scientific method, extraction schema, or artifact format.

Example source and rendered form:

```markdown
Evidence [cite](sr-cite:users/123/items/ABCD2345).
Evidence [(Smith, 2024)](sr-cite:users/123/items/ABCD2345).
```

That ID is **synthetic**. Real IDs must come from the actual library. Complex
clusters/locators are encoded by `review_citation`. Existing files are protected
unless overwrite is explicit. See [citation format, API setup and usage](docs/citations.md).

## Platforms and optional applications

The same portable core targets **Linux x86-64/amd64 and arm64, and Android Termux
x86-64 and arm64**. Tests have run on Linux x86-64 and native Termux x86-64;
the initial alpha was also tested on native aarch64 Termux. Linux arm64 has not
yet been executed. See the dated [validation log](docs/implementation-plan.md)
for exact coverage. A [Linux CI template](docs/ci/README.md) is included but
inactive. Do not substitute glibc Linux binaries for Termux's Bionic packages.

Live Zotero access uses the running local application; existing reference
snapshots support offline rendering and export without it. On Termux, the project
targets its owner's native Zotero port, installable with apt from the
user's configured repository. Use that port's documented repository/package
instructions; its installation and local API on each device remain separate
validation checks.

LibreOffice/Word and Zotero's standard office integration are needed only for
interactive live-citation refresh/editing, not initial rendering/export. PDF
reading uses whatever appropriate tools are available: text extraction first,
page images and agent/subagent vision where needed. Optional binaries are
selected for the host platform, never downloaded or installed automatically.

## Standalone use and verification

```sh
npm ci --ignore-scripts --legacy-peer-deps
npm test
npm run check
npm run example
```

The example creates `output/example/` containing rendered Markdown and DOCX in
both citation modes. All references are explicitly fictional. Use a new output
directory to rerun: `node scripts/example.mjs output/another-example`.

Native Pi loader smoke test (no model or network calls):

```sh
npm run smoke:pi
# If the host SDK is not on this project's Node resolution path:
PI_SDK_ENTRY=/path/to/pi-coding-agent/dist/index.js npm run smoke:pi
```

Optional real LibreOffice round-trip check, using an isolated temporary profile:

```sh
python scripts/verify-office.py output/example/manuscript.docx
```

Independent metadata harvest:

```sh
node scripts/harvest.mjs --query "evidence synthesis" --limit 100 --output harvest.json
```

Read [harvesting](docs/harvesting.md) for search limitations, provenance and retry
behavior. A single Crossref search is not a comprehensive systematic search.

The [OpenAlex collector](docs/openalex.md) takes native search/filter arguments,
reconstructs indexed abstracts, and can read matching Zotero records to enrich
abstracts using the original plugin's metadata-preference rule:

```sh
node scripts/openalex.mjs --query "your search" --limit 100 --output works.json
```

Independent Zotero access:

```sh
node scripts/zotero.mjs --help
node scripts/zotero.mjs search --query "search terms" --output references.json
node scripts/zotero.mjs target
```

The [Zotero CLI guide](docs/zotero-cli.md) covers identifier normalization,
PMCID-to-PMID conversion, explicit imports into the selected Zotero destination,
verified citation identities, pagination and write receipts.
It also lists local attachments and reads Zotero's cached text with indexing
coverage; it does not assume an imported reference has a PDF.

Optional [semantic search](docs/semantic-search.md) combines titles and abstracts,
uses an explicitly configured OpenAI-compatible embedding endpoint (including
llama.cpp), and preserves reusable vectors and provenance:

```sh
node scripts/embeddings.mjs rank --input works.json --query "your research question" \
  --base-url http://127.0.0.1:8080/v1 --model YOUR_EMBEDDING_MODEL \
  --output ranked.json
```

Use the model's required query/document prefixes and verify its input limits.
The helper does not install models or choose an exclusion threshold. The attached
guidance explains how to investigate multiple lower-ranked titles and abstracts,
including exceptions and missing text, before discussing a possible cutoff.

Refresh inline citations in one Markdown file using live Zotero metadata:

```sh
node scripts/citations.mjs render --input draft.md --zotero local --in-place
```

The [citation guide](docs/citations.md) also covers offline snapshots and separate
output files. Citation identity stays inline; empty or stale labels are updated,
while ordinary brackets, links and code examples remain unchanged.

## Status and limits

**Alpha implementation, not a validated research product.** Offline tests and
Pi's real package loader pass on Linux x86-64, with additional native Termux
test coverage recorded in the validation log. Real DOI imports and paginated
metadata retrieval passed against Zotero 10.0.6. Its standard LibreOffice
integration rebuilt stale citations and bibliography in an exported DOCX,
resolved the papers to real library items, then passed save/close/reopen/Refresh
with LibreOffice 26.2.6.3. Word, interactive citation editing and style changes
remain separate checks. See the [office validation procedure](docs/office-interop.md).

The bundled author–date style is deliberately minimal, **not APA**. Supply an
independent in-text CSL style for real work and install it in Zotero before
Refresh. Cached labels/bibliographies are plain text; Zotero Refresh applies
rich citation styling. Footnote styles, DOCX-to-Markdown round trips, images,
raw HTML and some advanced Markdown features are not supported by the exporter;
unsupported content fails rather than disappearing. There is no legacy database
migration or automatic unreviewed screening/extraction.

## Documentation

- [All tools, commands, helpers and skills](docs/capabilities.md)
- [Optional service setup: Pi, terminal or local browser](docs/setup.md)
- [Implementation plan and validation log](docs/implementation-plan.md)
- [Contributor instructions](AGENTS.md)
- [Umbrella review skill](skills/systematic-review/SKILL.md)
- [Research artifacts and handoffs](docs/research-artifacts.md)
- [Citations and Zotero API](docs/citations.md)
- [Standalone Zotero CLI and DOI import](docs/zotero-cli.md)
- [Office interoperability](docs/office-interop.md)
- [Harvesting](docs/harvesting.md)
- [OpenAlex abstracts and Zotero enrichment](docs/openalex.md)
- [Citation asset licensing](assets/NOTICE.md)

## License

Copyright (C) 2026 Rutkauskas L. and contributors. [AGPL-3.0-or-later](LICENSE).
The bundled CSL locale retains its separate CC BY-SA 3.0 license and attribution.
Independent third-party project; not affiliated with Pi, Zotero or LibreOffice.
