# Markdown citations and Zotero

V3 separates **identity**, **rendering** and **office transport**. A citation's
rendered author/year label is only a cache. The stable Zotero library/item ID and
locator are authoritative. No custom Zotero plugin, extraction database, or
running office application is needed to render or export.

## Get verified identities

Use `review_zotero` against the running Zotero application's existing local API.
The independent [Zotero CLI](zotero-cli.md) provides the same search/snapshot
operations without loading the extension, plus an explicit DOI-import command.
Local access must be enabled in Zotero Settings → Advanced → “Allow other
applications on this computer to communicate with Zotero”. A local query:

```json
{"operation":"search","query":"evidence synthesis","limit":25,"output":"references-page-1.json"}
```

The output is a bounded page and a reference snapshot. Inspect `page.nextStart`
and repeat with `start` to continue; it is not a complete library dump. Search
uses `users/0` only as the local API routing alias. Returned citation identities
use the actual user or local-user key. To read a group, supply
`"library":"groups/ACTUAL_NUMERIC_ID"`.

Fetch selected verified identities into a snapshot:

```json
{"operation":"snapshot","ids":["users/123/items/ABCD2345"],"output":"references.json"}
```

IDs in these examples are **synthetic**. Replace them with identities retrieved
from your actual library, never with guessed keys. Local Zotero needs no API key
or mode selection. No network request is made merely by loading the package.

Local API URL defaults to `http://127.0.0.1:23119/api/`. `ZOTERO_LOCAL_URL` can
select a different loopback host/port, but must retain `/api/`; forwarding an
unauthenticated local library endpoint to the network is not supported. API
reads time out, honor bounded rate-limit waits, reject redirects, and cap
responses at 10 MiB. A long backoff is reported for retry later, not bypassed.
Local Zotero 10 instance IDs and item versions are recorded as provenance.

The extension tool reads bibliographic metadata only. The standalone CLI can
import Crossref DOI metadata through Zotero's existing Connector HTTP importer
when requested. Other Zotero work can use its documented local interfaces with
an appropriate small adapter; it need not be added to this extension. Follow the user's existing
authorization for imports/writes; harvesting and rendering never silently import
items. Never edit SQLite.

## Reference snapshot

An ordinary JSON file is sufficient; it is **not an extraction schema**:

```json
{
  "version": 1,
  "items": [{
    "id": "users/123/items/ABCD2345",
    "itemData": {
      "type": "article-journal",
      "title": "Synthetic example only",
      "author": [{"family": "Smith", "given": "Alex"}],
      "issued": {"date-parts": [[2024]]}
    }
  }]
}
```

`itemData` is CSL-JSON, not Zotero's native `data` object. Snapshot entries may
also carry `provenance`; `review_zotero` records source URL, retrieval time,
item version and local server ID. Extra snapshot-level data such as pagination
is allowed. Combine pages with ordinary code, rejecting conflicts
rather than keeping two entries with the same ID. Rendering rejects duplicates.

Identities are `users/<actualUserID>/items/<KEY>`,
`groups/<actualGroupID>/items/<KEY>`, or the real unsynced
`users/local/<localUserKey>/items/<KEY>`. `users/0`, bare item keys and a local
numeric SQLite library ID are not valid citation identities. Standard Zotero
HTTP(S) item URIs are accepted
and normalized; office metadata uses Zotero's canonical historical
`http://zotero.org/...` URI. The HTTP URI is an identifier, not an HTTP request.

When an export translator substitutes a citation key for the URI, the adapter
uses the API's actual library identity. If it cannot establish identity, it
fails and requests a verified identity; it does not invent a library scope.

## Durable Markdown markers

For a single item with no locator, write:

```markdown
A finding [cite](sr-cite:users/123/items/ABCD2345).
```

An empty label, `[](sr-cite:users/123/items/ABCD2345)`, is equally valid when only
the verified identity is known. The `sr-cite:` target identifies the citation;
the label is never used to infer its source. Both empty and stale labels are
replaced on complete-document rendering. Ordinary brackets and unrelated links
are left alone; literal examples in code are not processed. The IDs shown here
are synthetic placeholders, not real references.

After `review_render_citations`:

```markdown
A finding [(Smith, 2024)](sr-cite:users/123/items/ABCD2345).
```

Ordinary Markdown viewers show **(Smith, 2024)**. `sr-cite:` is an interchange
link target, not an implemented clickable Zotero navigation URL. The visible
label can be replaced by rendering without changing the source identity.

For locators or multiple references, call `review_citation`:

```json
{"items":[{"id":"users/123/items/ABCD2345","locator":"12–14","label":"page"},{"id":"groups/456/items/EFGH6789"}]}
```

It returns a Markdown marker to insert using ordinary edit/write. Complex link
targets contain percent-encoded JSON with this structure:

```json
{"v":1,"items":[{"id":"users/123/items/ABCD2345","locator":"12–14","label":"page"},{"id":"groups/456/items/EFGH6789"}]}
```

