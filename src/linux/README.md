# Linux host

Run `python3 src/linux/host.py` with Node >=22.19, Python/PyGObject, GTK >=4.10
and WebKitGTK 6.0 installed. `BASHKITTEN_NODE` can select a Node executable
outside PATH. The server remains independently usable in ordinary browsers.

The host uses the shared private controller, preserves cookies in its private
desktop profile, and leaves the server/Pi running when closed. Its Services menu
and Start/Retry screen work while the HTTP server is stopped. GTK handles folder
selection, HTML file inputs and document launching. A missing desktop portal
falls back to the web folder picker. Repository/attachment paths are validated
over the local control socket before being opened; model output is never a shell
command. External links and provider authorization open in the default browser.

Only this host's presentation replaces repository browsing/ZIP with Open project
folder. The existing browser UI keeps its files panel and downloads. Native
actions require a real click and a capability injected into the trusted top
frame; repository documents and remote pages never receive it.

`tests/platform/linux-host.py signup` then `restore` checks a disposable profile
selected with `BASHKITTEN_DATA_DIR` and `PI_CODING_AGENT_DIR`. Give it an unused
`PORT`. It exercises system WebKit and captures screenshots in `test-results`.
Run with `GDK_BACKEND=wayland` on Wayland. For isolated X11 tests, use
`GDK_BACKEND=x11 GDK_DEBUG=no-portals dbus-run-session -- xvfb-run -a ...`.
The test-only portal switch selects GTK's ordinary chooser inside Xvfb; the
application itself preserves the user's normal portal configuration.

Verified locally on native Linux arm64 with GTK 4.22 / WebKitGTK 2.52.6:
signup, persistent login after a separate process restart on X11 and Wayland,
native folder chooser via pointer input, rejected synthetic native actions,
and shared file-path/image-cache tests. AMD64 and packaged-install tests are
separate release gates; this record does not claim those have passed yet.
