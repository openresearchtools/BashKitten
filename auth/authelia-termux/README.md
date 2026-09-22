# Authelia on Termux

This builds the checked-in Authelia source with the pinned Termux Go toolchain
and Android NDK compiler, `GOOS=android`, ARM64, CGO and PIE. SQLite remains the
upstream `go-sqlite3` implementation compiled for Bionic. The ordinary Authelia
frontend is built from its frozen pnpm lock and embedded before cross-compilation.
No authentication behavior or upstream source is patched.

The recipe uses Termux's Go toolchain adaptations (resolver, Android netlink,
pidfd and futex compatibility), recorded in `../upstreams.lock.json`. Native
ELF load segments must support both 4 KB and 16 KB pages. CLI execution,
SQLite/TOTP, hashing and real browser login are checked using the resulting
artifact on Termux; a successful cross-compile alone does not prove those flows.
