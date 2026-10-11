# Native Pi runtime pin

This branch runs unmodified Pi rather than porting its behavior:

- Repository: https://github.com/earendil-works/pi
- Release: `v1.1.0`
- Commit: `abe508e1b89912adde45528136c3221eb69acdd7`
- Packages: `@earendil-works/pi-coding-agent@1.1.0`, `@earendil-works/pi-ai@1.1.0`
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
`250d558ded87e6b389456a549adccf7168bbeb45` is in `pi/vendor/pillama/`, including
its MIT license, dependency lock and build metadata. Exact tree/archive provenance
is in `pi/vendor/pillama.upstream.json`. Packaging selects its declared runtime
files from this tree; no pillama fetch or development/test payload is required.
It uses native Pi extension status RPC
for llama.cpp loading, prefill/cache, decode speeds and elapsed time.
The adapter identifies unchanged generated providers by their complete ownership
snapshot so live thinking discovery can replace provisional cold-model metadata;
independently edited provider definitions retain their explicit settings.

Pillama can opt into native llama.cpp response replay with `/pillama-resume on 3`.
It retains raw SSE byte offsets and the original generation ID across connection
loss, trying the configured number of recoveries before stock Pi may retry a new
request. It preserves Pi's native provider/parser and uses the same endpoint and
authentication. `/pillama-resume off` disables it; the default is off. Settings
live in BashKitten's private Pi profile, not the standalone Pi directory.


The 11 October 2026 update uses the official v1.1.0 release commit and registry
integrities. The adapter continues to use stock `get_state`, `get_entries`,
`prompt` with steering, `clear_queue`, `fork`/`clone`, and native session parsing.
Pi's own extension loader aliases SDK imports to the selected runtime; `chats`
therefore reads that runtime's history parser without a second model runtime.
This does not opt into experimental Pi Durable or migrate native JSONL sessions.

The deferred `ask_user` extension returns a pending operational question at once.
Its live worker owns the absolute two-minute deadline, atomic resolution and
existing held-draft/steering delivery. A persisted Stop generation also prevents
an older phone review or question answer from restarting stopped work. Recovery
never blindly resubmits an ambiguous prompt. No Pi files are patched.

ChatGPT subscription status uses only the selected model's supported Pi OAuth
resolution and an account/workspace identity present in that resolved token.
The source-observed usage endpoint is not a stable public API; an auth path that
cannot prove that identity reports unavailable. No Codex process, credential-file
scraping, provider switch, separate token refresh or API-key quota inference is
used. Full donor provenance and MIT notices are in `pi/vendor/pi-codex-usage`.
Source checks are separate from required installed terminal/browser acceptance.
