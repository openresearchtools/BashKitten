# Third-party notices

The Agent code is AGPL-3.0-only. The browser retains its Mozilla/Waterfox MPL,
BrowserOS-derived AGPL and other original notices. Each dependency keeps its
own license; the offline **About → Licenses** pages include full bundled texts.

The server package bundles private Node.js/npm, unmodified Pi and its npm dependencies, Caddy,
Authelia, Tor, Valkey and the DDGS search runtime. **Unsloth Studio — adapted
search and page reading** has its own offline license entry with original
copyright, exact upstream revision, full AGPL-3.0-only text and the dated
BashKitten modification notice. Search also retains the separately credited
Buzzard Search and pi-web-access work. Access configuration preserves Torkitten's Apache-2.0
notice. Releases provide corresponding source and build material.
Model downloads adapt BashKitten Rust and SimpleHF behavior, retaining their
Apache-2.0/MIT notices and the credited rust-hf-downloader and Pi client notices.
Full texts and source pins are in `src/server/models/third_party/` and About.

Node.js/npm and the private Termux native library closure retain their original
licenses in the runtime component inventory. The corresponding-source artifacts
include the pinned Node source and Termux recipes/patches; source URLs and hashes
are recorded in the component manifest.

Termux, Python, Git, GitHub CLI and declared system libraries are
installed separately under their package licenses. The Android APK and Termux
server are separate parts of BashKitten; both inventories are available in the
Android app's offline About page. Linux includes its browser and server notices,
including the distinction between bundled software and external GTK/system
libraries. Optional llama.cpp, GPU drivers and model weights are separate.

The browser's offline notices separately identify **Waterfox** and **BrowserOS**,
their retained code, licenses and BashKitten adaptations. Original per-file
notices remain intact; third-party code is not relicensed by BashKitten’s own AGPL-3.0-only choice.

## pillama

The bundled Pi extension includes unmodified pillama 0.4.0 production sources
(MIT), commit `fefa5a90c5f5f6eead52e9de9a3a698d2ea48f67` from
https://github.com/openresearchtools/pillama. Full license and source notice:
`pi/vendor/pillama/LICENSE` and `pi/vendor/pillama/NOTICE`.
