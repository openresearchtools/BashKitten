# Native access stack

BashKitten builds the original Authelia, Caddy and Tor sources recorded in
`upstreams.lock.json`. Their licenses and notices remain in each source tree.
These private server executables are included in the Linux and Termux packages.
Termux recipes and patches are separate; they never replace the pristine source.

`build/authelia.sh`, `build/caddy.sh` and `build/tor.sh` take a target
(`linux-amd64`, `linux-arm64` or `termux-aarch64`) and a staging directory.
GitHub Actions produces the binaries, dependency notices and matching source.
The staged `bin/`, `share/` and any `lib/` directories install below the Agent
package's `auth/`; the server uses `BASHKITTEN_AUTH_BIN` only as an explicit
override of that private binary directory.

Build/configuration patterns retain attribution to
[Torkitten](https://github.com/openresearchtools/torkitten), Apache-2.0.
Runtime authentication and lifecycle integration are in `agent/src/server/access/`.
