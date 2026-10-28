# References citations and native Office

The default Office writing path uses the bundled `office` skill/tool and the
replaceable References plugin in Writer, Calc and Impress. The agent has a native
authenticated view of the same document as the human. No editor tab is needed for
editing; returned normal URLs support optional browser/layout/PDF inspection.
The service owns native fields/anchors, complete CSL style/locale rendering,
refresh/disambiguation, bibliography and native save/export. Read back rendered
text and identity. Ordinary prose edits must retain fields.

Canonical IDs are `bkref:<backend>/<project>/<item>`. Obtain them from References.
Never invent an ID, use `users/0` as an identity, or silently reinterpret a legacy
library ID. Explicit legacy mappings preserve their source provenance.

## Optional Markdown interchange

`review_citation` creates `[cite](sr-cite:bkref:backend/project/KEY)`. A multi-source
or located citation encodes `{v:1,items:[{id,locator,label,prefix,suffix,"suppress-author"}]}`
as percent-encoded JSON after `sr-cite:`. Use the tool/parser instead of hand-encoding.
The donor parser rejects malformed markers and treats code examples as code.

A snapshot is `{version:1,items:[{id,itemData,version?,data?}]}` with verified IDs
and complete CSL JSON. `review_references` reads at most 100 selected records or
one bounded page and writes that snapshot; `review_zotero` is a deprecated tool
name alias. Native metadata is retained alongside its CSL view.

`review_render_citations` takes `projectId,input,output` plus optional
`references` snapshot path, installed `style` ID, `locale` and `overwrite`.
It parses the whole ordered manuscript and calls the shared renderer, preserving
identity-bearing labels and retroactive disambiguation. A bibliography is enclosed
by standalone `<!-- sr-bibliography -->` and `<!-- /sr-bibliography -->` blocks.
Rendering is not document insertion; promote/import with supported Office APIs and
verify native citation fields. Snapshot input does not mutate the library.

## Migration from the frozen donor

The four existing tool names remain. `review_zotero` now requires explicit
`projectId` and reads References. `review_citation` accepts canonical References
IDs. `review_render_citations` uses shared full CSL and installed styles instead
of the donor's in-text-only renderer. `review_export_docx` requires the `sessionId`
returned by `office open`, and optional export `name`; it awaits native save and
DOCX export. The old offline ZIP serializer, bookmark/field mode selection and
later external Refresh workflow are removed from runtime. Open/import/edit the
live document before export; an unavailable import/promotion operation remains
an explicit capability gap rather than an imitation DOCX export.

Keep native save/export acknowledgements, round-trip identity checks and visual
checks distinct. Report unavailable adapters or platform gates honestly.
