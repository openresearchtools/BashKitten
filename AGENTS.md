# BashKitten · native Pi / Linux and Termux

This branch reuses BashKitten's browser UI with unmodified Pi 0.85.1
(`d981de1229ef899957bbe968bc8dcda02a21f477`). It contains no Rust backend or
agent reimplementation. `PI_UPSTREAM.md` records the runtime pin;
`docs/pi-termux.md` describes the architecture and native boundaries.

BashKitten's own code is GPL-3.0-only. Preserve third-party license notices and
the individual license metadata of dependencies.

## Change tracking

Work directly on `main` unless the user explicitly asks for a branch.
Always stage, commit and push completed changes, including documentation and plans.
Use focused commits for logical changes so features are easy to track, fix and
revert. Run the relevant checks before committing, push to the current branch's
remote, and report the commit IDs and push result.
Stage only files belonging to the task; preserve unrelated work and never commit
credentials, signing keys or personal runtime data.
Read `docs/android-termux-suite-plan.md` in full before implementation and after
compaction. Keep the shared code small; reuse upstream components unmodified
except for the documented Termux integration/build patches.

## Runtime ownership

- Pi owns the agent loop, tools, providers, models, thinking, queues, compaction,
  native session history, credential storage and token refresh.
- Run Pi as a separate RPC process per session. A detached Node worker owns the
  process; closing a browser or restarting the web server must not stop a turn.
- Use Pi's public ModelRuntime for service login because RPC has no login command.
  Open authorization in the Android browser and let Pi receive its own loopback
  callback. Present all required steps in the browser, without terminal sign-in.
- Never modify Pi, port its agent logic, introduce a custom provider credential
  format, or restore the old llama.cpp supervisor or goal loop.
- Ship an exact Pi release and dependency lock. User-requested npm updates
  resolve an exact new runtime from the registry, validate its native API and
  retain its lock before activation. Do not require a custom release manifest.
  Inspect upstream APIs before changing how the adapter interacts with Pi.

## UI and filesystem

- Preserve the existing transcript, thinking/tool streaming, compaction styling,
  image viewer, themes and project/chat sidebar. Adapt layout for narrow screens.
- On Termux, working-folder choices are writable directories inside home only.
  Show `~` and `~/project`, stop parent navigation at home, and omit shared storage
  and inaccessible system folders. Linux additionally allows explicitly chosen
  project roots through its platform adapter.
- Uploads use the browser's ordinary file picker, clipboard and drag/drop. Never
  substitute a custom Android picker or require Android storage permissions.
- Browse repositories on the backend. Open/download files through normal browser
  behavior; build complete repository ZIPs on the backend.
- Retain native queue order, attachments and per-tab edit ownership. Never replay
  consumed messages after queue edits or browser reconnects.

## Local security and verification

Bind to 127.0.0.1. Keep the local web account, Argon2id password hashing,
HttpOnly/SameSite cookies, Origin/CSRF checks, private storage permissions and
filesystem path confinement. Do not expose provider credentials in browser
status, logs or URLs. Disable startup catalog/update traffic and telemetry.

Use Node >=22.19, plus ripgrep and fd. `npm test` exercises real Pi RPC against
local fixtures. Preserve those tests and test relevant UI changes in native
Android browsers with Termux. Real account authorization must be distinguished
from fixture OAuth callbacks in test reports. Do not commit runtime credentials,
node_modules or personal session data.
