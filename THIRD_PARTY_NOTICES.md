# Third-party notices

BashKitten is GPL-3.0-only; see [LICENSE](LICENSE). The Android app and Linux
desktop host connect to the separately installed server. The server package
bundles unmodified Pi and its npm dependencies, each under its own license.
Termux, Node.js, GTK, WebKitGTK, Python and other system packages are installed
separately and retain their own licenses.

**About → Licenses** in the Android app covers its bundled AndroidX, Kotlin and
other libraries and the original Termux icons. **Server licenses**, or
**Settings → About → Licenses** in the web UI, shows the bundled server libraries.
The Linux app's **Menu → About → Licenses** also reads these installed notices
directly, including when the backend is stopped.
Full license, copyright and notice texts are included offline. Package copies
are installed under `share/doc/bashkitten` and `share/doc/bashkitten-desktop`.

The build collects notices from the exact resolved artifacts, with upstream
supplements in [licenses](licenses) for texts omitted from published packages.
Releases include application source, dependency sources and their notices.
Development-only tools are excluded from production packages. No third-party
chat frontend was copied.
