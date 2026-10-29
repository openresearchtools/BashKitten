# References browser capture component

The fixed host (`host/`, `references-host@bashkitten.org`, API 1) exposes only the
existing authenticated backend's project context and named Connector operations.
It accepts messages only from the background of `references@bashkitten.org`;
page scripts cannot call the host. Desktop packaging adds the tiny native
`bashkittenReferences.request` Experiment. Android uses GeckoView's built-in
native-messaging delegate `bashkitten_references`. No tokens, filesystem handles
or arbitrary native URL fetch are exposed to the capture extension.

The independently built capture extension (currently 1.0.7), preinstalled separately from the fixed host, reuses Connector 5.0.217's
translation, ItemSaver, background attachment, SingleFile, item selector, progress,
content-type interception, cookies and challenge-monitor modules. Its source
import is immutable under `upstream/`; a named patch changes only documented seams.
The whole Zotero desktop app and Google Docs integration are not runtime inputs.
The relevant core assets are materialized from the Connector's own exact gitlink,
not substituted with the newer backend graph. Translator data is the separately
pinned References dataset `c83003773b65359e41466e1d419b2d1df5512af7`.

Build without Mozilla:

```sh
python3 references/connector/build.py
```

This applies the patch to an ignored temporary source copy, uses the release's
546 locked npm source pins from `vendor/npm/SOURCES.json`, and the actual upstream
Firefox build, then produces
`dist/references.xpi`, unpacked `dist/references/`, a runtime hash inventory and
`dist/component.json`. The XPI is **unsigned** until the normal release signing
process signs it. These artifact/syntax checks are not installed product tests.
No new BashKitten scripted product tests are part of this component.

`agent/packaging/source_cache.py` fetches the exact pinned HTTPS archive bytes into
`BASHKITTEN_SOURCE_CACHE` (or the shared default user cache), verifies SHA-256 and
size, and can use an existing whole repository archive as an optional seed. The
build passes verified external paths to npm's native content cache, retaining
the original lock integrity checks and offline `npm ci`; repository tarballs are
not required. Set `BASHKITTEN_OFFLINE_SOURCES=1` to forbid source downloads and
require an already populated cache. Include the shared helper alongside the
Connector source, pinned translators and branding inputs when preparing a
standalone source-review/build bundle.

The manifest uses Gecko's native required-data declaration for `browsingActivity`
and `websiteContent`: selected page URLs/referrers, reference metadata, notes/tags
and requested snapshots/PDFs go to the explicitly selected local or remote backend.
About References describes that flow and reads its version from the native
extension manifest. There is no analytics permission or new consent/updater UI.
Desktop 140 and Android 142 are the minimum versions supporting this native
data-permission prompt; the current BashKitten source is newer on both targets.

The capture action retains Gecko's native configurable extension command without
a default shortcut: the donor's Ctrl+Shift+S conflicts with browser screenshots.
Users can assign a capture shortcut through the browser's extension settings.

## Native API contract

The capture background sends `{apiVersion:1,operation:'context'}` to the fixed host.
A result is `{apiVersion:1,body:{backendId,projects:[{id,name}],selectedProjectId}}`.
The optional `backends` array carries the same authorized descriptors for each
backend if the native owner supports backend choice. No service starts merely
for translator detection; metadata/code comes from the package.

The manager action opens directly, including the New project state after all
projects were deliberately deleted; its `open` request may omit `projectId`.
Capture requests always require an explicit project ID.

Every save begins with an explicit backend and References project choice and a
fresh capture session generated in the background before translation starts.
The session stays bound to that backend, project and source tab. The capture
form has no collection, search, hierarchy or paging controls.
The action menu's **Open References** opens the manager directly through the
native shared application-launch owner. The capture chooser's **Open manager**
uses its selected project. Both pass no URL or credential into page scripts and
return no capture session. Closing or cancelling the chooser makes no item or
attachment. The donor progress disclosure retains its native tags and note
controls; its collection tree and retarget action are removed. The legacy
`getSelectedCollection` method name remains a root-only compatibility seam.

Capture, selector, progress and manager styling reuse `web/theme.css`, with the
existing BashKitten sidecar palette and the browser's native
`prefers-color-scheme`. There is no separate References theme setting or store.
The shared Office chooser keeps its explicit light theme.

Requests are `{apiVersion:1,operation:'request',backendId,projectId,method,data,
headers,queryString,bodyEncoding}` and return `{apiVersion:1,status,headers,body}`.
The native owner maps only to authenticated `POST /api/references/connector` on
that backend. The service routes to `/projects/:projectId/connector/:method`.
Headers are limited to `Content-Type` and `X-Metadata`; the query allows one each
of `sessionID`, `session`, `target`. Normal message data is at most 512 KiB.
Native/back-end errors remain errors; there is no cloud account or sync fallback.
API 3 resolver capability is a boolean, and resolver save success is an attachment
title. A `BROWSER_REQUIRED` response uses the existing ordinary-tab resolver helper
and returns that title only after a verified completed attachment receipt; pending,
unavailable or cancelled retrieval never reports a successful PDF save.

API 3 capture methods are `ping`, `getTranslators`, `getTranslatorCode`,
`getSelectedCollection`, `saveItems`, `saveSnapshot`, `saveSingleFile`,
`saveAttachment`, `saveStandaloneAttachment`, `getRecognizedItem`,
`hasAttachmentResolvers`, `saveAttachmentFromResolver`, `updateSession`, `import`,
`installStyle` and `getResolverRequest`. Historical progress/select RPCs are not advertised.

Binary attachment/snapshot uploads preserve API 3 MIME, X-Metadata and sessionID:

