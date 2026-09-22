<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Android agent API v2

Install the **browser APK**. Both interfaces execute inside the browser and share its tab dispatcher. No companion APK or public command listener is required.

## Termux and shell programs

The installed browser APK includes `com.bashkitten.BrowserCommand`.
Run it with Android's `app_process`; no second APK, root, ADB, or copied client
binary is required. In Termux, add this function to your shell configuration:

```sh
bashkitten() {
    local browser_apk
    browser_apk="$(pm path com.bashkitten </dev/null 2>/dev/null | tr -d '\r' | sed -n 's/^package://p' | head -n 1)"
    [ -n "$browser_apk" ] || { echo 'Install BashKitten first' >&2; return 1; }
    env -u LD_PRELOAD -u LD_LIBRARY_PATH CLASSPATH="$browser_apk" \
        /system/bin/app_process / com.bashkitten.BrowserCommand "$@"
}

bashkitten tabs.create '{"url":"https://example.com"}'
bashkitten tabs.list
bashkitten tabs.show '{"tabId":"ID_FROM_CREATE"}'
bashkitten snapshot '{"tabId":"ID_FROM_CREATE"}'
bashkitten tabs.setDesktopMode '{"tabId":"ID_FROM_CREATE","enabled":true}'
bashkitten tabs.close '{"tabId":"ID_FROM_CREATE"}'
```

The browser checks Binder's actual caller UID and current APK signing identity
before every command. Any installed Termux, including GitHub, F-Droid and custom
builds, can call it. A normal first command opens native approval when needed,
then runs once after approval. Approved apps run directly; same-publisher trust
is an optional shortcut, never an installation requirement. Settings → Agent
access can revoke grants and disable publisher trust. Programs running in
Termux share Termux's permission, including its shared-UID peers.

Denial and cancellation return distinct errors and do not run the command.
A denied app must be allowed in Agent access or explicitly use `--authorize` to
ask again. If Android prevents the consent screen appearing in the background,
open BashKitten to review the pending request. Replacing an app with a different
signer requires fresh approval. Package-name strings never confer trust.

Use explicit `tabId` values for ordinary tabs. There is no `--session`, browser
profile/window selection, command-key storage or legacy TCP control service.
Agent, setup, login and remote-credential views are outside the tab registry and
cannot be read, navigated, closed or captured. No application-quit tool exists.

Commands return JSON to stdout, diagnostics to stderr, and a nonzero exit code
on errors. A complete request may be passed with `--json` or on stdin. The CLI
uses browser-owned, single-use PendingIntents for approval and tab activation,
with Android's visibility-based launch opt-ins. This also works when the browser
is already in front and Termux is in the background. Cold-start preparation can
use Termux's `am` command. Android still requires a visible caller or browser to
bring an activity forward. `tabs.show` brings a particular tab forward.
Native Android callers handling their own foreground launch can use `--no-launch`
and send the returned single-use `launch` ticket as an extra to
`com.bashkitten.CommandAccessActivity` within 30 seconds.

Save a screenshot directly into Termux's private files, without shared storage:

```sh
bashkitten tabs.show '{"tabId":"TAB_ID"}'
bashkitten --output "$HOME/screenshot.png" screenshot '{"tabId":"TAB_ID"}'
bashkitten downloads.list
bashkitten --output "$HOME/download.pdf" downloads.get '{"downloadId":"DOWNLOAD_ID"}'
```

The output JSON contains the absolute `path`. Files are created with mode 0600;
existing paths are never overwritten. `screenshot` with `{"transfer":true}` or
`downloads.get` without `--output` returns a five-minute `transfer` object with
`url`, `token`, `size`, and a ready-to-use `wget` command. Only the requested file
is exposed, only on `127.0.0.1`, with an Authorization bearer header. Origin-bearing
web requests, missing/wrong tokens, expired transfers and revoked app grants
are rejected. There is no unauthenticated directory listing. Only downloads associated with current ordinary browsing tabs can be listed or exported. `downloads.accept {tabId,downloadId}` accepts a pending
browser download; visible agent tabs automatically use the browser's downloader.

