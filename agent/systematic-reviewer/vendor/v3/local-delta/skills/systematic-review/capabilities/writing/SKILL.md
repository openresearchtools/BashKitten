---
name: writing
description: Draft or revise evidence-grounded review reports with the researcher's citation tools and artifacts; use the bundled Zotero bridge when live-citation DOCX export is requested.
license: AGPL-3.0-or-later
disable-model-invocation: true
---

# Write with traceable claims and live citations

Use for a paragraph, manuscript, methods section, evidence summary, or export.
Apply the [shared safeguards](../../SKILL.md). Respect the researcher's outline,
voice, audience, and file format; do not require a new report template.

## Build the argument from evidence

- Separate included-study findings, background literature, methodological
  choices, and interpretation. Tie consequential factual claims to the correct
  sources and locators. A citation to a review does not imply its primary studies
  were read; disclose secondary sourcing when it cannot be resolved.
- Verify that citations support the actual claim, population, direction, and
  time frame. Keep uncertainty, contradictory evidence, risk of bias, and
  applicability visible. Do not turn absence of evidence into evidence of no
  effect or association into causation.
- Derive counts, tables, and results from the reviewed artifacts and analyses.
  Keep records, reports, studies, participants, and observations distinct. Do not
  invent flow-diagram counts, searches, extraction checks, or reviewer actions.
- Report methods actually used, dated deviations, access gaps, synthesis limits,
  and relevant AI assistance. Use the appropriate reporting guideline/version
  when requested, but do not claim compliance without checking its items.
- Preserve quotations accurately and sparingly with context; paraphrase without
  plagiarism. Never fabricate a quotation, page number, reference, or result to
  make an unfinished draft read smoothly. Label unresolved claims for review.

## Use the selected citation workflow

Keep the researcher's reference manager and existing document conventions. Use
available documented APIs, tools, or exports for that manager and preserve its
identities and citation metadata. An existing bibliography or reference export
can be sufficient for the requested writing task. State when a chosen export is
static or does not preserve live editing; do not claim universal manager support.
The package's implemented live-citation bridge is Zotero-specific.

## Preserve identity in the Zotero bridge

When a single Markdown manuscript is preferred, the standalone citation helper
can refresh it in place using live local Zotero metadata, without a saved reference
snapshot. Read the citation guide and `node scripts/citations.mjs --help` from
the package directory. Empty labels and stale labels use the same `sr-cite:`
identity-bearing link; ordinary bracketed text is not a citation marker. Use
offline snapshots when useful rather than requiring either storage approach.

Before adding markers, refreshing labels, or exporting through this bridge, read
the [citation specification](../../../../docs/citations.md). It defines the accepted
marker format, reference snapshot, tool arguments, and supported modes. If the
documentation or required metadata is unavailable, stop that integration task
and report the gap rather than inventing syntax or a key.

To obtain missing Zotero reference metadata or perform a requested library
import, use the [Zotero helper guide](../../../../docs/zotero-cli.md) and current
help (`node scripts/zotero.mjs --help` from the package directory). Follow
[harvesting](../harvesting/SKILL.md) for identifier resolution and provenance;
do not turn a DOI, PMID, arXiv, ISBN, or PMCID directly into a Zotero item key.

Use only verified library-qualified Zotero item identities. Author/year labels,
bibliography positions, and temporary keys are not stable identities. Preserve
cluster membership, locator metadata, and supported citation modes. Do not
reinterpret source-code examples as actual citations. Keep the offline reference
snapshot and its provenance separate from extraction findings.

When available, use `review_render_citations` on the complete document to refresh
labels and bibliography with the chosen CSL style and locale. Document order,
repeated citations, and disambiguation matter; do not render isolated clusters
and paste them together. Resolve missing items, malformed markers, and unsupported
modes before claiming success. Never fix a rendering error by dropping a source
or flattening a live citation to plain author-date text.

## Export and verify only what was tested

For the bundled Zotero bridge, use `review_export_docx` according to its current
schema, saving a new output unless overwrite is explicit. Retain the source
document, reference snapshot, and style/locale needed to reproduce it. If the
tool is unavailable, provide the source and explain that live-field export has
not been performed.

For other workflows, use the selected manager's available export/integration
and check the properties that matter for that deliverable. Do not translate
foreign keys into Zotero item identities or promise live-field interoperability
without a supported, verified conversion.

For a Zotero-linked DOCX, check that it contains live citation fields, embedded
item metadata, document preferences, and a bibliography field as documented. Keep
these validation claims distinct:

- ZIP/XML structural checks on the produced archive.
- An office open/save round trip with fields inspected afterward.
- An actual Zotero UI/Refresh check in a supported word processor.

None substitutes for the others. Do not claim working Zotero editing from a
visually correct DOCX alone. Report unavailable dependencies and remaining checks;
load [verification](../verification/SKILL.md) for a broader evidence/citation audit.
