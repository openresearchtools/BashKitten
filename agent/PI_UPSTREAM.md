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

The bundled browser integration also installs unmodified pillama 0.2.1 production
sources at `e37e76a2d4b3c8f9e5287d003d50eddc4b5a7e7f`; its MIT license and
provenance are in `pi/vendor/pillama/`. It uses native Pi extension status RPC
for llama.cpp loading, prefill/cache, decode speeds and elapsed time.
