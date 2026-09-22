# Search notices

BashKitten Search adapts Buzzard Search commit
`05721962dd11c7506286ecc9aa5b35f6fc4828d0`, copyright 2026 its contributors,
under AGPL-3.0-only. The full license is in `LICENSE`; original selected-file
hashes and adaptations are in `third_party/buzzard-search.json`.

The network policy, HTML-to-Markdown conversion, PDF extraction and search
guidance derive from Unsloth Studio, copyright 2026-present Unsloth AI Inc.,
commit `bfcaea46574d63ec470ce9c7d7221471a38ea7e4`, under AGPL-3.0-only.
`third_party/unsloth-studio/` preserves its license, source identity and manifest.
Only selected search/read code is retained; its original dependency versions
describe that historical source, not the current packaged runtime.

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
