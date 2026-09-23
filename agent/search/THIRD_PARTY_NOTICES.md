# Search notices

BashKitten Search adapts Buzzard Search commit
`05721962dd11c7506286ecc9aa5b35f6fc4828d0`, copyright 2026 its contributors,
under AGPL-3.0-only. The full license is in `LICENSE`; original selected-file
hashes and adaptations are in `third_party/buzzard-search.json`.

The network policy, HTML-to-Markdown conversion, PDF extraction and search
guidance derive from Unsloth Studio, copyright 2026-present Unsloth AI Inc.,
commit `bfcaea46574d63ec470ce9c7d7221471a38ea7e4`, under AGPL-3.0-only.
`third_party/unsloth-studio/` preserves its full license, source identity,
manifest and dated `NOTICE` describing the modifications. The offline component
licenses list this separately as **Unsloth Studio — adapted search and page reading**.
Only selected search/read code is retained; its original dependency versions
describe that historical source, not the current packaged runtime.

OpenResearchTools modified the extracted code for BashKitten on 23 September
2026: one DDGS query-or-URL command and native Pi skill; packaged Linux/Termux
Python dependencies; private persistent Markdown files; complete extraction
before the 16,000-character inline preview; removal of hard download/extraction
caps; explicit errors and cancellation; and the selected PDF reader with its
text/layout fallback. The Unsloth Studio application, unrelated RAG/image tools
and SearXNG are not included. The full modification notice precedes Unsloth's
unaltered AGPL-3.0 license in both Android and Linux offline inventories.

The repository reader is WildBuzzard's Python adaptation of the bounded
inspection design in Nico Bailon's MIT-licensed pi-web-access 0.19.0.
`third_party/pi-web-access/` preserves the original notice. Git is supplied by
the operating system. WildBuzzard's transcript rendering and file handling
retain their AGPL-3.0-or-later headers within this AGPL-3.0-only combined work.

YouTube transcript retrieval uses Jonas Depoix's MIT-licensed
youtube-transcript-api; its notice is under `third_party/youtube-transcript-api/`.
DDGS is MIT licensed. PyMuPDF/PyMuPDF4LLM and MuPDF retain their own AGPL and
third-party notices. The build records actual Python/native dependency versions,
license texts and corresponding sources under `runtime/`; no historical
PyInstaller or Python-interpreter bundle is claimed as this package's inventory.
