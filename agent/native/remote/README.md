# Native remote core

This small Go module contains the TorKitten v2 service-ID tunnel adapter and
connection image codec. Upstream Chisel, age and QR source trees are referenced
directly under `auth/`; no source patch or runtime source download is used.
`NOTICE` records the donor and adaptations.

- `bundle` encrypts/decrypts the complete version 2 `TK2:` enrollment and encodes
  PNGs with a QR quiet zone. Password/account creation, persistence and Tor
  ownership remain with the existing host/platform controllers.
- `tunnel` maps a reserved loopback listener to an exact enrolled onion through
  the supplied Tor SOCKS endpoint, CA/client certificate and Chisel fingerprint.
  Chisel owns the stream copying and half-close behavior. No HTTP content is
  rewritten and failed application connections are not replayed.
- `bashkitten_client` excludes the host server adapter from Android client builds.
  The host adapter accepts configured service IDs, never remote-provided targets.
  It requires an Authelia authorization callback; it does not issue tokens.
- `oauth` uses upstream Authelia PAR, PKCE/S256, explicit consent, token exchange,
  refresh and revocation. `Begin` supplies the URL for the protected Agent browser
  context. Native navigation must intercept the exact loopback callback before
  loading it, recording it in history or allowing ordinary tabs to handle it.
  `Complete` validates issuer/state and consumes the exchange once; credentials
  go only to the supplied native encrypted-store callback. Authelia's real browser
  cookie stays in that same protected context for Agent/Remember me. The native
  token transport shares the exact enrolled Tor/TLS identity with the tunnel.
- `client` owns one enrollment's login/cancellation, serialized token refresh
  and loopback mappings. The platform supplies the existing Tor SOCKS endpoint
  and an atomic encrypted `Save(Token)` callback; an empty token means erase.
  Normal Close preserves saved login; Logout closes all local access before
  revoking/erasing credentials. Failed rotation closes mappings and cannot retry
  the consumed token. An occupied replacement port leaves the old mapping open.
  Mapping status reports its bound port/carrier error, not host readiness.
  Register the native OAuth client as `bashkitten-` plus the TK2 bundle ID;
  `client.OAuthClientID` supplies the identical value to both native owners.
- `host` and `cmd/bashkitten-remote` provide the native host executable. Its sole
  management input is the controller-owned stdin/stdout pipe; the only listener
  is a private Unix socket serving authenticated service-ID carriers. EOF,
  shutdown or process termination closes the owned connections. Active carriers
  recheck Authelia every 15 seconds (5-second check timeout), matching Agent stream
  policy; explicit revoke/service removal closes connections immediately.

The pipe accepts JSON objects with `id`, `method`, `params` and returns that `id`
with `result` or `error`. Operations are `keygen`, `encrypt`, `oauth-registration`, `start`, `service-set`,
`service-remove`, `revoke`, `shutdown`. Key and encryption inputs/outputs are
private controller data, never logs, argv or web responses. Start takes `socket`,
`auth_socket`, `onion`, `key`; service-set takes `id`, `network`, `address`.
The host uses the separate Bearer-only Authelia `/login/api/authz/tunnel` endpoint.
`oauth-registration` takes `client_id` and `onion` and returns the matching
public-client configuration; it does not register clients remotely.
The controller must configure that endpoint and reconcile its owned processes;
the helper neither starts daemons nor removes existing sockets.

`mobile` is the small native Java binding. It accepts private enrollment bytes,
the existing Tor SOCKS endpoint and an encrypted `TokenStore` callback. Its
PKCS#8 enrollment output belongs only to the privileged Gecko call, never web
content or Android KeyChain. Build it with `auth/build/remote-android.sh`; the
separate Android build module pins pristine Go mobile tools and dependencies.
It provides no HTTP server, shell/host management or replacement Tor owner.
Run network/encryption calls on the native app's existing background executor;
token persistence must complete synchronously before its callback returns.

This is integration source, not a completed remote feature. Native library
compilation/device loading, private controller activation, protected browser login and UI integration are
still pending; client lifecycle source has not passed real authentication and
device acceptance. Compilation does
not establish working Tor, authentication, camera import or device acceptance.
`access/tunnel.mjs` now provides the private pipe adapter through the existing
AccessStack process owner; Share Local has not yet activated it. The auth-native
workflow builds/packages the host alongside the other native components, while
remote-native compiles both host and APK-client source boundaries.