Optional item properties: `locator`, CSL `label` (defaults to `page` when a
locator is present), `prefix`, `suffix`, and boolean `suppress-author`. Affix
spacing is preserved. Clusters contain 1–100 items; encoded markers are capped
at 32 KiB to bound tool output. Unknown properties fail. Narrative author-only citations
and note/footnote styles are not supported. Do not hand-escape complex JSON:
use the tool or `citationMarker()` from the library.

Only inline links are live citations. Reference links and images with
`sr-cite:` targets are rejected. Fenced/indented code and inline-code examples
are left alone. Rendering preserves surrounding Markdown, including source
positions in lists, quotes and GFM tables. Malformed markers in prose fail.

## Bibliography

Place one optional pair of standalone comments, with blank lines around them:

```markdown
## References

<!-- sr-bibliography -->

<!-- /sr-bibliography -->
```

Rendering replaces only the contents of this block with references for cited
items, in CSL bibliography order. Treat the interior as generated content;
put researcher-written notes outside it. The comments remain invisible in
Markdown previews. Export turns the block into a single live Zotero bibliography
range. Do not put citations inside it or nest it in a list/quote.

## Render and export

For a single manuscript that carries its own inline citation identities, use
the standalone refresh helper:

```sh
node scripts/citations.mjs render --input draft.md --zotero local --in-place
```

It fetches only the cited identities from the running Zotero API into memory,
reconciles every citation in document order, and updates the same Markdown file.
No reference snapshot or second manuscript is written. Empty labels receive
citation text; existing labels are replaced regardless of their content. CSL
controls first/subsequent-citation rules, numbering and disambiguation. The
`sr-cite:` identity and optional locators remain authoritative throughout.

Use `--style /path/to/style.csl` for a chosen independent in-text CSL style.
For offline work, replace `--zotero local` with `--references references.json`.
Local access accepts `ZOTERO_LOCAL_URL` or `--local-url`. To keep the source
unchanged, replace `--in-place` with `--output new-draft.md`; an existing
destination is refused.

Lookup, parsing or rendering failures leave the manuscript unchanged. In-place
refresh checks for edits made while metadata was being fetched and refuses to
overwrite them. This is not a lock against another editor: save edits before
refreshing. Literal code and ordinary brackets/links are never citation matches.

The extension's file-based tools remain available too:

```json
{"input":"draft.md","references":"references.json","output":"report.md"}
```

Call `review_render_citations` with those parameters. Render the **complete
manuscript**, not isolated paragraphs, so numbering, repetition and
same-author/year disambiguation agree across the document. Later CSL updates to
earlier citations are applied. Re-rendering is idempotent. The tool returns
paths/counts, not the whole manuscript in model context.

Call `review_export_docx` with the same inputs and `"output":"report.docx"`.
It renders first; there is no need to trust a stale visible label. Default
`"mode":"bookmarks"` targets Word/LibreOffice interoperability. Optional
`"mode":"fields"` emits Word ADDIN fields, not a portable LibreOffice workflow.
See [office interoperability](office-interop.md) before final delivery.

Existing output files are refused unless `overwrite:true` is explicit. You may
render Markdown in place with that opt-in; DOCX cannot replace the Markdown or
reference input. Publication uses atomic same-directory rename/hardlink where
supported. On Android/filesystems that forbid hardlinks, create-exclusive copy
preserves no-clobber behavior but the new file can be visible briefly while it
is copied. Pi queues concurrent writes to the same output path. Deterministic
operations read text inputs up to 32 MiB; this is a memory-safety limit, not a
model-context estimate or a substitute for source-reading guidance.

## CSL styles and limitations

The default is an original minimal author–date style, **not APA**. For a real
submission, supply the path of an appropriate independent in-text CSL style via
`style`. Styles are read locally; no downloads occur during rendering. Choose
`locale` and a matching `localeFile` for another language; only en-US is bundled.
The library also accepts an explicit locale map for multilingual styles.
Missing locales, missing references and unsupported styles fail rather than
silently falling back. Dependent styles must first be resolved to their parent.

Cached Markdown and initial DOCX citation/bibliography results are plain text;
CSL italics, superscript styling and other rich text are not preserved in that
cache. The standard Zotero office integration applies its own full styling on
Refresh. Install the selected CSL style in Zotero before refreshing. For the
bundled default, install [author-date.csl](../assets/author-date.csl) first; its
style ID is metadata, not a promise of an online style repository.

This alpha does not round-trip office edits back to Markdown, support every
Markdown feature, migrate legacy implicit-library citation syntax, or replace
Zotero's office integration. DOCX export rejects unsupported Markdown rather
than silently discarding it. Keep the Markdown and reference snapshot as the
editable/reproducible source; after office-side edits, agree on one master copy.

Sources: [Zotero local API](https://www.zotero.org/support/dev/web_api/v3/local_api) and
[CSL data schema](https://github.com/citation-style-language/schema/blob/master/schemas/input/csl-data.json).
