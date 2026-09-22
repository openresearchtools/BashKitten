<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# BashKitten tools for Pi on Android

A small Pi extension that calls the command entry point inside the installed
BashKitten APK. The browser owns rendering, Tor, downloads and control. No
companion APK or shared-storage permission is needed. Pi remains unmodified.

Install this directory as a Pi package, using the Pi runtime already installed
in Termux:

```sh
pi install /path/to/bashkitten/android/pi
```

Actions artifacts also include `pi-bashkitten-0.1.0.tgz`. Install it with
`npm install /path/to/pi-bashkitten-0.1.0.tgz` in a private directory, then run
`pi install "$PWD/node_modules/@openresearchtools/pi-bashkitten"` there.

For a one-off session, install the pinned `typebox` dependency with `npm ci` in
this directory and use `pi -e /path/to/extension.mjs`.
The extension follows the public Pi 0.85.1 extension/session APIs.

Apps signed with BashKitten's current publisher certificate are authorized
by default. For Termux from another vendor, run `/bashkitten-authorize` once and
approve the named Android app. Alternatively, open **BashKitten → Settings →
Agent access**, select the installed app and allow it. Individual commands do
not prompt again. Access can be revoked from that same screen.

Tools:

- `bashkitten_browser`: create/show/close tabs, navigate, get DOM trees, read
  text, click/fill references, evaluate page JavaScript, change per-tab desktop
  mode or blocking, and inspect runtime diagnostics.
- `bashkitten_screenshot`: show a tab, copy its PNG privately into the current
  Pi session directory, and return both a native Pi image content block and its
  absolute file path. The normal Pi `read` tool can read the saved PNG again.
- `bashkitten_downloads`: list this session's browser downloads or fetch a
  completed file into this session's private directory.

Files live under `<Pi session directory>/bashkitten/pi-<session hash>/`, with
0700 directories and 0600 files. Each native Pi session gets its own browser
scope and file directory, including after resuming it. Forked/new sessions use
their new session IDs. Screenshots/downloads use unique names and never
silently replace existing files. Cancelling a tool cancels its client process;
closing Pi does not close the browser or unrelated tabs.

The browser issues per-file localhost bearer grants lasting five minutes.
The extension consumes them through the browser CLI and returns a private path;
it does not put transfer tokens into ordinary tool results. Tokens stop working
after their app's access is revoked. The browser's plain CLI also returns a
ready-to-use `wget` command for callers that prefer to fetch files directly.

The npm dependency retains its own license. BashKitten extension code is
AGPL-3.0-or-later; the full text is in `LICENSE`.
