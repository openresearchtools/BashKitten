<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Android agent API v2

Install only the **browser APK**. The agent probe is an optional developer test
app, not an agent runtime or a required companion. Both interfaces below execute
inside the browser and share its tab dispatcher.

## Termux and shell programs

The installed browser APK includes `org.openresearchtools.wildbuzzard.BrowserCommand`.
Run it with Android's `app_process`; no second APK, root, ADB, or copied client
binary is required. In Termux, add this function to your shell configuration:

```sh
wildbuzzard() {
    local browser_apk
    browser_apk="$(pm path org.openresearchtools.wildbuzzard </dev/null 2>/dev/null | tr -d '\r' | sed -n 's/^package://p' | head -n 1)"
    [ -n "$browser_apk" ] || { echo 'Install Wild Buzzard first' >&2; return 1; }
    env -u LD_PRELOAD -u LD_LIBRARY_PATH CLASSPATH="$browser_apk" \
        /system/bin/app_process / org.openresearchtools.wildbuzzard.BrowserCommand "$@"
}

wildbuzzard --authorize
wildbuzzard tabs.create '{"url":"https://example.com"}'
wildbuzzard tabs.list
wildbuzzard tabs.show '{"tabId":"ID_FROM_CREATE"}'
wildbuzzard snapshot '{"tabId":"ID_FROM_CREATE"}'
wildbuzzard tabs.setDesktopMode '{"tabId":"ID_FROM_CREATE","enabled":true}'
wildbuzzard tabs.close '{"tabId":"ID_FROM_CREATE"}'
```

The browser checks Android's actual caller UID and current APK signing
certificate. Apps signed with the same publisher certificate are allowed by
default, including this publisher's `com.termux`. The package name alone never
confers trust. A Termux build from another vendor, or another Android app, can
run `--authorize` once and approve the named app. **Settings → Agent access** also
lets the user allow or revoke installed apps and disable automatic publisher
trust. Individual commands do not prompt again. Revoke-all disables existing
grants and automatic publisher trust until it is enabled again.

The default command interface needs no manually managed key. It uses Android
Binder IPC, discovered through an explicit broadcast to the browser. The browser
checks Binder's actual caller UID and package signatures before every dispatch;
the caller checks that connection and result callbacks come from the installed
browser UID. The discovery broadcast grants no authority. No command socket or
shared-storage key is needed. A supplied package name cannot impersonate an
app. Add `--session CHAT_ID` to partition a terminal app's tabs, downloads and
website storage between chats. Session IDs namespace an app's authority; they
are not an additional security boundary against programs already in that app.

The older encrypted command-key interface remains available with `--legacy-key`
or `--state-dir DIRECTORY`. Its private key stays in
`$HOME/.config/wildbuzzard/command-key` with mode 0600. Its grant remains separate
from Android app identity. Never put it in shared storage or a repository.

Commands return JSON to stdout, diagnostics to stderr, and a nonzero exit code
on errors. A complete request may be passed with `--json` or on stdin. The CLI
uses browser-owned, single-use PendingIntents for approval and tab activation,
with Android's visibility-based launch opt-ins. This also works when the browser
is already in front and Termux is in the background. Cold-start preparation can
use Termux's `am` command. Android still requires a visible caller or browser to
bring an activity forward. `tabs.show` brings a particular tab forward.
Native Android callers handling their own foreground launch can use `--no-launch`
and send the returned single-use `launch` ticket as an extra to
`org.openresearchtools.wildbuzzard.CommandAccessActivity` within 30 seconds.

The legacy command-key interface uses an IPv4 loopback listener on port 48271
while legacy command access is enabled. A challenge proves possession of the enrolled 256-bit key before the
client sends a page command. Requests and responses use AES-GCM with distinct
direction/transcript binding. The key is never sent over the socket; the browser
stores it in its Android Keystore-encrypted, backup-excluded vault. Authentication
does not rely on trusting every app that can connect to localhost. Protocol
framing and cryptography are defined in `CommandProtocol.java`.

Save a screenshot directly into Termux's private files, without shared storage:

```sh
wildbuzzard --session CHAT_ID tabs.show '{"tabId":"TAB_ID"}'
wildbuzzard --session CHAT_ID --output "$HOME/screenshot.png" screenshot '{"tabId":"TAB_ID"}'
wildbuzzard --session CHAT_ID downloads.list
wildbuzzard --session CHAT_ID --output "$HOME/download.pdf" downloads.get '{"downloadId":"DOWNLOAD_ID"}'
```

The output JSON contains the absolute `path`. Files are created with mode 0600;
existing paths are never overwritten. `screenshot` with `{"transfer":true}` or
`downloads.get` without `--output` returns a five-minute `transfer` object with
`url`, `token`, `size`, and a ready-to-use `wget` command. Only the requested file
is exposed, only on `127.0.0.1`, with an Authorization bearer header. Origin-bearing
web requests, missing/wrong tokens, expired transfers and revoked app grants
are rejected. There is no unauthenticated directory listing. Only downloads from
tabs belonging to the calling app/session can be listed or exported, including
after those tabs close. `downloads.accept {tabId,downloadId}` accepts a pending
browser download; visible agent tabs automatically use the browser's downloader.

