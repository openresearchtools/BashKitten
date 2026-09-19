<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Android agent API v1

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
    browser_apk="$(pm path org.openresearchtools.wildbuzzard | sed -n 's/^package://p' | head -n 1)"
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

Authorization opens the browser's consent dialog. Match its short key identifier
to the terminal before approving. The private command key stays in
`$HOME/.config/wildbuzzard/command-key` with mode 0600; `--state-dir` selects an
alternative app-private directory. Programs sharing that key share their agent
tabs and authority. This is a command-key grant, separate from Android package
and signing-certificate grants. Never put the key in shared storage or a repository.
**Revoke agent access** invalidates both kinds of grant and closes their tabs.

Commands return JSON to stdout, diagnostics to stderr, and a nonzero exit code
on errors. A complete request may be passed with `--json` or on stdin. The CLI
opens the browser when needed using Termux's `am` command; Android's foreground
launch restrictions still apply. `tabs.show` brings a particular tab forward.
Native Android callers handling their own foreground launch can use `--no-launch`
and send the returned single-use `launch` ticket as an extra to
`org.openresearchtools.wildbuzzard.CommandAccessActivity` within 30 seconds.

The browser owns an IPv4 loopback listener on port 48271 while command access is
enabled. A challenge proves possession of the enrolled 256-bit key before the
client sends a page command. Requests and responses use AES-GCM with distinct
direction/transcript binding. The key is never sent over the socket; the browser
stores it in its Android Keystore-encrypted, backup-excluded vault. Authentication
does not rely on trusting every app that can connect to localhost. Protocol
framing and cryptography are defined in `CommandProtocol.java`.

Shell screenshots return PNG `base64` and `mimeType`, subject to the same response
size limit; reduce the viewport if necessary. Use `wildbuzzard --help` for syntax
and `wildbuzzard --licenses` for the notices packaged in that exact browser APK.

## Android apps

Bind an explicit intent with action
`org.openresearchtools.wildbuzzard.BIND_AGENT` and package
`org.openresearchtools.wildbuzzard`. Include that package in your manifest's
`queries` section. Compile the two AIDL files from `wildbuzzard-sdk`.

1. Call `requestAccess()` and launch the returned immutable PendingIntent while
   your app is visible. The user approves your package and signing identity.
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

Call `capabilities` to discover supported methods. Navigation also supports
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
