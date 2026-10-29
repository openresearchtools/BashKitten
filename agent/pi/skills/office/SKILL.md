---
name: office
description: Create, read and edit live Collabora documents, spreadsheets and presentations, manage References citations, save/export and inspect ordinary browser views.
---

# Office

Discover `office`. `open` requires an explicit owning `projectId` plus a returned
`documentId`, a project-relative `relativePath`, or `create:{name,format}`.
The native owner resolves existing files and exclusive creation within that project. Save
its returned `sessionId`, document type, capabilities and `browserUrl`. The backend
owns one shared Collabora service and authenticates a separate agent participant.
Editing works without an open editor web UI. Optional `show:true` opens the normal
browser URL; also use the existing `browser` tools to open/inspect returned views
or exported PDFs when visual verification helps. Never copy another tab's token.

Execute uses `{action:'execute',sessionId,command:{operation,...}}`. Native replies
and capability errors are authoritative. Work with stable objects and expected
content, preserving human changes and managed citation fields. Never replace the
live file with direct ZIP/XML edits or run a standalone conversion process.

| Native operation | Command fields |
| --- | --- |
| `inspect` | Bounded `offset,limit`; optional `sheet,range`. Read text/tables/cells/formulas/slides/shapes and managed citation identities. |
| `text.append` | `text` |
| `text.edit` | `target:{paragraph,offset,length,expectedText}`, `text` |
| `table.insert`, `table.set` | `rows,columns,name,target`; or `table,cells:[{cell,text}]` |
| `sheet.set`, `sheet.insert` | `sheet,range,values` or `formulas`, optional `expectedFormulas`; or `name,index` |
| `sheet.rows`, `sheet.columns` | `sheet,index,count,action` |
| `slide.insert`, `slide.remove` | `index,name`; or `slide` |
| `shape.insert`, `shape.edit` | `slide,name,text,x,y,width,height`; or `target:{slide,name|index},text,expectedText,position,size` |
| `format` | Native `target,properties`; preserve authored cell/font/slide colors. |
| `citations.bind` | First inspect, then supply `projectId`, `style:{id,locale}` and required `expectedRevision` and `expectedNativeSnapshot` from the same `citations.inspect` result; optional `noteType`. Changing libraries with managed content additionally requires explicitly authorized `convertExistingToText:true` as described below. |
| `citations.inspect`, `citations.insert`, `citations.edit`, `citations.remove` | Use returned plugin state and native target/occurrence identity; clusters retain ordered verified References IDs, locators, affixes and suppress-author. |
| `citations.style`, `citations.refresh`, `citations.bibliography` | Set installed style/locale and render the complete ordered document state through the shared plugin. |
| `citations.import-snapshots` | Explicitly import copied references into the document's bound project library with stable `requestId`, optional `collection`; the adapter verifies revision/positions before relinking fields. |
| `save`, `export` | Await actual save acknowledgement; export supplies supported `format` and optional `name`, returning its real result/view URL. |

For Calc, put `sheet`, `range` and `values` or `formulas` directly in `command`.
`sheet` is a zero-based index or the native sheet name. `range` is a native range
string such as `A1:B2`, `$A$1:$B$2` or a named range. Matrix rows and columns match
the selected range. Inspect that range first; copy its returned `formulas` into
`expectedFormulas` when guarding an edit against concurrent changes.

```json
{"action":"execute","sessionId":"RETURNED_SESSION_ID","command":{"operation":"sheet.set","sheet":0,"range":"A1:B2","values":[["Item","Amount"],["Example",2]]}}
```

```json
{"action":"execute","sessionId":"RETURNED_SESSION_ID","command":{"operation":"sheet.set","sheet":"Sheet1","range":"C2","formulas":[["=B2*2"]]}}
```

Inspect native capabilities and the specific API result before assuming a command
works on an editor. Use shipped UNO-backed operations when preferred script
interfaces lack an operation. A deprecation warning does not authorize silently
omitting it; report permission/extension/runtime gaps precisely. On an uncertain native mutation, keep its returned `operationId`, inspect the
actual affected document state and explicitly use `reconcile` with that ID before
any new mutation. Never automatically replay an edit after timeout/disconnect.
Native locks, undo, selection and overlap semantics apply. Separate views permit work in different
locations but do not guarantee conflict-free edits at the same location.

Users see style-rendered managed citations. Read rendered text plus identities;
use the References chooser/API and plugin for insert/edit, multi-source clusters,
style/locale, refresh and bibliography. Refresh after metadata edits in the bound
library, and verify the resulting live document. Do not flatten fields to hide an
error. Typed `sr-cite:` markers are optional interchange that must be promoted to native fields
by a supported adapter, not pasted as a substitute for live citations.

Before first citation use, inspect the document's `binding:{projectId,style}`.
If it is null, choose one registered library from References `GET /projects` and
an installed citation style, then call `citations.bind` with both `expectedRevision` and
`expectedNativeSnapshot` through the same Office
executor. The binding is durable document metadata; it need not be the project's
file location or the currently selected browser library. Search and resolve only
that bound database. Regular citation commands require a binding, and an explicit
`projectId` on them must match it. Reinspect on `citation_state_changed` or a changed native snapshot; do not
retry with a guessed revision or silently select another library.

Changing the binding with no managed citations or bibliography is an ordinary
settings operation. With managed content, obtain explicit user authorization to
unlink it before sending `convertExistingToText:true`; never add that flag merely
to bypass `binding_confirmation_required`. Despite its name, the flag preserves
rendered text, rich runs and native formatting while removing managed anchors and
metadata. Existing content is not rerendered in the new style or linked to the new
database. If the user cancels, send no binding mutation. A same-library style
change uses normal managed refresh and does not require unlinking.

Copied fields can use `metadataSource:'snapshot'` on style/refresh: supplied CSL
renders with its original identities and no foreign-library read. Library mode
uses authorized records in the document's bound library. Import/remap into that
library is a separate explicit action. If import succeeds but concurrent edits
prevent relinking, retain
`error.details.imported` (request ID/mapping), inspect and reconcile; never
blindly import another copy or overwrite changed citation positions.

Await native save/export before reporting delivery. `review_export_docx` is a
shortcut for a native save then DOCX export of this session. Explicit static
citation-unlinked copies must use a supported export-only operation; never unlink
the live source to produce an export. Native history uses `{action:'history',projectId,documentId,command:{operation}}`:
`list` returns retained `versions` and `maxVersions`; `open` adds a returned
`versionId` and opens that immutable version in a separate read-only native view;
`restore` adds `versionId`, asks the native broker to save and close all live views,
then returns a fresh master session and browser URL. Prior live session IDs are
stale after restore. Optional `show:true` opens the returned ordinary browser view.
`configure` adds `maxVersions` (integer 1–10000, default 50); it persists per document
and prunes older retained versions immediately. List/configure need no running
renderer. Never turn an immutable view into an editable master implicitly. The optional
`office-diff` CLI compares saved Office snapshots only; inspect its help if installed.
It has no Git/Changes/UI integration. Keep the agent view connected until single-use exported downloads are consumed.
Close the agent view when finished; this does
not stop the shared Office service or the human's view. UI and canvas are light,
while actual stored document colors remain unchanged.
