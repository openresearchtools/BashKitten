# Native access stack

BashKitten builds the original Authelia, Caddy, Tor, Valkey and Chisel sources recorded in
`upstreams.lock.json`. Their licenses and notices remain in each source tree.
These private server executables are included in the Linux and Termux packages.
Termux recipes and patches are separate; they never replace the pristine source.

`build/authelia.sh`, `build/caddy.sh`, `build/tor.sh`, `build/valkey.sh` and
`build/chisel.sh` take a target
(`linux-amd64`, `linux-arm64`, `termux-aarch64` or `termux-x86_64`) and a staging directory.
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

`mobile/` is the complete pristine Go Android binding source pinned in the lock,
including its BSD license and patent grant. `build/remote-android.sh` builds its
tools from that tree, then creates an ARM64 Java/JNI AAR with NDK r29/API 31.
It does not use `gomobile init`, which would fetch a moving tool version.
The APK bundles the client library and its actual linked notices; Actions and
APK candidates include corresponding Go dependency and generated Java sources.
No upstream Chisel or Go mobile source patch is applied.

The private `valkey-server` stores Authelia's sessions so remembered logins
survive full service restarts. It listens only on the controller's private Unix
socket and is owned by the same service group. It does not install a system
Redis/Valkey service or run in the Android APK.
Termux x86_64 selects Valkey's documented `NO_PROCESSOR_CLOCK` build option,
using `CLOCK_MONOTONIC`. The upstream x86 TSC probe aborts in Bionic's regex
compiler during actual Share Local startup. The recipe verifies the flag in
the emitted `monotonic.c` compiler command; other targets remain unchanged.

The native authentication workflow accepts optional component/target choices
for a focused rebuild. Defaults and reusable workflow calls still build the
complete matrix. Selecting one component uploads only its component archive;
it does not assemble or publish a complete authentication package.

Build/configuration patterns retain attribution to
[Torkitten](https://github.com/openresearchtools/torkitten), Apache-2.0.
Runtime authentication and lifecycle integration are in `agent/src/server/access/`.