1. `upload-begin`: `{method,headers,queryString,bodyEncoding:'binary'|'json',byteLength,requestId}` → `{uploadId}`.
2. `upload-chunk`: `{uploadId,offset,data}`; data is base64 of at most 256 KiB, sent sequentially.
3. `upload-commit`: `{uploadId}` returns the real capture result and retained receipt.
4. `upload-cancel`: `{uploadId}` abandons a transfer before commit.

The server owns temporary files, expiry, offsets, project binding and receipts.
A lost commit response is ambiguous; the extension retains the upload ID in the
error and never repeats the write automatically. The upstream browser attachment
fetch still returns its native ArrayBuffer; chunking prevents whole-attachment
JSON copies across Gecko/native messaging. Large SingleFile payload creation is
upstream behavior and still needs installed responsiveness evidence.

## Browser-assisted resolver handoff

The existing authenticated browser-control operation `references.resolve` carries
only `{backendId,projectId,requestId}`. The fixed host receives that immutable event
through its desktop Experiment event or Android native-message port and forwards
it to the capture background. The capture verifies `getResolverRequest` against
the same project before and after interaction, uses the donor attachment-response
classification and validation, and uploads the PDF with
`X-Metadata.resolverRequestId`. The backend validates the session, attachment and
parent, then completes the originating receipt/job.

The fixed host returns the bounded receipt through native
`operation:'resolver-result'`; backend changes, Off and stale requests fail.
There is no polling, arbitrary page-to-host listener, cookie export or supplied
native fetch URL. Challenges use visible ordinary tabs for human completion;
automated Amazon and hidden-iframe bypass paths are removed from runtime.

Normal resolver jobs invoke that same handoff automatically through their owning
backend. A browser-required job opens an ordinary background tab through native
`tabs.create`, without copying an application service's cookie-store ID. The
source window is requested where the platform supports it; the source URL and
selected tab are left unchanged. The plugin attaches native
`webRequest.filterResponseData` before the request and passes response bytes
through unchanged, retaining only the selected attachment response. It does not
cancel the PDF, redirect to a monitor page, extract cookies or fetch the PDF again
from the background. The selected attachment's `Content-Disposition: attachment`
becomes `inline`, preserving its filename: Gecko otherwise retargets this existing
tab navigation into a new foreground tab (`DocumentLoadListener::GetWhereToOpen`).
The native viewer therefore stays in the created background tab. The existing
resolver response limit is 32 MiB; partial or
empty responses and donor MIME validation failures cannot become saved files.
Ordinary HTML, redirects and unrelated failed frames remain native page behavior.

The durable job reports its tab identity and source URL for existing user/agent
browser controls. Challenge/PDF tabs remain open. The existing expiry and tab-close
paths release stream capture; authorization is checked again before upload.
Only an unused blank tab is removed if authorization fails before navigation or
the native API returns a public tab for a private source. Unsupported private
creation reports an error rather than navigating that public tab. Desktop and
Android session/private/partitioned behavior require installed verification.

On Android Firefox, ordinary capture reuses the donor's existing source-content
attachment helper: same-origin requests use the page's native XHR, while forced
cross-origin requests use its MV2 extension sandbox XHR and existing host
permissions. Both retain the source tab's native origin attributes and cookie
handling. The native runtime platform API selects this branch; desktop behavior
and the donor's explicit cookie-header filter remain unchanged.
An uninjectable Android PDF reuses the same response-stream helper under its
existing capture session, with source/backend checks before and after retrieval.
The donor still validates and uploads through its normal session path. Closing
the source cancels capture. A routine successful helper tab closes after MIME
validation; challenge and failed tabs remain visible. No cookie export, cookie
store mutation, new request owner or native host operation is added.

## Independent install, update and rollback

Desktop development uses native `about:debugging` → This Firefox → Load Temporary
Add-on → the unpacked `dist/references/manifest.json`. This reloads capture code
without rebuilding the browser, and does not replace the fixed privileged host.
The first native package preinstalls both components: the fixed host and the
capture extension as separate built-ins. The capture manifest requests no native
messaging/Experiment API. The native installer preserves an installed ordinary
signed capture replacement instead of resetting it to the built-in version.
Between-release distribution uses the browser's normal signed add-on mechanism.
`ensureBuiltIn` accepts only APK resources; it is not an unsigned capture updater.

The native signed add-on installer supplies package authentication, manifest
version checks and manual rollback; no custom update catalogue is needed.
[Manual update and rollback](UPDATE.md) records the exact source-verified paths,
versioned artifact/signing procedure and remaining gates. The generated XPI is
unsigned; no signing credentials or successful signed installation are claimed.
Android has the native signed installer and verified References-ID permission
gate. The **BashKitten settings gear → Update References from file** entry uses
the existing native `AddonFilePicker` and `AddonManager`, with file preparation
off the UI thread. Download the signed package first; Android does not register
the desktop XPI hyperlink content handler. This entry is source-wired for the
next browser package, not earlier sealed candidates. Installed
upgrade/restart/rollback acceptance remains pending on both targets.

## Evidence and remaining acceptance

The first independent source build succeeded on 28 October 2026 with 748 pinned
translators. Manifest resource presence, adapted JavaScript parse checks, immutable
source archive hashes and package file hashes are available. No real identifier
batch/PDF harvest was performed and no browser-native installed pass is claimed.

Still required: installed desktop and Fenix action availability, detection and
single/multiple/PDF/snapshot saving, project binding and tag/note updates, selector close,
concurrent destinations, private/partitioned cookies and redirects, challenge
tab completion, partial uploads/ambiguous receipts, traffic inspection, backend
resolver parity and signed update/rollback. Source-adapter work is not completion
of these gates. Native context currently supplies the selected backend; exposing
all authorized backend choices remains dependent on the host owner's context.
