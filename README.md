# BashKitten

![Testing releases: current releases are for automated testing only. Not ready for production. Coming soon.](docs/testing-releases.svg)

A Firefox-based browser with a built-in interface for the stock
[Pi coding agent](https://github.com/earendil-works/pi): project chats, streaming
tools, image attachments and file browsing. The same Agent interface also works
in an ordinary browser. This branch contains the browser migration; integration
builds and testing are in progress.

Android ARM64 and x86_64 use an ordinary Termux installation for the Agent server. Linux packages
include both the browser and server. Local connects automatically without an
account login. Optional Linux publishing and remote connections use Tor and
an account with two-factor authentication. Turning Agent off stops its services;
closing the Linux browser also stops its local Agent. Closing the Android
browser leaves Termux work running until Agent is turned off.

BashKitten includes private Node/npm and Pi data. Pi extensions and `npm -g`
installs made by its Agent stay in BashKitten’s data directory; ordinary project
dependencies remain in the selected project.

Android setup includes battery-access prompts for background Agent work. For
local Termux on Android 14+, enable **Developer options → Disable child process
restrictions** and keep Developer options enabled. Setup links to Android Settings;
this is separate from the wake locks managed by Turn on/off.

[Releases](https://github.com/openresearchtools/bashkitten/releases) ·
[Package repository](https://github.com/openresearchtools/apt) ·
[Build packages](agent/packaging/README.md)

Current builds are published as prereleases. To receive them through APT, install
the platform's main keyring and nightly setup package from the
[package repository](https://github.com/openresearchtools/apt).

About and full licenses are available offline in the browser's settings.
BashKitten's own code is [AGPL-3.0-only](LICENSE); inherited browser and dependency notices retain
their original terms. See [third-party notices](agent/THIRD_PARTY_NOTICES.md).
