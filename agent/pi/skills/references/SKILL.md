---
name: references
description: Manage project reference libraries, collections, metadata, identifiers, abstracts, PDFs, full text and citation styles through BashKitten References.
---

# References

Discover `references` with stock tool search. It uses this Pi worker's authorized
backend and the same service as the human UI. Start with `GET /projects`; choose
an explicit project ID. Libraries are separate databases outside repositories;
attachments belong to that project's `Bibliography` folder. Never read/write the
database, start another resolver, infer a destination from a browser tab, or reuse
another backend's credentials. Existing shared services start on demand.

The tool accepts `{method,path,body?}`. Paths below follow `/projects/PROJECT`.
Native item responses retain complete `data`, versions and canonical
`bkref:BACKEND/PROJECT/KEY` identities. A bare key or compatibility `users/0` is not
a citation identity. Map legacy identities explicitly before using them.

| Operation | API |
| --- | --- |
| Bounded library search | `GET /items?q=TEXT&limit=50&sort=title`; keep returned `next` cursor and library version. Use `cursor=...` for the next page; reload on concurrent-change conflict. `format=csljson` adds derived CSL, preserving native metadata. |
| Item and cached full text | `GET /items/KEY`, `/items/KEY/children?limit=50`, `/items/ATTACHMENT/fulltext` and `/items/ATTACHMENT/file`. Read returned coverage counts and missing-text status. |
| Create/update/delete | `POST /items` with `{data:{itemType,...}}`; `PATCH /items/KEY` with `{version:PREVIOUS,data:{...}}`; `DELETE /items/KEY` with `{version:PREVIOUS}`. Preserve full creator records, metadata, tags, notes and relations. |
| Collections | `GET /collections?limit=50`, `GET /collections/KEY`, `POST /collections` with `{data:{name,parentCollection?}}`, versioned `PATCH`/`DELETE /collections/KEY`. |
| Identifier import | `POST /identifiers/import` with `{identifiers:[...],requestId:STABLE_ID}`; explicit bounded batches and collection/PDF choices follow the current service contract. |
| OpenAlex | `POST /openalex/search` with explicit query/filter and result bounds; `POST /openalex/import` with selected raw records and stable requestId. |
| Shared enrichment/PDF queue | `POST /items/enrich` or `/items/resolve-pdfs` with `{keys:[...],requestId:STABLE_ID}`. Enrichment never creates records. |
| Jobs | `GET /jobs/ID` for progress/outcomes, `DELETE /jobs/ID` for cancellation. Retain receipts and unresolved/partial/interrupted statuses before retrying uncertain writes. |
| Schema/styles | `GET /schema`, `GET /styles?query=TEXT&limit=50`; whole-state `POST /citations/render` is shared with Office. |
| Safe service configuration | `GET /settings`; user `/review-setup` or native References settings owns key entry. Never solicit API keys in model messages. |

Use bounded lazy pages, indexed backend search/sort and cancellation. Do not fetch
an entire library or harvest a large real corpus to test the UI. DOI/PMID/PMCID,
arXiv/ISBN, OpenAlex and PDF resolution belong to the shared backend. Preserve its
exact identifier checks, provenance, conservative queue/per-domain pacing and
unchanged custom-resolver JSON. A missing identifier crosswalk is not a different
article. PDF retrieval and metadata success are separate outcomes.

The inherited abstract rule replaces trimmed existing text only if it is shorter
than 100 characters and a nonempty exactly matched OpenAlex abstract is longer.
Retain both texts, raw index warnings, source IDs and version checks. Failed
lookup must not erase text or invent an abstract. Respect human challenge flows.

Use `office` for native citation insertion/editing, style/locale, whole-document
refresh and bibliography. Library edits alone do not change a live document.
`review_references` saves bounded verified CSL snapshots; `review_zotero` is its
migration alias. `systematic-review` provides optional research methods and
source-reading guidance without imposing a review database or pipeline.
