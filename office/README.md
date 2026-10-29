# Office native module

This module connects to the one backend-owned Collabora Online service. It does
not own another document engine, save timer, collaboration server, login or
browser integration. The pinned implementation is `cp-26.04.5-2`, commit
`42745e44dd8530fac7acd5f46cb7571ceea63c6a`; its untouched source and notices are
under `upstream/online/source`.

## Where the upstream source is

| Contents | Location |
| --- | --- |
| Complete pinned Collabora source tree | [upstream/online/source](upstream/online/source) |
| Office engine, including Writer, Calc and Impress | [upstream/online/source/engine](upstream/online/source/engine) |
| Original licenses and third-party notices | [COPYING](upstream/online/source/COPYING), [THIRDPARTYLICENSES](upstream/online/source/THIRDPARTYLICENSES), [engine licenses](upstream/online/source/engine/readlicense_oo) |
| Exact release, commit and complete-tree hashes | [upstream/online/source.json](upstream/online/source.json) |
| Exact dependency download URLs and checksums | [upstream/dependencies](upstream/dependencies) |
| Our changes, applied to an external build copy | [patches](patches) |

The Collabora import contains the complete recorded upstream Git tree, including
the engine. Build preparation fetches the exact dependency archives selected by
the committed URLs and checksums into `BASHKITTEN_SOURCE_CACHE` (default
`~/.cache/bashkitten-sources`). Downloaded archives and split copies are not
stored in Git. A prepared cache supports `BASHKITTEN_OFFLINE_SOURCES=1`; the
normal build verifies the source tree and original archive checksums. Matching
original dependency sources are delivered with the normal corresponding-source
artifacts, including instructions for using that cache offline.

## Runtime integration

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
`DELETE /sessions/:id`, `POST /snapshots` (list/open/restore/configure) and `POST /snapshots/diff`. Runtime adapters wrap results
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
The explicit text-copy command uses its existing frame nonce and captured
browser grant to call this same operation. Its temporary native views are scoped
to the individual action; the ordinary browser URL opens the saved copy. Native
export URLs are registered with the existing file owner before being returned
through the service, so ordinary browser opening retains the authorized route.

## Replaceable References extension

`extension/kit.mjs` is the same native operation adapter used by Pi and the
Office extension. Writer uses Collabora's native UNHANDLED fieldmark facility
(also used by its Zotero integration), with normal rendered text and embedded
CSL identities/data. Calc citations use whole-cell user-defined attributes and
named anchors; Impress uses attributes on native text shapes. Calc bibliographies
use native cell-anchored text shapes because its cell text writer deliberately
removes paragraph attributes. These native carriers
travel with copied objects. The generic OOXML attribute patch preserves the
same attributes in XLSX/PPTX; ODS/ODP already preserve them natively. A native
document property stores ordered citation/style state. Calc and Impress retain
clickable rich-text links through their native URL text fields.
Bibliography indentation, line/entry spacing and tab stops come from the actual
Zotero `Cite.getBibliographyFormatParameters` output. The adapter converts twips
to native UNO units and honors the native relative-tab convention. Writer uses
the native `Bibliography 1` paragraph style, retaining its customizations during
same-style refresh and resetting CSL-owned layout properties when the citation
style changes. Direct formatting may reset during native rich-text regeneration,
as in Zotero's LibreOffice integration. Calc and Impress retain native shape
paragraph adjustments, matching entries by their CSL identities. Numeric labels
use native tabs; rich titles and links remain native
text formatting. Native copied bibliographies are refreshed and unlinked together.
Legacy `com.sun.star` use is isolated here because the pinned runtime's preferred
`cool.getActiveDocument()` model binding threw a native overload/type error in
the actual runtime proof. It is an upgrade check, not permission to omit edits.

The classic chooser is packaged directly from `../references/web`, not a second
picker. The commands-only manifest has no sidebar entry. Labelled native
Citations menu/notebookbar actions open short-lived HTML command dialogs through
the existing native `cool.dialog.open` host, on desktop and phones. One optional
nonvisual `background` entry receives the existing native command callbacks and
owns `cool.document.onModified` for automatic typed-code conversion through the
existing bounded parser/promotion owner. This is the missing extension lifecycle
facility; it does not create a sidebar, polling loop or separate service. Native
menus, secondary-click contributions and keyboard dispatch remain upstream.
An already open command dialog keeps its draft when another command is invoked.
The dialog forwards the native `titlebar:false` option because its shared
chooser/settings already provide the title and actions. This avoids a duplicate
header and preserves native CSS centering when a phone keyboard changes the
viewport. Native Escape and explicit Cancel/Close remain available, including
while the authorized host context is loading.
Very short keyboard viewports retain normal control sizes and scroll the whole
Settings dialog. Headerless native frames reduce their outer gutter as space
falls; this does not make an entire form fit a single control row.
The host proxy binds
each frame/origin/nonce and exposes project-scoped References requests without
another browser bearer token. The native experimental feature and actual write,
copy, print and export gates remain enforced.

