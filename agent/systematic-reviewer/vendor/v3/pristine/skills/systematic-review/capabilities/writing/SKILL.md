---
name: writing
description: Draft or revise evidence-grounded review reports, preserve live Zotero citation identities, refresh citation labels, and export DOCX with honest validation claims.
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

## Preserve citation identity

Before adding markers, refreshing labels, or exporting, read the
[citation specification](../../../../docs/citations.md). It defines the accepted
marker format, reference snapshot, tool arguments, and supported modes. If the
documentation or required metadata is unavailable, stop that integration task
and report the gap rather than inventing syntax or a key.

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

Use `review_export_docx` according to its current schema, saving a new output
unless overwrite is explicit. Retain the source document, reference snapshot,
and style/locale needed to reproduce it. If the tool is unavailable, provide the
source and explain that live-field export has not been performed.

Check that the export contains live Zotero citation fields, embedded item
metadata, document preferences, and a bibliography field as documented. Keep
these validation claims distinct:

- ZIP/XML structural checks on the produced archive.
- An office open/save round trip with fields inspected afterward.
- An actual Zotero UI/Refresh check in a supported word processor.

None substitutes for the others. Do not claim working Zotero editing from a
visually correct DOCX alone. Report unavailable dependencies and remaining checks;
load [verification](../verification/SKILL.md) for a broader evidence/citation audit.
