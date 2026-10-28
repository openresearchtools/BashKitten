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
| `citations.inspect`, `citations.insert`, `citations.edit`, `citations.remove` | Use returned plugin state and native target/occurrence identity; clusters retain ordered verified References IDs, locators, affixes and suppress-author. |
| `citations.style`, `citations.refresh`, `citations.bibliography` | Set installed style/locale and render the complete ordered document state through the shared plugin. |
| `save`, `export` | Await actual save acknowledgement; export supplies supported `format` and optional `name`, returning its real result/view URL. |

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
style/locale, refresh and bibliography. Refresh after a library change, and verify
the resulting live document. Do not flatten fields to hide an error. Typed
`sr-cite:` markers are optional interchange that must be promoted to native fields
by a supported adapter, not pasted as a substitute for live citations.

Await native save/export before reporting delivery. `review_export_docx` is a
shortcut for a native save then DOCX export of this session. Explicit static
citation-unlinked copies must use a supported export-only operation; never unlink
the live source. Native history/snapshot operations use the same owner. The optional
`office-diff` CLI compares saved Office snapshots only; inspect its help if installed.
It has no Git/Changes/UI integration. Keep the agent view connected until single-use exported downloads are consumed.
Close the agent view when finished; this does
not stop the shared Office service or the human's view. UI and canvas are light,
while actual stored document colors remain unchanged.
