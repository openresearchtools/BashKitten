---
name: writing
description: Draft or revise evidence-grounded review reports with the researcher's citation tools and artifacts; use References and live Collabora when Office writing or export is requested.
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

## Work in the live document

Use the bundled `office` skill and native tool to open/create the document as your
own authenticated participant. Editing does not require an open editor tab.
Open the returned ordinary browser URL when inspecting layout, rendering or a PDF
would help; the existing `browser` tool remains available for visual checks.
Human and agent views share the same document, with separate selection/cursor state.
Read structured text/tables, cells/formulas/ranges or slides/shapes, then edit using
native identities and expected content. Preserve existing citation fields during
prose edits. Do not rewrite a live document's ZIP/XML or save a competing file copy.
Native overlap/undo/conflict semantics still apply; distinct views are not a promise
of conflict-free overlapping edits.

Discover the complete shared References API for library, collection, item, metadata,
abstract, PDF and full-text work. Verify the destination project and returned
`bkref:<backend>/<project>/<item>` identities. Follow
[harvesting](../harvesting/SKILL.md) for provenance and identity conflicts; never
turn a DOI, PMID or title into an invented item key.

Inspect the document's citation binding first. If unset, use the existing Office
`citations.bind` operation with one registered `projectId`, `style:{id,locale}`
and `expectedRevision` plus `expectedNativeSnapshot` from the same
`citations.inspect` result. Search only that bound library;
do not aggregate project databases or retarget an old key. Changing libraries
with managed citations/bibliography needs explicit authorization before
`convertExistingToText:true`: this removes management anchors/metadata while
preserving rich rendered content and native formatting, without rerendering old
citations against the new library. Cancellation sends no mutation. See the
[citation contract](../../../../docs/citations.md) for binding and stale-state handling.

Insert/edit managed citations through `office` `citations.insert`/`citations.edit`,
including ordered multi-source clusters, locators, affixes and suppress-author.
Read rendered citation text plus identities. Set style/locale and refresh the whole
citation state/bibliography through the shared plugin; an item metadata edit alone
does not update the document. Use the same operations in Writer, Calc and Impress.
Report an unavailable native operation as a blocker instead of flattening fields.

## Optional Markdown interchange

When Markdown is requested, read [citations](../../../../docs/citations.md).
`review_citation` builds an identity-bearing `sr-cite:` marker;
`review_render_citations` sends the whole ordered document state to References.
A verified offline CSL snapshot can supply metadata, but the shared backend owns
style resolution and rich CSL rendering. Preserve originals, references and
provenance. Plain author-year text is not a managed citation. Markdown import into
Office must use supported native import/promotion APIs and verify resulting fields;
a visually plausible pasted citation is not successful promotion.

## Save, export and verify

Await acknowledged native `save` and `export`. `review_export_docx` exports an
already-open Office session; other supported formats and PDF use `office` export.
The source keeps managed fields. Request an explicit citation-unlinked export only
for a separate static copy. No standalone conversion process or later external
Refresh is part of this workflow. Reopen and inspect when round-trip fidelity matters.

Report actual document type/session, save/export results and ordinary viewing URLs.
Keep structural checks, native open/save round trips, citation identity preservation
and visual review distinct. Check both views, human selection, undo and reconnect
when validating collaboration. A successful file export alone does not prove all
those properties. Load [verification](../verification/SKILL.md) for a broader audit.
