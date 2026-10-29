# References module

References is BashKitten's selective integration of reference-management
components, rather than the whole Zotero desktop application. The
[component source map](legal/COMPONENT-ATTRIBUTION.md) links the exact upstream
sources to our adapters, explains the modifications and retained licenses, and
is included in the existing offline About/license package. See also the
[full module notices](THIRD_PARTY_NOTICES.md).

The existing environment backend owns authentication, project authorization,
service lifetime and HTTP transport. `createReferencesService` opens one module
per environment; it does not listen on another socket. The factory requires
`dataDir`, the persistent `backendId`, and `authorizeProject(authority,id)`.
The authorization result supplies the independent References project UUID, its attachment root
and the existing owner's `runAuthorized(work)` mutation/drain callback.

SQLite work runs in a worker with separate project files under the private
backend data directory. Native translation, CSL and resolver work runs in a
second worker. Only eight project SQLite connections stay open. Item and creator
search uses FTS5; indexed sorts use bounded, version-qualified keyset pages.
Lists transfer summary fields by default, with full records loaded explicitly.
An item edit requires its current version and returns 412 on conflict. A query
cursor returns 409 after a concurrent library change, rather than skipping data.

Each backend initially has Default and independently named References projects,
created/selected by users and agents. They are separate from BashKitten workspaces;
one workspace can use several databases. Existing database/citation UUIDs survive
migration. There are no collections in the product UI or API; legacy memberships
remain stored without dropping their items.

Attachments live under each project's exact `bibliographyPath` folder.
Their metadata includes the relative path, size and SHA-256. Databases, jobs,
credentials, extraction caches and temporary uploads stay outside projects.

## Existing-owner interface

`handle({method,path,body,query,headers,authority,signal})` accepts paths relative
to `/api/references` and returns `{status,headers,body}`, or an authorized
`filePath` for the existing transport to stream. Every data path starts with
`/projects/:projectId`. The persistent reference identity is
`bkref:<backendId>/<projectId>/<itemKey>`. Native browser backend aliases are
transport context and are never compared with the persistent backend UUID.
Library discovery uses the existing backend-owned independent References catalogue
(`GET /projects`); it does not enumerate SQLite files or load library records.
The Office document's selected library is one explicit project UUID, separate
from its file location. Every item query still addresses only that library.

- `items`, `items/:key`, `items/:key/children`, `items/:key/file`,
  `items/:key/fulltext`: metadata, notes, tags, relationships and attachments.
  Item pages accept `q`, `sort`, `direction`, `cursor`, `limit`,
  `itemType`, `top`, `deleted`, `includeData` and `format=csljson`.
  Optional comma-separated `fields` adds selected native schema fields to the
  summary for configurable columns. Extra text cells are excerpts (at most
  2,048 characters each and 16,384 extra characters per row); names in
  `meta.truncatedFields` identify excerpts. Full item records remain unchanged.
  Unknown field names return 400; indexed search, sort and cursor rules stay
  unchanged. This projection never reads another library or adds an index.
- `searches`: versioned saved-search CRUD. Retired collection filters fail
  explicitly rather than silently broadening a saved selection.
- `identifiers/import`, `openalex/import`, `items/enrich`, `items/resolve-pdfs`
  and `items/manage`: explicit bounded jobs returning 202. Management operations
  are trash and restore, with selected item versions.
- `openalex/search`: bounded provider pages/estimates, Boolean or semantic
  search, provider field selection, filters, sort and explicit cursor paging.
  The preserved V3 bounded harvest also remains available. `crossref/search`
  uses the configured contact and optional Metadata Plus header.
- `jobs` lists bounded summaries; `jobs/:id` returns detail; DELETE cancels;
  POST `jobs/:id/resume` reuses stored input and receipts, skipping successful
  records. A restart does not silently replay an uncertain write.
- `import` uses native format detection, retaining all imported records in the
  selected References database, with at most 200 records in each commit. `summary:true` returns a small resumable
  job receipt. `translators/export` lists the pinned native formats, and
  `items/export` exports selected metadata, notes and attachment URLs. File copies
  belong to the ordinary Files/Bibliography workflow; `exportFileData` is rejected
  explicitly by the metadata route.
  Real files use the existing `connector/upload-*` owner with binary `import`,
  sealed encoding/request ID and 256 KiB chunks. The worker decodes
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
`moveBibliography({projectId,bibliographyPath,expectedBibliographyPath,authority,signal})`
uses the existing per-project transition owner to copy/verify attachments and
atomically update their paths and the authoritative SQLite folder setting.
Metadata remains available when an attachment folder is unavailable. Native
BashKitten workspace/file authorization is independent and unchanged.

`deleteLibrary({projectId,confirmProjectId,attachments,authority,signal})` and
DELETE `projects/:id/library` require the exact project confirmation and an
explicit keep/delete attachment choice. A private tombstone prevents a deleted
library identity from silently being assigned to a new database. Navigation
archive/unregister remains within the independent References project owner.

## Reused native facilities

`runtime/provenance.json` names the source methods, exact source hashes and small
adaptations. The native Zotero schema, item conversion, import/search translators,
full translator graph, RDF/XPath utilities, file detection, resolver order and
conservative queue are reused. The released translation-server supplies Node
transport/sandbox adapters; it does not bring its AWS/serverless service graph.
Core HTTP retry and delay functions wrap that transport. Request cancellation
uses a per-operation asynchronous context, rather than a global selected target.

