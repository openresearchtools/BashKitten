# Office native module

This module connects to the one backend-owned Collabora Online service. It does
not own another document engine, save timer, collaboration server, login or
browser integration. The pinned implementation is `cp-26.04.5-2`, commit
`42745e44dd8530fac7acd5f46cb7571ceea63c6a`; its untouched source and notices are
under `upstream/online/source`.

`createOfficeService()` accepts the existing backend's `resolveOpen`, `authorizeOpen`,
`authorizeSession`, `authorizeRenew`, `authorizeSnapshot` and References adapters.
It opens an independently authenticated native participant for Pi using normal
`coolclient`, `load`, `executescript`, UNO, save and export messages. The trusted
WOPI owner supplies all endpoints and tokens. Pi cannot select credentials.
Browser URLs use the authorized HTTPS host; private native sockets use the
separate backend endpoint. An ordinary editor tab is optional for visual work.
Native `filemode` and `perm` messages govern scripting access, including a
writable host grant made read-only by a native lock failure. Token renewal uses
the existing host authority and native `resetaccesstoken`, preserving the view;
it can run while a native save awaits renewal. Only an explicit native
`docunloading` load response retries with the released client's bounded backoff.
The registry resolves authority and document/project identity before allocating
native credentials. Repeated and concurrent opens share the existing participant
and revalidate its captured grant instead of creating unused browser launches.

Private routes are `POST /sessions`, `POST /sessions/:id/commands`,
`DELETE /sessions/:id` and `POST /snapshots/diff`. Runtime adapters wrap results
in their ordinary `{status,body}` envelope. Commands include bounded inspection,
paragraph/table, cell/formula/sheet, slide/shape and formatting edits; citation
insert/edit/remove/style/refresh/bibliography/code promotion; native save/export;
`native.uno {command,arguments:[{name,type,value}]}`; and
`native.script {source,args}` for a JavaScript function running in the native
kit. These escape hatches retain actual native scripting permissions. They do
not run JavaScript in the backend process. An uncertain dispatched mutation is
never replayed: its error includes `operationId`, followed by inspection and
explicit `reconcile` before further mutation.

`export.copy {name,format}` invokes native WOPI Save As, authorizes the new
document through the same owner, unlinks citations only in that separate
document, saves it and returns its session/browser/download details. Plain
`export` keeps managed fields. Downloads are native single-use capabilities;
keep the returned session open until the download finishes. Unknown export
options are rejected. History restore uses a separately authorized temporary
view and the native `versionrestore prerestore` broker acknowledgement after
save/close; a browser assertion cannot authorize a restore.
The panel's explicit text-copy action uses its existing frame nonce and captured
browser grant to call this same operation. Its temporary native views are scoped
to the individual action; the ordinary browser URL opens the saved copy. Native
export URLs are registered with the existing file owner before being returned
through the service, so ordinary browser opening retains the authorized route.

## Replaceable References extension

`extension/kit.mjs` is the same native operation adapter used by Pi and the
Office extension. Writer uses Collabora's native UNHANDLED fieldmark facility
(also used by its Zotero integration), with normal rendered text and embedded
CSL identities/data. Calc uses whole-cell user-defined attributes and named
anchors; Impress uses attributes on native text shapes. These native carriers
travel with copied objects. The generic OOXML attribute patch preserves the
same attributes in XLSX/PPTX; ODS/ODP already preserve them natively. A native
document property stores ordered citation/style state. Calc and Impress retain
clickable rich-text links through their native URL text fields.
Legacy `com.sun.star` use is isolated here because the pinned runtime's preferred
`cool.getActiveDocument()` model binding threw a native overload/type error in
the actual runtime proof. It is an upgrade check, not permission to omit edits.

The classic chooser is packaged directly from `../references/web`, not a second
picker. Desktop uses native `cool.dialog`; the small-screen patch reuses that
same native dialog host where upstream has no sidebar. The host proxy binds
each frame/origin/nonce and exposes project-scoped References requests without
another browser bearer token. The native experimental feature and actual write,
copy, print and export gates remain enforced.

