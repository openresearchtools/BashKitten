# Android Agent login and background work

This describes the implementation after the 6 October 2026 main-thread fixes.
It is a source-level description. Fresh APK compilation and manual acceptance
of the combined changes are still required.

## Remote sign-in

1. **Connections** scans or opens the encrypted connection QR.
   `AgentRemotesActivity.ImportState` reads/decodes the image and calls native
   TK2 decryption on workers. The password decrypts the QR only; it is not sent
   to a hidden first-factor endpoint or retained as an Authelia password.
2. `AgentRuntime.importRemote` validates the native enrollment and saves the
   encrypted catalogue and pinned identity through its serial storage worker.
   Existing enrollments are not silently replaced when their identity differs.
3. `TorManager` starts/bootstrap-checks Tor and installs the enrolled onion key
   on its worker. `RemoteAgentConnection` opens the native client, reads its
   encrypted refresh token and attempts authorization on its own executor.
4. When sign-in is needed, the native client creates the authorization request.
   `AgentRuntime.remoteLogin` configures the enrollment's protected GeckoSession
   and loads the real Authelia page. Username/password, Remember Me, TOTP and
   consent belong to that page. Gecko owns its genuine cookies in that remote's
   protected storage context; there is no custom login web engine.
5. Gecko intercepts the pending exact OAuth `form_post` callback before network
   access. It checks the protected current document, browsing context, source
   principal and top-level POST. The upload is copied by Gecko's stream worker
   into memory, without synchronously seeking/reading the original stream.
   Agent cancel/disconnect/reconfiguration/destruction cancels that copy. Its
   completion rechecks the pending owner and exact current document, then validates
   complete body length and ASCII form encoding. Android then checks the selected
   session, live connection and pending callback. Native completion validates
   issuer, state and PKCE and exchanges the code on the connection worker.
6. The native client maps the reserved Agent service. The existing route switches
   to the tunnel on the worker; main only updates state and loads the Agent view.
   Ordinary service links use their own browser contexts and native localhost
   mappings. Agent/login/QR views are excluded from browser automation.

Remote-only use does not need Termux. Account-free Local uses the separate
permission-checked Termux bridge and native session; it is not a remote fallback.

## UI and worker ownership

| Operation | Where blocking work runs | What main does |
| --- | --- | --- |
| Saved remotes, mapping choices and certificate identity | `AgentRuntime.storage` | Render results or storage errors; discard stale operation callbacks |
| OAuth/token exchange, Chisel and service requests | `RemoteAgentConnection.io` / native client | Select views, show login/progress/results/errors |
| OAuth POST upload body | Gecko `NetUtil.asyncCopy` stream worker | Cancel the callback channel immediately, validate context before/after copying, pass the validated form to native |
| Disconnect/replacement | Remote close worker | Revoke the route immediately; socket drain precedes native port release |
| Tor startup/control and shutdown | TorManager and TorService workers | Receive success/failure, update affected views |
| Share Local setup, password hashing, TOTP, reissue, publishing, host services | Termux's native backend via `RUN_COMMAND` and result PendingIntent | Collect input, show progress/errors; no process or network wait |
| Display command/status/start/stop and Pi imports | Same asynchronous Termux bridge | Local-only controls and command editing |
| QR image display/export | Image/export workers | Attach the decoded bitmap or display the error |
| Browser screenshots/download grants | Existing file workers | Capture through Gecko and recheck access/tab before returning a result |
| File-transfer revocation | Metadata revoked immediately; socket/file cleanup on workers | Never wait for filesystem or socket shutdown |
| Cross-app browser results | Existing worker pool | Never call a potentially blocked external Binder callback on main |
| Installed-app access list | Package-list worker | Display the completed list, guarded against destroyed/stale views |
| Offline licenses | Gecko resource loading | Show content or its load error without opening the asset on main |

Opening the already-selected live remote returns to its existing view without
restarting login. Closing/switching does not wait for Tor, native TLS shutdown
or credential writes. Route monitors protect metadata only; they do not cover
SOCKS handshakes, stream copies or socket closure. Host commands have their existing
asynchronous result timeout/error path. A failure must not become a direct-network
retry or an account-free remote connection.

Android has no separate native LocalAI runtime configuration panel. Host-provided
llama services are managed/mapped in Connections; optional Pi import goes through
the local bridge. Microphone approval is native Android/Gecko, while recording and
transcription remain the existing Agent/Whisper flow.

## Verification still required

The six Java files changed in this follow-up pass parse with JDK 17 and pass
whitespace checks. This is not Java/Android type compilation or runtime testing.
The Gecko OAuth module also passes JavaScript syntax checking. Its ordinary
`onDataAvailable` reads remain synchronous as required by `nsIStreamListener`:
the supplied chunk is already available without blocking and must be consumed
before returning. Those reads do not seek or wait for the rest of an upload.
No app restart, ADB, instrumented API or scripted product test was used.

After building and updating through the published nightly, manually exercise QR
import, real Authelia password/TOTP/consent, remembered login and callbacks; open
ordinary tabs while login is pending, then disconnect/reopen. Also check Share
Local setup/reissue and service failures, Display, localhost mapping/Pi import,
screenshots/downloads with access revoked while work is pending, Agent access and
offline licenses. Confirm browser navigation stays responsive and the relevant
panel shows failures. None of these combined-build manual checks is claimed here.
