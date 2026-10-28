# Systematic Reviewer capabilities

The bundled `systematic-review` skill retains protocol, harvesting, semantic
search, full-text/PDF reading, evidence reading, screening, extraction, appraisal,
analysis, writing and verification guides. They are independent capabilities,
not a compulsory pipeline or research database. Existing scientific choices,
records/reports/studies distinctions, complete-source guidance and uncertainty
remain unchanged.

Pi tools retain `review_zotero` (alias of `review_references`), `review_citation`,
`review_render_citations` and `review_export_docx`. The separate `references` and
`office` tools expose shared library and live native document operations. See
[citations](citations.md) for the explicit old-to-new argument migration.

Standalone setup, OpenAlex, harvest, library, citation and embeddings CLIs remain.
The first five call the shared authorized backend contracts. The embeddings CLI
retains its explicit endpoint/model, text recipes/hashes, bounded requests,
dimension/index validation, deterministic ties and scoped cache. It does not
perform provider discovery, model downloads or automatic eligibility decisions.
Pi owns model/provider configuration, context, compaction, history and file
mutation queues. `full-read` and `compact_context` are unchanged.

Native component availability, platform integration and installed acceptance are
separate from source/tool registration. Unsupported runtime operations return
explicit errors; successful synthetic contract checks do not establish native
Termux, live collaboration, PDF-resolution parity or three-editor acceptance.
