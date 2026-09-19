<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Android agent API v1

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
by another app. The browser menu revokes all grants and closes agent-owned tabs.

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