Refresh/style commands accept `metadataSource: 'library' | 'snapshot'`; embedded
snapshot rendering preserves original identities without reading other projects.
`citations.import-snapshots {requestId?,collection?}` explicitly imports copied
references with the native CSL JSON translator, in bounded receipt-deduplicated
batches, then checks native revision/positions before relinking the document.
Current-project identities are reused. If the document changed after import,
the error retains the request ID and mapping; imported library records remain
available and the document is not silently retargeted.

`package-extension.mjs` builds browser `.js` assets from source `.mjs` modules
because the pinned native server does not assign JavaScript MIME to `.mjs`.
Packaging puts the ZIP contents directly at its root and installs
`runtime/share/bashkitten/org.bashkitten.references.zip`. `prepareOffice()`
returns its fixed path and SHA256 to the WOPI owner. Native UserSettings exposes
`extensions:[{uri,stamp}]`; the ZIP filename identifies the plugin and native
presets own download/cache/atomic replacement. `../cool.js` resolves to the
released native client API even in a preset extension.

The named native patches cover only observed missing facilities: small-screen
extension access, a runtime proof-key path, generic document-property undo,
Writer field-command undo/redo, and generic OOXML user-defined attributes.
The light-canvas and Termux changes belong to their respective native owners.
No citation algorithm is added to Office core. Recheck and retire seams when
upstream provides the equivalent facility. `prepareOffice()` fails with 503 for
missing/incompatible native artifacts and uses the existing service owner.
Termux keeps native Landlock mandatory and supplies its bundled Bionic runtime
paths in the child service environment; it never disables seccomp.

## Snapshot comparison

`office-diff --project ID --document ID --from VERSION --to VERSION --format
json|text [--session SESSION]` uses the existing authorized private application
channel. Only retained immutable snapshot descriptors can reach the library.
It needs no running Office renderer or References service. Pinned yauzl, saxes
and diff sources are retained under `vendor/npm`, with lockfile integrity.

Comparison reads ZIP entries and namespace-aware XML, including text/tables,
fields/notes, cells/formulas/styles/merges/names, slides/shapes/themes and
relationships. Uninterpreted/binary parts retain checksums and size differences;
normalized-equal XML still reports raw changed parts. It never extracts files,
executes macros or resolves external XML/relationships. Worker time, memory,
expanded sizes and output are bounded, and cancellation terminates the worker.
It does not claim visual or full semantic equivalence, and has no UI/Git hook.

## Verification and remaining work

Fresh independent copies on stock pinned CODE have exercised all six formats
for native edits, rendered multi-source citations, style change, bibliography,
WOPI save and PDF export. Save/reopen preserves citation IDs and metadata.
Actual addon-host Save As plus unlink-in-copy passed all six formats while the
source retained its citation. Namespace-aware snapshot comparison identified
changed semantic parts for all six formats. Native restore acknowledgement and
Writer inline/footnote/endnote transitions have focused proofs.

The 28 October native gateway run used artifact manifest SHA256
`6742ea3282e39d416eb0d94e45229eca7ceee447633fab2e4aa2935140dd16db`
and packaged extension ZIP SHA256
`c57cd3fa1e3e18cdaada5d285faa3516bd59051a22003d66f83891bf6ca08eea`.
The loaded native adapter source SHA256 was
`2e6c3f099d04e63ab9b7085902bf58496a9cae85dfd762aaf34120aff51a2e28`.
On a fresh DOCX, native Undo/Redo restored both field command metadata and
document-property revisions for insertion and locator edits, including the same
occurrence ID and rendered text. Full backend shutdown/reopen preserved managed
citations in DOCX/XLSX/PPTX. The generic attribute seam independently preserved
exact 43,709-byte native attribute payloads through native clipboard and all six
format roundtrips.

These component proofs are not installed product acceptance. Current work still
includes comprehensive cross-document copy/move identity behavior, full
desktop/phone chooser behavior and installed Linux/Termux/browser flows.
In particular, an unrefreshed copied cell has a distinct provisional occurrence
identity until its native payload is persisted by a citation operation. No
six-format roundtrip result establishes the missing installed UI checks.
