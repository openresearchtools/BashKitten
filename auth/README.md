# Native access stack

BashKitten builds the original Authelia, Caddy, Tor, Valkey and Chisel sources recorded in
`upstreams.lock.json`. Their licenses and notices remain in each source tree.
These private server executables are included in the Linux and Termux packages.
Termux recipes and patches are separate; they never replace the pristine source.

`build/authelia.sh`, `build/caddy.sh`, `build/tor.sh`, `build/valkey.sh` and
`build/chisel.sh` take a target
(`linux-amd64`, `linux-arm64` or `termux-aarch64`) and a staging directory.
GitHub Actions produces the binaries, dependency notices and matching source.
The staged `bin/`, `share/` and any `lib/` directories install below the Agent
package's `auth/`; the server uses `BASHKITTEN_AUTH_BIN` only as an explicit
override of that private binary directory.

Chisel 1.12.0 is built without source patches. Caddy is pinned to 2.11.7;
its older imported Termux recipe remains pristine, with the version override
in our separate recipe. The complete age 1.3.2 source is pinned for the remote
connection bundle integration; it is not a separate installed CLI.

`build/remote.sh` builds the small shared adapter under `agent/native/remote/`
as private `bashkitten-remote` for Linux and Termux. It is assembled and licensed
with this payload. The existing controller owns its private pipes and process;
it does not replace Chisel with a second transport or expose a management port.
The APK client is built separately with host code excluded. Native Share Local,
browser callbacks and the new remote lifecycle are still being integrated.

The private `valkey-server` stores Authelia's sessions so remembered logins
survive full service restarts. It listens only on the controller's private Unix
socket and is owned by the same service group. It does not install a system
Redis/Valkey service or run in the Android APK.

Build/configuration patterns retain attribution to
[Torkitten](https://github.com/openresearchtools/torkitten), Apache-2.0.
Runtime authentication and lifecycle integration are in `agent/src/server/access/`.
