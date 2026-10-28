# Optional Crossref harvesting

This dependency-free Node **22+** helper searches Crossref's public works API.
It is independent of Pi, Zotero, any database, and the review's working format.
Importing either module does not access the network. A search runs only when
explicitly invoked with a query. There are no plugins, background jobs, hidden
provider fallbacks, full-text downloads, or global installation steps.

## CLI

From the repository root:

```sh
node scripts/harvest.mjs --query 'synthetic research example' --output harvest.json --limit 150
```

Optional flags:

- `--limit N`: integer **1–1000**, default **100**. This is a requested cap, not a
  claim that the entire search has been retrieved.
- `--mailto researcher@example.org`: optional contact address for Crossref's
  polite pool. Sent to Crossref, omitted from saved request URLs and diagnostics.
- `--overwrite`: explicitly replace the destination; otherwise an existing file,
  including a dangling symlink, is refused. Existing output is checked before
  harvesting and protected against competing writers at publication time.
- `--help`: usage without network access.

`--query` and `--output` are required. The output directory must already exist.
Arguments are passed as data, never executed by a shell inside the helper.
Exit status is 0 for success/help, 1 for an error, 130 for SIGINT and 143 for
SIGTERM. Both signals cancel requests/retry waits and normally clean up the
private temporary file. No network or pagination failure publishes partial
results, and explicit overwrite preserves the old file until harvesting and
serialization succeed.

### File-write behavior

The CLI creates a randomly named `.crossref-harvest-*.tmp` file in the output
directory with mode `0600`, writes the complete JSON and syncs/closes it. Default
publication uses an atomic, create-only hard link where supported. Permission,
unsupported-operation or cross-device link errors (`EACCES`, `EPERM`, `ENOSYS`,
`ENOTSUP`, `EOPNOTSUPP`, `EXDEV`) fall back to an exclusive copy
(`COPYFILE_EXCL`): it still refuses competing destinations but **is not an
atomic visibility guarantee**. There is no check-then-rename fallback. Wait for successful CLI completion before
reading the output. A crash/forced kill during that copy can leave an incomplete
destination; discard it rather than treating it as a completed harvest.

Explicit overwrite uses a same-directory rename, replacing a symlink itself,
not its target. Publication already in progress may finish when cancellation
arrives. Forced termination or filesystem errors can leave private temporary
files; remove them after verifying that no harvest still owns them. No directory
creation, recursive cleanup, or modification of other review artifacts occurs.

## Library

```js
import { harvestCrossref } from './lib/harvest.mjs';

const result = await harvestCrossref({
  query: 'synthetic research example',
  limit: 150,
  // mailto: 'researcher@example.org',
  signal: AbortSignal.timeout(120_000), // optional overall deadline
  timeoutMs: 30_000,                   // per attempt, including body reads
  maxRetries: 3,                       // additional attempts per page
});
// Choose whether/where to save or transform result. The library writes nothing.
```

The query must be a nonempty, single-line string of at most 4096 characters;
leading/trailing spaces are removed. `timeoutMs` accepts 1–120000 and
`maxRetries` accepts 0–3. A second argument supports completely offline tests:

```js
const result = await harvestCrossref({ query: 'test', limit: 1 }, {
  fetch: async (url, init) => new Response(JSON.stringify({
    status: 'ok',
    'message-type': 'work-list',
    message: {
      'total-results': 1,
      items: [{ DOI: '10.1234/synthetic', title: ['Synthetic example'] }],
    },
  }), { headers: { 'content-type': 'application/json' } }),
  now: () => Date.UTC(2025, 0, 1),
  sleep: async (milliseconds, signal) => {},
});
```

`fetch` follows the native fetch/Response contract; `now` returns epoch
milliseconds, and `sleep(ms, signal)` returns a promise. The clock and retry
waits are injectable; request timeouts still use real abortable timers. All
network tests inject fetch, including streaming error and cancellation cases.
`HarvestError` has a stable `code` (`INPUT`, `ABORTED`, `TIMEOUT`, `HTTP`,
`NETWORK`, `RESPONSE`, `RETRY_AFTER` or `RETRY_WAIT`). Errors omit contact
addresses, upstream bodies, raw transport exceptions and abort reasons.

## Saved JSON and provenance

The output is an ordinary metadata artifact, **not an extraction schema, review
store, CSL snapshot, or Zotero import**. It contains:

