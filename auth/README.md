# Native access stack

BashKitten builds the original Authelia, Caddy, Tor and Valkey sources recorded in
`upstreams.lock.json`. Their licenses and notices remain in each source tree.
These private server executables are included in the Linux and Termux packages.
Termux recipes and patches are separate; they never replace the pristine source.

`build/authelia.sh`, `build/caddy.sh`, `build/tor.sh` and `build/valkey.sh` take a target
(`linux-amd64`, `linux-arm64` or `termux-aarch64`) and a staging directory.
GitHub Actions produces the binaries, dependency notices and matching source.
The staged `bin/`, `share/` and any `lib/` directories install below the Agent
package's `auth/`; the server uses `BASHKITTEN_AUTH_BIN` only as an explicit
override of that private binary directory.

The private `valkey-server` stores Authelia's sessions so remembered logins
survive full service restarts. It listens only on the controller's private Unix
socket and is owned by the same service group. It does not install a system
Redis/Valkey service or run in the Android APK.

Build/configuration patterns retain attribution to
[Torkitten](https://github.com/openresearchtools/torkitten), Apache-2.0.
Runtime authentication and lifecycle integration are in `agent/src/server/access/`.
