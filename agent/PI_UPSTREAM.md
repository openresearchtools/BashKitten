# Native Pi runtime pin

This branch runs unmodified Pi rather than porting its behavior:

- Repository: https://github.com/earendil-works/pi
- Release: `v0.87.1`
- Commit: `f07218c4d4bbc12bef056a7058c3dd49dfe41abe`
- Packages: `@earendil-works/pi-coding-agent@0.87.1`, `@earendil-works/pi-ai@0.87.1`
- Full transitive dependency resolution and tarball integrity: `package-lock.json`
- Pi’s published shrinkwrap omits integrity for five internal packages. The root
  lock records the exact-version npm registry SRI for those entries as well;
  package contents and versions remain unchanged.
- License: MIT (see `reference/PI-LICENSE`)

The RPC documentation and public types shipped with that release are the adapter's
specification. Inference runs through the CLI's RPC mode. Provider setup uses its
public `ModelRuntime`; session forks and clones use its native RPC commands.
History is read through Pi's native parser without writing session files. No Pi
files or dependencies are patched. Built-in startup network operations are disabled
with Pi's supported offline/telemetry flags.

Only this native runtime pin applies to this branch. The old Rust port and its
differential fixtures are available in Git history, outside the current tree.