Add/Edit Citation uses `citations.selection` to identify the managed citation
under the native caret or partial selection (or the selected Calc cell/Impress
text shape). Secondary-click Edit and Remove use that same native selection.
Editing preloads the complete cluster into the shared chooser, and both preview
and confirmation carry revision/native-snapshot guards. Complete chooser edits
use `replaceCluster:true`, including deliberate removal of custom preview text;
Pi's existing partial-edit contract remains unchanged. Adding, editing or
removing citations and changing styles refresh the managed bibliography in the
same operation.

Each document explicitly binds one project library and citation style in its
native document property. First citation use opens Document settings, using the
existing authorized project catalogue and bounded style search. Project is the
first dropdown. Styles use catalogue titles, including a saved style outside the
first result page, and languages use native `Intl.DisplayNames` labels while
retaining the CSL locale values. Bibliography and conversion remain separate
commands. The file's
project remains its file authority; References requests are separately authorized
for the single bound library. The chooser never searches across databases.
`citations.inspect.binding` is `{projectId,style}` or `null`. Pi uses
`citations.bind {projectId,style:{id,locale},expectedRevision,expectedNativeSnapshot,noteType?}` with the
revision and nativeSnapshot from inspection. Native paste/deletion can change
managed content without changing the plugin revision, so both guards are required. Unbound citation commands fail with `binding_required`.
Changing the library with live managed citations or bibliography requires
`convertExistingToText:true`; the UI asks explicitly before issuing it. Cancel
issues no native mutation. The native operation unlinks fields/attributes while
preserving rich rendered content, paragraph layout and cell/shape formatting,
then records the new empty binding in the same native Undo group. It does not
render the old content with the new style. A same-library style change uses the
existing render/apply path. Revision and native-position checks reject stale
settings or rendering; typed-code promotion also captures the bound library.

Refresh/style commands accept `metadataSource: 'library' | 'snapshot'`; embedded
snapshot rendering preserves original identities without reading other projects.
`citations.import-snapshots {requestId?}` explicitly imports copied
references with the native CSL JSON translator, in bounded receipt-deduplicated
batches, then checks native revision/positions before relinking the document.
Bound-library identities are reused. If the document changed after import,
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
extension access, the optional background command/listener lifetime,
viewport-bounded native frames and distinct per-dialog reply identities,
native modifying-activity accounting for editable scripts during final autosave,
a runtime proof-key path, generic document-property undo,
Writer field-command undo/redo, generic OOXML user-defined attributes, and native
view ownership for UNO undo contexts/actions, background shape undo, a
read-only native text-edit state property, and rich-text snapshots in the native
shape-attribute Undo action. The latter selects the existing native text-saving
option so unlink Undo restores both attributes and paragraph/rich-text layout.
These retain the existing
collaborative ownership checks; they do not allow one participant to undo another.
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
normalized-equal XML still reports raw changed parts. Office text containers and
inherited `xml:space` preserve significant whitespace; adjacent SAX text chunks
are coalesced so parser input boundaries do not create differences. It never
extracts files, executes macros or resolves external XML/relationships. Worker time, memory,
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
On a fresh DOCX, the native `XUndoManager` API restored both field command metadata and
document-property revisions for insertion and locator edits, including the same
occurrence ID and rendered text. This API proof did not establish collaborative
UI Undo: a later `.uno:Undo` check exposed upstream UNO contexts' unknown view
identity. The rebuilt 0009 artifact (manifest SHA256
`117843e54fc2615aba0f836812ca2dbc89761a02fb05440c57bc0cfa582b9937`,
packaged plugin `04a026bff54d0236530ad9952cf6f607442f1a16c915c56fbf9a73a5cce65fea`)
and the adapter's actual active-frame controller passed Writer `.uno:Undo`/Redo
with separate authenticated views. The other view's Undo was rejected in all
three editors. Calc/Impress shape text initially failed to roll back with the group.
The subsequent 0010 artifact (manifest SHA256
`0a7feb8700501540dc186878452958c9772df01ff73dbae7abd188e2ecd3a128`,
plugin `a07c72a7f01480fa9ddb749943c6222723314df81ccee96a5a4ac76d74288d86`)
passed native `.uno:Undo`/Redo and other-view rejection in all three editors,
including copied bibliography layout and unlink/Undo/Redo. Empty auto-grow
frames regain their original size and empty text. Native active same-shape
writes now reject; edits elsewhere and human typing continue, and retry works
after the human finishes. Calc's rollback after an earlier cell write moved an
anchored shape by 0.05 mm, so the adapter also preflights all shape targets via
the generic 0016 native read-only property before any citation write. The 0016 runtime (manifest SHA256
`d38de9569e428818cc2561761da0ed158ca4ab9fe213a5bc6fccc2b2cdab3492`,
plugin `3b5be62d9c8db13c3e1f16240faa7c41eb6e9e17f0b14b179becef3bf36074ce`,
adapter source SHA256
`b538e69bec586f94f2fb034625ae14e40f15e3c8e32b8dc3caaf66d65bb56c11`)
then passed exact text/metadata/geometry preservation on active-target rejection
in Calc and Impress, including an untagged shape targeted for code promotion.
The property changed false/true/false around native text editing, rejected writes,
reported read-only/transient flags, and did not change the undo stack. Edits in
another shape, continued human typing, and explicit retry after editing all
passed through the same shared native owner.
Full backend shutdown/reopen preserved managed
citations in DOCX/XLSX/PPTX. The generic attribute seam independently preserved
exact 43,709-byte native attribute payloads through native clipboard and all six
format roundtrips.

