---
name: harvesting
description: Design reproducible evidence searches, retrieve bibliographic records or lawful full text, deduplicate records, and update source collections.
license: AGPL-3.0-or-later
disable-model-invocation: true
---

# Search and harvest evidence

Use for discovery, a search update, importing supplied records, or retrieving
specific sources. Apply the [shared safeguards](../../SKILL.md). An existing
export can be sufficient; live access and a Zotero library are not prerequisites.

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
requiring a Zotero library or claiming an unimplemented package adapter.
For Zotero, use its configured built-in local API when the application is running,
or a reference snapshot for offline work. Zotero access is local only and needs no key.
Choose according to the user's setup. Do not require a custom Zotero plugin or a
new review store. A metadata snapshot is not the full-text attachment itself.
Inspect tool help before use rather than inventing API arguments. Respect access
rights, rate limits, pagination, timeouts, response bounds, and cancellation.
Never expose credentials in URLs, logs, reports, or shell history. Do not bypass
paywalls or modify Zotero SQLite/profile files.

For an OpenAlex key, use `node scripts/setup.mjs status` from the
package directory to inspect its safe configuration summary. Direct the user to
`/review-setup` or the [setup guide](../../../../docs/setup.md) for official
account links, hidden terminal entry or the optional local browser form. The
agent may start browser setup and open its printed URL; the user enters the key.
Never ask for keys in chat or read the credential file. `OPENALEX_API_KEY`
overrides the saved key; configured status does not validate it. Local Zotero
needs no credential setup, including the project's native apt-packaged Termux port.

For the bundled Zotero helper, read the
[CLI guide](../../../../docs/zotero-cli.md) and run
`node scripts/zotero.mjs --help` from the package directory. Use its current
interface for the requested retrieval, resolution, or import operation.

For OpenAlex, read the [collector guide](../../../../docs/openalex.md) and inspect
`node scripts/openalex.mjs --help`. It reconstructs indexed abstracts and can
enrich them from exactly matched existing Zotero records, recording both sources.
Its inherited abstract-length preference is a metadata heuristic, not a judgement
of evidence quality. Do not treat a missing abstract as grounds for exclusion or
silently import a harvest merely to enrich it.

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
  Zotero citations, keep the library scope with each item identity; ask rather
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