Screenshots without `transfer` still return PNG `base64` and `mimeType`,
subject to the JSON response limit. Transfers avoid that limit. Use
`bashkitten --help` for syntax and `bashkitten --licenses` for this APK's notices.
The bundled native Pi integration provides the Android browser skill and saves
screenshots/downloads through Pi's normal tools.

## Android apps

Bind an explicit intent with action
`com.bashkitten.BIND_AGENT` and package
`com.bashkitten`. Include that package in your manifest's
`queries` section. Compile the two AIDL files from `bashkitten-sdk`.

1. Call `execute(requestJson, callback)`. An authorized caller receives JSON
   containing `result` or `error` through `onResult`.
2. If permission is needed, `onApprovalRequired(PendingIntent)` supplies the
   browser-owned immutable approval intent. Send it while your app is visible.
   The browser holds this one request and executes it once after approval;
   do not resubmit it. Denial/cancellation/revocation returns an error through
   `onResult`. An exited caller's request is abandoned. Only one approval-waiting
   command per app and eight executing commands per caller are allowed.
3. `requestAccess()` remains available to request approval before a command.
   `showTab(tabId)` returns a one-use foreground PendingIntent for an ordinary
   tab; Android's activity-launch rules still apply.

Approval allows the app to read and act in ordinary browsing tabs, including
signed-in pages. Protected Agent views and raw key/password stores are never
exposed. Revoke agent access invalidates commands and file transfers. Tor tabs
retain their isolated contexts. Fenix persists ordinary tab IDs across restarts.
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

The built-in PDF viewer can be read and controlled when displaying an HTTP or
HTTPS PDF in an ordinary browsing tab, including its Download button. Internal browser
pages and local files remain outside the page-control interface.

Snapshots return at most 200 nodes within Android's response budget and mark
`truncated` when limited. Use `depth` or `maxNodes` to request a smaller tree.
To inspect a container in more detail, call `snapshot {tabId,target}` with its
opaque reference from the preceding snapshot; this returns that subtree.
A fresh snapshot replaces the previous snapshot's element references.

Call `capabilities` to discover supported methods and authorization mode.
`diagnostics {tabId}` reads the actual Gecko remote-debugging preferences,
Marionette/remote-agent state preferences, `navigator.webdriver`, and Gecko's
accessibility-service state. Remote protocol preferences are locked off. Android
page snapshots use DOM trees without starting the Gecko accessibility service;
an external Android accessibility tool can independently activate accessibility,
and diagnostics reports that actual state. There is no Android accessibility
service used as an agent-control bridge. Publisher APKs have Android debuggability
disabled.
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

For Android 14 and later, the visible caller must opt in to sending its launch privileges with the PendingIntent. On API 36+, pass `ActivityOptions.makeBasic().setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_IF_VISIBLE).toBundle()` to `PendingIntent.send`. On API 34–35, use `MODE_BACKGROUND_ACTIVITY_START_ALLOWED` while the caller is visible. This follows [Android's activity launch rules](https://developer.android.com/guide/components/activities/secure-bal); neither API call grants an unrestricted background-launch permission.

## Selected Agent server

The native Agent menu can grant the selected signed-in server browser control.
The browser opens authenticated HTTPS requests using only that protected view's
cookies, scoped certificate identity and Tor route. It uses the same tab tools;
there is no inbound command listener. Logout, server switching, power off or a
failed connection revokes the grant. Reconnecting requires fresh native approval.

Remote screenshots return `data` as PNG base64. Remote file export copies only
an already-authorized browser file transfer and returns `data`, `mimeType`,
`name` and `size`; files above 23 MiB return a clear size error. Termux's native
`--output` path remains a streamed transfer without this remote JSON limit.
Commands are not replayed when delivery or a reply becomes uncertain.
