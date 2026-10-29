# References and Office command-line interfaces

Run `node scripts/references.mjs --help` from this package. It accepts an explicit
method/path, optional JSON request file and output file. Its project-qualified
paths and response envelopes are the same as the `references` Pi tool and human
UI. `scripts/zotero.mjs` retains only its deprecated filename as a migration alias.
Old local-desktop URL/credential options are not accepted.

Actual files use `--path /projects/PROJECT/import --file sources.ris`, optional
`--encoding`, `--request-id STABLE_ID`. The client sends
256 KiB chunks through the same upload owner as the UI; decoding/native detection
run in the worker and return resumable jobs. `--input` alongside a file supplies
small transfer options only. Attachments use
`--path /projects/PROJECT/connector/saveAttachment --file paper.pdf --input metadata.json`
with `parentKey` and optional title/contentType; `saveStandaloneAttachment` uploads directly into the chosen References project. Recover lost commits with the unchanged file
and same request ID, preserving returned recovery receipts.

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
Independent References projects, item data/tags/notes/relations, schema and styles use the same API.
Read the pinned native `GET .../schema` and complete `GET .../items/KEY` data
before editing any applicable field. `PATCH .../items/KEY` accepts
`{version:RETURNED_VERSION,data:{...changedFields}}`, including full ordered
creator records, `abstractNote`, and top-level `DOI`, `PMID`, `PMCID`, `OpenAlex`
(Wdigits) and `arXiv`. Preserve unspecified fields and creator identities;
explicit empty strings clear work IDs. Automatic enrichment preserves manual
edits. Work merges require exact normalized identifier overlap, never title or
author similarity. Use returned canonical keys/versions for later edits while
retaining requested citation identities in existing documents. PDF, DOCX, XML
and other local attachment uploads preserve extensions and distinct files;
collisions receive `-2`, `-3` before the extension. Edit/delete the attachment's
own key/version, not its parent. Project Settings/relink moves every registered
attachment through the existing storage owner and updates paths transactionally.
The bundled References skill documents project create/archive/relink, deliberate
library deletion, recent-job recovery, selected native exports, saved searches,
copied-snapshot reconciliation and POST `/resolve` for browser-assisted PDFs.
OpenAlex imports may supply a search specification and explicit chosen total;
the backend pages lazily and exposes bounded `jobs/ID/results` pages.

`scripts/openalex.mjs search|import` and `scripts/harvest.mjs` are convenience
entries for shared bounded OpenAlex/Crossref requests. `scripts/citations.mjs`
renders complete Markdown through the shared CSL service. `scripts/office.mjs`
uses `POST /sessions`, `POST /sessions/ID/commands` and `DELETE /sessions/ID`;
inspect the bundled Office skill for typed native editing/save/export operations.

Output files refuse replacement unless `--overwrite` is explicit. JSON request
files must not contain credentials unless specifically handled as private input;
OpenAlex setup instead uses hidden terminal/stdin entry through `scripts/setup.mjs`.
