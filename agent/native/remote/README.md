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

This is integration source, not a completed remote feature. The native helper/
JNI entry points, private controller wiring, continuous authorization lifecycle,
protected browser login and UI integration are still pending. Compilation does
not establish working Tor, authentication, camera import or device acceptance.
