---
name: references
description: Manage independent project databases, metadata, identifiers, abstracts, PDFs, full text and citation styles through BashKitten References.
---

# References

Discover `references` with stock tool search. It uses this Pi worker's authorized
backend and the same service as the human UI. Start with `GET /projects`; choose
an explicit References project ID. Each backend initially provides a ready-to-use `Default`. Explicit later
rename/archive/delete follows the normal lifecycle; never recreate a deliberately
deleted database.
These are independent named databases, not BashKitten chat/workspace projects:
one workspace may use several. Users and agents create them with `POST /projects
{name,cwd?}` and select one returned ID for subsequent calls. Databases stay
outside repositories; attachments use the project's independently chosen
`bibliographyPath` (a Bibliography folder). There are no collections. Never read/write the
database, start another resolver, infer a destination from a browser tab, or reuse
another backend's credentials. Existing shared services start on demand.

The tool accepts `{method,path,body?,file?}`. A local `file` streams through the
existing upload owner; never encode its bytes into model messages. Import uses
`POST /projects/PROJECT/import` with optional `encoding` and stable
`requestId` (32 MiB). Attachments use `POST /projects/PROJECT/connector/saveAttachment`
with `parentKey`, optional `title`, `contentType`, `requestId`; standalone uploads
use `saveStandaloneAttachment` (2 GiB). Preserve
recovery receipts after cancellation or lost responses; retry the unchanged file
and same request ID to recover its acknowledged job/attachment.

Paths in the table below follow `/projects/PROJECT`.
Native item responses retain complete `data`, versions and canonical
`bkref:BACKEND/PROJECT/KEY` identities. A bare key or compatibility `users/0` is not
a citation identity. Map legacy identities explicitly before using them.

Read `GET /projects/PROJECT/schema` for the pinned native item types, their
applicable fields and creator roles, then `GET /projects/PROJECT/items/KEY` for
complete metadata. The tool's `body.data` accepts every applicable schema field;
it is not limited to title/abstract or a CSL snapshot. Update native fields such
as `publicationTitle`, `volume`, `issue`, `pages`, `date`, `publisher`, `url`,
`language`, `extra` and `abstractNote` through the same versioned item API as
the right-hand editor. Work identifiers are editable top-level `DOI`, `PMID`,
`PMCID`, `OpenAlex` (canonical `W123…`) and `arXiv` fields. An explicit empty
string clears an identifier; changing/clearing a primary ID replaces all active
values of that kind. Verified alternatives are editable arrays in
`data.provenance.identifierAliases`, e.g. `{PMID:["456"]}`. The backend normalizes
all inputs and updates its identity evidence. Keep original raw resolver/provider
provenance.

For example, after reading an item's canonical key and version:

```json
{"method":"PATCH","path":"/projects/PROJECT/items/KEY","body":{"version":7,"data":{"title":"Corrected title","publicationTitle":"Journal name","abstractNote":"Verified abstract text","DOI":"10.1234/example","PMID":"12345","PMCID":"PMC67890","OpenAlex":"W123456","arXiv":"2301.12345","creators":[{"creatorType":"author","firstName":"Ada","lastName":"Lovelace"},{"creatorType":"author","name":"Research Consortium"}]}}}
```

Use actual returned IDs/version and verified metadata, never the example values.
Preserve the full ordered creator array, including each creator's role and
`ORCID`/`OpenAlex` author identities when present. Single-field organization or
unstructured names use `name`; person names use `firstName`/`lastName`.
Human/agent edits become manual field provenance, which later automatic
enrichment preserves. Automatic imports/enrichment merge only when normalized
work identifiers overlap exactly; any one exact ID suffices, even when another
identifier kind differs. Titles, authors, journal ISSNs and similar text do not
establish work identity. Newly supplied missing identifiers/metadata are unioned
on a match; differing same-kind IDs survive in `provenance.identifierAliases`
and returned `identityConflicts` identify that condition. After a merge, use the returned canonical key/version
for further edits. Reading an old citation key returns survivor metadata and
`requestedKey`; preserve the original citation identity in existing documents.