The subsequent native gateway check copied citations before their originals in
DOCX/XLSX/PPTX. Original field/name/NamedRange identities stayed attached to the
originals, inspection left embedded state byte-identical, and refreshing then
editing a copy left the original locator unchanged. APA and numeric bibliography
layout, same-style custom indentation, and copied bibliography refresh/unlink
passed native checks in all three editors. A full backend shutdown/reopen retained
the bibliography carriers, text, indentation, spacing and native tab coordinates,
including the Calc text shape in XLSX. A subsequent copy-before-original then
native deletion of the original retained the surviving copy's identity in all
three editors. Read/inspect remained nonmutating; explicit refresh removed the
missing occurrence and its dangling owned range. Native `apa-with-abstract`
blocks, `acm-siggraph` small caps, and nested roman text within italic text also
passed native text/character-property inspection in all three editors. These
latest adapter diagnostics used source scripts against the 0009 runtime; they
are not receipts for the older packaged ZIP. These are native component diagnostics;
rendered desktop/phone UI and visual layout acceptance remain separate.

Explicit UI citation confirmation finishes only its own native shape editor
before the citation undo group. Actual Calc/Impress checks retain the typed text
on citation Undo, with a separate next Undo for the typing. Preview/read/cancel
leave the editor untouched. The preflight and mutation execute in one synchronous
native script under the native SolarMutex; another view cannot start editing
between those two steps. CSL rendering occurs before that script and still uses
revision/anchor checks.

The subsequent document-binding regression used the rebuilt native runtime
(manifest SHA256
`4227675632bb46547c8248a9c03223a8a8066270916fd18b87a41012a664724e`,
adapter source SHA256
`8d37f4cbbaf8cf1571507c91885bf5b956eddbabf84700134a097023633404df`).
All six formats passed unbound-operation rejection, unconfirmed-switch
nonmutation, stale-revision rejection, exact rich unlink, ordinary native
Undo/Redo of the binding and managed content, and binding persistence after
save/reopen. The 0018 correction selects the existing native attribute-Undo
text snapshot option; Undo remains an ordinary editor regression check.
Separate focused checks on the preceding 0016 runtime proved native paste can
change the anchor snapshot without changing the stored revision, and that the
snapshot guard rejects stale confirmation without mutation in all three editors.
Byte-identical source copies also passed matched normal-save versus
unlink/save/reopen comparisons in all six formats: normal export normalization
was identical on both paths. Those earlier receipts retain their original
runtime identities; none of these module checks establishes installed UI or
platform acceptance.

Native Calc cell input follows its existing last-commit behavior: both raw UNO
cell writes and ordinary native `EnterString` can be superseded by a human's
later Enter from an already active cell input buffer. This adapter does not add
a separate cell-lock policy. Agents should inspect and verify the final cell
value when another participant is editing that same cell.

These component proofs are not installed product acceptance. Current work still
includes comprehensive cross-document copy/move identity behavior, full
desktop/phone chooser behavior and installed Linux/Termux/browser flows.
In particular, an unrefreshed copied cell has a distinct provisional occurrence
identity until its native payload is persisted by a citation operation. No
six-format roundtrip result establishes the missing installed UI checks.
