# Shared OpenAlex search and enrichment

Use `references` or `node scripts/openalex.mjs --help`. The CLI sends a bounded
JSON request to the same project-qualified References service used by the UI.
Search supports the backend's query/filter, paging and explicit result limits.
Import selected raw records with an explicit project/collection and stable request
identity; retain the resulting job and per-record outcomes. A bounded import of
all results must preserve its declared search scope and page provenance.

References owns identifier normalization, DOI/PMID/PMCID crosswalks, translation,
deduplication, full metadata and PDF resolution. It retains the V3 index gap/
collision validation and exact DOI/PMID matches. A conflicting or ambiguous
identity is a reported error, not a title-based merge or sole-item guess.

After trimming, enrich an existing abstract only when it is shorter than 100
characters and the exactly matched OpenAlex text is nonempty and longer. Keep
source abstracts, chosen origin, raw provider data, warnings and item versions.
Failed enrichment does not clear existing text or synthesize content; an
explicit enrichment-only operation does not create new library records.
Changed chosen text invalidates its affected embedding/text hash only.

OpenAlex keys/contact settings stay in the owning backend. See [setup](setup.md).
Missing abstracts and search gaps are research evidence limits, not eligibility
judgements. Search/import success and attachment retrieval success are distinct.
