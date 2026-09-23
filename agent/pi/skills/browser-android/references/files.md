# Android content, console and files

Page commands take `tabId` and optional observed `frameId`:

- `read`: `format:"text"|"markdown"|"links"` (markdown), optional CSS `selector`,
  `includeLinks` (true), `includeImages`, `viewportOnly`. Returns string content
  or links as `[{text,href}]`. Narrow the selector when output is too large.
- `evaluate`: required `code` as an async function body; `timeout` (10000ms).
  Example `{"tabId":"actual-id","code":"return document.title;"}`.
  Returns `{hasValue:true,value}` for serializable data or a description otherwise.
  This is page JS, not Android, privileged preferences or browser chrome.
- `console`: returns captured recent page console messages.
- `clearConsole`: clears that page's console buffer. Desktop console filters,
  network records, scripts and logpoints are not Android APIs.

## Screenshots

Prefer `bashkitten_screenshot {tabId}`: shows the tab, captures PNG, writes a
unique private file beside Pi's session and returns image/path. Raw
`screenshot {tabId}` requires the tab visible; returns PNG data or transfer
metadata according to transport. No Android fullPage/clip/size/annotation/PDF
arguments. No Agent/native-dialog capture or shared-storage permission is needed.

## Downloads

1. Click the real download link with act and inspect the result.
2. `downloads.list {}` returns downloads associated with ordinary open tabs,
   with `id,tabId,name,mimeType,status,size`. A pending download can need confirmation.
3. `downloads.accept {tabId,downloadId}` accepts that tab's requested pending
   download. Use observed IDs; this is a download confirmation, not installation.
4. Once status is `COMPLETED`, call
   `bashkitten_downloads {action:"fetch",downloadId:"actual-id"}` to copy it
   into private Pi storage and receive a usable path/name.

`bashkitten_downloads {action:"list"}` wraps downloads.list. Raw
`downloads.get {downloadId}` grants a native transfer, not a directly usable
filesystem path; use the helper to copy it. Keep the originating tab open until
transfer completes. Incomplete/failed downloads are errors, not files.
Local Binder transfers stream; remotes use the authorized browser channel.
Helper paths belong to Pi's host. A content URI is not a filesystem path.
Known download/tab associations survive browser restarts while that ordinary tab
remains open. Older downloads without a recorded association stay unavailable;
do not infer ownership from a filename or URL.
Android exposes no automated upload command: use the normal user file picker.
