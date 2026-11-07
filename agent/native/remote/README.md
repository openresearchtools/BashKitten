# Native remote core

This Go module contains the TorKitten v2 service-ID tunnel adapter, connection
image codec and independently selected raw network carriers. Upstream Chisel,
age, QR, Tailcat, Tailscale and cloudflared source trees are referenced directly
under `auth/`; no source patch or runtime source download is used.
`NOTICE` records the donor and adaptations.

- `bundle` preserves version 2 `TK2:` Tor enrollment and adds version 3 `TK3:`
  enrollment for Cloudflare Quick Tunnel, Tailcat and embedded Tailscale. It encodes
  PNGs with a QR quiet zone. Password/account creation, persistence and Tor
  ownership remain with the existing host/platform controllers.
- `transport` supplies raw TCP below the existing TLS/mTLS layer. Tor continues
  to use the platform's existing SOCKS owner. Cloudflare uses its native TCP
  ingress and exported `websocket.GorillaConn`, with a context-aware Gorilla dial
  seam because cloudflared's public Access carrier API cannot cancel an upgrade
  and can initiate a separate Access account flow. The host controller launches
  pristine cloudflared with a `tcp://127.0.0.1:<Caddy TLS port>` origin. The edge
  sees encrypted inner TLS bytes, never the private CA's TLS termination or the
  enrolled client key. Tailcat uses native `Server.Listen`/`Client.DialTCPPort`;
  Tailscale uses independent `tsnet.Server` instances and native account login.
  Each provider node has its own private state directory and stops with its owner.
  Upstream no-log-upload mode and `ts_omit_logtail,ts_omit_netlog` are enabled.
- `tunnel` maps a reserved loopback listener to the exact enrolled private host
  through the selected carrier, CA/client certificate and Chisel fingerprint.
  Chisel owns the stream copying and half-close behavior. No HTTP content is
  rewritten and failed application connections are not replayed.
- `taskarian_client` excludes the host server adapter from Android client builds.
  The host adapter accepts configured service IDs, never remote-provided targets.
  It requires an Authelia authorization callback; it does not issue tokens.
