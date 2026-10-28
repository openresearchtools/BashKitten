# References browser capture component

The fixed host (`host/`, `references-host@bashkitten.org`, API 1) exposes only the
existing authenticated backend's project context and named Connector operations.
It accepts messages only from the background of `references@bashkitten.org`;
page scripts cannot call the host. Desktop packaging adds the tiny native
`bashkittenReferences.request` Experiment. Android uses GeckoView's built-in
native-messaging delegate `bashkitten_references`. No tokens, filesystem handles
or arbitrary native URL fetch are exposed to the capture extension.

The independently built capture extension, preinstalled separately from the fixed host, reuses Connector 5.0.217's
translation, ItemSaver, background attachment, SingleFile, item selector, progress,
content-type interception, cookies and challenge-monitor modules. Its source
import is immutable under `upstream/`; a named patch changes only documented seams.
The whole Zotero desktop app and Google Docs integration are not runtime inputs.
The relevant core assets are materialized from the Connector's own exact gitlink,
not substituted with the newer backend graph. Translator data is the separately
pinned References dataset `c83003773b65359e41466e1d419b2d1df5512af7`.

Build without Mozilla:

```sh
python3 agent/references/connector/build.py
```

This applies the patch to an ignored temporary source copy, uses the release's
locked npm dependencies entirely offline from the 546 integrity-verified source
archives under vendor/npm, and actual upstream Firefox build, then produces
`dist/references.xpi`, unpacked `dist/references/`, a runtime hash inventory and
`dist/component.json`. The XPI is **unsigned** until the normal release signing
process signs it. These artifact/syntax checks are not installed product tests.
No new BashKitten scripted product tests are part of this component.

## Native API contract

The capture background sends `{apiVersion:1,operation:'context'}` to the fixed host.
A result is `{apiVersion:1,body:{backendId,projects:[{id,name}],selectedProjectId}}`.
The optional `backends` array carries the same authorized descriptors for each
backend if the native owner supports backend choice. No service starts merely
for translator detection; metadata/code comes from the package.

Every save begins with an explicit backend/project/collection choice and a fresh
capture session generated in the background before translation starts. The
session is permanently bound to that destination and source tab. Collection
choice traverses collection hierarchy using bounded pages (at most 100 targets); stale search responses are discarded. Closing
or cancelling the chooser makes no item or attachment. Upstream progress updates
retain the same bound session; the server is the final authorization owner.

Requests are `{apiVersion:1,operation:'request',backendId,projectId,method,data,
headers,queryString,bodyEncoding}` and return `{apiVersion:1,status,headers,body}`.
The native owner maps only to authenticated `POST /api/references/connector` on
that backend. The service routes to `/projects/:projectId/connector/:method`.
Headers are limited to `Content-Type` and `X-Metadata`; the query allows one each
of `sessionID`, `session`, `target`. Normal message data is at most 512 KiB.
Native/back-end errors remain errors; there is no cloud account or sync fallback.

API 3 capture methods are `ping`, `getTranslators`, `getTranslatorCode`,
`getSelectedCollection`, `saveItems`, `saveSnapshot`, `saveSingleFile`,
`saveAttachment`, `saveStandaloneAttachment`, `getRecognizedItem`,
`hasAttachmentResolvers`, `saveAttachmentFromResolver`, `updateSession`, `import`
and `installStyle`. Historical progress/select RPCs are not advertised.

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

A release/update must verify the signed package, fixed extension ID, component
SHA-256, host API 1 and Connector API 3 before activation, retain the prior signed
package, and use native add-on installation to roll back that verified package.
The generated unsigned manifest is evidence, not a trusted update catalogue.
**The authenticated release catalogue/signing/install/rollback wiring is still an
open integration gate.** No signing check or browser privilege policy is weakened.

## Evidence and remaining acceptance

The first independent source build succeeded on 28 October 2026 with 748 pinned
translators. Manifest resource presence, adapted JavaScript parse checks, immutable
source archive hashes and package file hashes are available. No real identifier
batch/PDF harvest was performed and no browser-native installed pass is claimed.

Still required: installed desktop and Fenix action availability, detection and
single/multiple/PDF/snapshot saving, collection/tag/note updates, selector close,
concurrent destinations, private/partitioned cookies and redirects, challenge
tab completion, partial uploads/ambiguous receipts, traffic inspection, backend
resolver parity and signed update/rollback. Source-adapter work is not completion
of these gates. Native context currently supplies the selected backend; exposing
all authorized backend choices remains dependent on the host owner's context.
