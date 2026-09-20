# BashKitten

BashKitten's existing browser UI, backed by the **native Pi coding agent**.
Open `http://127.0.0.1:3939` in an Android or Linux browser.
Pi runs locally as an unmodified `pi --mode rpc` subprocess for each
session. The frontend keeps BashKitten's transcript, thinking/tool work traces,
image viewer, compaction display, themes, and project/chat sidebar.

The Android host adds a signed Termux app store, package/desktop controls and
service recovery. The optional Linux host uses system GTK/WebKit with persistent
cookies and native file opening. Both use this same server and UI. See the
[implementation status](suite-implementation-status.md) for device coverage.

## Run on Linux

With Node >=22.19, npm, ripgrep and fd installed, run `npm ci --ignore-scripts`
and `npm start`. The optional desktop host also needs Python/PyGObject, GTK >=4.10
and WebKitGTK 6.0: run `python3 src/linux/host.py`. Browser-only use needs no GTK.
See [native packaging](../packaging/README.md) for arm64/amd64 builds and
[Linux host integration](../src/linux/README.md).

## Install in Termux

Use a current Termux release from GitHub or F-Droid:

```sh
pkg update
pkg install nodejs-lts git ripgrep fd
# Node >=22.19 is required. Node 24 LTS is supported.
git clone --single-branch -b main https://github.com/openresearchtools/bashkitten.git
cd bashkitten
npm ci --omit=dev --ignore-scripts
npm start
```

These source-install instructions work with ordinary upstream Termux. The Android host can connect to ordinary upstream Termux using its public command permission. Apps shows the setup instructions and keeps add-ons from the same source.

Pi 0.85.1 is installed by npm as a pinned local dependency. You can also use its
terminal UI in this checkout with `./node_modules/.bin/pi`. No Rust build, GTK,
systemd, proot, custom inference server, or changes to Pi are required.

Create the local web account on the first visit. Then open **Settings → Services**
and select one of Pi's supported browser-login or API-key methods. Complete the
provider's own prompts in the new browser tab. Pi receives the localhost callback
in Termux automatically and saves the connection; no terminal interaction is
needed for sign-in. Device-code providers show their verification step in the
browser. Pi's optional code-paste fallback is available in Services if needed.
Existing `~/.pi/agent` credentials,
models, settings, extensions and skills are used by Pi. Credentials stay in Pi's
native store; BashKitten does not implement OAuth or inference itself.

Pick a working folder in the chat header and choose a model before sending.
The working-folder picker starts at Termux's writable home, displayed as `~`.
It shows writable subfolders, with no inaccessible `/data/data` parents or shared
storage. No Android storage permission is needed: the browser's standard upload
picker and download handling move files into and out of Termux.

## Use

- The left sidebar groups named chats by working folder. The `⋯` button exposes
  rename/delete; Copy and Fork remain on transcript messages.
- The header's **Files** button opens an expandable file tree for the working
  folder. Each project also has a Files button. Select a directory before uploading;
  click the panel title to select the root. Uploads never overwrite existing files.
- File links use the browser's native opening behavior; `↓` requests a download.
  **Download ZIP** streams a ZIP assembled by the backend, including hidden files
  and `.git`. Links leaving the selected folder are not followed.
- Attach files using the composer picker, paste, or drag/drop. Pi receives absolute
  paths for all files and native image content for PNG/JPEG/GIF/WebP. The app does
  not depend on Termux's text-only clipboard API for browser image paste.
- Enter queues a follow-up during a run. Queue rows support steer/edit/remove;
  Pause invokes Pi's queue clear and abort and restores pending input to the draft.
- **Compact context** invokes Pi's native compaction. Completed summaries use the
  existing expandable compaction presentation. Pi RPC does not expose incremental
  summary tokens, so the indicator remains visible until the summary arrives.
- Mobile uses drawers for projects and files; wide screens support both sidebars.
- **Settings → Services → Open an existing Pi session** links a native Pi session
  into the sidebar. Do not open the same session concurrently in another Pi client.

The old custom llama.cpp/OpenAI backend and goal loop are not used. Pi supplies
providers, model capabilities, commands and extensions. `/goal` is passed to Pi if
an installed Pi extension provides it. Custom provider/model configuration uses
Pi's native `~/.pi/agent/models.json`.

## Processes and storage

BashKitten listens only on IPv4 loopback. A local password, HttpOnly cookie, origin
check and CSRF token protect filesystem, session and credential endpoints.

UI state defaults to `~/.local/share/bashkitten-pi/`; override it with
`BASHKITTEN_DATA_DIR`. `PI_CODING_AGENT_DIR` selects an alternate native Pi profile.
BashKitten stores native session JSONL plus small UI metadata and attachment files.
Imported sessions keep their original Pi files. Forks preserve native history and
share immutable attachments so deleting an original chat does not break its forks.

One detached worker owns each Pi RPC process. Closing the browser or restarting
`npm start` does not stop a running session; reconnect restores history and live
work. Changing a working folder waits for the turn to settle, then reopens the
same session with Pi in the new directory. Android can still stop Termux under
memory/battery pressure; use Termux's wake lock/battery settings for long runs.

Set the port in App settings, or start with `npm start -- --port=3939`.
Pi is launched with `--offline` and `PI_TELEMETRY=0` to disable startup catalog,
package/update checks and telemetry. Configured inference and explicit login
requests still work.

## Development and verification

```sh
npm ci --ignore-scripts
npm test
```

Tests execute **real Pi RPC processes** against a deterministic local provider,
including all seven real filesystem/shell tools, image payloads, native session persistence,
queue edits, forks, compaction, cwd changes and a web-server restart during a turn.
OAuth tests use Pi's real loopback listener, state/PKCE validation and credential
store with a test-only token response. Live provider account authorization is a
separate user sign-in.
The fixture is test-only and never used by `npm start`.

See [architecture and limits](pi-termux.md) and
[Cuttlefish test record](../tests/live/2026-09-19-pi-termux.md).
Source lives under `src/web/`, the shared Node server in `src/server/` (Pi
integration in `rpc/`), and small native hosts in `src/android/` and `src/linux/`.
`packaging/` builds native Termux aarch64 and Linux arm64/amd64 packages. There is
no Rust backend or copied agent engine.
The original Rust implementation remains in Git history and is preserved with
its complete main-branch history in [bashkitten-rust](https://github.com/openresearchtools/bashkitten-rust).

BashKitten is licensed under the GNU General Public License, version 3 only
(`GPL-3.0-only`). See [LICENSE](../LICENSE). Third-party dependencies retain their
own licenses and attribution in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
