# Live Zotero citations in DOCX

V3 writes ordinary DOCX files with Zotero-compatible citation metadata. It uses
Zotero's existing APIs or an offline reference snapshot; it does not install a
Zotero extension, run an office application, or change a Zotero profile.

## Choose the citation storage mode

- **Bookmarks (default):** intended for exchange between Microsoft Word and
  LibreOffice. Citation ranges have `ZOTERO_BREF_…` names, with their metadata in
  the document's custom properties.
- **Fields (Word only):** native Word `ADDIN ZOTERO_ITEM CSL_CITATION` complex
  fields. Use this option for a Word-only workflow. Do not assume LibreOffice can
  edit these as live Zotero citations.

Generation and ordinary viewing do not require a running Zotero installation.
**Live citation editing and Refresh in Word or LibreOffice require Zotero and
its standard, bundled word-processor integration.** The read-only Zotero API
alone cannot refresh citations inside an office application. No additional V3
Zotero plugin is needed.

Open the exported file in the appropriate office application and use Zotero →
Refresh. The cached citations and bibliography are visible before that refresh.
Zotero → Document Preferences can change the style. Keep an editable master:
Zotero → Unlink Citations permanently removes citation metadata from that copy.
A generic office “update fields” operation is not a substitute for Zotero Refresh.

The DOCX stores the **CSL style ID**, not the style itself. The bundled
[author-date style](../assets/author-date.csl) is a minimal V3 style, not APA or
another journal's official style. Install that file through Zotero's ordinary
Cite → Styles settings to reproduce it, or choose an installed style in Document
Preferences. A recipient without the custom style may be prompted to choose a
style. Installing a CSL style is not installing a Zotero plugin.

## Library API

```js
import { renderDocument } from '../lib/citations.mjs';
import { exportDocx } from '../lib/docx.mjs';

const rendered = renderDocument(markdown, snapshot);
const bytes = exportDocx(rendered, { mode: 'bookmarks', title: 'My review' });
```

`exportDocx` synchronously returns a `Uint8Array`. It performs no file, network or
office application I/O. The caller is responsible for safe, explicit output-file
creation. Each export gets a fresh document session and bookmark names, so ZIP
bytes are not deterministic even when visible content and citations are equal.
Do not edit the rendered result's Markdown independently of its offsets and
citation metadata; render again after changes.

## Identity and embedded metadata

The source registry retains library-qualified Zotero item identities. Canonical
citation URIs look like:

```text
http://zotero.org/users/123/items/ABCD2345
http://zotero.org/groups/456/items/ABCD2345
http://zotero.org/users/local/ACTUAL_LOCAL_USER_KEY/items/ABCD2345
```

The local-user key must come from Zotero; do not invent one. A desktop database's
`libraryID` is not a Zotero account ID or group ID. DOI URLs, `zotero://select`
links, API endpoint URLs and Better BibTeX citekeys are not these identities.
Preserve the canonical `http://zotero.org/` URI prefix: it is an identifier, not a
request to fetch the item over HTTP.

Each citation embeds a CSL bibliographic snapshot in `itemData`, plus its URI
and locator metadata. Zotero can use the embedded data if the receiving library
does not contain the item. That fallback is an orphaned citation, not a promise
that it is connected to the recipient's library. This data travels with the
DOCX: inspect the references before sharing, particularly private-library items.
API keys, attachment paths and full-text files do not belong in citation fields.

## Package representation

Both modes store document preferences as JSON with `dataVersion: 4`, a fresh
session ID, the CSL style ID and locale, and the matching `prefs.fieldType`.
Custom properties `ZOTERO_PREF_1`, `_2`, … are contiguous chunks of at most 255
UTF-16 code units. `style.hasBibliography` describes the style's capability.

Each citation occurrence has a distinct `citationID`; repeated items retain the
same identity. In bookmark mode, properties named `<bookmarkName>_1`, `_2`, …
contain `ZOTERO_ITEM CSL_CITATION {JSON}`. In Word field mode the instruction is
` ADDIN ZOTERO_ITEM CSL_CITATION {JSON} ` between begin/separate/end field runs.
The visible result is separate from its authoritative metadata.

A single live bibliography range wraps its entries, not its heading. Its code is
`ZOTERO_BIBL {"uncited":[],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY`, with the
` ADDIN ` prefix and surrounding spaces in Word field mode. All XML and embedded
JSON must be escaped independently; Unicode must survive property chunking.