The object-only metadata converter preserves native `Item.fromJSON` handling of
unknown string fields and fields invalid for the selected item type in Extra.
Its pinned base-field/RDF deduplication and Extra formatter are reused with the
existing schema hosts. Existing valid API fields keep their native conversion;
no DOI-specific mapping or bibliographic identity check is added.

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

The existing owner supplies `resolveInBrowser({authority,projectId,requestId,signal})`
for automatic continuation after a durable browser-required recipe is stored.
The native resolver queue finishes before that asynchronous browser wait. Actual
attachment receipts decide success even when the command response is lost;
missing/disconnected browsers retain an explicit resumable request. Browser tab
progress uses the same serialized capture owner as attachment commits, so a late
progress update cannot restore a completed request. Cancellation also drains
later files already downloaded by the shared queue.

Direct OpenAlex imports use the pinned OpenAlex JSON translator for every work,
including records with DOI/PMID and works without them. Canonical DOI, PMID,
PMCID, OpenAlex work ID and arXiv values are editable item fields. The shared
SQLite owner merges exact work identities only within the selected database,
fills missing native metadata and retains source provenance and attachments.
Reimport reports `updated` when an existing reference is reused. User and Pi
`items/enrich` requests use the same native mapping and preserve deliberate edits.
Ordinary OpenAlex creator display names retain native Zotero personal-name
parsing. Explicit given/family names retain their boundaries; explicit
single-field/company names and native one-part names retain that native mode.
Creator OpenAlex/ORCID identities and the complete original work remain
available for correction.

One exact normalized work identifier is sufficient to reuse/merge a record;
titles, author similarity and journal IDs never trigger a merge. Competing
same-kind values stay in `provenance.identifierAliases` and are indexed alongside
the primary editable field. Explicitly correcting/clearing a primary field
replaces its active aliases; prior data remains in provenance history receipts.
The native worker transaction preserves manual edits, all attachment records and
bytes, and old citation keys through flattened replacement aliases. File naming
and Bibliography relocation remain with the existing attachment storage owner.
The focused offline fixture is `node --test references/test/work-identity.test.mjs`;
it does not perform a real identifier/PDF harvest or replace installed acceptance.

The full citeproc engine and complete pinned styles/locales render user and
agent citations consistently. Note styles require real native note indices.
The shared chooser is in `web/`, and capture/browser adaptations are in
`connector/`; these remain independently replaceable modules.

## Packaging and verification boundary

Each References project's actual Bibliography folder is held in its own SQLite
settings record. New files use the pinned Zotero creator/year/short-title naming
methods with UTF-8 filename limits and `-2`, `-3` collision suffixes. Legacy paths
remain valid until an explicit folder move. That move copies and verifies files
before one SQLite transaction changes the folder and item paths, then removes
the old copies. Existing receipts resume interrupted cleanup; item identities,
citation links and unchanged full text remain intact. Registered Office files
use the existing Office reservation and exact-path reconciliation owner.

`runtime-payload.json` is the runtime allowlist and legal inventory. Pristine
donor trees, source manifests and licenses remain in Git. The shared source-cache
owner fetches original archives from the exact URLs and checksums in those
manifests into `BASHKITTEN_SOURCE_CACHE` (or the existing default external cache).
The complete corresponding-source distribution includes these verified archives;
the whole desktop application and upstream test/example trees are excluded from
runtime. See `THIRD_PARTY_NOTICES.md` and the existing bundled-component legal
surface. The XPath npm dependency uses its already pinned Zotero commit archive;
it does not require a separately generated npm-pack archive in the checkout.

Focused synthetic diagnostics cover real SQLite/CSL/capture APIs, concurrent
version rejection, native HTTP retries/cancellation, native queue pacing,
project-scoped attachment commits and browser-assistance receipts. They are
outside the repository. They do not establish installed Linux/Termux browser
acceptance, native Office citation anchoring, authenticated publisher access or
same-network PDF retrieval parity. Those require the separate product and donor
comparison checks recorded by the coordinating implementation status owner.

Native metadata export supports explicit selected, library and indexed
search selections through the existing `metadata-export` job owner. The SQLite
owner freezes a library version and reads bounded 100-record pages, including all
child notes/attachments. A private JSONL input feeds the unchanged native Node
ItemGetter through its `length`/`shift` interface. One native Translate.Export
invocation writes through the pinned IO.Write with Node file/character-set hosts.
No per-page format concatenation or whole-library metadata array is introduced.

Export receipts expire after 24 hours; the next export prunes at most 100 expired
receipts/files through the existing private store. No project file or library item
is created. The shared file-response owner streams only an opened, validated
receipt. A captured stale library version returns 409; retrying an acknowledged
request returns its original receipt. Cancellation reaches synchronous native
record reads/writes through a flag in the existing worker owner.

Native CSL JSON, RDF and TEI exporters inherently build an array, graph or XML
document in memory. `translators/export` returns their `memoryNotice`; streaming
input/output does not remove those native resource requirements. One record and
its children also remain the native export unit. There is no 1,000-record total
or 200-child export ceiling. Legacy small selected-key requests can still return
inline text; file delivery and large outputs use private download descriptors.