- `oauth` uses upstream Authelia PAR, PKCE/S256, explicit consent, token exchange,
  refresh and revocation. `Begin` supplies the URL for the protected Agent browser
  context. Native request handling intercepts the exact loopback callback's
  `form_post` body (required by Authelia's bearer scope) before
  loading it, recording it in history or allowing ordinary tabs to handle it.
  `Complete` validates issuer/state and consumes the exchange once; credentials
  go only to the supplied native encrypted-store callback. Authelia's real browser
  cookie stays in that same protected context for Agent/Remember me. The native
  token transport shares the exact enrolled TLS/mTLS identity with the tunnel.
- `client` owns one enrollment's login/cancellation, serialized token refresh
  and loopback mappings. The platform supplies the existing Tor SOCKS endpoint
  or provider state directory and an atomic encrypted `Save(Token)` callback;
  an empty token means erase.
  Normal Close preserves saved login; Logout closes all local access before
  revoking/erasing credentials. Transport failures preserve saved credentials;
  an explicitly rejected grant clears them and closes mappings. An occupied
  replacement port leaves the old mapping open.
  Mapping status reports its bound port/carrier error, not host readiness.
  Register the native OAuth client as `taskarian-` plus the bundle ID;
  `client.OAuthClientID` supplies the identical value to both native owners.
  Connection setup, token refresh and service actions follow their native
  owner's cancellation context, without wrapper-imposed elapsed-time cutoffs.
  Cancellation closes pending WebSocket/SSH sockets as well as active streams.
  Tor retains its own circuit handling; Authelia still enforces authorization.
  `LoginPort` supplies a raw TLS route for the protected browser before OAuth;
  `CloseLoginRoute` removes it once the authenticated Agent mapping is ready.
  `CancelOperations` stops access while leaving a provider available for explicit
  OAuth revocation; `Close` also stops its network node.
- `host` and `cmd/taskarian-remote` provide the native host executable. Its sole
  management input is the controller-owned stdin/stdout pipe; the only listener
  is a private Unix socket serving authenticated service-ID carriers. EOF,
  shutdown or process termination closes the owned connections. Active carriers
  recheck Authelia every 15 seconds (5-second check timeout), matching Agent stream
  policy; explicit revoke/service removal closes connections immediately.

The pipe accepts JSON objects with `id`, `method`, `params` and returns that `id`
with `result` or `error`. Operations are `hash-password`, `enrollment-keys`,
`encrypt`, `decrypt`, `oauth-registration`, `start`, `service-set`,
`service-remove`, `revoke`, `transport-start`, `transport-status`,
`transport-stop`, `shutdown`. Key and encryption inputs/outputs are
private controller data, never logs, argv or web responses. Start takes `socket`,
`auth_socket`, `onion`, `key`; service-set takes `id`, `network`, `address`.
The host uses the separate Bearer-only Authelia `/login/api/authz/tunnel` endpoint.
`oauth-registration` takes `client_id` and `onion` and returns the matching
public-client configuration; it does not register clients remotely.
The controller must configure that endpoint and reconcile its owned processes;
the helper neither starts external daemons nor removes existing sockets.

`transport-start` takes `{kind,dir,host,target,initialize}` for Tailcat or
Tailscale. `target` is the numeric loopback Caddy TLS address. Start initiates
work without waiting for a provider account login; status returns
`{kind,state,address?,login_url?,error?}`. Upstream `tsnet.Start` owns initial
Tailscale login and saved-profile reconnection; observing status never forces
interactive login, and its initial `NoState` is reported as `starting`.
`initialize` is permitted only during new setup or
reissue: ordinary restart rejects missing provider identity state. Tailcat
persists its native private key, PSK and chosen relay; Tailscale owns its native
state file. A Tailcat address contains its WireGuard PSK and must remain private
enrollment material. Client-facing transport status omits addresses entirely.
`decrypt` takes exactly one of encrypted PNG `image` (base64 JSON bytes) or `text`,
plus `password`, returning private enrollment only on the controller pipe.

TK3 retains `owner`, `id`, `name`, `root_ca`, `certificate`, `private_key` and
`fingerprint`. It requires `host: "<48-hex-id>.taskarian.invalid"` and
`transport: {kind,address}`; it forbids the TK2 `onion` and `tor_private` fields.
Cloudflare addresses are exact HTTPS `*.trycloudflare.com` roots, Tailcat
addresses must contain the complete upstream keys/PSK, and Tailscale addresses
are numeric tailnet IPs on port 443. The private TLS hostname is never resolved
through public DNS. Envelope and payload versions must agree. All versions use
the existing gzip, pristine age scrypt, full-document validation and QR quiet zone.

`mobile` is the native Java binding. It accepts private enrollment bytes,
the existing Tor SOCKS endpoint and an encrypted `TokenStore` callback.
`OpenProfile` additionally takes the private per-enrollment provider state path;
the original `Open` remains available for Tor, Cloudflare and Tailcat. Its
PKCS#8 enrollment output belongs only to the privileged Gecko call, never web
content or Android KeyChain. Build it with `auth/build/remote-android.sh`; the
separate Android build module pins pristine Go mobile tools and dependencies.
It provides no HTTP server, shell/host management or replacement Tor owner.
Run network/encryption calls on the native app's existing background executor;
token persistence must complete synchronously before its callback returns.

The desktop `--client` pipe accepts `profileDirectory` on `open`; `login-route`
returns the same authenticated SOCKS credential shape as `agent-route` before
OAuth. `agent-route` replaces and closes the login route. `transport-status`
exposes native Tailscale setup and its official login URL without Authelia tokens.

6 November source checks compiled Linux host/client and both Android client ABI
boundaries with Go 1.27.3 and pristine dependencies. An external protocol harness
verified real Tailcat relay traffic with exact private CA/mTLS, TK2/TK3 encrypted
PNG roundtrips, wrong-password rejection, persistent provider identity and
cancellation. An isolated embedded Tailscale check verified a pending genuine
account-login URL and cancellation of its listener/node and blocked client dial.
These checks do not establish installed browser, Android JNI, human Tailscale
sign-in or complete Authelia/Chisel user-flow acceptance; record those separately.