## Scope and acceptance checks

V3's minimal exporter supports in-text citations, not footnote/endnote citation
styles. Native ODT generation is not implemented. Prose supports paragraphs,
headings, emphasis, inline/fenced code, lists (up to nine levels), blockquotes,
horizontal rules, GFM tables and ordinary links. Images, raw HTML, task-list
nodes, and document-fragment links such as `#references` are not supported.
Citation and bibliography markers are handled by the shared Markdown parser;
examples inside code are literal text. Bibliography markers must be standalone,
top-level blocks. Unsupported parsed nodes produce explicit errors instead of
disappearing. Re-export from the Markdown source rather than assuming an
arbitrary DOCX editing/import workflow is supported.

Cached citation labels and bibliography entries currently use CSL **plain-text**
output, not rich citation typography such as italic journal names or superscript
citation numbers. Zotero Refresh applies the chosen installed style. Prose
emphasis is preserved independently. An empty live bibliography has the visible
placeholder “No cited references.” rather than a fabricated reference.

Offline tests inspect the ZIP, preferences, field/bookmark ranges, embedded item
metadata and cached bibliography. They are **structural checks, not proof of a
successful Zotero Refresh**. An office open/save or conversion smoke test also
does not prove Zotero interoperability.

Before relying on a new exporter or office/plugin version, test a synthetic
manuscript with repeated citations, a multi-item citation, a locator, non-ASCII
author names and a multi-paragraph bibliography:

1. Open the DOCX in Word + Zotero and use Refresh.
2. Edit a locator with Add/Edit Citation; change the style using Document
   Preferences; insert another citation.
3. Verify the bibliography changes and the citation's Open in Library action
   resolves to the intended item. Test an embedded-only fallback separately.
4. Save, close, reopen and Refresh again.
5. Repeat bookmark-mode checks in LibreOffice + Zotero, including save/reopen.
6. If exchanging between applications, repeat the round trip in both directions
   on copies. Confirm that citations remain editable, not merely visible.

Record the office and Zotero versions and the storage mode tested. Until these
checks are performed, describe exports as structurally validated, with live
plugin interoperability pending. Never test against a researcher's only copy.

On 24 October 2026, bookmark-mode exports passed genuine Refresh and
save/close/reopen/Refresh in the user's main Zotero 10.0.6 and LibreOffice
26.2.6.3 profiles with the standard integration 9.0.2. The test replaced cached
citations and bibliography with stale text first, then verified regeneration and
resolution to the actual library records. Repetition, a multi-item cluster, a
locator and Unicode survived. This validates that path, not every procedure
above: Word, Add/Edit Citation, style-change dialogs and embedded-only fallback
remain untested. See the [dated validation log](implementation-plan.md).

## Protocol references

The implementation is a fresh serializer, not a port of Zotero or the old V1
writer. These public AGPL-licensed sources document the interchange details:

- [Zotero integration.js](https://github.com/zotero/zotero/blob/db41b99fddcc52d38897c59c161b6adaca036afb/chrome/content/zotero/xpcom/integration.js):
  document preferences, citation payloads, embedded-item fallback and bibliography.
- [Zotero uri.js](https://github.com/zotero/zotero/blob/db41b99fddcc52d38897c59c161b6adaca036afb/chrome/content/zotero/xpcom/uri.js):
  canonical user, group and local item identities.
- [Word field.cpp](https://github.com/zotero/zotero-word-for-windows-integration/blob/398b0c81666ce7710626a9dca0c6dbd7782b6a74/build/zoteroWinWordIntegration/field.cpp)
  and [document.cpp](https://github.com/zotero/zotero-word-for-windows-integration/blob/398b0c81666ce7710626a9dca0c6dbd7782b6a74/build/zoteroWinWordIntegration/document.cpp):
  fields, bookmarks and chunked custom properties.
- [LibreOffice integration sources](https://github.com/zotero/zotero-libreoffice-integration/tree/2e78b1010ad49b4dde70ec9f0094b34a7b6f8965/build/source/org/zotero/integration/ooo/comp):
  `Properties.java`, `Bookmark.java`, `ReferenceMark.java` and `Document.java`.
- Official [Word](https://www.zotero.org/support/word_processor_plugin_usage) and
  [LibreOffice](https://www.zotero.org/support/libreoffice_writer_plugin_usage)
  plugin usage and storage-mode guidance.
