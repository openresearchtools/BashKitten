# Remote connections, service tunnels and desktop lifetime

Requested 5 October 2026. **Status: plan, not implemented or accepted.** This
extends the [browser integration plan](browser-integration-plan.md) and replaces
its conflicting remote-export, llama relay and desktop-close requirements.
Local Agent remains account-free. Publishing remains Linux-only. Android remote
use requires no Termux; Termux is needed only for a local Pi/backend.

The deliverable is working Linux amd64/arm64 packages, the Android APK and matching
Termux package, source and notices, after builds and manual acceptance. Writing
this plan, building a helper or dispatching CI does not complete that deliverable.

## 1. Required user experience

| Where | Required result |
| --- | --- |
| Fresh Android Agent | The Termux setup page offers **Connect to remote** before any Termux install, command permission or package setup |
| Agent selector | Local, named remotes and Connect to remote remain reachable in every setup/connection state |
| Mobile Agent navigation | Replace the spelled-out **Agent** navigation button with the current BashKitten logo, retaining accessible naming, touch target and behavior |
| Unconfigured Local | Show the short-command setup and **Back to remote**, retaining the previous remote, login and draft |
| Linux Enable remote | Choose one username/password, scan the authenticator QR, verify a TOTP, then display the encrypted connection QR |
| Connection QR | One image contains all client connection material, encrypted with that same Authelia password; display, click to download, camera scan and image upload work |
| Remote login | Decrypt the QR, verify the server, authenticate with Authelia/TOTP and connect; no separately chosen tunnel password or pasted keys |
| Connected remote | List Agent and every published service, actual host state, local URL/port, Open/Copy, mapping control and host Start/Stop/Reload |
| Android localhost | Services bind an available port automatically or a user-selected port; Termux Pi and ordinary local applications can use them |
| Tor browsing on both platforms | Every network request from a Tor tab uses Tor or is blocked; ordinary unenrolled `.onion` navigation always enters the private Tor context |
| Linux host services | Explicit target and launch command/configuration, including llama.cpp router mode, with Start/Stop/Reload and Launch on startup |
| Reissue identity | Close old access, replace the remote account and all remote keys, enroll fresh TOTP, issue the new password-encrypted QR |
| Linux lifetime | Close hides to a functioning tray with BashKitten icon; Quit stops owned services and exits; Start on login is configurable |

No SSH service, remote terminal, arbitrary reverse-port forwarding or UDP UI is
included. Retain Chisel's internal SSH transport without adding an SSH server
feature. Published application endpoints are TCP/Unix streams, primarily web
applications and llama.cpp.

### Mobile Agent button branding

Additional requirement, 5 October: on Android, replace the visible **Agent** text
on the navigation button with the existing BashKitten kitten-with-glasses logo.
Apply this consistently beside the address bar, in the leftmost Agent entry on
the tabs screen and wherever the same Agent navigation control is reused. Use
the current product asset, not an old kitten image or a newly generated logo.
Keep the native rounded/circular button treatment and full touch target, with
clear light/dark appearance, focus and selected states. Retain the accessible
name **Agent** and its existing action: restore the protected Agent view without
losing its chat/draft or creating another tab. Keep it available after opening
new tabs and while Local setup or Remote connections are displayed. This is a
required mobile change; desktop logo treatment can follow its native layout.

## 2. Sources and verified starting points

