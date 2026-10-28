# References and Office command-line interfaces

Run `node scripts/references.mjs --help` from this package. It accepts an explicit
method/path, optional JSON request file and output file. Its project-qualified
paths and response envelopes are the same as the `references` Pi tool and human
UI. `scripts/zotero.mjs` retains only its deprecated filename as a migration alias.
Old local-desktop URL/credential options are not accepted.

Inside an owned Pi worker the inherited private worker key binds the current
session. An ordinary local CLI supplies `--session CHAT_ID` and uses the existing
private backend owner helper; it does not create a public API or new token store.
No service is spawned by a CLI. Cross-backend access still requires the established
authorized route; never substitute credentials found in an open browser tab.

Use bounded `GET /projects/PROJECT/items?limit=50` pages, native item versions and
returned continuation cursors. `GET .../items/KEY/children`, `.../fulltext` and
`.../file` expose attachment metadata, complete indexed text/coverage and files.
`POST .../identifiers/import`, `.../items/enrich`, `.../items/resolve-pdfs` and
`.../openalex/import` use shared jobs, receipts and native cancellation. Preserve
partial, unresolved and interrupted outcomes; uncertain writes need reconciliation.
Collections, item data/tags/notes/relations, schema and styles use the same API.

`scripts/openalex.mjs search|import` and `scripts/harvest.mjs` are convenience
entries for shared bounded OpenAlex/Crossref requests. `scripts/citations.mjs`
renders complete Markdown through the shared CSL service. `scripts/office.mjs`
uses `POST /sessions`, `POST /sessions/ID/commands` and `DELETE /sessions/ID`;
inspect the bundled Office skill for typed native editing/save/export operations.

Output files refuse replacement unless `--overwrite` is explicit. JSON request
files must not contain credentials unless specifically handled as private input;
OpenAlex setup instead uses hidden terminal/stdin entry through `scripts/setup.mjs`.
