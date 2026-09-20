# BashKitten on Pi / Termux

This branch contains a browser frontend and a Node adapter for unmodified Pi RPC
processes. The old Rust implementation, build files, packages, differential
fixtures and porting scripts are removed from the current tree. Git history and
the separate [bashkitten-rust repository](https://github.com/openresearchtools/bashkitten-rust)
retain the original Rust implementation and its complete main-branch history.
Pi is pinned to npm `@earendil-works/pi-coding-agent@0.86.1`, upstream commit
`13cbf77df2396303013a41646bcfa77b4271ae56` (tag v0.86.1). The lockfile pins its
runtime dependencies. Pi owns inference, tools, compaction, session JSONL, and
credentials. The existing HTML/CSS transcript remains the presentation layer.

Intentional differences from the historical Rust branch: Node runtime; Pi-native
providers and authentication; Pi-native session tree files with separate UI
metadata; a private detached RPC worker per session instead of systemd; server
filesystem browsing, uploads, individual downloads, and streaming ZIP downloads.
The web server can restart without interrupting detached session workers. Pi
restores the working folder from its native session header before loading project
settings, extensions and tools. Choose a folder before starting a new chat;
existing chats retain their saved folder. No Pi internals are patched.
RPC launches leave tool selection to Pi's defaults, native settings and extensions.
Normal `pi install` packages and global/project resources use Pi's own loader.
Termux supplies `ripgrep` and `fd`; no Linux binaries are downloaded on Android.

## Transport and UI contract

Browser → web server uses same-origin authenticated HTTP. Live output uses SSE.
The server proxies each SSE connection to the worker's private Unix socket. A
subscription starts with one atomic snapshot: native active-branch entries, the
current in-memory work trace, usage and pending queues. Subsequent events are
ordered Pi events translated to the original renderer's vocabulary. Reconnect
rebuilds the view from that snapshot, rather than joining independently fetched
history and a live stream. Settled native entries replace the transient trace so
Copy/Fork use real Pi entry IDs. The full native active branch is currently loaded
on connect; very large histories are a future pagination optimization.

Pi owns its steering/follow-up queues. To edit/promote/remove a browser queue row,
the worker uses `clear_queue` then requeues only the messages Pi actually returned.
It retains image payloads and attachment references outside Pi's string-only queue
notifications. A message already consumed at a turn boundary is never replayed.
An edit temporarily holds the selected message in the worker; Cancel returns it to
Pi. A worker crash loses unconsumed in-memory queues, as native RPC does.

The header and file browser use Pi's saved working folder. BashKitten reads native
history through Pi's parser into an in-memory view; it never opens a second
writable session manager. Fork uses the stock `fork` RPC
command on that live Pi process, including extension hooks and cancellation.
It forks before the selected user message and returns Pi's text to the editor.
The worker follows the new native session; Pi alone decides when to save it.
BashKitten never writes or reconstructs Pi JSONL. New sessions use Pi's normal
session directory; existing sessions resume by their recorded native file path.
Saved model/thinking settings are restored by Pi, without cached UI overrides.
Explicit choices in the UI use native model/thinking commands.

Extension commands go through native `prompt` RPC. Their dialogs use Pi's
extension UI sub-protocol, and model lists for running chats come from
`get_available_models`, including extension-provided models. TUI-only extension
widgets have the limitations documented by upstream RPC; BashKitten does not
replace Pi's extension runtime.

## Files and authentication

All browse/upload/download/ZIP routes require the web account. State changes check
Origin and a per-login CSRF token. Cookies are HttpOnly/SameSite=Strict; only hashes
of session and CSRF tokens are persisted. Local web passwords use Argon2id. Login
cookies survive web restarts. Files/directories in app storage use 0600/0700.

Repository navigation resolves real paths within the selected root. Upload names
must be single filenames and are created exclusively (`wx`), never overwritten.
Multipart uploads are capped at 32 MiB per request. ZIP creation streams from the
backend, includes hidden files and `.git`, preserves safe relative symlinks, and
omits symlinks escaping the root. Opening repository HTML/SVG returns a sandboxed
Content-Security-Policy so uploaded scripts cannot act as the authenticated app.

Upload controls are ordinary browser `<input type="file" multiple>` elements. The
browser owns the file picker and delegates to the operating system as usual. The
custom expandable tree browses files on the **Termux server**, not the client's
storage. Open/download links and Content-Disposition delegate handling to the
browser. Chat image paste uses browser ClipboardEvent files, not Termux:API.
Clipboard files are read with FileReader and sent as bounded base64 form fields;
the server validates/decodes those bytes and passes ordinary native images to Pi.
An unreadable clipboard item times out with the draft preserved instead of
leaving the send control disabled indefinitely. File-picker uploads stay multipart.
The working-folder picker is rooted at the current Termux user's home (`~`).
It offers only readable, writable, searchable directories under that home and
does not expose system parents, shared storage, or symlinks outside home. The
header and folder input show `~/project` instead of Android's internal app path.
This uses Termux's own unrooted app permissions; Android storage permission is
unnecessary for standard browser uploads and downloads.

Pi RPC has no login command. Provider login uses Pi's public `ModelRuntime.login`
with its own prompts and notifications alongside the RPC processes. An OAuth
button synchronously opens a browser tab (avoiding popup blocking). That tab
presents any native method selection and automatically navigates to Pi's
authorization URL. Pi owns the loopback listener, OAuth state/PKCE checks, token
exchange, refresh and native auth.json. The Android browser and Termux share the
same loopback network: no root, custom Android intent, terminal input, proxy
callback or changes to Pi are required. Services refreshes on return to the app.
Pi's optional manual-code fallback is collapsed in Services. Device-code providers
show the native verification code/link and poll using Pi's implementation.
Keys/tokens are never included in service status. Cancellation aborts Pi's flow.
Background model refresh is disabled. RPC launches use `--offline`/`PI_TELEMETRY=0`.

Services also registers Pi's bundled llama.cpp provider, using its unmodified
factory and native URL/optional-key prompts. Login and **Refresh models** contact
only that configured HTTP service through Pi's model refresh API. Cached models
remain available during offline startup. This is the same connection on Linux
and Termux; the llama.cpp router runs wherever the user hosts it. Pi lists loaded
models and eligible autoload presets. Its `/llama` management screen is currently
TUI-only upstream. See [Pi's llama.cpp guide](https://github.com/earendil-works/pi/blob/v0.86.1/packages/coding-agent/docs/llama-cpp.md).

Upstream references at the pinned release:
[RPC protocol](https://github.com/earendil-works/pi/blob/v0.86.1/packages/coding-agent/docs/rpc.md),
[native login API](https://github.com/earendil-works/pi/blob/v0.86.1/packages/coding-agent/src/core/model-runtime.ts),
[browser callback implementation](https://github.com/earendil-works/pi/blob/v0.86.1/packages/ai/src/auth/oauth/openai-codex.ts).

## Native boundaries

- Pi RPC does not stream compaction summary tokens. The existing compaction style
  shows progress and then the native completed summary, with no invented deltas.
- Pi has no built-in BashKitten goal loop. Goal commands are native Pi extension
  commands if installed; the old harness goal UI is removed.
- Existing custom providers are loaded from Pi's models.json; the old llama.cpp
  process manager and custom OpenAI credential store are not used.
- The app does not launch a model request to generate titles.
- Android lifecycle policy can terminate Termux even though a browser disconnect
  or web-server restart does not terminate the worker.
- Imported native sessions should have only one active owner. The app does not
  attach to a separately running terminal Pi process.