Use **TorKitten `torkitten-v2` at
`2fd0f48358aa37e6c23336cd550f52ab00bbe7e3`**, not v1/main. Inspected references:
[README](https://github.com/openresearchtools/torkitten/blob/2fd0f48358aa37e6c23336cd550f52ab00bbe7e3/README.md),
[identity/QR](https://github.com/openresearchtools/torkitten/blob/2fd0f48358aa37e6c23336cd550f52ab00bbe7e3/internal/app/identity.go),
[client mappings](https://github.com/openresearchtools/torkitten/blob/2fd0f48358aa37e6c23336cd550f52ab00bbe7e3/internal/app/client.go),
[tunnel](https://github.com/openresearchtools/torkitten/tree/2fd0f48358aa37e6c23336cd550f52ab00bbe7e3/internal/tunnel),
[OAuth](https://github.com/openresearchtools/torkitten/tree/2fd0f48358aa37e6c23336cd550f52ab00bbe7e3/internal/oauth)
and [service commands](https://github.com/openresearchtools/torkitten/blob/2fd0f48358aa37e6c23336cd550f52ab00bbe7e3/internal/app/managed.go).

| Component | Checked release / source | Action |
| --- | --- | --- |
| Chisel | [v1.12.0](https://github.com/jpillora/chisel/releases/tag/v1.12.0), `fe4f4fe7e6a849b4aa6d1b8ee47037e16033f42a` | Import full pristine source at `auth/chisel`; retain upstream wire, SSH, backpressure and half-close behavior |
| Caddy | [v2.11.7](https://github.com/caddyserver/caddy/releases/tag/v2.11.7), `72dd0fb067f6d7826c7f79907670ba4a713bfe37` | Update current 2.11.4 source and rebuild shipped targets |
| Authelia | [v4.39.28](https://github.com/authelia/authelia/releases/tag/v4.39.28), `8da42b2348b0351c6284a2940a9c5eec3d4cd3fd` | Already pinned to the checked latest release; keep native account/TOTP/OAuth validation |
| age | [v1.3.2](https://github.com/FiloSottile/age/releases/tag/v1.3.2), `b74dce4cdbe35b5e5f66c06d9612b72f89028758` | Reuse v2's pristine scrypt-recipient implementation and full source |
| QR | Donor's pinned barcode/gozxing, existing Android ZXing | Keep format/validation; reuse camera/file controls and avoid duplicate codecs per platform |
| Tor | Existing 0.4.9.12 pin/platform adapters | Keep native client/publisher separation; recheck supported security release before final build |

Recheck official stable releases at implementation, record exact commits, source
hashes and dependency locks, and build from those trees. Never resolve moving
branches during a release. Full corresponding source and notices include retained
Go dependencies. A release/version check is not runtime verification.

Adapt these donor differences deliberately:

- V2 generates its account and uses a separate QR password. BashKitten uses the
  chosen username/password and the **same password for the QR**, with no second
  account database or password verifier.
- V2 disables Remember me and locks profiles after restart. Preserve BashKitten's
  requested remembered login through native protected storage and Authelia's
  real session/refresh lifecycle, not repeated password prompts.
- V2 explicitly has incomplete Android packaging/device proof. Its mobile
  facade is a reference, not evidence that our Android flow already works.
- Host command control uses systemd user units. The Android client must not
  include that host-only dependency or `/usr/bin/openssl`/`ssh-keygen` assumptions.
- Keep real protocol validation. Do not import unrelated SSH UI, arbitrary
  service-count quotas, another application shell or a new supervisor framework.

## 3. Transport and security boundaries

```text
Android / Linux client                              Linux publishing host

ordinary client: Pi, browser, curl
  -> 127.0.0.1:<actual local service port>
  -> native Chisel carrier
  -> native Tor -> authorized onion:443 ---------> Caddy TLS + device mTLS
                                                   -> Authelia carrier auth
                                                   -> private Chisel backend
                                                   -> approved host loopback
                                                      TCP or Unix service
```

Native service discovery, login/OAuth and service actions use the same enrolled
Tor/TLS identity. They form the authenticated control path needed to establish
a tunnel, not an unauthenticated application fallback.

Caddy terminates **outer** TLS and forwards an authenticated WebSocket carrier.
Chisel carries **inner** TCP bytes without parsing/replacing application HTTP
headers, bodies, bearer tokens, SSE or WebSockets. Authelia authorizes the carrier;
it does not process the inner llama.cpp response. Each accepted local connection
gets its own carrier, as in v2. Preserve upstream backpressure, half-close and
cancellation; no response buffering, invented stream deadline or POST replay.

Mandatory boundaries:

- Tor v3 client authorization, exact onion/TLS identity, enrolled client
  certificate, full Chisel fingerprint and valid Authelia authorization.
  No clearnet retry, arbitrary CA acceptance or account-free Local fallback.
- Caddy/Authelia stay on the Linux host. Android remote access uses native Tor
  and the client core without Termux or Android-hosted authentication daemons.
- The private tunnel backend independently verifies Authelia authorization,
  following v2. A remote supplies only a configured service ID, never a new dial
  address, Unix socket, command or arbitrary reverse-forwarding destination.
- Caddy admin, Authelia storage/admin, host setup and controller IPC remain
  private. Preserve Origin/CSRF validation and strip untrusted identity/forwarded
  headers. Never treat a Tor connection as Local because it arrives on loopback.
- Use Authelia's token validation/refresh/revocation. Logout, revoked enrollment,
  reset and failed/expired authorization close affected active carriers and
  handshakes, not merely future connections. No parallel token issuer/store.
- Keep remote-generation keys separate from Local's native session/trust keys.

### Protected Agent versus ordinary service pages

Keep the protected Agent view and per-remote storage context. Reserve an Agent
service backed by the existing **remote-authenticated** HTTPS entry, never the
native Local bypass. Route its application traffic through the native tunnel
while preserving the enrolled origin, TLS checks and protected browser context.
Extend the existing scoped `TorGateway`/desktop remote-channel integration; do
not turn Agent into an ordinary localhost tab or expose its native bridge.

One Authelia login must serve the protected Agent session and native tunnel
authorization. Integrate supported authorization-code/PKCE with the protected
sign-in context and genuine Authelia session. Do not manufacture a login cookie,
expose refresh tokens to page JavaScript, or ask for another password/TOTP just
to open Agent. Prove this integration early before replacing remote login.

Ordinary service links open ordinary controllable tabs. Agent/login/QR/password
views remain excluded from browser automation. Service HTML gets no native
controller, tunnel keys or Authelia credentials. Different localhost ports do
not isolate cookies: use separate browser storage contexts for service tabs.
A web app may need its own base URL/origin configured for localhost; present
that real configuration requirement rather than silently rewriting its stream.

### Strict Tor tabs and ordinary onion links

Additional requirement, 5 October: **Tor routing belongs to the tab's browsing
context, not just to destinations ending in `.onion`.** On Android and Linux,
every network request initiated by a Tor tab must use Tor or fail closed. This
includes the document, HTTP/HTTPS assets on ordinary public domains, scripts,
styles, images, fonts, media, frames, fetch/XHR, SSE, WebSockets, downloads,
redirects and worker requests where supported. Keep normal TLS verification,
mixed-content restrictions and other browser security checks; Tor routing does
not make otherwise blocked content safe to load.

Carry the private Tor context across navigations, redirects, new-tab links,
popups, downloads and process changes. An onion page redirecting to an ordinary
HTTPS site stays on Tor. Resolve destination names through Tor, including public
asset hosts; no system DNS, direct DoH, speculative DNS/preconnect or auxiliary
page-triggered lookup may reveal those destinations outside Tor. Prevent direct
socket paths such as WebRTC/STUN or unsupported UDP/QUIC/WebTransport from
bypassing the proxy: use a supported Tor transport or block that capability in
the Tor context. A starting, stopped or failed Tor client produces a clear
waiting/error state; it never retries directly or inherits a system proxy's
direct/localhost bypass rules.

An ordinary `.onion` address with no imported connection/client key is normal
Tor browsing, not an Agent enrollment attempt. Typed/pasted URLs, clicked links,
OS URL opens, redirects and automation-created ordinary tabs must select the
**private Tor tab/context before making the onion request**. Preserve the
single-window product design; “private” here does not require another desktop
window. Do not ask users to import a key for a public onion site, attach a saved
Agent identity/session, or fall back to a normal/direct tab when a site is
unavailable or actually requires client authorization. Tor tabs keep private
storage isolated from ordinary browsing and protected Agent connections.

The native authenticated tunnel path remains distinct. A registered service
exposed at `127.0.0.1:<mapped-port>` is already the local end of the enrolled
Chisel-over-Tor connection; Pi and the native client must use that local socket
without sending it through Tor again. Service links deliberately opened from
the connected-remote UI use their scoped service context, not an ordinary Tor
tab. This exception is selected by trusted native connection/context ownership,
never by a blanket `localhost`/`127.*` URL exemption. An arbitrary Tor page
cannot gain direct loopback/LAN access or the native API exception by requesting
such a URL. Enforce this in native network routing on both platforms, not only
in address-bar navigation or JavaScript fetch helpers.

## 4. Publisher setup and encrypted image

1. Linux **Enable remote** opens first-time account setup: username, password and
   confirmation. Use Authelia's own Argon2 hashing and TOTP storage. Validate the
   password against both account and QR requirements before creating anything;
   retain v2's encryption work factor and check real mobile decrypt performance.
2. Generate the remote generation directory, onion identity/client grant, private
   server CA, client certificate/key, Chisel host key, OAuth registration/signing
   material and session secrets. No extra user key fields.
3. Show Authelia's authenticator QR and verify a real TOTP through Authelia.
   This **authenticator QR** is distinct from the final **Connection QR**.
   Application access/publication remains closed until verification succeeds.
4. Encrypt the complete connection bundle with that same chosen password.
   Display the Connection QR in Remote access with **Download QR image**;
   clicking the image downloads the same PNG. Preserve the encrypted image for
   redisplay after restart; plaintext connection JSON is not the normal export.
5. Show actual publishing/address/service state. Publishing Off closes remote
   ingress/carriers; subsequent On retains the account/identity without enrolling
   again. Local remains usable without an account and does not switch to Tor.

Reuse the actual v2 sequence: versioned bundle -> gzip -> pristine age scrypt
encryption -> base64 QR text -> PNG. Retain the `TK2:` envelope and field meanings
where compatible; document/version any necessary extension. Verify complete QR
capacity and camera readability; never truncate keys or silently substitute an
unencrypted export when encoding fails.

Inside the encrypted bundle: onion address, Tor **client authorization private
key**, public server CA, enrolled **client** certificate/private key, Chisel
server **public fingerprint**, owner name and bundle identity/version. Never
include the server's onion private key, CA private key, Chisel private key,
Authelia password/hash, TOTP seed or live OAuth tokens. Reissuing the Chisel key
means generating it on the host and exporting its new verification fingerprint.

Keep the setup password only in the pending operation; clear temporary plaintext
where supported. Save the encrypted PNG, not a plaintext password for regenerating
it. Cancellation/expiry clears pending sensitive state and stays unpublished.
Changing credentials must also replace the encrypted export; use full Reissue
identity for that action in this release, avoiding a stale image encrypted with
a password the UI describes as replaced.

One reusable image follows v2's shared enrollment model: multiple clients importing
it share that bundle's grant. Do not label those copies individually revocable
hardware identities. Full reissue invalidates every copy; their actual Authelia
client sessions still have their own token lifecycle.

## 5. Client onboarding and Local/Remote switching

1. **Connect to remote** offers **Scan QR** and **Upload QR image** through normal
   camera permission/file selection. Decode locally; never navigate the QR as a
   URL or upload it to another server. Camera denial leaves image upload working;
   leaving/cancelling capture stops the camera.
2. Ask for **Password** beside import. Decrypt and validate the whole bundle
   before updating saved state. Wrong password/damaged image gets visible local
   feedback without overwriting a working connection.
3. Verify Tor and TLS/mTLS before sending login credentials; validate the imported
   fingerprint and verify it at the authenticated Chisel handshake. Use the owner
   name and reuse the entered password in memory for the actual Authelia first
   factor during this one flow. Request a current authenticator code and present
   the required OAuth consent. Decryption alone is not authentication.
4. Save enrollment and refresh/session state using Android Keystore-protected
   storage or desktop NSS. No secrets in URLs, logs, clipboard, page storage or
   status responses. Remembered login survives normal app/process/package
   restarts while Authelia permits it; explicit logout/revocation still works.
5. Show Agent and the service list, including Connecting, Ready, Offline,
   Sign-in required and actual errors. Preserve drafts and per-server login.

Android Remote and Local setup are separate state transitions. Remote must not
launch Termux, request RUN_COMMAND, install packages or ask for Termux's battery
exemption. Unconfigured Local shows its normal short-command setup plus Back to
remote. Cancelling restores the last remote. Termux removal/reinstall affects
Local only; preserve dynamic-port discovery and native Local trust recovery.

## 6. Host services and client localhost mappings

Extend existing service settings with one saved host catalogue and a separate
client mapping record per remote/service; no second service-manager UI.

| Host field | Meaning |
| --- | --- |
| Stable ID and name | Authenticated catalogue/tunnel allowlist identifier and display label |
| Available remotely | Whether clients can discover/map the service |
| Target | Explicit numeric loopback TCP address/port or approved Unix stream socket |
| Web URL details | Scheme and optional opening path, used for links without rewriting traffic |
| Launch command / working directory | Owner-configured executable and arguments; model/config file paths go to that program |
| Launch on startup | Start when the host runtime starts; off by default for newly added services |

Reuse v2's systemd **user** units for Linux commands, with product-owned stable
unit IDs and upstream group cleanup. Reuse existing BashKitten identities where
possible; do not add component fingerprinting. No root service is needed. Keep
arguments/quoting intact; no implicit shell expansion. Owners needing shell syntax
can explicitly configure `/bin/sh -lc ...`. Configuration files remain on the
host, without a custom model registry or command rewriting.

Start is idempotent; Stop stops the owned unit. **Reload** restarts it with the
current command/configuration, matching v2, and indicates that active streams
will end. Report process state, target reachability and real control errors
separately. An external target without an owned launch command can be mapped but
must not present fake Start/Stop controls for an unrelated process.

Host commands are configured on the host. Remote actions accept only an
authorized service ID plus a supported action. Removing/disabling a service
closes its carriers and removes its catalogue entry. Changing command/target
closes old access before applying the new configuration. Keep actual logs and
errors available with secrets redacted.

### Connected remote screen on Android and Linux

Every published service, including stopped ones, has one card containing:

- Name, actual host Running/Stopped/Starting/Failed state and reachability.
- **Start on host / Stop on host / Reload on host**, with progress/error in the
  same card and only actions that the host really supports.
- **Local access** on/off and **Port: Automatic / chosen number**.
- Actual local URL, for example `http://127.0.0.1:43127/`, with Open/Copy;
  llama.cpp additionally shows its `/v1` API URL.

After login, restore enabled mappings. On first connection, default offered
service mappings to automatic ports so the list provides usable addresses;
mapping does not silently start a stopped host process. Local access Off closes
only this device's port. Stop on host affects the service for all clients.

Bind directly to `127.0.0.1:0` for an automatic port and keep the returned listener;
no scan or probe-then-rebind race. For a selected port, report conflict/permission
denial and retain an existing working mapping. Never attach to an unknown process
on that port. Remember the user's choice. Automatic mode may use a new port after
restart and must show the actual value. Keep mappings distinct across remotes.

**Selecting Local chat must not disconnect enabled remote service mappings:**
local Termux Pi -> mapped remote llama.cpp is an explicit supported use case.
Changing the displayed Agent does not itself revoke other service connections.
Show connected status per remote. Disconnect closes that remote's mappings;
Agent Turn off closes all owned client mappings and stops any adopted local
group. Forget also erases that remote's credentials. These client actions do
not silently stop the remote host.
Browser-control authority remains tied to the selected/authorized remote Agent.

The Android APK owns listeners through its native core/foreground runtime and
native Tor. They work without Termux and remain usable with Termux foregrounded.
Reuse wake/notification/battery handling; release resources on Turn off and
reconcile actual state after an OS kill. Wake locks do not guarantee process
survival. Installing Termux later lets Pi use the displayed endpoint without
installing Chisel there or moving tunnel credentials into Termux.

Loopback mappings intentionally permit ordinary local applications to connect;
loopback is not Android-package or desktop-process authentication. Do not expose
the privileged controller on these service ports. Preserve application-native
authentication if the owner enables it; no mandatory extra token or HTTP rewrite.

## 7. llama.cpp router passthrough

Treat llama.cpp as a normal managed service with a convenient command/config
form. Use the installed `llama-server` and supported router preset syntax, such
as `--models-preset <file>`, with an explicit loopback host/port. Verify against
the packaged version. Preserve model/config files, existing downloads/runtime
selection, and real readiness/errors. Do not introduce another llama supervisor
or modify Pi's agent loop.

The user's launch command/configuration decides whether llama.cpp requires an
API bearer token. Carry the client's Authorization header unchanged; never
insert the Authelia carrier token, replace the llama token, strip `/v1`, parse
and re-emit SSE or buffer the response. Outer credentials never become target
application headers. Apply the same transparent behavior to other services.

Termux Pi/pillama uses the actual phone-local mapped URL through its supported
provider settings. A remote Pi uses the host endpoint instead; localhost refers
to the machine running that Pi. Update only explicitly BashKitten-managed
provider settings when an automatic local port changes.

Upstream documents [resumable streaming](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README-dev.md#resumable-streaming-sse-replay-buffer)
using `X-Conversation-Id`, `GET /v1/stream?conv_id=<id>&from=<byte-offset>`,
lookup and explicit stream deletion, including router/model-child forwarding.
Preserve these headers/paths/queries and response bytes. A broken TCP connection
still requires the capable client to reconnect and ask for native byte-offset
replay. Chisel must not repeat a generation POST or invent a resume protocol.
Do not claim Pi resumes automatically unless its actual provider/pillama client
does so; verify native resume and Pi behavior separately.

Use real models to verify multiple router children, native bearer and token-free
modes, simultaneous streams, interruption and exact replay without gaps/duplicates,
plus expired/unknown stream errors. Compare application bytes, not packet or
HTTP chunk boundaries. Preserve pillama's native progress/cache/speed display.

## 8. Identity reissue and failure recovery

**Reissue identity** is a host-local action with confirmation that old clients
will disconnect. It is not a remote account-takeover endpoint. Collect the new
username/password, then:

1. Persist replacement-in-progress; reject new remote work. Close carriers,
   handshakes, remote Agent/browser-control sessions and ingress. Stop the owned
   remote Tor, Chisel, Authelia/session-store and Caddy, verifying exact ownership.
2. Delete the old remote user/hash/TOTP, OAuth registration/signing/token/session
   state, onion identity/client authorizations, Chisel key, remote CA/client grants
   and encrypted QR. Old downloaded QR images cannot be erased but no longer
   authorize this server. No reachable fallback to the old generation.
3. Generate all new remote material, create the chosen account, require fresh
   TOTP enrollment/verification, and issue a new QR encrypted with the new
   Authelia password. Publish only after readiness/authentication succeeds.
4. On interruption or failure, stay remotely closed and show host setup again.
   A restart must not restore the old identity or publish a partial replacement.
   Persist generation/state transitions atomically and durably.

Separate remote-generation paths from native Local trust before this change.
Stopping shared Caddy can briefly interrupt Local; restart its local listener
with unchanged trust and restore the view automatically. Preserve local Pi chats,
provider logins, projects, models, service definitions and unrelated remotes.
Keep local service applications running unless whole-Agent power/Quit is requested;
their remote carriers are closed throughout reissue. Reconcile owned units after
failure without killing unrelated terminal processes.

Publishing Off/On, app restart, logout, client disconnect and Reissue identity
are distinct actions. Ordinary restart retains identity and remembered login;
retrying a network problem must never silently rotate credentials.

## 9. Linux startup, tray and Quit

Native settings add **Start BashKitten when I log in** and **Keep running in the
tray when the window closes**. Startup is opt-in; close-to-tray is the requested
default where a working tray host exists. Use per-user XDG autostart and the
existing single-instance path, without sudo, another profile/window or a system
boot daemon. Service Launch on startup remains a separate per-service choice.

Use a small native StatusNotifier/AppIndicator integration with the BashKitten
icon. Tray actions: **Open BashKitten**, real Agent/remote status and **Quit**.
Hide/show the existing window so its lifetime guard/adopted runtime stays alive;
do not destroy the final Gecko window and try to revive the stopped backend.
OS URL launches/another invocation reveal the same instance. Autostart can enter
the tray when supported. With no functioning tray host, retain a reachable window
and explain the setting; never hide the only route back to the app.

Quit prevents restarts, closes client mappings/control channels, stops adopted
Pi/backend/auth/Tor/Chisel and product-owned service units, removes the icon and
exits. Preserve data/unrelated daemons and finish active package transactions
safely. Independent CLI servers remain independent until adopted. Browser death
still invokes existing group cleanup; hiding does not. Reopening starts only
enabled startup services without duplicate units. Explicit Stop stays respected
during the current runtime.

## 10. Implementation map and upstream maintenance

| Area | Changes |
| --- | --- |
| `agent/src/server/access/{remote,accounts,stack,paths,hosting}.mjs` | Remote generations, chosen account, QR delivery, Authelia OAuth config, catalogue/actions, Tor/Caddy routes |
| `agent/src/server/control.mjs`, runtime ownership/guard | Remote reset/lifecycle, owned service units, safe Quit and reconciliation |
| `agent/src/server/platform/linux/{llama,llama-provider}.mjs` | Command/config service ownership; remove duplicate HTTP token-injecting relay behavior |
| Existing `agent/src/web` settings | Publishing flow/image, service command/startup controls and real state/errors; no web-side crypto/auth implementation |
| Android `AgentPanel.java`, `AgentRuntime.java`, `AgentRemotesActivity.java` and Fenix Agent navigation | Remote-first onboarding/back, encrypted image import, service actions/mappings, foreground ownership and logo-based Agent navigation |
| Android `TorManager.java`, `TorGateway.java`, `SecretStore.java` | Reuse native Tor, scoped trust and protected credentials; add native tunnel client without Termux |
| Desktop `components/{agent,tor}` | Equivalent UI, protected Agent transport and storage; replace `LlamaRelay` with common native mapping core |
| Android/desktop native tab and network routing | Private Tor context before onion navigation; Tor-only subresources, DNS, redirects and downloads; block unsupported direct transports; keep native mapped-service routing separately scoped |
| Desktop native GTK/lifetime integration | Tray, hide/reopen, autostart and real Quit |
| `auth`, packaging/workflows/notices | Full source imports, native builds, minimal staged patches, provenance/source/license bundles and four artifacts |

Put one small shared Go integration under `agent/native/remote/`, derived from
v2's inspected tunnel/OAuth/encrypted-bundle code with its Apache attribution.
Build a Linux helper over private existing native/controller channels and an
Android JNI/AAR client library. Compile host-only functionality out of the
Android client. Reuse platform Tor/credential stores and current UI/controller,
not the entire donor app or duplicated account managers on each platform.

Keep Chisel, age and retained QR libraries pristine/pinned. First build the
unmodified client for Android; **zero Chisel source patches is preferable when
sufficient**. Keep only necessary Go/NDK/link/path adaptations in a documented
staged patch series outside upstream trees. A patch failure stops the build.
No custom cryptography, SSH protocol, token issuer, HTTP rewriter or generic
supervisor. Caddy/Authelia remain upstream components with small integration
changes. Do not duplicate Node/Pi behavior in Go or claim this multi-process
stack is one PID. Document exact process ownership and private IPC.

## 11. Ordered gates, migration and release

| Gate | Work and required proof |
| --- | --- |
| 1. Sources/native boundary | Pin/import complete Chisel/crypto/QR and donor provenance; update Caddy; build Linux and Android core without host-only client dependencies; verify ABI, licenses and 16 KB alignment |
| 2. Host/tunnel | Actual Tor/Caddy/Authelia/Chisel, chosen account, verified TOTP, encrypted image and approved-service mapping; reject invalid identity/auth/target |
| 3. One-login UI | Protected Agent/OAuth integration, no-Termux Android onboarding, camera/image import, stored secrets, Back to remote and remembered restart; desktop parity |
| 4. Services/localhost | Host command/config/startup UI, real remote actions, automatic/chosen ports, concurrent remotes and Local Pi using an enabled remote mapping |
| 5. Real applications | Multi-model llama router, bearer/no-bearer, byte-offset replay, pillama status, web application uploads/downloads/cookies/WebSockets; strict Tor-tab routing and ordinary private onion navigation |
| 6. Reset/lifetime | Complete and interrupted identity rotation; old exports/sessions fail; tray/hide/reopen/autostart/Quit and owned-group cleanup |
| 7. Delivery | Existing-data migration, four complete artifacts, offline notices/source, manual platform acceptance, release/APT publication with testing warning |

Work directly on main in focused commits and push finished slices. Record actual
evidence per exact candidate commit. Resolve early integration gates before full
Gecko iterations; reuse unchanged component artifacts under existing provenance
rules. No new build repositories or fingerprinting scheme.

Preserve Local data, providers, Pi history/runtime, drafts, native permissions and
saved remotes. Never clear app/Termux data to make an upgrade work. Existing hosts
get an explicit migration to the encrypted bundle; no silent account/identity
replacement. Old v1 plaintext exports cannot supply new tunnel credentials:
provide actionable re-enrollment after host migration. Retain only necessary
bounded legacy compatibility, then remove superseded export/HTTP-relay paths;
never negotiate a weaker fallback from the new tunnel flow.

Use the current independent Linux arm64/amd64 and Android build repositories.
Collect artifacts as soon as they upload; each builder keeps manually downloadable
Actions artifacts and publishes no release. Build matching Termux aarch64 with
current Pi/pillama/skills and prior Local recovery fixes. Preserve `com.bashkitten`,
APK signer and increasing version code. Publish four installable artifacts,
checksums, corresponding source/build material and offline Android/Linux notices,
including Chisel, age, QR dependencies and reused TorKitten. BashKitten remains
AGPL-3.0-only; preserve every retained dependency's own license.

## 12. Manual acceptance

Use visible ordinary Cuttlefish UI, Linux browsers, APT and normal package
installers. No ADB/root/hidden permissions or BashKitten-owned scripted product
tests. Source integrity/compiler/artifact checks are necessary but not user-flow
proof. Keep evidence outside product source/artifacts. Record actual Android/VM
configuration and the previously authorized child-process toggle; do not claim
a physical Pixel or untouched default settings. Preserve the running browser/VM
except where an explicit restart case requires otherwise.

| Case | Required evidence |
| --- | --- |
| Fresh Android without Termux | Immediate remote option, image import, actual TOTP login, Agent and mapped service URL; no Termux prompts |
| Switching/setup/reinstall | Unconfigured Local has Back to remote; login/draft retained; later normal Termux setup; removal/reinstall does not break saved remotes |
| QR inputs | Real screen-to-camera scan and PNG import on both platforms; wrong password, damaged image and camera denial handled without replacing working state |
| Auth lifecycle | No access before TOTP; actual consent, remembered restart, refresh, expiry/logout/revocation, valid TLS leaf renewal under the same pinned CA, incorrect TLS/mTLS/fingerprint rejection, no repeated login merely to open Agent |
| Service controls | All published stopped/running services listed; real Start/Stop/Reload; mapping Off leaves host application running |
| Local ports | Actual auto/chosen/conflicting ports, two remotes with same service name, retained mapping while using Local, recovery after process death |
| Pi/browser tools | Real Pi turn using phone-local remote llama; browser controls ordinary service tabs but excludes Agent/auth/QR; approved Termux calls run without repeated prompts |
| Web apps | Real navigation/login if app requires it, file upload/download and WebSockets; service contexts receive no Agent cookies or native privileges |
| Tor tab network boundary | On Android/Linux manually browse real onion and public pages in Tor tabs with HTTP/HTTPS assets, frames, requests, redirects, downloads and WebSockets; inspect external network evidence for no direct destination/DNS or WebRTC/UDP escape; stop Tor during loading and confirm failure without direct fallback |
| Onion entry and tunnel exception | Typed/clicked/OS-opened/redirected/automation-opened public onion URLs enter private Tor without import prompts; linked public hosts stay on Tor; native mapped APIs still work locally; Tor-page loopback/LAN requests cannot use the native exception; storage stays separate |
| llama/router | Two actual models, bearer and token-free modes, concurrent streams, pillama status, network interruption and exact native byte-offset replay |
| Access removal | Disconnect/logout/revoke/reset during streaming closes access; old QR/session fails; service removal/target change closes old carriers |
| Identity reset | New user/password/TOTP/onion/client grant/CA/Chisel key; old account removed; interrupted rotation closed; local chats/provider logins/models/service definitions preserved |
| Desktop | Supported X11/Wayland tray and icon; serving while hidden, same-window reopen, actual login autostart and disabled-autostart check, missing-tray fallback, complete Quit cleanup |
| Android UI/lifetime | Screen-off/background runtime, reopen/reconnect, rotation/keyboard for every password/TOTP/port field; input and controls remain visible |
| Mobile Agent logo | Current logo replaces navigation text beside the address bar and in the tabs screen; accessible Agent name, full touch target, light/dark/selected states; new tabs and setup/remote screens retain access and existing chat/draft |
| Upgrade/licenses | Signed APK/APT updates retain state; accurate full notices/source available offline before backend/login on Android/Linux |

Record results on all target platforms before release. Missing runtime coverage
remains missing, never inferred from compilation. Fix observed failures, rebuild
affected components and repeat the affected real flow. Do not publish an earlier
candidate as if it contains these features. Every release retains the README's
testing-warning SVG and explicit testing-only/not-ready-for-production text.

Prior work is not silently complete: candidate
`919f94522b2c08154a15981f421e62b59bf0fa09` predates this architecture. Its Android
Local re-enrollment/clean-Termux-reinstall and fully authenticated remote checks
remain unfinished. Include browser-skill package-lookup fix
`9bebe11479c8d530268df0ffe1ddf8e6cf226832` and finish those regressions as part of
the eventual release, rather than losing them during migration.
