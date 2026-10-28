# References module

The existing environment backend owns authentication, project authorization,
service lifetime and HTTP transport. `createReferencesService` opens one module
per environment; it does not listen on another socket. The factory requires
`dataDir`, the persistent `backendId`, and `authorizeProject(authority,id)`.
The authorization result supplies the original project UUID, its current root
and the existing owner's `runAuthorized(work)` mutation/drain callback.

SQLite work runs in a worker with separate project files under the private
backend data directory. Native translation, CSL and resolver work runs in a
second worker. Only eight project SQLite connections stay open. Item and creator
search uses FTS5; indexed sorts use bounded, version-qualified keyset pages.
Lists transfer summary fields by default, with full records loaded explicitly.
An item edit requires its current version and returns 412 on conflict. A query
cursor returns 409 after a concurrent library change, rather than skipping data.

Attachments live under
`<project>/Bibliography/<stable-library-hash>/<item-key>/<attachment-key>-<name>`.
Their metadata includes the relative path, size and SHA-256. Databases, jobs,
credentials, extraction caches and temporary uploads stay outside projects.

## Existing-owner interface

`handle({method,path,body,query,headers,authority,signal})` accepts paths relative
to `/api/references` and returns `{status,headers,body}`, or an authorized
`filePath` for the existing transport to stream. Every data path starts with
`/projects/:projectId`. The persistent reference identity is
`bkref:<backendId>/<projectId>/<itemKey>`. Native browser backend aliases are
transport context and are never compared with the persistent backend UUID.

- `items`, `items/:key`, `items/:key/children`, `items/:key/file`,
  `items/:key/fulltext`: metadata, notes, tags, relationships and attachments.
  Item pages accept `q`, `sort`, `direction`, `cursor`, `limit`, `collection`,
  `itemType`, `top`, `deleted`, `includeData` and `format=csljson`.
- `collections` and `searches`: versioned collection and saved-search CRUD.
  Collection removal updates indexed membership and stored item JSON together;
  child collections must first be moved or removed.
- `identifiers/import`, `openalex/import`, `items/enrich`, `items/resolve-pdfs`
  and `items/manage`: explicit bounded jobs returning 202. Management operations
  are add/remove collection, trash and restore, with selected item versions.
- `openalex/search`: bounded provider pages/estimates, Boolean or semantic
  search, provider field selection, filters, sort and explicit cursor paging.
  The preserved V3 bounded harvest also remains available. `crossref/search`
  uses the configured contact and optional Metadata Plus header.
- `jobs` lists bounded summaries; `jobs/:id` returns detail; DELETE cancels;
  POST `jobs/:id/resume` reuses stored input and receipts, skipping successful
  records. A restart does not silently replay an uncertain write.
- `import` uses native format detection and the native collection hierarchy mapper,
  with at most 200 records in each commit. `summary:true` returns a small resumable
  job receipt. `translators/export` lists the pinned native formats, and
  `items/export` exports selected metadata, notes and attachment URLs. File copies
  belong to the ordinary Files/Bibliography workflow; `exportFileData` is rejected
  explicitly by the metadata route.
  Real files use the existing `connector/upload-*` owner with binary `import`,
  sealed encoding/collection/request ID and 256 KiB chunks. The worker decodes
  at most 32 MiB; no whole-file JSON request crosses the gateway. Success discards
  staging bytes; interrupted/partial jobs retain them for explicit resume.
- `settings` exposes safe configuration status. Keys are write-only and live
  in the private backend. Resolver JSON remains the native array/single-object
  language, including JSPath mappings and `automatic` opt-in.
- `schema`, `styles`, `citation-options`, `citations/render`, `citations/parse`
  serve the shared manager, classic chooser, Office extension and Pi adapter.

`renderDocument(state,{authority,projectId,signal})` is the internal wrapper for
the same whole-document CSL route. It returns ordered rich/plain clusters,
processor sorting, note metadata, bibliography and resolved embedded CSL items.
Snapshot mode requires current-project authorization for library reads. Fully
supplied foreign canonical snapshots render without any foreign-library access;
IDs remain unchanged and `unlinkedItems` identifies them. Explicit
`citations/import-snapshots` uses the native CSL JSON translator and returns a
retry-stable old-to-new map (100 items/4 MiB), reusing current-project IDs. It does
not mutate a document. The parser calls the preserved reviewer
Markdown parser and returns UTF-16 positions, ignoring code examples.

The optional `authorizeLibraryLifecycle` callback belongs to the existing owner
and authorizes archived or unavailable-root lifecycle operations separately.
`validateLibraryRelink({projectId,previousRoot,newRoot,authority,signal})` checks
stored attachment paths, sizes and available hashes before the project owner
changes its root. It does not move files or rewrite chat history.
`deleteLibrary({projectId,confirmProjectId,attachments,authority,signal})` and
DELETE `projects/:id/library` require the exact project confirmation and an
explicit keep/delete attachment choice. A private tombstone prevents a deleted
library identity from silently being assigned to a new database. Navigation
archive/unregister and project relinking remain native project-owner actions.

## Reused native facilities

`runtime/provenance.json` names the source methods, exact source hashes and small
adaptations. The native Zotero schema, item conversion, import/search translators,
full translator graph, RDF/XPath utilities, file detection, resolver order and
conservative queue are reused. The released translation-server supplies Node
transport/sandbox adapters; it does not bring its AWS/serverless service graph.
Core HTTP retry and delay functions wrap that transport. Request cancellation
uses a per-operation asynchronous context, rather than a global selected target.

The resolver queue is shared across libraries. Selected batches enter the native
queue together, allowing another domain to proceed while one is delayed.
Native one-second pacing, Retry-After, backoff and failure bounds are retained;
the environment adapter also retains not-before times between batches and renews
the slot when a paused request resumes. Progress arrives as worker events.
Concurrent requests for the same item share the active work.

The private Zotero OA mirror is replaced by the documented public Unpaywall or
OpenAlex API. PDF recognition uses the existing packaged Search PDF extractor,
strict identifiers and native metadata translators. An ambiguous/missing match
leaves the standalone attachment intact for manual parenting; it does not claim
the matching quality of the unavailable hosted Zotero recognition service.

Browser-required retrieval has a durable project/session/parent-bound request.
The native one-shot `references.resolve` command activates the existing capture
helper. `connector/getResolverRequest` returns its fixed recipe; the donor
browser attachment/challenge helper returns bytes through chunked API3 upload.
The backend verifies the receipt and PDF signature and completes the original
job. No cookie export, hidden polling or independent credential owner is used.
Repeated upload commits return the original receipt. RFC 2047 metadata headers
use the actual native decoder.

The full citeproc engine and complete pinned styles/locales render user and
agent citations consistently. Note styles require real native note indices.
The shared chooser is in `web/`, and capture/browser adaptations are in
`connector/`; these remain independently replaceable modules.

## Packaging and verification boundary

`runtime-payload.json` is the runtime allowlist and legal inventory. Full pinned
donor archives, source manifests and offline npm source packages remain in the
source distribution; the whole desktop application and upstream test/example
trees are excluded from runtime. See `THIRD_PARTY_NOTICES.md` and the existing
BashKitten bundled-component legal surface.

Focused synthetic diagnostics cover real SQLite/CSL/capture APIs, concurrent
version rejection, native HTTP retries/cancellation, native queue pacing,
project-scoped attachment commits and browser-assistance receipts. They are
outside the repository. They do not establish installed Linux/Termux browser
acceptance, native Office citation anchoring, authenticated publisher access or
same-network PDF retrieval parity. Those require the separate product and donor
comparison checks recorded by the coordinating implementation status owner.
