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
- `host` and `cmd/bashkitten-remote` provide the native host executable. Its sole
  management input is the controller-owned stdin/stdout pipe; the only listener
  is a private Unix socket serving authenticated service-ID carriers. EOF,
  shutdown or process termination closes the owned connections. Active carriers
  recheck Authelia every 15 seconds (5-second check timeout), matching Agent stream
  policy; explicit revoke/service removal closes connections immediately.

The pipe accepts JSON objects with `id`, `method`, `params` and returns that `id`
with `result` or `error`. Operations are `keygen`, `encrypt`, `start`, `service-set`,
`service-remove`, `revoke`, `shutdown`. Key and encryption inputs/outputs are
private controller data, never logs, argv or web responses. Start takes `socket`,
`auth_socket`, `onion`, `key`; service-set takes `id`, `network`, `address`.
The host uses the separate Bearer-only Authelia `/login/api/authz/tunnel` endpoint.
The controller must configure that endpoint and reconcile its owned processes;
the helper neither starts daemons nor removes existing sockets.

This is integration source, not a completed remote feature. APK JNI entry points,
private controller wiring, complete logout/refresh lifecycle,
protected browser login and UI integration are still pending. Compilation does
not establish working Tor, authentication, camera import or device acceptance.
