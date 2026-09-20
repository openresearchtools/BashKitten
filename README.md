# BashKitten

A local interface for the [Pi coding agent](https://github.com/earendil-works/pi),
with project chats, streaming tools, image attachments and file browsing.
Use the Android or Linux app, or open the same UI in a browser on localhost.

Download the app from [Releases](https://github.com/openresearchtools/bashkitten/releases/latest).
On Android, **Apps** installs the matching Termux environment and manages updates.
Existing Termux installations can connect using the instructions shown there.
On Linux, install `bashkitten-desktop` from the
[Open Research Tools APT repository](https://github.com/openresearchtools/apt).

Create your local account, connect a provider in **Settings → Providers**, and
choose a working folder. Closing the window leaves the server and active turns
running. **Settings → About → Licenses** lists the bundled software.

BashKitten is [GPL-3.0-only](LICENSE). The separate server package includes
unmodified Pi and its dependencies; Termux and Node.js are installed separately.
They retain their own licenses. See [third-party notices](THIRD_PARTY_NOTICES.md).

[Run from source](docs/usage.md) · [Build packages](packaging/README.md)
