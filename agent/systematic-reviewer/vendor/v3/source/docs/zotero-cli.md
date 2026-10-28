# Zotero helper CLI

Use `node scripts/zotero.mjs --help` from the package directory. The helper is
independent of Pi and uses portable Node APIs. The extension still exposes only
its four existing tools; importing references is a separate, explicit command.
The helper does not choose review methods, eligibility criteria, extraction
fields, or the next research task.

## Read references

Start Zotero normally with the library you want to use and enable its local API
in Settings → Advanced. No custom Zotero plugin or database access is needed.

```sh
node scripts/zotero.mjs search --query "search terms" --limit 25 --output page.json
node scripts/zotero.mjs snapshot --id users/123/items/ABCD2345 --output references.json
```

The identity in the second example is synthetic: use actual IDs returned by
search. Search returns one bounded page; follow `page.nextStart` with `--start`
until it is null when a complete result set is needed. Snapshot retrieves only
the selected identities. These commands produce the same citation snapshot
format as `review_zotero`.

Reads and imports use only the running local application's HTTP interfaces.
No API key or mode selection is needed. `ZOTERO_LOCAL_URL`, or an overriding
`--local-url`, can select a loopback HTTP address with the `/api/` path. See
[local Zotero setup](setup.md#zotero) for Linux and the project's native Termux target.

## Read local attachments

```sh
node scripts/zotero.mjs attachments --id users/123/items/ABCD2345 --output attachments.json
node scripts/zotero.mjs attachment-text --id users/123/items/EFGH6789 --output attachment-text.json
```

These IDs are synthetic. Use a parent identity returned by reference search,
then an attachment identity returned by `attachments`. The manifest verifies the
parent library and each child's parent relationship through the local API. It
returns one page (default 100); follow `page.nextStart` with `--start` when it is
not null. Filename, MIME type, link mode and source URL are descriptive metadata;
the helper does not open those paths or URLs.

`attachment-text` returns the entire text cached by Zotero, with its indexed and
total page/character counts. `status: missing` means no indexed text is available;
`status: empty` means the cache contains no characters. Coverage is `partial`,
`complete`, or `unknown` according to Zotero's counters. Even complete indexing
does not establish that OCR, figures, tables or source reading are complete.
Inspect the source and choose an extraction tool where needed; do not treat a
missing or partial cache as a fully read paper.

Both commands are read-only and leave the selected library/collection unchanged.
They do not download PDFs, trigger indexing, copy files, or inspect Zotero's
database/profile. Responses use the read client's 10 MiB bound and 30-second
request deadline; oversize text fails explicitly rather than truncating. A
standalone unsynced attachment whose canonical library identity cannot be
verified through the API is refused; linked attachments are verified through
their bibliographic parent. Synced user and group identities retain their scope.

API details: [local API](https://www.zotero.org/support/dev/web_api/v3/local_api),
[full-text responses](https://www.zotero.org/support/dev/web_api/v3/fulltext), and
[native local implementation](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/server/server_localAPI.js).

## Resolve external identifiers

```sh
node scripts/zotero.mjs resolve --identifier PMCID:PMC2707599 --identifier PMID:100
node scripts/zotero.mjs resolve --identifier arXiv:1706.03762 --identifier ISBN:9780140328721
```

The resolver normalizes DOI, PMID, PMCID, arXiv and ISBN strings, including their
recognized URLs and prefixes. It validates ISBN checksums. DOI, PMID, arXiv and
ISBN are already native Zotero search inputs: normalization returns the matching
payload without claiming a metadata lookup. PMCID is converted to PMID through
the official PMC converter, retaining the DOI, original identifier and lookup
provenance. Missing mappings remain explicit. A versioned PMC identifier must
exist in the converter response; the resulting PMID still identifies the
article, not a particular manuscript version.

This preserves the relevant resolution boundary from the original plugin:
native types went to Zotero's identifier search, with PMCID converted first.
The helper does not impose the old harvester's preferred order among available
identifiers or require every record to have a DOI. Optional `--mailto EMAIL`
identifies the caller to the PMC service; it is not saved in the source URL.

## Import DOI metadata

Select the intended library or collection in Zotero. Read its current target:

```sh
node scripts/zotero.mjs target
```

Then run an import using the returned target value. For example, **if** the
target is `C1`:

```sh
node scripts/zotero.mjs import-doi \
  --doi 10.1136/bmj.n71 --doi 10.1371/journal.pmed.1000097 \
  --expect-target C1 --output import-receipt.json
```

These two public papers are integration-test examples, not required methods or
recommended eligibility criteria. Any 1–20 supported Crossref DOIs can be used.
The command sends the DOI to Crossref, obtains RIS metadata, and passes that
metadata to the running Zotero application's standard Connector importer over
HTTP. Zotero performs the bibliographic conversion. PDFs and attachments are
not imported. Other DOI registries and other import formats can use their own
documented tools without extending this helper into a general workflow engine.

`import-doi` writes to Zotero. It checks the selected target before metadata
retrieval and immediately before import. Keep the selection unchanged while
it runs: this check is not an atomic destination lock. Connector target values
such as `L1` and `C1` are local destination selectors, **not citation identities**.
The receipt records DOIs, source URLs, destination and returned item keys. Use
search/snapshot afterward to obtain verified library-qualified citation IDs.

Imports can create duplicates. The command never automatically retries a write;
if a response is lost or validation fails after submission, inspect Zotero
before retrying. Saving the receipt can also fail after the import succeeds.
The selected library's normal Zotero sync settings still apply.

## Import other supported identifiers

```sh
node scripts/zotero.mjs import --identifier PMID:26978244 --expect-target C1 --output receipt.json
```

`import` accepts one DOI, PMID, PMCID or unversioned arXiv identifier per call.
It uses Crossref RIS, PubMed article XML, or arXiv's BibTeX export, then lets
Zotero's existing import translators perform the conversion. A PMCID follows
the verified PMID mapping. PubMed and arXiv records do not need a DOI. The same
destination guard, receipt, duplicate and uncertain-write rules apply.

Zotero's Connector API does not expose its native identifier-search executor.
The helper therefore reports ISBN, explicitly versioned arXiv and PubMed book
imports as requiring Zotero's native Add Item by Identifier, before writing.
It does not silently substitute a different arXiv version or import book-section
attachments. This is a deliberate import boundary, not a claim that Zotero
itself cannot handle those identifiers.

## Output and limits

Commands print JSON to stdout unless `--output FILE` is supplied. Existing files
are refused unless `--overwrite` is explicit. Requests have a 30-second deadline;
import responses and the combined RIS payload are bounded to 4 MiB. Cancellation
is propagated. Loading the library or requesting help performs no network calls.
No app is launched or installed automatically.

The local `/api/` client remains read-only. Import uses the separate existing
Connector endpoint; it does not create a local write key. Tested with native
Zotero 10.0.6 on Linux x86-64. Endpoint compatibility with other Zotero versions
is not implied by offline tests.

Protocol references: [Zotero Connector implementation](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/server/server_connector.js),
[local API](https://www.zotero.org/support/dev/web_api/v3/local_api), and
[Crossref content negotiation](https://www.crossref.org/documentation/retrieve-metadata/content-negotiation/).
Identifier sources: [PMC converter](https://pmc.ncbi.nlm.nih.gov/tools/id-converter-api/),
[Zotero PubMed XML translator](https://github.com/zotero/translators/blob/master/PubMed%20XML.js),
and [arXiv BibTeX export](https://github.com/arXiv/arxiv-browse/blob/develop/browse/controllers/bibtexcite.py).
