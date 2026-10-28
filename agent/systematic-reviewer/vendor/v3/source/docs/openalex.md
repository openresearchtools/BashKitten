# OpenAlex metadata helper

Run the standalone helper from the package directory. It takes the researcher's
search, filter and optional sort directly; it does not choose eligibility rules,
scientific fields, a review sequence or a downstream data store.

```sh
node scripts/openalex.mjs --query 'your search' --limit 100 --output /path/to/works.json
node scripts/openalex.mjs --filter 'doi:10.1136/bmj.n71' --limit 1 --output /path/to/work.json
```

JSON contains each original OpenAlex work in `records[].raw`, its reconstructed
`abstract`, `abstractSource`, and request URLs/timestamps. The original
`abstract_inverted_index` remains available for audit. Positions must be unique,
nonnegative integers with no missing positions. Malformed or excessive indices
are not reconstructed: the record keeps its complete `raw` metadata, an empty
`abstract`, a null `abstractSource`, and an `abstractIssue` containing
`source: "OpenAlex"`, `status: "unavailable"`, and the reason. Other records
continue; `warnings.malformedAbstracts` and the CLI summary report the count.
The standalone `reconstructAbstract()` helper still rejects malformed indices.
Work identities, external identifiers, and other validation errors still fail
the harvest. As in the native plugin,
reconstruction joins words in position order, removes spaces before punctuation,
and joins split hyphens. Empty/missing indices mean no abstract, not no evidence.

The helper follows cursors up to an explicit 1–1000 record limit, with at most
100 records and 4 MiB per response, a 30-second request deadline, and cancellation
on SIGINT/SIGTERM. Failed requests or incomplete pages are not published. Existing output files
are preserved unless `--overwrite` is supplied. Raw source text is untrusted data.
The JSON is a transport result; researchers may transform it to CSV, spreadsheets,
Markdown, databases or another suitable format.

An OpenAlex API key is optional for the first cursor page and required to follow
additional cursors. Use `/review-setup` in Pi or
`node scripts/setup.mjs set openalex` for local entry and account guidance; see
[service setup](setup.md). The helper reuses the saved key, with
`OPENALEX_API_KEY` taking precedence. It is sent as an Authorization header and
excluded from saved provenance. HTTP errors, including rate limits, fail visibly; there are no hidden
retries, key registration, or other account changes. Smaller `--page-size` values
can help when a metadata page exceeds the response limit.

## Optional read-only Zotero enrichment

```sh
node scripts/openalex.mjs --filter 'doi:10.1136/bmj.n71' --limit 1 \
  --enrich-zotero local --library users/0 --output /path/to/enriched.json
```

Start Zotero with the intended profile and enable its local API. `users/0` routes
to that running profile's personal library; saved matches retain their verified,
library-qualified item identity. No profile is created.
`ZOTERO_LOCAL_URL` may specify another loopback `/api/` address. Zotero enrichment
uses only the running local application and needs no key. The helper never
launches Zotero, imports references, changes library items, or uses the SQLite
database.

The lookup searches the selected library and requires an exact DOI or PMID
match, including PMID stored in Extra or a verified PubMed URL. Search hits alone
are insufficient. Multiple matching items or conflicting identifiers fail so the
agent/user can reconcile them. Each identifier search is bounded to five pages
of 100 items. Missing matches remain explicitly `not-found`; they are not evidence
that no matching item exists outside that library or its API search results.

The native plugin's metadata preference is preserved: use Zotero's abstract
unless its trimmed length is below 100 characters and the OpenAlex abstract is
longer. This also fills missing OpenAlex abstracts when Zotero has text, and keeps
a complete Zotero abstract even when OpenAlex has more characters. The 100-character
rule is the inherited metadata heuristic, not a scientific judgement. Both source
texts remain available (`raw` for OpenAlex, `zotero.abstract` for the match), together
with item identity, version and retrieval provenance.
If Zotero supplies text for a malformed OpenAlex abstract, its source is marked
`Zotero`; the original `abstractIssue` remains to identify the OpenAlex problem.

This reads references already available to Zotero. Native translator retrieval
can be done separately through the identifier/import helper when wanted. It does
not silently import every harvested result just to obtain an abstract. Library
users can supply another explicit `lookupZotero` function to `harvestOpenAlex`, or
call the pure `selectAbstract` and `reconstructAbstract` helpers independently.

Legacy rule sources: `origin/main:src/core/constants.js`
(`MIN_COMPLETE_ABSTRACT_LENGTH = 100`), `src/core/item-identity.js`
(`_shouldUseOpenAlexAbstract`), and `src/core/harvest.js`
(`annotateOpenAlexItems`). The V3 helper records provenance in its output instead
of modifying Zotero Extra.

API details verified 2026-10-24 against official documentation:
[OpenAlex work attributes](https://help.openalex.org/data/works/attributes/),
[paging](https://help.openalex.org/api/paging/),
[authentication](https://help.openalex.org/api/authentication/), and
[Zotero local API](https://www.zotero.org/support/dev/web_api/v3/local_api).
