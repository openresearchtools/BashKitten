# Native Pi runtime pin

This branch runs unmodified Pi rather than porting its behavior:

- Repository: https://github.com/earendil-works/pi
- Release: `v1.0.2`
- Commit: `cd32f7725fdbddbaecdff5b1e68491563394e0ca`
- Packages: `@earendil-works/pi-coding-agent@1.0.2`, `@earendil-works/pi-ai@1.0.2`
- Full transitive dependency resolution and tarball integrity: `package-lock.json`
- License: MIT (see `reference/PI-LICENSE`)

The RPC documentation and public types shipped with that release are the adapter's
specification. Inference runs through the CLI's RPC mode. Provider setup uses its
public `ModelRuntime`; session forks and clones use its native RPC commands.
History is read through Pi's native parser without writing session files. No Pi
files or dependencies are patched. Built-in startup network operations are disabled
with Pi's supported offline/telemetry flags.

Only this native runtime pin applies to this branch. The old Rust port and its
differential fixtures are available in Git history, outside the current tree.

The complete unmodified pillama 0.4.0 source tree at
`fefa5a90c5f5f6eead52e9de9a3a698d2ea48f67` is in `pi/vendor/pillama/`, including
its MIT license, dependency lock and build metadata. Exact tree/archive provenance
is in `pi/vendor/pillama.upstream.json`. Packaging selects its declared runtime
files from this tree; no pillama fetch or development/test payload is required.
It uses native Pi extension status RPC
for llama.cpp loading, prefill/cache, decode speeds and elapsed time.

Pillama can opt into native llama.cpp response replay with `/pillama-resume on 3`.
It retains raw SSE byte offsets and the original generation ID across connection
loss, trying the configured number of recoveries before stock Pi may retry a new
request. It preserves Pi's native provider/parser and uses the same endpoint and
authentication. `/pillama-resume off` disables it; the default is off. Settings
live in BashKitten's private Pi profile, not the standalone Pi directory.
