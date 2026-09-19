# Native Pi runtime pin

This branch runs unmodified Pi rather than porting its behavior:

- Repository: https://github.com/earendil-works/pi
- Release: `v0.85.1`
- Commit: `d981de1229ef899957bbe968bc8dcda02a21f477`
- Packages: `@earendil-works/pi-coding-agent@0.85.1`, `@earendil-works/pi-ai@0.85.1`
- Full transitive dependency resolution and tarball integrity: `package-lock.json`
- License: MIT (see `reference/PI-LICENSE`)

The RPC documentation and public types shipped with that release are the adapter's
specification. Inference runs through the CLI's RPC mode. Provider setup uses its
public `ModelRuntime`; history forking uses its public `SessionManager`. No Pi
files or dependencies are patched. Built-in startup network operations are disabled
with Pi's supported offline/telemetry flags.

Only this native runtime pin applies to this branch. The old Rust port and its
differential fixtures are available in Git history, outside the current tree.
