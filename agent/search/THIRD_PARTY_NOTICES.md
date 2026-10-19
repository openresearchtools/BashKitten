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

17 October 2026 packaging correction: siphasher 1.0.3's pristine `COPYING`
contains its Rust Project Developers / Frank Denis copyrights and an Apache-2.0
or MIT choice, but neither full grant. The pinned `cargoLicenseSources` entries
supply the canonical full texts alongside that original notice. Their hashes and
provenance are retained in `vendor/sources/sources.json` and copied into matching
source archives. This changes notice delivery only, not the crate or its license.

19 October 2026 release refresh: the private runtime now pins Click 8.5.0,
lxml 6.1.3, PyMuPDF 1.28.2 with MuPDF 1.28.2, certifi 2026.10.18,
charset-normalizer 3.5.2, idna 3.20 and urllib3 2.8.0. The exact official PyPI
release archives, wheel URLs and SHA-256 values are in `runtime-lock.json`;
the matching source archives and their original full notices are retained in
`vendor/sources/`. Linux wheels are pinned for both architectures and the
existing Python 3.12–3.14 ABIs. lxml's wheels still embed libxml2 2.14.6 and
libxslt 1.1.43, whose matching pristine sources remain retained.

DDGS 9.16.0, primp 1.3.1, PyMuPDF4LLM 0.3.4, tabulate 0.10.0,
youtube-transcript-api 1.2.4, defusedxml 0.7.1 and requests 2.34.2 remain the
latest releases in their selected lines at this check. primp 2.x and
PyMuPDF/PyMuPDF4LLM 2.x are separate major lines; this refresh preserves the
existing primp API and isolated Android Bionic DNS patch, and the selected
PyMuPDF4LLM extraction API. Frozen adapted donor revisions are unchanged.
Termux's Python/lxml/PyMuPDF/MuPDF packages remain external native dependencies;
Linux wheel versions do not describe those installed system packages.

Both Linux runtime/source assemblies pass retained-source checks and full-notice
generation. The amd64 Python 3.14 native imports, upstream PDF-to-Markdown,
XML, IDNA, certificate-bundle and HTTP-request preparation diagnostics pass;
the unchanged Termux source staging and Bionic DNS patch dry-run also pass.
These are component checks, not installed BashKitten acceptance. Installed
Linux/Android search and PDF flows, arm64 native execution and traffic checks
remain required against the combined candidate. No helper behavior, SDK,
telemetry integration or dependency extras are added by this refresh.

19 October 2026 native-source clarification: the official lxml 6.1.3 Linux
wheels use libxslt **1.1.43 with lxml's backport1 patch**, not pristine 1.1.43.
The already retained lxml sdist contains `libxslt-1.1.43-backport1.patch`,
`patch_lxml_deplibs.py` and the applying `buildlibxml.py` recipe. Upstream's
changelog identifies the backports as fixes for CVE-2025-7424 and CVE-2025-11731.
The patch applies to our pristine libxslt archive; all six selected Linux wheels
match their pinned PyPI hashes and contain its new source-document cleanup and
error-message markers. The full library license remains in the pristine archive.

`third_party/lxml-build-cohort.json` records the peeled lxml release commit,
archive/member hashes and upstream patch-introduction commit. The release recipe
explicitly selects patched libxslt 1.1.43 on Linux and 1.1.45 on Windows; the
inspected upstream sources give no further reason for that choice. We preserve
the upstream-produced wheel's corresponding sources, without claiming that its
native libraries are each the latest independent release. The recipe declares
no patches for libxml2 2.14.6, libiconv 1.18 or zlib 1.3.2. The published sdist's
Cython build constraint differs from the Git tag; its native-library settings,
patch and patch applier match, and both recipe-file hashes are recorded.

The same Linux wheels statically include GNU libiconv 1.18 and zlib 1.3.2.
Their exact archives, checked against the release recipe's SHA-256 values, and
full licenses are now retained and included in generated offline notices and
matching source bundles. libiconv's library is LGPL-2.1-or-later; its source also
contains GPL-3.0-or-later utilities and their full notices. zlib retains its own
license and included third-party notices. The amd64 native symbols report
libiconv 0x0112 and zlib 1.3.2. No wheel or runtime executable changes in this
source-delivery correction; the generated source/notices artifacts must be
refreshed for the combined candidate.
