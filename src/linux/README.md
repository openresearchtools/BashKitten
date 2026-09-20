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

Verify the installed host with external tools and a disposable profile, separate
from the application repository. The implementation status records previous
Linux and Android checks.
