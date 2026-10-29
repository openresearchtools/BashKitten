---
name: harvesting
description: Design reproducible evidence searches, retrieve bibliographic records or lawful full text, deduplicate records, and update reference records.
license: AGPL-3.0-or-later
disable-model-invocation: true
---

# Search and harvest evidence

Use for discovery, a search update, importing supplied records, or retrieving
specific sources. Apply the [shared safeguards](../../SKILL.md). An existing
export can be sufficient; live access and a References library are not prerequisites.

## Search deliberately

- Work from the question and eligibility criteria. Select databases, registries,
  grey literature, citation chasing, or web sources appropriate to the topic.
  A general web search alone does not establish exhaustive database coverage.
- Build concept groups, synonyms, spelling variants, and controlled vocabulary
  where supported. Adapt field codes, Boolean logic, proximity, and truncation
  to each source; never claim one query works unchanged everywhere.
- Check whether a few known relevant records are retrieved and investigate
  misses. This is a search check, not proof of complete recall. Document applied
  filters and justify date/language/design restrictions.
- Retain the exact executed query, source/interface, search date, limits,
  reported hit count, retrieved count, and export/version information in a
  convenient form. Do not describe a proposed query as an executed search.

## Retrieve with explicit limits

Use configured APIs, authorized source tools, or researcher-supplied files for
the sources and reference manager the researcher chooses. Prefer an available
small helper for the requested operation; inspect its help and documented
limits. Another manager's supported API or export is valid input, without
requiring a References library or claiming an unimplemented package adapter.
Use the shared References API through `references` or the
[References CLI](../../../../docs/references-cli.md). Explicitly select the owning
independent References project database before importing. GET `/projects` lists
Default and named databases; POST `/projects {name,cwd?}` creates one. There are
no collection destinations. The backend keeps that destination
atomic while other tabs or users change selection. Use bounded pages and cancellable
jobs; inspect returned totals, next pages, per-record outcomes and provenance.
A metadata snapshot is not the full-text attachment itself. Never read or edit the
library database directly or start another resolver queue.

OpenAlex search/import and DOI/PMID/PMCID/arXiv/ISBN resolution use the same backend
as the human interface. A missing DOI conversion does not prevent direct PubMed
retrieval. The shared backend automatically enriches eligible imported abstracts:
replace only trimmed existing text shorter than 100 characters with a nonempty,
longer exactly matched OpenAlex abstract. Preserve inverted-index gaps/collision
warnings, both source texts and lookup provenance. Enrichment-only requests never
create records. Missing abstracts do not justify screening exclusion.

For an OpenAlex key, inspect `node scripts/setup.mjs status` or `/review-setup`.
Private References settings own keys/contact configuration; the researcher enters
them there, not in model messages or shell arguments. Inspect the
[setup guide](../../../../docs/setup.md). No separate reviewer credential store,
local desktop application or cloud account is required for References.

For collector arguments and provenance, inspect the
[OpenAlex guide](../../../../docs/openalex.md) and `node scripts/openalex.mjs --help`.
Crossref harvesting is also a shared backend operation. Respect conservative
request pacing, retries, custom-resolver syntax, access rights and human challenge
handling. Do not create an aggressive parallel downloader or treat lookup success
as PDF retrieval success.

Distinguish metadata retrieval from importing items into a reference library.
For a requested import, use the selected manager's supported write API/tool and
the intended destination; retain returned identities and report duplicates,
partial failures, and unresolved records. A successful metadata lookup alone
does not mean that an item was added to the library or its full text retrieved.

Keep retrieval provenance and original exports where permitted. Record exhausted
budgets, failed pages, missing attachments, access restrictions, and partial
results; a truncated response is not the complete search. Retry only within
reasonable limits. Full text, metadata, and an abstract are different assets.
Do not upload a local corpus to an unapproved retrieval/OCR service.

## Resolve identities without losing evidence

- Prefer the selected manager's native identifier lookup for formats it
  supports, such as DOI, PMID, arXiv, or ISBN. Use a resolver only for unsupported
  inputs or a specific conversion the task needs, such as PMCID to PMID; do not
  require every reference to have or become a DOI. Preserve the original input,
  returned identifier/metadata, lookup source, and unresolved or ambiguous
  mappings. An identifier match does not establish that two reports are the same
  study or that their findings are interchangeable.
- Preserve source-specific record IDs and verified identifier aliases. For
  References citations, keep the library scope with each item identity; ask rather
  than resolving a bare key across libraries. Follow the
  [citation specification](../../../../docs/citations.md) for snapshots.
- Deduplicate conservatively using normalized verified identifiers and
  bibliographic context. Title similarity alone is insufficient. Preserve an
  auditable map from merged records to originals, reasons, and uncertain pairs.
- Distinguish duplicate search records from multiple reports of the same study.
  A preprint, conference abstract, correction, and final article may contain
  different information; link versions rather than silently discarding them.
  Track known retractions/corrections and when status was checked.
- For updates, retain the prior search and explain changed queries, coverage,
  new versions, and added/merged records. Reconcile counts using consistent
  units; do not count linked reports as new independent studies.

Deliver the requested collection in its existing or agreed format, plus enough
provenance to rerun the search and understand gaps. Load
[screening](../screening/SKILL.md) for eligibility judgements,
[full text and PDF](../full-text/SKILL.md) for PDF conversion/visual transcription,
or [evidence reading](../evidence-reading/SKILL.md) for interpreting sources.
Harvesting alone does not determine inclusion or evidential strength.