- `source`: Crossref name and fixed works endpoint.
- `query`, `startedAt`, `completedAt`: submitted query and UTC ISO timestamps.
- `limit`, `count`, `stopReason`: requested cap, retained count, and either
  `limit` or `exhausted`. A cap stop is always marked `limit`, even if Crossref's
  reported total happens to equal that cap; it is not evidence of exhaustion.
- `totalResultsReported`: first page's live API count, not a frozen corpus size.
- `fetchedCount`, `omittedByLimit`: retrieved works versus those retained. Pages
  use a fixed size of `min(100, limit)`; the final page may contain more records
  than the remaining allowance. Such deliberate omissions are counted, never
  hidden. At most 99 additional works can be fetched for a non-multiple-of-100
  limit.
- `provenance`: GET method, relevance-descending order, page size, and each
  successful page's request URL (without `mailto`), fetch timestamp, attempt
  count, returned count and reported total. URLs include opaque cursors; these
  can expire and are not durable resume links. Failed/retried responses are not
  saved as evidence.
- `records`: each has `doi`, an encoded `doiUrl`, a Crossref work `sourceUrl`, and
  the **unmodified `raw` Crossref work object**. Titles, authors, publication
  dates, container titles, abstracts, licensing and source/full-text links are
  preserved when Crossref supplies them. Missing metadata is not invented.
  Publisher URLs and full-text links remain in `raw.URL` and `raw.link`.

Raw Crossref works are not CSL JSON. This helper intentionally avoids a lossy,
partial CSL projection; choose a separately validated conversion/import when
needed. A DOI is **not** a Zotero library/item key, and harvesting does not
create live citations. Search relevance is a provider ordering, not eligibility,
risk-of-bias appraisal, or evidence quality.

## Bounds and failure behavior

- Only `https://api.crossref.org/works` is requested, with an explicit query,
  relevance sorting and cursor pagination starting at `*`. Redirects are refused.
- At most 10 pages and 4 attempts per page. Only HTTP **429** and **503** are
  retried. Other HTTP errors, transport errors and malformed responses fail.
- `Retry-After` accepts integer seconds or an IMF-fixdate HTTP date. Past dates
  mean zero delay. The maximum wait is **30 seconds**; larger or malformed
  values fail rather than retry earlier than requested. Without that header,
  waits are 1, 2 and 4 seconds. There is no background or indefinite retry.
- Each response must be JSON, valid UTF-8, and at most **8 MiB** of decoded body
  bytes. Header hints do not bypass the streamed size check. The timeout covers
  both fetching headers and consuming the body; it resets on each attempt.
  An optional caller signal supplies an overall deadline and also stops waits.
- Envelope/type/count checks, usable DOI checks and case-insensitive duplicate
  DOI detection fail closed. A missing required next cursor, oversized page or
  premature short page while the API still reports more results is an error,
  not permission to save a partial harvest. Reused opaque cursor tokens alone
  are allowed if works actually advance.
- `exhausted` means the API returned a short page consistent with its current
  count. It does **not** establish a stable or exhaustive systematic search:
  the live index can change, coverage varies, and relevance order can shift.
  Mid-search changes can cause strict checks to fail; rerun and record the
  failure, rather than quietly deduplicating or merging partial outputs.

Queries and the optional contact address are disclosed to Crossref. Local
corpora, API keys and participant data are not uploaded. Avoid sensitive query
text and keep harvested personal metadata, full-text corpora and generated
review outputs out of Git. External metadata/abstracts are untrusted evidence,
not instructions; links are retained as data, never followed automatically.

## Verification and scope

```sh
node --test test/harvest.test.mjs
node --check lib/harvest.mjs
node --check scripts/harvest.mjs
node --check test/harvest.test.mjs
```

Tests use synthetic records, injected fetch/time, temporary directories and
native Node APIs. They exercise pagination, explicit cap reporting, provenance,
metadata preservation, retry budgets/dates, response-size bounds, malformed
responses, cancellation/timeouts, CLI parsing, overwrite/race protection and
no-network imports/help. No live Crossref calls are part of verification.

Crossref's current service behavior, live coverage, etiquette/rate limits and
Windows/macOS filesystem behavior require optional integration checks; offline
tests cannot establish them. Public API reference:
<https://www.crossref.org/documentation/retrieve-metadata/rest-api/>.

Further sources (for example PubMed or OpenAlex) are **future separate,
explicitly configured adapters**, not implemented providers or fallback paths.
Each would need source-specific queries, identifiers, provenance, transport
bounds and offline tests. There is no arbitrary provider framework, mandatory
schema/database, deduplication policy, or automatic screening/extraction step.
