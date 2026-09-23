# BashKitten

![Testing releases: current releases are for automated testing only. Not ready for production. Coming soon.](docs/testing-releases.svg)

A Firefox-based browser with a built-in interface for the stock
[Pi coding agent](https://github.com/earendil-works/pi): project chats, streaming
tools, image attachments and file browsing. The same Agent interface also works
in an ordinary browser. This branch contains the browser migration; integration
builds and testing are in progress.

Android uses an ordinary Termux installation for the Agent server. Linux packages
include both the browser and server. Local and optional Tor access use the same
account with two-factor authentication. Turning Agent off stops its services;
closing the Linux browser also stops its local Agent. Closing the Android
browser leaves Termux work running until Agent is turned off.

[Releases](https://github.com/openresearchtools/bashkitten/releases) ·
[Package repository](https://github.com/openresearchtools/apt) ·
[Build packages](agent/packaging/README.md)

About and full licenses are available offline in the browser's settings.
The Agent code is [GPL-3.0-only](LICENSE); browser and dependency notices retain
their original terms. See [third-party notices](agent/THIRD_PARTY_NOTICES.md).
