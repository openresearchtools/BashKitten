# Fixed References host

This is the small Mozilla boundary for the separately versioned References
capture extension. The canonical fixed shim source is
`references/connector/host/`. Capture, translators, selector/challenge tabs,
attachment upload chunks and resolver behavior belong to that component and the
References backend, not this directory.

The pinned Gecko tree already provides desktop builtin add-ons and privileged
Experiment APIs, and GeckoView `ensureBuiltIn` plus background native messaging.
The only missing facility is access to the owning protected BashKitten backend.
The fixed host supplies that access through one versioned, project-bound bridge.
It never hands an extension the protected Agent cookie, CSRF token or a generic
native command/URL/filesystem interface. Page content receives no native host.

Desktop packaging uses the normal builtin-addons jar and generated registry.
Android stages the same fixed source into APK resources and installs it with
`ensureBuiltIn`. Both also preinstall the separately built ordinary capture
extension, verified against its component runtime checksums before packaging.
The Android delegate accepts only the fixed host ID's background
extension environment. `nativeMessagingFromContent` is not requested. The desktop
Experiment is available only to that same fixed host ID. Neither target relaxes
extension signing or opens a public management listener.

API 1 accepts `context`, `request` and `open`; the fixed JS shim validates the named
Connector API 3 methods and bounded upload messages. Native code binds requests
to the selected backend and actual protected document, then uses the existing
cookie-authenticated request owner for `POST /api/references/connector`.
`context` returns `{apiVersion:1,body:{backendId,projects,selectedProjectId}}`.
The response to `request` preserves the backend's `status`, `headers` and `body`
with `apiVersion:1`. Missing authentication/modules and changed backends fail
explicitly. No service starts merely because the browser loads the fixed host.
`open` launches the selected project's References manager through the same
ordinary application gateway as Files.

The existing authorized browser dispatcher also accepts `references.resolve`
with a project and opaque request ID (an optional backend handle must match the
selected owner). It sends one event to the fixed host, which asks the capture
extension to fetch the authorized resolver job through `getResolverRequest`.
Only job identities cross this event boundary, never URLs or credentials. The
capture receipt returns through `resolver-result`; native waits for the receipt,
rejects changed owners/cancellation and bounds an unanswered request to ten
minutes. The backend retains actual job status. Desktop uses an Experiment
event; Android uses the fixed background native-messaging port, with no polling.

`references@bashkitten.org` is the separately versioned ordinary capture add-on.
Its source/build contract is in `references/connector/README.md`. Desktop
development can use the native `about:debugging` temporary-add-on reload flow;
this is development, not a distributable update. Production install/update and
rollback use normal signed XPI installation with the stable ID and compatible
host API. Desktop's native profile add-on location takes precedence over the
builtin location. Android lists installed extensions first and preserves an
existing non-builtin capture extension, avoiding `ensureBuiltIn` replacing a
signed update with the APK version. APK-only built-in installation is not a
downloaded-code installer. The fixed privileged shim remains browser-owned.
A signed capture package and its installed Android update/rollback flows remain
acceptance requirements; source staging and an unsigned build do not prove them.
Android uses the retained Fenix HTTPS XPI link/download/permission flow. After
Gecko validates the package, the required-permission handler accepts only the
capture ID above; unrelated add-ons and the privileged host cannot be installed
through that flow. There is no custom updater or signature-policy change.

Desktop uses the capture manifest's native navbar browser action. Android adds
one toolbar button backed by Fenix's selected-tab WebExtension action state,
including enable/private state, dynamic icon and existing click/popup handler.
Capture logic and the project chooser are not reimplemented in Mozilla.

Changes to capture logic, translators or backend modules do not change this host;
independent signed updates use Gecko's ordinary extension installation path.
Changes to native authority or the fixed shim require a new browser build. The
browser package includes the fixed shim and the capture component's generated
runtime directory, never its donor source/build dependencies. Existing signing
restrictions and system-addon update preferences stay intact.

Files opens an ordinary service tab using the owning backend's authenticated
launch response. Local, private container forwarding and exact remote Chisel
mapping all use HTTPS. The native CA owner trusts the supplied gateway CA only
for 127.0.0.1 in that isolated service storage context, retaining normal chain,
host, date and key checks. This adds no certificate warning bypass, global root
or protected Agent cookie/client certificate to the ordinary service tab.
Installed TLS, toolbar and capture acceptance still require the native builds.
Pi can pass `application:true` to existing `tabs.create` alongside a returned
application URL. The native owner resolves it through authenticated
`POST /api/apps/resolve`, which validates the owning live gateway grant, before
opening the same isolated service context. No caller-provided CA is accepted and
Mozilla adds no Office protocol or editor logic.