Legacy screenshots without `transfer` still return PNG `base64` and `mimeType`,
subject to the JSON response limit. Transfers avoid that limit. Use
`wildbuzzard --help` for syntax and `wildbuzzard --licenses` for this APK's notices.
The optional [Pi extension](pi/README.md) saves screenshots/downloads in each
native Pi session directory and returns native image content plus the file path.

## Android apps

Bind an explicit intent with action
`org.openresearchtools.wildbuzzard.BIND_AGENT` and package
`org.openresearchtools.wildbuzzard`. Include that package in your manifest's
`queries` section. Compile the two AIDL files from `wildbuzzard-sdk`.

1. Call `requestAccess()` and launch the returned immutable PendingIntent while
   your app is visible. Publisher-signed apps are already authorized; other apps
   receive a one-time package/signing-identity prompt.
2. Call `execute(requestJson, callback)`. The callback receives JSON containing
   `result` or `error`. Up to eight requests per caller may be outstanding.
3. To bring a tab to the foreground, call `showTab(tabId)` and launch the returned
   PendingIntent. Android's foreground-launch rules still apply.

An approval allows the app to read and act in its own tabs, including pages
using stored logins. It does not expose raw key/password storage or tabs owned
by another app. The Revoke agent access item in Settings revokes all grants and closes agent-owned tabs.
Ordinary tabs owned by the same approved app share website cookies and storage;
each app has a separate storage context. Tor tabs start in isolated contexts,
and their page-created child tabs inherit that context and ownership.
Fenix persists tab IDs and agent ownership across browser process restarts.
`tabs.list` includes restored tabs whose engine sessions have not been recreated;
the next control request recreates that session and reapplies its tab policies.
Page-created tabs are handled at application scope, including while the agent
app is in the foreground. A popup from a background tab does not change the
browser's selected tab.

```json
{"method":"tabs.create","params":{"url":"https://example.com","tor":false}}
{"method":"tabs.list"}
{"method":"tabs.setDesktopMode","params":{"tabId":"...","enabled":true}}
{"method":"tabs.setAdblocking","params":{"tabId":"...","enabled":false}}
{"method":"snapshot","params":{"tabId":"..."}}
{"method":"act","params":{"tabId":"...","kind":"click","target":"reference-from-snapshot"}}
{"method":"read","params":{"tabId":"...","format":"text"}}
{"method":"evaluate","params":{"tabId":"...","code":"return document.title;"}}
{"method":"navigate","params":{"tabId":"...","url":"https://example.com/next"}}
{"method":"tabs.close","params":{"tabId":"..."}}
```

Call `capabilities` to discover supported methods and authorization mode.
`diagnostics {tabId}` reads the actual Gecko remote-debugging preferences,
Marionette/remote-agent state preferences, `navigator.webdriver`, and Gecko's
accessibility-service state. Remote protocol preferences are locked off. Android
page snapshots use DOM trees without starting the Gecko accessibility service;
an external Android accessibility tool can independently activate accessibility,
and diagnostics reports that actual state. There is no Android accessibility
service used as an agent-control bridge. Publisher APKs have Android debuggability
disabled; the independent test-probe APKs keep their separate development signer.
 Navigation also supports
`back`, `forward`, `reload` and `stop`. Page tools include `wait`, `console`,
`clearConsole` and `viewport`. `screenshot` requires the tab to be shown and
returns a `content://` URI with read permission granted to the caller's package;
it expires after five minutes.

Both `tabs.create` and `navigate` automatically route `.onion` addresses through
Tor, including when the caller leaves `tor` false or omits it. Navigation in an
existing direct-network tab creates an isolated Tor session in that same tab.
Imported authentication keys are selected by exact onion service ID, never by
trying keys saved for other sites.

Element references are opaque, tied to a tab/document, and refreshed by each
snapshot. Optional `frameId` values must identify a frame inside the requested
tab. Content tools only operate on HTTP/HTTPS documents. Raw Gecko references,
privileged URLs, arbitrary files, engine preferences, process/window controls
and unrestricted remote debugging are not exposed. There is no `browser.close`
or application-kill method. Desktop-only tool parity must not be assumed: use
capability discovery. Requests are limited to 200,000 characters and responses
to 200,000 characters; narrow large snapshots/read queries. Evaluations and
waits are bounded to 30 seconds.

`evaluate.code` is an asynchronous function body; use `return` to return a value. `act` supports snapshot references for click, focus, fill, check/uncheck and select; `fill` accepts `value` and optional `clear`.

For Android 14 and later, the visible caller must opt in to sending its launch privileges with the PendingIntent. On API 36+, pass `ActivityOptions.makeBasic().setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_IF_VISIBLE).toBundle()` to `PendingIntent.send`. On API 34–35, use `MODE_BACKGROUND_ACTIVITY_START_ALLOWED` while the caller is visible. The probe app demonstrates the version guards. This follows [Android's activity launch rules](https://developer.android.com/guide/components/activities/secure-bal); neither API call grants an unrestricted background-launch permission.
