# Systematic Reviewer V3

**A native Pi package for flexible, traceable evidence work.** This is a fresh
rewrite on the orphan `V3` branch, not the Zotero application's UI or another
agent harness. The original application remains on `main`.

## Design

- **One umbrella skill**, with attached capabilities loaded only when needed:
  protocol, harvesting, PDF/vision reading, screening, extraction, appraisal,
  analysis, writing and verification. These are capabilities, not a fixed workflow.
- **Your artifacts, your tools.** Excel, CSV, Markdown, JSON, scripts or an
  optional database; no compulsory columns, store, model, OCR provider or subagent.
- **Pi owns the harness:** models, sessions, context, tool use and optional
  delegation. Existing full-read/chunked-read capabilities are reused.
- **Existing Zotero APIs**, no new Zotero plugin. A read-only adapter retrieves
  verified identities and CSL metadata; an offline snapshot works too.
- **Readable Markdown, live office citations.** Render author/date or numeric
  labels alongside durable Zotero identities, then export Zotero-linked DOCX.
  Use Zotero's standard LibreOffice/Word integration for Refresh and style changes.
- **Small separable tools.** The Crossref harvest script works independently of
  Pi; citation libraries run without an office process or network.

## Install into Pi

Requires Node **22.19+** and Pi with the current `@earendil-works` extension API
(tested with Pi 1.3.0). Install the package, not a second harness:

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

## Tools

| Tool | Purpose |
| --- | --- |
| `review_zotero` | Search one bounded page or retrieve selected references through Zotero's existing local/Web API into a JSON snapshot |
| `review_citation` | Build a citation marker from verified IDs and optional locators/affixes |
| `review_render_citations` | Render the complete Markdown manuscript with CSL, preserving identities and optional bibliography |
| `review_export_docx` | Export a manuscript with embedded Zotero metadata; cross-office bookmarks by default, optional Word fields |

Example source and rendered form:

```markdown
Evidence [cite](sr-cite:users/123/items/ABCD2345).
Evidence [(Smith, 2024)](sr-cite:users/123/items/ABCD2345).
```

That ID is **synthetic**. Real IDs must come from the actual library. Complex
clusters/locators are encoded by `review_citation`. Existing files are protected
unless overwrite is explicit. See [citation format, API setup and usage](docs/citations.md).

## Platforms and optional applications

The same portable core targets **native Linux amd64, Linux arm64 and Android
Termux**. Tests have been run here on aarch64 Termux. A [Linux CI template](docs/ci/README.md)
for both architectures is included but inactive: the current GitHub login lacks
`workflow` scope. Do not substitute glibc Linux binaries for Termux's Bionic packages.

Zotero desktop is optional when using the Web API or existing reference files.
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

## Status and limits

**Alpha implementation, not a validated research product.** Offline tests and
Pi's real package loader pass on Termux. LibreOffice 26.8.1.1 opened the example,
rendered a visually inspected PDF, and preserved all citation bookmarks and
custom properties through DOCX re-save and ODT conversion. An actual Zotero
Refresh has **not** been verified here: Zotero and its office integration were
not found in this backend. See the [office validation procedure](docs/office-interop.md).

The bundled author–date style is deliberately minimal, **not APA**. Supply an
independent in-text CSL style for real work and install it in Zotero before
Refresh. Cached labels/bibliographies are plain text; Zotero Refresh applies
rich citation styling. Footnote styles, DOCX-to-Markdown round trips, images,
raw HTML and some advanced Markdown features are not supported by the exporter;
unsupported content fails rather than disappearing. There is no legacy database
migration or automatic unreviewed screening/extraction.

## Documentation

- [Implementation plan and validation log](docs/implementation-plan.md)
- [Contributor instructions](AGENTS.md)
- [Umbrella review skill](skills/systematic-review/SKILL.md)
- [Research artifacts and handoffs](docs/research-artifacts.md)
- [Citations and Zotero API](docs/citations.md)
- [Office interoperability](docs/office-interop.md)
- [Harvesting](docs/harvesting.md)
- [Citation asset licensing](assets/NOTICE.md)

## License

Copyright (C) 2026 Rutkauskas L. and contributors. [AGPL-3.0-or-later](LICENSE).
The bundled CSL locale retains its separate CC BY-SA 3.0 license and attribution.
Independent third-party project; not affiliated with Pi, Zotero or LibreOffice.