Local attachments use the tool's `file` parameter with
`POST /projects/PROJECT/connector/saveAttachment` and
`body:{parentKey:"RETURNED_KEY",requestId:"STABLE_ID"}`. PDF, DOCX, XML and other
formats share this upload owner and retain their extensions. Every distinct
upload is kept, including matching bytes/names; filename collisions receive
`-2`, `-3`, etc. before the extension. Reusing the same request ID is an idempotent
retry of that upload. Read a parent's bounded `/children` page, PATCH a child
attachment's title/URL/parent using its own version, or DELETE its own key to
move it to deleted items. Set `parentItem:null` to leave it standalone.
Enrich metadata with `POST /projects/PROJECT/items/enrich`
`{keys:["RETURNED_KEY"],requestId:"STABLE_ID"}`, then read its job and reload the
item. Direct OpenAlex imports and this tool use the same normalization/merge
owner; do not implement a second deduplicator or metadata writer.

| Operation | API |
| --- | --- |
| Bounded library search | `GET /items?q=TEXT&limit=50&sort=title`; keep returned `next` cursor and library version. Use `cursor=...` for the next page; reload on concurrent-change conflict. `format=csljson` adds derived CSL, preserving native metadata. |
| Item and cached full text | `GET /items/KEY`, `/items/KEY/children?limit=50`, `/items/ATTACHMENT/fulltext` and `/items/ATTACHMENT/file`. Read returned coverage counts and missing-text status. |
| Create/update/delete | `POST /items` with `{data:{itemType,...}}`; `PATCH /items/KEY` with `{version:PREVIOUS,data:{...changedFields}}`; explicit replacement uses `PUT /items/KEY` with `{version:PREVIOUS,data:COMPLETE_DATA}`; `DELETE /items/KEY` with `{version:PREVIOUS}` moves it to deleted items. Preserve full creator records, metadata, tags, notes and relations. |
| Identifier import | `POST /identifiers/import` with `{identifiers:[...],resolvePDFs:false,requestId:STABLE_ID}`; at most 1,000 selected identifiers. Verified identifiers revealed by native translation are checked again before writing. |
| OpenAlex | `POST /openalex/search` with `{query,filter?,sort?,page:1,pageSize:80,queryMode:'boolean',field:'all'}`; follow `nextCursor` or `nextPage`. `POST /openalex/import` accepts selected `records:[raw,...]` (at most 1,000) or `search:{query,filter?,sort?,queryMode?,field?,exact?}` plus an explicit positive `limit`. Both accept `resolvePDFs` and stable `requestId`; search imports page inside the backend. |
| Shared enrichment/PDF queue | `POST /items/enrich` or `/items/resolve-pdfs` with `{keys:[...],requestId:STABLE_ID}`. Enrichment never creates records. |
| Jobs | `GET /jobs?limit=80` recovers recent work; `GET /jobs/ID` reads progress, DELETE cancels, POST `/jobs/ID/resume` resumes partial/interrupted work. Search-import summaries contain only 80 samples; read `/jobs/ID/results?limit=80&cursor=...` (or `start`) for remaining outcomes. Carry returned `version`; reload on 409. |
| Bulk management | `POST /items/manage` with `{operation:'delete'|'restore',items:[{key,version}],requestId}`; at most 1,000 selected records. |
| Saved searches | Versioned GET/POST `/searches` and GET/PATCH/DELETE `/searches/KEY` preserve the shared UI search specification. |
| Native import/export | Small pasted text: POST `/import` with `{text,requestId,summary:true}`. Actual files: use `file`. GET `/translators/export` lists native formats/options and `memoryNotice`. POST `/items/export` with `{selection:{scope:'selected',keys:[...]},translatorID,options,requestId,delivery:'file'}` starts a cancellable `metadata-export` job. Other explicit scopes are `library` and `search` with frozen `q`, `deleted`, `sort`, `direction`; include the last indexed page `version` when available. Stale selections fail with 409; reload rather than silently changing the export. The server pages all parents/children into private input and invokes one native translator. Legacy small `keys` requests remain supported. Use `delivery:'file'` to return an expiring private export descriptor; GET its project-relative `downloadPath` for a local `filePath` and scoped browser `url`. No project files or library items are added. Large inline outputs automatically return the same descriptor. Attachment bytes use normal download routes; `exportFileData` is explicitly unsupported by metadata export. |
| Schema/styles | `GET /schema`, `GET /styles?query=TEXT&limit=50`; whole-state `POST /citations/render` is shared with Office. |
| Safe service configuration | `GET /settings`; user `/review-setup` or native References settings owns key entry. Never solicit API keys in model messages. |
| Copied snapshots | Explicit POST `/citations/import-snapshots` with `{items:{OLD_ID:CSL,...},requestId}` imports up to 100 snapshots/4 MiB through native CSL conversion and returns `mapping`. Existing current-project IDs are reused; foreign IDs never silently retarget. Office's `citations.import-snapshots` also safely relinks managed fields. |

Backend-relative catalogue routes: GET `/projects?includeArchived=true` returns
`id,name,bibliographyPath,archived,isDefault,revision`. POST `/projects {name,cwd?}`
creates an independent database; optional `cwd` is the parent of Bibliography,
not a workspace authorization. PATCH `/projects/ID {name}` renames it; POST
`/projects/ID/archive {archived}` archives/unarchives navigation. Move the actual
attachment folder through POST `/projects/ID/relink
{bibliographyPath,expectedBibliographyPath,expectedRevision?}`. The existing owner
copies/verifies files and atomically updates stored paths; inspect returned
status/errors before reporting success. DELETE `/projects/ID` unregisters its
navigation without deleting data. DELETE `/projects/ID/library` requires
`{confirmProjectId:ID,attachments:'keep'|'delete'}` and permanently retires the
database identity. Archive is not permission to delete. Existing legacy IDs,
items, citation identities and attachment locations survive migration; legacy
collection memberships are retained as inert data and cannot be edited.

An attachment or export GET returns its authorized owning-backend `filePath` and
ordinary browser `url`. To view it, use the existing browser `tabs.create` with
`{url,application:true}`; keep the returned exact service mapping.

For a returned PDF `challenge-required` request, use backend-relative POST
`/resolve {projectId,requestId}`. The same authorized browser helper used by the UI
handles login/challenges. Do not supply a URL, copy cookies, invent a browser
target or poll hidden tabs. Re-read the original job/outcome pages afterward.

OpenAlex supports pages of at most 100, basic paging through 10,000 results and
deeper cursor paging with a configured free key. Semantic search has actual
provider limits of 50 results and 2,000 query characters. These are provider
limits, not project-library size limits. Keep partial receipts on budget/errors
and resume explicitly; do not eagerly fetch an entire provider result set.

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
refresh and bibliography. First inspect its document binding; if unset, use
Office's existing `citations.bind` with one registered `projectId`,
`style:{id,locale}`, `expectedRevision` and `expectedNativeSnapshot` from the same
inspection. Search/read/import for
that document only within its bound project database; never resolve a bare key
against another library. The file's owning project or a browser selection does
not replace this binding. A References project switch with managed citations/bibliography
requires explicit user authorization before `convertExistingToText:true`: it
unlinks managed anchors while retaining rich rendered content and formatting.
Cancellation leaves the binding/content untouched. Library metadata edits alone
do not change a live document; refresh through the plugin afterward.
`review_references` saves bounded verified CSL snapshots; `review_zotero` is its
migration alias. `systematic-review` provides optional research methods and
source-reading guidance without imposing a review database or pipeline.
