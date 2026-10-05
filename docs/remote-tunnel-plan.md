# Remote connections, service tunnels and desktop lifetime

Requested 5 October 2026. **Status: plan, not implemented or accepted.** This
extends the [browser integration plan](browser-integration-plan.md) and replaces
its conflicting remote-export, llama relay and desktop-close requirements.
Local Agent remains account-free. Publishing is supported on Linux and on Android
through its native Termux backend. Android can connect to a remote without
Termux; hosting its own Agent/services requires the local Termux runtime.

Latest clarification, 5 October: all publishing, enrollment, identity and host
permission controls move out of the shared web UI into browser-owned **Share
Local** beside Local/saved remotes. This supersedes the earlier Linux-only
publishing decision. Include the complete pinned pillama source in this product
repository, extending the production-source subset already vendored.

Additional Android requirement, 5 October: add a compact native **Display** button
and panel **only while Local is selected**, with Termux:X11 installation,
an editable XFCE launch command, real display status and Start/Stop/Open X11.
The panel and local Pi use one packaged Termux launcher and the same saved script.
Provide a concise Pi skill for software rendering and verified device-specific
GPU configuration. This supersedes the older blanket removal of X11 controls;
X11 remains optional and remote-only operation still needs no Termux.

Additional desktop requirement, 5 October: native **LocalAI** in the Local Agent
tab owns llama.cpp/Whisper runtime setup, launch commands, router INI editing and
model downloads. Move those controls out of the shared web UI; reuse backend
workers/jobs. Share Local has only a **Share llama.cpp** checkbox for that managed
service. Plan a separate `bashkitten-localai` build/distribution repository for
mainstream llama.cpp and whisper.cpp Linux amd64/arm64 CUDA/Vulkan artifacts,
automatic managed updates, custom-binary opt-out and automatic Pi configuration.
Whisper enables explicit microphone recording, Stop, transcription on the
configured host and normal text submission, with no retained audio or separate
transcript/log store.

Latest usability clarification, 5 October: Display includes a short copyable
prompt naming `termux-display`. LocalAI's **Import this configuration into the
coding agent** checkbox starts checked for new configurations. Remote llama
mapping cards offer **Add to Pi** and the same import choice, applied on **Save
changes**. Pi configuration is conditional on that saved choice, not an automatic
side effect of every runtime start, connection or port change.

The deliverable is working Linux amd64/arm64 packages, the Android APK and matching
Termux package, source and notices, after builds and manual acceptance. Writing
this plan, building a helper or dispatching CI does not complete that deliverable.

### Implementation constraints, 5 October

Implement this plan end to end, feature by feature. Add only the functions,
buttons and options needed for the requested behavior; do not expand the product
scope. Prefer the smallest clear implementation, reuse the existing controllers
and upstream APIs, and remove replaced paths instead of maintaining duplicates.
Do not add fallback implementations or silently substitute another transport,
authentication path, runtime or configuration after failure. Report the actual
failure and preserve the user's saved choice. This instruction supersedes earlier
automatic-fallback wording; explicitly selected CPU/software modes remain valid.
Keep Tor, Caddy, Authelia and Chisel integration thin, preserving upstream
behavior. Build Chisel unchanged first; apply only demonstrated Android build
fixes as minimal staged patches, never speculative portability changes.
Complete the corresponding build and manual checks before claiming a feature
works. Continue through all delivery gates; a partial implementation is not the
completed plan.

Latest execution clarification, 5 October: implement the remaining features in
focused source changes before dispatching another complete application build.
Then build and manually check the full feature set, fixing any failures before
release. Existing in-flight candidates can supply available manual evidence;
they are not feature-complete deliverables. Syntax/source checks during coding
do not replace that final acceptance. Keep the minimal-code/no-fallback rules.

## 1. Required user experience

| Where | Required result |
| --- | --- |
| Fresh Android Agent | The Termux setup page offers **Connect to remote** before any Termux install, command permission or package setup |
| Agent selector | Local, named remotes and Connect to remote remain reachable in every setup/connection state |
| Mobile Agent navigation | Replace the spelled-out **Agent** navigation button with the current BashKitten logo, retaining accessible naming, touch target and behavior |
| Unconfigured Local | Show the short-command setup and **Back to remote**, retaining the previous remote, login and draft |
| Android Local Display | One compact native panel: compatible X11 download if missing, current editable command, actual status, Start/Stop and Open X11; absent in Remote mode |
| Desktop LocalAI | Native Local Agent button; llama.cpp binary/command, router INI and shared model downloader, plus optional Whisper model/device/command setup |
| Share llama.cpp | One native Share Local checkbox exposes the same LocalAI service through the existing authenticated tunnel; no duplicate launcher/configuration |
| Dictation | When the selected Agent has Whisper configured, microphone beside Send records until Stop, transcribes on that host, then submits text to the chat; no saved audio or separate transcript history |
| Share Local | Browser-owned entry beside Local/remotes on Linux/Android; choose username/password, enroll with authenticator app/QR, verify TOTP, then show the downloadable connection QR |
| Remote file-manager permission | Host setup has **Allow remote file manager**, off by default; the server gates Files/Changes browsing, editing, diffs and manager transfers while chat attachments/image previews and Pi tools continue working |
| Connection QR | One image contains all client connection material, encrypted with that same Authelia password; display, click to download, camera scan and image upload work |
| Remote login | Decrypt the QR, verify the server, authenticate with Authelia/TOTP and connect; no separately chosen tunnel password or pasted keys |
| Connected remote | List Agent and every published service, actual host state, local URL/port, Open/Copy, mapping control and host Start/Stop/Reload |
| Android localhost | Services bind an available port automatically or a user-selected port; Termux Pi and ordinary local applications can use them |
| Tor browsing on both platforms | Every network request from a Tor tab uses Tor or is blocked; ordinary unenrolled `.onion` navigation always enters the private Tor context |
| Host services | Linux or native Termux targets/launch commands, configuration, Start/Stop/Reload and Launch on startup; llama.cpp router support where a compatible native runtime is installed |
| Reissue identity | Close old access, replace the remote account and all remote keys, enroll fresh TOTP, issue the new password-encrypted QR |
| Linux lifetime | Close hides to a functioning tray with BashKitten icon; Quit stops owned services and exits; Start on login is configurable |

No SSH service, remote terminal, arbitrary reverse-port forwarding or UDP UI is
included. Retain Chisel's internal SSH transport without adding an SSH server
feature. Published application endpoints are TCP/Unix streams, primarily web
applications and llama.cpp.

### Mobile Agent button branding

Additional requirement, 5 October: on Android, replace the visible **Agent** text
on the navigation button with the existing BashKitten kitten-with-glasses logo.
Apply this consistently beside the address bar, in the leftmost Agent entry on
the tabs screen and wherever the same Agent navigation control is reused. Use
the current product asset, not an old kitten image or a newly generated logo.
Keep the native rounded/circular button treatment and full touch target, with
clear light/dark appearance, focus and selected states. Retain the accessible
name **Agent** and its existing action: restore the protected Agent view without
losing its chat/draft or creating another tab. Keep it available after opening
new tabs and while Local setup or Remote connections are displayed. This is a
required mobile change; desktop logo treatment can follow its native layout.

### Android Local Display and shared Termux launcher

Add **Display** in the native Android Agent tab only when **Local** is selected.
It opens a small native sheet/dialog, not another web settings page. Hide it in
Remote mode, dismiss it on a switch to Remote, and recheck the selection before
dispatching a native action. No remote HTTP/RPC route, tunnel service or remote
file-manager capability grants control of this phone's display. A remotely
hosted Pi does not receive this phone-local skill/launcher through its browser
connection. Stock local Termux shell authority remains unchanged.
Keep the launch script/controller state outside remote file-manager writes too,
including symlink/alias paths; enabling Files must not become a remote command
editor. This does not remove Pi's separately acknowledged same-account shell access.

Keep the panel short: “Run desktop apps in an XFCE desktop using Termux:X11.”
Show one status line, the current launch command in a rounded scrollable code
block with three or four visible lines and Copy/Edit, and the relevant actions:

- Missing Termux: reuse Local setup, with Back; do not pretend X11 alone is enough.
- Missing X11: **Download X11**, then recheck installation on return.
- Ready/stopped: **Start**. Starting/stopping: actual progress, without duplicates.
- Running: **Stop** and **Open X11**. Opening its Android activity does not start
  a second desktop; dismissing that activity does not claim the server stopped.
- Edit: multiline command with **Save / Cancel** and secondary **Restore default**.
  Save does not execute it or stop a running desktop; show “Saved for next start”
  if it differs from the running command. Errors stay beside the action, with
  expandable actual output rather than a terminal/log wall.

Under **Ask your agent**, include this short copyable text block with **Copy prompt**:

```text
Use the termux-display skill to set up XFCE for this device and save a working launch command, using supported GPU acceleration if available.
```

Keep it a few visible lines, separate from the executable launch command, with
brief copy feedback. It copies only the prompt for the user to paste into chat;
it does not submit a chat turn, execute a command or change display settings.

Use native theme, touch targets and keyboard insets. Refresh actual state on
open/resume and action completion; no hidden polling. Closing the sheet leaves
the display running. Changing to Remote only hides these controls, without
killing local GUI work; return to Local to manage it. Whole-Agent Turn off stops
its owned display along with its retained Local group. Do not autostart XFCE on
every chat/app open merely because X11 is installed.

#### Compatible X11 installation

Inspect `com.termux.x11` with normal PackageManager visibility and the installed
Termux signer/source. Use the existing browser download/system installer flow.
Prefer the same trusted distribution where it actually publishes a compatible
X11 APK. Installer identity alone is not proof of a signing match. Preserve
installed apps/data and report an incompatible update without uninstalling them.

Checked upstream on 5 October at
[`0e1ebb4c180f4e8e7a14a80f7cd0db8301791b6d`](https://github.com/termux/termux-x11/tree/0e1ebb4c180f4e8e7a14a80f7cd0db8301791b6d):
the [official nightly](https://github.com/termux/termux-x11/releases/tag/nightly)
publishes standalone `termux-x11-universal-debug.apk` and
`termux-x11-universal-sharedUid-debug.apk`. The latter requires the GitHub Termux
signer; do not offer it for F-Droid/other signers. Prefer it for compatible GitHub
Termux as requested. For F-Droid, use a verified matching distribution if one is
available; otherwise offer the official standalone APK with a brief explanation,
not a fabricated F-Droid link or a forced Termux replacement. Recheck current
upstream assets/compatibility at implementation. The two variants currently have
different Android target SDKs; verify installation on the supported stock Android
version. An OS rejection must remain visible and allow a compatible standalone
option, never an ADB/root workaround. Shared UID also shares Termux's authority;
it is not a separate per-agent permission.

The companion `termux-x11-nightly` package and XFCE run in Termux. Add the former
to the native Termux package dependency/bootstrap path, retain the existing
`x11-repo`, `xfce4` and D-Bus dependencies, and ensure Mesa's software renderer
is available through its current native packages. Reuse package jobs/locks and the initial
APT upgrade; no duplicate installer or extra command payload in the APK. The
external X11 APK is optional for visible display, not required for Local chat,
headless Xvfb or remote connections. Do not restore the old suite/store UI.

#### One command used by the user, native UI and Pi

Package **`$PREFIX/bin/bashkitten-display`**, on ordinary Termux `PATH`, as a thin
entry to the existing private controller/process guard. Store its editable script
at **`$BASHKITTEN_DATA_DIR/display/launch.sh`**, resolving the existing default to
`~/.local/share/bashkitten-pi/display/launch.sh`. Expose the actual launcher/script
paths in the Termux Pi environment note and launcher status; resolve them centrally
so a custom data directory cannot leave the panel and agent editing different files.

Planned stable command contract, to document with exact examples in the skill:

```sh
bashkitten-display command                 # read the complete saved launch script
bashkitten-display command --path          # resolve its actual absolute path
bashkitten-display command --set < new.sh   # validate and save from stdin
bashkitten-display command --reset         # restore the packaged default
bashkitten-display status                  # real state, command path and display environment
bashkitten-display start                   # execute the saved script, idempotently
bashkitten-display stop                    # stop this owned display session
```

Native Edit/Save and Pi call this same implementation through the private local
bridge/CLI. Keep one user-owned file, create the default only when absent and
preserve edits on package upgrades. Validate shell syntax without executing it;
save atomically with private permissions and avoid overwriting a concurrent edit.
Start rereads the saved file, so a valid direct user/agent edit also takes effect;
do not cache a second command in Android preferences, Pi prompts or `.bashrc`.
Keep a previous working command for an explicit restore after a failed change.
This is an intentional Termux shell script: run it with Termux's real shell,
not Android `/bin/sh`, command text in an intent, or HTML-generated shell code.

Use the upstream XFCE launch form as the default, adding session-scoped software
rendering and disabling X TCP listening. Illustrative command, to validate with
the packaged versions before activation:

```sh
termux-x11 :1 -nolisten tcp -xstartup \
  'env LIBGL_ALWAYS_SOFTWARE=true dbus-launch --exit-with-session xfce4-session'
```

The software override is BashKitten's choice using
[Mesa's documented variable](https://docs.mesa3d.org/envvars.html);
it is not a claim that upstream prescribes that exact combined command or that
Android's own screen compositor runs on the CPU. Check display-number/socket
conflicts before starting. Never remove a live X lock or silently reuse another
server. Keep current-command/display/readiness distinct from saved-next-command.
Report an independently running Termux:X11/Xvfb server as such; do not claim it
is this managed XFCE session or stop it with a broad `pkill`.

Track the exact owned X server, XFCE session and optional GPU helper processes,
with real startup errors and crash reconciliation. An X11 failure must not stop
Pi/chat or pretend the entire Agent died. Start succeeds only when the requested
display/session is usable; Stop ends only owned GUI processes and reports a
failure truthfully. Return the actual `DISPLAY` and required session environment
through status, so Pi can launch GUI applications on this same display without
restarting Pi or changing global shell settings. Keep separate owned Xvfb for
tasks that explicitly need no visible desktop; update the current environment
note that otherwise tells every agent to start Xvfb unconditionally.

#### Pi skill: display setup and device-specific rendering

Add one concise, self-contained **`agent/pi/skills/termux-display/SKILL.md`**, using
stock Pi discovery for the local Termux runtime, including ordinary terminal Pi.
Do not load it on every turn or fragment it into many reference files. It must
explain XFCE, the stable launcher/read/write/status contract, launching a GUI app
on its reported display, owned cleanup and restoring the default. An agent can
replace the same saved command when helping the user configure their display;
it must not edit the installed skill or generate a competing startup mechanism.

For GPU help, inspect the actual device, Android version/ABI, GPU/driver and native
Termux packages, then consult current primary sources for that combination.
Consider supported Turnip/Zink or VirGL paths only where the installed hardware,
drivers and packages support them; do not infer acceleration from a chipset name
or an emulator result. Explain the proposed change briefly, preserve the working
software command, verify the actual renderer plus a visible GUI application,
and save the working replacement through the same launcher. Keep software as the
usable choice if GPU support is missing or unproven. Do not install arbitrary
driver binaries, root/proot, change developer settings or apply black-screen/
colour workaround flags to every device. Record the actual skill token count.

Include these primary-source links and explain what each is for: the
[Termux:X11 setup/usage guide](https://github.com/termux/termux-x11#setup-instructions)
and [nightly APKs](https://github.com/termux/termux-x11/releases/tag/nightly),
[Termux package recipes](https://github.com/termux/termux-packages),
[Mesa/native drivers](https://github.com/termux/termux-packages/tree/master/packages/mesa),
[VirGL Android](https://github.com/termux/termux-packages/tree/master/packages/virglrenderer-android)
and [Mesa rendering variables](https://docs.mesa3d.org/envvars.html).
Recipe presence is not proof that a GPU path works on the user's device. Keep
download/signing and renderer advice current at implementation, with normal
upstream attribution and source/notices for any code actually redistributed.

## 2. Sources and verified starting points

Use **TorKitten `torkitten-v2` at
`2fd0f48358aa37e6c23336cd550f52ab00bbe7e3`**, not v1/main. Inspected references:
[README](https://github.com/openresearchtools/torkitten/blob/2fd0f48358aa37e6c23336cd550f52ab00bbe7e3/README.md),
[identity/QR](https://github.com/openresearchtools/torkitten/blob/2fd0f48358aa37e6c23336cd550f52ab00bbe7e3/internal/app/identity.go),
[client mappings](https://github.com/openresearchtools/torkitten/blob/2fd0f48358aa37e6c23336cd550f52ab00bbe7e3/internal/app/client.go),
[tunnel](https://github.com/openresearchtools/torkitten/tree/2fd0f48358aa37e6c23336cd550f52ab00bbe7e3/internal/tunnel),
[OAuth](https://github.com/openresearchtools/torkitten/tree/2fd0f48358aa37e6c23336cd550f52ab00bbe7e3/internal/oauth)
and [service commands](https://github.com/openresearchtools/torkitten/blob/2fd0f48358aa37e6c23336cd550f52ab00bbe7e3/internal/app/managed.go).

| Component | Checked release / source | Action |
| --- | --- | --- |
| Chisel | [v1.12.0](https://github.com/jpillora/chisel/releases/tag/v1.12.0), `fe4f4fe7e6a849b4aa6d1b8ee47037e16033f42a` | Import full pristine source at `auth/chisel`; retain upstream wire, SSH, backpressure and half-close behavior |
| Caddy | [v2.11.7](https://github.com/caddyserver/caddy/releases/tag/v2.11.7), `72dd0fb067f6d7826c7f79907670ba4a713bfe37` | Update current 2.11.4 source and rebuild shipped targets |
| Authelia | [v4.39.28](https://github.com/authelia/authelia/releases/tag/v4.39.28), `8da42b2348b0351c6284a2940a9c5eec3d4cd3fd` | Already pinned to the checked latest release; keep native account/TOTP/OAuth validation |
| age | [v1.3.2](https://github.com/FiloSottile/age/releases/tag/v1.3.2), `b74dce4cdbe35b5e5f66c06d9612b72f89028758` | Reuse v2's pristine scrypt-recipient implementation and full source |
| QR | Donor's pinned barcode/gozxing, existing Android ZXing | Keep format/validation; reuse camera/file controls and avoid duplicate codecs per platform |
| Tor | Existing 0.4.9.12 pin/platform adapters | Keep native client/publisher separation; recheck supported security release before final build |

Recheck official stable releases at implementation, record exact commits, source
hashes and dependency locks, and build from those trees. Never resolve moving
branches during a release. Full corresponding source and notices include retained
Go dependencies. A release/version check is not runtime verification.

Adapt these donor differences deliberately:

- V2 generates its account and uses a separate QR password. BashKitten uses the
  chosen username/password and the **same password for the QR**, with no second
  account database or password verifier.
- V2 disables Remember me and locks profiles after restart. Preserve BashKitten's
  requested remembered login through native protected storage and Authelia's
  real session/refresh lifecycle, not repeated password prompts.
- V2 explicitly has incomplete Android packaging/device proof. Its mobile
  facade is a reference, not evidence that our Android flow already works.
- Donor host commands use systemd user units on Linux. Termux hosting uses the
  existing native controller/guard and owned process groups instead; no systemd,
  root or proot. The APK's client library must not acquire host-only dependencies
  or `/usr/bin/openssl`/`ssh-keygen` assumptions.
- Keep real protocol validation. Do not import unrelated SSH UI, arbitrary
  service-count quotas, another application shell or a new supervisor framework.

## 3. Transport and security boundaries

```text
Android / Linux client                       Linux / Android-Termux host

ordinary client: Pi, browser, curl
  -> 127.0.0.1:<actual local service port>
  -> native Chisel carrier
  -> native Tor -> authorized onion:443 ---------> Caddy TLS + device mTLS
                                                   -> Authelia carrier auth
                                                   -> private Chisel backend
                                                   -> approved host loopback
                                                      TCP or Unix service
```

Native service discovery, login/OAuth and service actions use the same enrolled
Tor/TLS identity. They form the authenticated control path needed to establish
a tunnel, not an unauthenticated application fallback.

Caddy terminates **outer** TLS and forwards an authenticated WebSocket carrier.
Chisel carries **inner** TCP bytes without parsing/replacing application HTTP
headers, bodies, bearer tokens, SSE or WebSockets. Authelia authorizes the carrier;
it does not process the inner llama.cpp response. Each accepted local connection
gets its own carrier, as in v2. Preserve upstream backpressure, half-close and
cancellation; no response buffering, invented stream deadline or POST replay.

Mandatory boundaries:

- Tor v3 client authorization, exact onion/TLS identity, enrolled client
  certificate, full Chisel fingerprint and valid Authelia authorization.
  No clearnet retry, arbitrary CA acceptance or account-free Local fallback.
- The publishing host runs Caddy/Authelia/Tor/Chisel: Linux native binaries on
  desktop or native Android/Bionic binaries in Termux on a phone. An Android
  remote-only client still uses the APK's Tor/client core without Termux or
  authentication daemons. Do not merge these separate hosting/client roles.
- The private tunnel backend independently verifies Authelia authorization,
  following v2. A remote supplies only a configured service ID, never a new dial
  address, Unix socket, command or arbitrary reverse-forwarding destination.
- Caddy admin, Authelia storage/admin, host setup and controller IPC remain
  private. Preserve Origin/CSRF validation and strip untrusted identity/forwarded
  headers. Never treat a Tor connection as Local because it arrives on loopback.
- Use Authelia's token validation/refresh/revocation. Logout, revoked enrollment,
  reset and failed/expired authorization close affected active carriers and
  handshakes, not merely future connections. No parallel token issuer/store.
- Keep remote-generation keys separate from Local's native session/trust keys.

### Protected Agent versus ordinary service pages

Keep the protected Agent view and per-remote storage context. Reserve an Agent
service backed by the existing **remote-authenticated** HTTPS entry, never the
native Local bypass. Route its application traffic through the native tunnel
while preserving the enrolled origin, TLS checks and protected browser context.
Extend the existing scoped `TorGateway`/desktop remote-channel integration; do
not turn Agent into an ordinary localhost tab or expose its native bridge.

One Authelia login must serve the protected Agent session and native tunnel
authorization. Integrate supported authorization-code/PKCE with the protected
sign-in context and genuine Authelia session. Do not manufacture a login cookie,
expose refresh tokens to page JavaScript, or ask for another password/TOTP just
to open Agent. Prove this integration early before replacing remote login.

Ordinary service links open ordinary controllable tabs. Agent/login/QR/password
views remain excluded from browser automation. Service HTML gets no native
controller, tunnel keys or Authelia credentials. Different localhost ports do
not isolate cookies: use separate browser storage contexts for service tabs.
A web app may need its own base URL/origin configured for localhost; present
that real configuration requirement rather than silently rewriting its stream.

### Strict Tor tabs and ordinary onion links

Additional requirement, 5 October: **Tor routing belongs to the tab's browsing
context, not just to destinations ending in `.onion`.** On Android and Linux,
every network request initiated by a Tor tab must use Tor or fail closed. This
includes the document, HTTP/HTTPS assets on ordinary public domains, scripts,
styles, images, fonts, media, frames, fetch/XHR, SSE, WebSockets, downloads,
redirects and worker requests where supported. Keep normal TLS verification,
mixed-content restrictions and other browser security checks; Tor routing does
not make otherwise blocked content safe to load.

Carry the private Tor context across navigations, redirects, new-tab links,
popups, downloads and process changes. An onion page redirecting to an ordinary
HTTPS site stays on Tor. Resolve destination names through Tor, including public
asset hosts; no system DNS, direct DoH, speculative DNS/preconnect or auxiliary
page-triggered lookup may reveal those destinations outside Tor. Prevent direct
socket paths such as WebRTC/STUN or unsupported UDP/QUIC/WebTransport from
bypassing the proxy: use a supported Tor transport or block that capability in
the Tor context. A starting, stopped or failed Tor client produces a clear
waiting/error state; it never retries directly or inherits a system proxy's
direct/localhost bypass rules.

An ordinary `.onion` address with no imported connection/client key is normal
Tor browsing, not an Agent enrollment attempt. Typed/pasted URLs, clicked links,
OS URL opens, redirects and automation-created ordinary tabs must select the
**private Tor tab/context before making the onion request**. Preserve the
single-window product design; “private” here does not require another desktop
window. Do not ask users to import a key for a public onion site, attach a saved
Agent identity/session, or fall back to a normal/direct tab when a site is
unavailable or actually requires client authorization. Tor tabs keep private
storage isolated from ordinary browsing and protected Agent connections.

The native authenticated tunnel path remains distinct. A registered service
exposed at `127.0.0.1:<mapped-port>` is already the local end of the enrolled
Chisel-over-Tor connection; Pi and the native client must use that local socket
without sending it through Tor again. Service links deliberately opened from
the connected-remote UI use their scoped service context, not an ordinary Tor
tab. This exception is selected by trusted native connection/context ownership,
never by a blanket `localhost`/`127.*` URL exemption. An arbitrary Tor page
cannot gain direct loopback/LAN access or the native API exception by requesting
such a URL. Enforce this in native network routing on both platforms, not only
in address-bar navigation or JavaScript fetch helpers.

## 4. Browser-owned Share Local and encrypted image

Add **Share Local** to the native Local/remote selector on Android and Linux.
It always configures **this device's Local node**, even when a remote Agent is
currently selected. Keep the title short, and identify the device inside the
panel. This opens a compact browser-owned page with Back, not a server-rendered
settings page. First-time controls are username/password, authenticator setup,
the file-manager checkbox and the final connection image. Once configured, show
publishing On/Off, connection QR/download, service configuration and Reissue
identity; keep secondary details collapsible.

Remove publishing/account creation, QR/key export, identity reset, file-manager
permission and host service command/exposure editing from `agent/src/web` and
from remotely callable HTTP/RPC management routes, including legacy `/api/control`
proxies. Hiding buttons while retaining an authorized remote management endpoint
does not satisfy this requirement. Backend operations remain behind the private
native controller: Linux's protected local IPC and Android's permission-checked
Termux bridge. No arbitrary webpage or protected Agent document gets that host
administration capability; selecting Local or supplying a loopback/Origin/header
does not grant it. Authentication UI may use Authelia's real APIs, but cannot
change host policy. Browser automation must not inspect or operate these controls.
Keep publisher policy, identities/keys and controller sockets outside remote
file-manager exposure even when that feature is allowed, including canonical
path/symlink/archive access. Otherwise editing the permission file itself would
bypass the native-only administration boundary. This does not restrict ordinary
chat attachments/image previews or Pi's separately acknowledged OS authority.

Remote clients retain the explicitly allowed Start/Stop/Reload actions for
already-published service IDs and their own localhost mappings in the native
connected-remote screen. They cannot change the service command/target, enable
file-manager access, export host enrollment material or republish/reissue the
host through those actions. Stock Pi's same-account OS/shell authority remains
separate; native UI placement is not an OS sandbox for that execution environment.

1. **Share Local → Turn on** opens first-time account setup: username, password and
   confirmation. Use Authelia's own Argon2 hashing and TOTP storage. Validate the
   password against both account and QR requirements before creating anything;
   retain v2's encryption work factor and check real mobile decrypt performance.
   Include the unchecked **Allow remote file manager** option described below;
   its authority is stored/enforced on the host, not in the imported QR or client.
2. Generate the remote generation directory, onion identity/client grant, private
   server CA, client certificate/key, Chisel host key, OAuth registration/signing
   material and session secrets. No extra user key fields.
3. Offer **Open authenticator** where supported and display Authelia's
   authenticator QR, then verify a real TOTP through Authelia.
   This **authenticator QR** is distinct from the final **Connection QR**.
   Application access/publication remains closed until verification succeeds.
4. Encrypt the complete connection bundle with that same chosen password.
   Display the Connection QR in the native Share Local panel with
   **Download QR image**;
   clicking the image downloads the same PNG. Preserve the encrypted image for
   redisplay after restart; plaintext connection JSON is not the normal export.
5. Show actual publishing/address/service state. Publishing Off closes remote
   ingress/carriers; subsequent On retains the account/identity without enrolling
   again. Local remains usable without an account and does not switch to Tor.

On Android, Share Local checks local Termux/package readiness and reuses the
ordinary one-command setup if needed, with Back to return to the current remote.
It then drives the host setup through the native Termux bridge. Existing native
Caddy/Authelia builds are reused; add the native Termux Chisel host build from
the same pristine source as the APK client. Keep client Tor and publisher Tor
as separate owned instances/data directories. A remote-only client does not
install or start the Termux host stack.

Android publishing uses the existing foreground runtime, Termux/browser wake
handling and ordinary battery-permission flow. Closing/hiding the browser UI
does not deliberately stop the Termux publisher; Publishing Off and whole-Agent
Turn off do. An OS kill or network outage must show truthful status and recover
through the controller without duplicate processes, changed identity or weaker
authentication. A normal restart retains the host identity; Termux uninstall
removes its host data and requires fresh local setup/QR enrollment, while saved
connections to other hosts remain intact. Never silently republish with missing
account, TOTP, file-manager policy or identity records.

Reuse the actual v2 sequence: versioned bundle -> gzip -> pristine age scrypt
encryption -> base64 QR text -> PNG. Retain the `TK2:` envelope and field meanings
where compatible; document/version any necessary extension. Verify complete QR
capacity and camera readability; never truncate keys or silently substitute an
unencrypted export when encoding fails.

Inside the encrypted bundle: onion address, Tor **client authorization private
key**, public server CA, enrolled **client** certificate/private key, Chisel
server **public fingerprint**, owner name and bundle identity/version. Never
include the server's onion private key, CA private key, Chisel private key,
Authelia password/hash, TOTP seed or live OAuth tokens. Reissuing the Chisel key
means generating it on the host and exporting its new verification fingerprint.

Keep the setup password only in the pending operation; clear temporary plaintext
where supported. Save the encrypted PNG, not a plaintext password for regenerating
it. Cancellation/expiry clears pending sensitive state and stays unpublished.
Changing credentials must also replace the encrypted export; use full Reissue
identity for that action in this release, avoiding a stale image encrypted with
a password the UI describes as replaced.

One reusable image follows v2's shared enrollment model: multiple clients importing
it share that bundle's grant. Do not label those copies individually revocable
hardware identities. Full reissue invalidates every copy; their actual Authelia
client sessions still have their own token lifecycle.

## 5. Client onboarding and Local/Remote switching

1. **Connect to remote** offers **Scan QR** and **Upload QR image** through normal
   camera permission/file selection. Decode locally; never navigate the QR as a
   URL or upload it to another server. Camera denial leaves image upload working;
   leaving/cancelling capture stops the camera.
2. Ask for **Password** beside import. Decrypt and validate the whole bundle
   before updating saved state. Wrong password/damaged image gets visible local
   feedback without overwriting a working connection.
3. Verify Tor and TLS/mTLS before sending login credentials; validate the imported
   fingerprint and verify it at the authenticated Chisel handshake. Use the owner
   name and reuse the entered password in memory for the actual Authelia first
   factor during this one flow. Request a current authenticator code and present
   the required OAuth consent. Decryption alone is not authentication.
4. Save enrollment and refresh/session state using Android Keystore-protected
   storage or desktop NSS. No secrets in URLs, logs, clipboard, page storage or
   status responses. Remembered login survives normal app/process/package
   restarts while Authelia permits it; explicit logout/revocation still works.
5. Show Agent and the service list, including Connecting, Ready, Offline,
   Sign-in required and actual errors. Preserve drafts and per-server login.

Android Remote and Local setup are separate state transitions. Remote must not
launch Termux, request RUN_COMMAND, install packages or ask for Termux's battery
exemption. Unconfigured Local shows its normal short-command setup plus Back to
remote. Cancelling restores the last remote. Termux removal/reinstall affects
Local only; preserve dynamic-port discovery and native Local trust recovery.

### Optional remote file manager: server-enforced permission

Additional requirement, 5 October: the publishing device's browser-owned **Share
Local** setup/settings include **Allow remote file manager**, **off by default**. Only
the host-local trusted setup/control path can change it. A remote client cannot
enable it through its own settings, QR fields, cached capability response,
Authelia login alone or a generic remote control request. Apply it to every
remote client of this published host. Keep the existing native Local file access
separate; never classify a tunneled request as Local because its source is
loopback or it supplied a trusted-looking header.

When enabled, Android and Linux remote clients get the existing Termux-style
**Files / Changes** sidecar operating on the host's filesystem: directory
navigation, file preview/open, text editing/saving, Git status/diffs, upload,
download, ZIP export and existing copy/create/delete actions. Use the existing
UI and server operations; implement any missing editor/save path behind the
same permission instead of assuming current file previews already allow edits.
Retain filesystem scope/OS permissions, path and symlink confinement, deletion
confirmation, atomic saves and edit-conflict handling. Remote paths refer to the
host, never the phone or desktop client's filesystem.

Enforce one deny-by-default file-manager capability in the server's trusted
remote request context, checked before manager file lookup, directory enumeration,
Git invocation, manager upload parsing/staging or manager job creation. The UI
consumes that capability to show sidebar controls, but hiding UI is not enforcement.
Missing, false,
invalid, unreadable or legacy permission state means **denied**, including after
upgrade/restart; errors never enable a fallback. Return a consistent permission
error to authenticated denied clients without leaking file existence/content.
Authorization remains mandatory even for previously issued URLs or known job IDs.

Inventory and guard every file-manager entry point and shared operation, including:

- `/api/folders`, `/api/files`, file content/edit/write endpoints and all methods,
  including HEAD/range downloads, archives and copy/delete/create operations.
- `/api/files/jobs` creation, listing/status and result downloads; job ownership
  and permission are checked on every access, not just when the job starts.
- `/api/git/changes` and `/api/git/diff`, file metadata, previews and alternate
  exports that could disclose the same filesystem information.
- File-manager previews and alternate manager exports. Keep these distinct from
  the authorized chat's attachment/image operations; sharing a low-level file
  streaming helper must not make all chat file access depend on this checkbox.
- Legacy/compatibility routes and the tunneled Agent entry. Use the same server
  authorization through every transport; no direct-backend/Local fallback or
  helper that retries a denied request under a more privileged identity.

Turning the option off must durably revoke manager access before reporting success:
reject new manager operations, close active remote manager file streams, cancel
owned manager jobs/transfers and prevent pending manager writes from committing
after revocation. Do not cancel chat uploads/downloads, image previews or Pi work.
Leave already committed files intact; clean temporary upload/archive material
safely. Serialize permission changes with write commits to avoid a check/use race.
Notify connected clients to close/clear the file sidebar and its previews/diffs;
do not clear images or attachments from chat. Stale manager UI cannot authorize
another manager read/write. Manager responses use private/no-store handling, and
revocation invalidates manager URLs/cached capabilities. Previously downloaded
bytes cannot be erased from another device. Local and chat jobs are unaffected.

Re-enabling requires an explicit host choice and refreshes available controls;
do not replay cancelled uploads/edits automatically. Ordinary restarts retain an
explicit saved choice. New/reissued remote identities start with the checkbox
off until the owner explicitly enables it in setup. QR possession never grants
this permission independently of the host's current policy.

**Chat file uploads, attachment downloads,
image previews and Pi's own file/shell tools remain available with the checkbox
off**. This is permission for the file manager itself, not a general remote file
ban or an OS sandbox. Preserve existing chat authentication, session ownership,
artifact/path confinement and native Pi behavior. Chat endpoints operate on that
authorized session's attachments and referenced images/artifacts, not arbitrary
client-supplied file paths or directory listings masquerading as chat requests.
Keep this operation distinction server-owned, never a client-supplied bypass flag.
Do not automatically retry a denied file-manager operation through chat, Pi or
another service. Independently published applications retain their own policies.

## 6. Host services and client localhost mappings

Move host service configuration into the native Share Local panel, reusing one
saved host catalogue and a separate client mapping record per remote/service.
Remove the old web settings implementation rather than maintaining two editors.
For desktop llama.cpp, the later LocalAI requirement below specializes this:
LocalAI owns its binary/command/router/models; Share Local only controls whether
that same service is published. Other service definitions remain in Share Local.

| Host field | Meaning |
| --- | --- |
| Stable ID and name | Authenticated catalogue/tunnel allowlist identifier and display label |
| Available remotely | Whether clients can discover/map the service |
| Target | Explicit numeric loopback TCP address/port or approved Unix stream socket |
| Web URL details | Scheme and optional opening path, used for links without rewriting traffic |
| Launch command / working directory | Owner-configured executable and arguments; model/config file paths go to that program |
| Launch on startup | Start when the host runtime starts; off by default for newly added services |

Reuse v2's systemd **user** units for Linux commands, with product-owned stable
unit IDs and upstream group cleanup. Reuse existing BashKitten identities where
possible; do not add component fingerprinting. No root service is needed. Keep
arguments/quoting intact; no implicit shell expansion. Owners needing shell syntax
can explicitly configure `/bin/sh -lc ...`. Configuration files remain on the
host, without a custom model registry or command rewriting.

For Termux hosts, reuse the existing BashKitten controller and native process
guard for equivalent owned-process-group start/stop/reload and startup choices.
Use Termux paths and native Android/Bionic executables; do not run Linux/glibc
binaries, systemd or `/bin/sh` assumptions on Android. Explicit shell commands
use the host platform's real shell. Track exact process identities and stop only
owned services; do not kill unrelated Termux jobs. Expose actual support/errors
for user commands and llama.cpp runtimes instead of offering Linux-only package
or GPU controls on a phone. An external loopback service can still be published
without pretending that BashKitten owns its process.

Start is idempotent; Stop stops the owned unit. **Reload** restarts it with the
current command/configuration, matching v2, and indicates that active streams
will end. Report process state, target reachability and real control errors
separately. An external target without an owned launch command can be mapped but
must not present fake Start/Stop controls for an unrelated process.

Host commands are configured on the host. Remote actions accept only an
authorized service ID plus a supported action. Removing/disabling a service
closes its carriers and removes its catalogue entry. Changing command/target
closes old access before applying the new configuration. Keep actual logs and
errors available with secrets redacted.

### Connected remote screen on Android and Linux

Every published service, including stopped ones, has one card containing:

- Name, actual host Running/Stopped/Starting/Failed state and reachability.
- **Start on host / Stop on host / Reload on host**, with progress/error in the
  same card and only actions that the host really supports.
- **Local access** on/off and **Port: Automatic / chosen number**.
- Actual local URL, for example `http://127.0.0.1:43127/`, with Open/Copy;
  llama.cpp additionally shows its `/v1` API URL.
- For llama.cpp/compatible inference services, **Add to Pi** opens that mapping's
  settings and checks **Import this configuration into the coding agent**. A new
  remote mapping starts unchecked until the user chooses it. **Save changes**
  applies the selected import along with the port/mapping settings; the quick
  action does not write Pi configuration before Save. Keep this inline and compact.

Import targets **this device's local Pi** and its real localhost mapping, never
the remote server's Pi or another device's loopback address. Use native local IPC
or the permission-checked Termux bridge. If local Pi is not set up, show that beside
the import option; remote connection/mapping still works without installing Termux.
Do not offer Pi import for ordinary web services. Persist the choice per enrolled
remote/service, preserving unrelated local/custom provider configuration.

After login, restore enabled mappings. On first connection, default offered
service mappings to automatic ports so the list provides usable addresses;
mapping does not silently start a stopped host process. Local access Off closes
only this device's port. Stop on host affects the service for all clients.

Bind directly to `127.0.0.1:0` for an automatic port and keep the returned listener;
no scan or probe-then-rebind race. For a selected port, report conflict/permission
denial and retain an existing working mapping. Never attach to an unknown process
on that port. Remember the user's choice. Automatic mode may use a new port after
restart and must show the actual value. Keep mappings distinct across remotes.

**Selecting Local chat must not disconnect enabled remote service mappings:**
local Termux Pi -> mapped remote llama.cpp is an explicit supported use case.
Changing the displayed Agent does not itself revoke other service connections.
Show connected status per remote. Disconnect closes that remote's mappings;
Agent Turn off closes all owned client mappings and stops any adopted local
group. Forget also erases that remote's credentials. These client actions do
not silently stop the remote host.
Browser-control authority remains tied to the selected/authorized remote Agent.

The Android APK owns listeners through its native core/foreground runtime and
native Tor. They work without Termux and remain usable with Termux foregrounded.
Reuse wake/notification/battery handling; release resources on Turn off and
reconcile actual state after an OS kill. Wake locks do not guarantee process
survival. Installing Termux later lets Pi use the displayed endpoint without
installing Chisel there or moving tunnel credentials into Termux.

Loopback mappings intentionally permit ordinary local applications to connect;
loopback is not Android-package or desktop-process authentication. Do not expose
the privileged controller on these service ports. Preserve application-native
authentication if the owner enables it; no mandatory extra token or HTTP rewrite.

## 7. Native desktop LocalAI and llama.cpp router passthrough

Treat llama.cpp as one managed service configured in native desktop **LocalAI**.
Use its selected `llama-server` and upstream `--models-preset <file>` router INI,
with an explicit loopback host/port. Verify against the selected runtime version.
Preserve model/config files, existing download jobs and real readiness/errors.
Do not introduce another llama supervisor or modify Pi's agent loop. Android's
native Termux host can still publish a compatible externally configured service;
Linux runtime downloads are not Android binaries.

### Native desktop LocalAI and sharing

Add a **LocalAI** button in the desktop Agent tab while **Local** is selected.
Open a native browser-owned panel/page with Back, compact sections for llama.cpp,
Whisper and Models, and native file/folder pickers. This is host configuration,
not another settings page served by the Agent web backend. Do not expose these
controls while a remote Agent is selected. Retain chat/provider/model selection
in the shared chat UI; remove its local runtime/downloader settings sections.

The llama.cpp section shows:

- **Managed / Custom binary**, installed version/path, actual CPU/GPU choice and
  runtime update state. Pick a `llama-server` executable or its containing folder;
  if ambiguous, require selection of the actual executable in the same native UI.
- The effective launch command in a compact copyable/editable code block, actual
  loopback URL/port, Start/Stop/Reload, real loading/failure state and Launch on startup.
- **Router INI**: select an existing file, or write/edit its contents in the panel
  and Save/Save as through a native picker. Keep one real file and its path, using
  upstream syntax; preserve comments/unknown supported options and external edits.
  Detect concurrent changes, save atomically and report invalid configuration
  beside the editor. Saving alone does not interrupt running inference; Reload
  explicitly applies it. Never overwrite the selected file with a hidden model
  registry or substitute Pi's JSON for llama.cpp's INI.
- **Models** links to the same downloader in this panel. Selecting downloaded
  GGUFs can create appropriate router entries; preserve split-model/mmproj files
  and use actual upstream model IDs and path semantics.
- **Import this configuration into the coding agent**, checked by default for
  a new configuration and persisted thereafter. **Save changes** applies that
  choice; it is independent of Managed/Custom binary and Share llama.cpp. Users
  keeping their own local or remote provider settings can uncheck it.

Use a working starter command/config and automatic or chosen loopback port.
Persist one command/config record behind the private controller so native UI,
service lifecycle and Pi integration agree. A custom command is deliberate
execution by the host owner; retain arguments/environment/working directory and
do not guess missing credentials from arbitrary shell text. The normal managed
flow supplies its actual endpoint and model list without manual provider setup
when the saved coding-agent import option is enabled.

Under **Share Local**, add only **Share llama.cpp**, off by default, plus status
and a link back to LocalAI if setup is incomplete. This checkbox publishes the
same stable service ID/target; it does not create a second server, command editor,
model downloader or independent runtime choice. A stopped configured service may
remain listed for permitted remote Start/Stop/Reload. Unchecking closes its remote
carriers and removes exposure while keeping local use running. The account/TOTP
and tunnel requirements remain mandatory, and the stream is still unchanged.
Do not automatically publish Whisper when enabling llama.cpp sharing.

### Reuse the backend and apply the selected Pi import

Move the UI and its trusted entry points, retaining existing model-download child
processes, durable jobs, pause/resume/cancel, package jobs and process ownership.
Disk/network work stays out of the browser UI thread. Refactor the existing
`ManagedLlama` into the planned common service lifecycle rather than run both.
Keep model downloads working while the native panel is closed. Preserve existing
models, chosen directories, Hugging Face credentials and partially downloaded files.

Call host configuration through the private native controller. Remove model
download/settings/search management and `llama-configure`/runtime-install routes
from the shared web management API, including `/api/control` forwarding. Preserve
chat `/api/models` and authorized inference/service-ID actions; they are different
operations. LocalAI command/config files and credentials must not be writable
through the remote file manager. Stock Pi keeps its separate OS authority.

Extend the existing `bashkitten-llama` provider integration through stock Pi's
supported configuration, **only when its saved import checkbox is enabled**.
Save changes imports/updates the one owned provider using the actual ready
loopback URL, router model IDs and configured application bearer/key file, if any;
no mandatory extra bearer or
rewriting tunnel traffic. Refresh at an idle boundary without replaying prompts,
changing an existing chat's selected model or overwriting other provider entries.
Retain pillama's native router/progress integration. With import enabled, the user
sees a ready local provider/model after setup without typing a port into Providers.
Apply the same selected import to an enrolled llama service's actual client-local
mapping on Linux/Termux; a remote Pi instead uses its own host endpoint. Selecting Local
keeps enabled remote mappings alive as specified above. Changed/conflicting ports
update only owned settings after confirming the actual service identity/readiness.
Use distinct owned provider entries for Local and each enrolled llama service,
so connecting another remote cannot overwrite the working Local endpoint.

Show import success/failure beside Save, including the provider name and actual
endpoint. If the service/mapping is not ready or Pi must wait for an idle boundary,
show a pending state and complete only while the saved import option remains on;
never claim an unavailable endpoint was imported successfully or silently start
a stopped host just to discover its models. Repeat Save is idempotent. An enabled
saved import keeps its owned endpoint current on verified port/model changes;
unchecking and saving cancels pending import and stops later managed writes.
Unchecked means save runtime/mapping settings only; it does not delete existing
Pi providers. Preserve user-created entries and manual edits even when they have
the same name as a proposed import; report a conflict rather than overwrite them.
Do not change the user's default provider or any current chat's selected model.

The shared downloader currently filters Hugging Face search to GGUF. Extend its
model-type selection to support whisper.cpp's actual supported model files too;
do not label arbitrary Whisper/PyTorch or GGUF files compatible. Keep one download
engine, immutable revision/hash checks, streamed progress and existing job recovery.
Native Models offers file/folder selection as well as downloads, separating llama
router entries from Whisper choices without duplicating downloaded files.

### Managed runtime builds and custom binaries

Create **`openresearchtools/bashkitten-localai`** during implementation as the
runtime build/distribution repository. Copy/adapt only mainstream llama.cpp
workflows and necessary Docker/build inputs from
[`llama-cpp-arm64-builds`](https://github.com/openresearchtools/llama-cpp-arm64-builds/tree/d6e2239e6b96365b6c79391c137c4e1e4df2944c),
checked at `d6e2239e6b96365b6c79391c137c4e1e4df2944c`, and add whisper.cpp builds.
Do not copy the TurboQuant tracker or choose TurboQuant assets. The existing
mainstream tracker checked on 5 October already has upstream llama.cpp **v0.5.0**
(`7fe450e19305b828c199d602c23a8337aaa1f03b`) and successful daily checks; a refresh
is only needed when actual upstream/new build inputs require it, not because its
repository name says arm64. Leave that donor and its unrelated releases intact.

Build both engines for Linux **amd64 and arm64**, each with **CUDA** and
**Vulkan/CPU** variants. Check CPU operation without a GPU/driver; use an explicit
CPU artifact if needed to make that work reliably. Whisper upstream supports
CUDA/Vulkan, but its checked v1.9.4 release/nightly inventory does not supply the
complete requested Linux GPU matrix. Start from
[`v1.9.4`](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.4),
`927cfce34f31707e17f2bff35c349632fb9e2c3a`, or a newer verified official release.
Recheck both upstreams during implementation. Pin exact tags/commits and locks;
no private inference fork, moving branch in a released artifact, or compiler
optimizations that silently exclude supported CPUs.

Give llama and Whisper distinct release/asset names so GitHub's single “latest”
release cannot confuse the engines. Publish checksums, exact source/build records,
required shared libraries, full dependency notices and corresponding sources.
LocalAI exposes the installed runtime's matching offline notices/source record;
an independently updated runtime must not keep an older binary's license inventory.
Keep artifacts downloadable from Actions immediately for manual checks as well
as runtime releases; retain the testing-release notice while required. Product
UI/controller/Pi changes remain in BashKitten. This explicitly requested runtime
builder is separate from the three existing app build-only repositories; do not
move product code or replace their cache/workflow arrangement. Preserve complete
source for what is shipped, without reviving another product-source repository.

Managed installation selects by OS/architecture and compatible ABI/driver, not
filename substring or release recency alone. Probe `nvidia-smi` and the real CUDA
device/driver; select CUDA when the matching binary can initialize it. Otherwise
select Vulkan/CPU and verify the available Vulkan device, falling back visibly
to CPU if none works. Retain an explicit CPU/GPU override. Do not assume that
`nvidia-smi` existing proves the required CUDA runtime libraries are installed,
or download a glibc Linux arm64 build for Termux. Report missing libraries/unsupported
drivers without altering the user's system GPU drivers.

Fetch verified archives into versioned private runtime directories through the
existing job mechanism, checking architecture, checksums, safe extraction and
required libraries before activation. Managed mode checks for newer matching
official builds when LocalAI opens and through the existing update flow; offer
Check now and apply downloaded updates at a safe idle/restart boundary. Never
replace a running inference binary or restart an active turn; retain the last
working version if validation fails. Avoid network checks on every chat render.
This replaces the earlier APT-only llama-runtime selection; preserve existing
external/APT installations and let users select their binary as Custom.

**Custom binary** disables BashKitten's checks/downloads/replacement for that
engine, including queued automatic updates. Keep its selected path and adjoining
libraries in place; validate executability, architecture and required router/server
capabilities without copying over or modifying it. A missing/incompatible custom
binary gets a visible error, not a silent switch to Managed. Re-enabling Managed
is an explicit native choice. Changing llama ownership does not disable Whisper
runtime updates or BashKitten app updates.

### Whisper setup and private dictation

LocalAI's Whisper section has a downloaded/existing model picker using the same
Models view, Auto/GPU/CPU selection, the effective editable server command and
actual setup/runtime state. Launch the owned loopback `whisper-server` and load
its model **on demand**, showing Loading/Transcribing rather than a frozen chat.
It need not occupy GPU memory at browser startup; stop/release it when idle after
the request unless the user explicitly keeps it running. Reuse the current process
owner/worker cancellation and shutdown, not a second daemon manager. CPU remains
available on machines without usable GPU support.

After setup, the Agent backend advertises its configured transcription capability
and the protected chat composer shows a small **microphone** beside Send. Local
desktop chat uses that desktop's Whisper. Linux/Android clients connected to that
Agent can use the same host-side Whisper through the authenticated Agent/tunnel
path, without a Linux executable or Termux on the client phone. Show which host
transcribes in the recording UI. If the selected backend has no configured
Whisper, omit the microphone; never fall back to an unrelated host or cloud speech
service. Keep LocalAI configuration native and Local-only. Remote dictation may
invoke inference, not edit commands/models, enable hosting or use Whisper's model
administration endpoints. Do not publish an unprotected Whisper server port.

An explicit user click obtains ordinary microphone permission and begins capture,
with Recording, elapsed time, **Stop** and **Cancel**. Record until the user stops;
no always-listening or silence-triggered send. Stop releases microphone tracks,
then transcribes on the identified host. On success, send the transcript as a
normal user text message through the existing Pi queue exactly once. Preserve
existing drafts and attachments rather than sending unrelated composer contents.
Cancel, empty/silent audio, errors or a changed chat/remote must not submit text
to an unintended conversation. Bind a recording to its originating chat and
cancel on a destination change; retain a failed submission only as that chat's
normal recoverable text draft, with no automatic retry that could duplicate it.

Audio and intermediate transcript data stay in memory for this operation. Do
not use the existing chat multipart/attachment staging path or durable job body
store for audio: those save files. Convert to a supported PCM/WAV representation
in memory and use a dedicated authenticated, non-persisting inference operation
to call Whisper's in-memory request path. Remote audio crosses only the selected
Agent's authenticated tunnel and stays in memory on that host too. In the inspected
[upstream server](https://github.com/ggml-org/whisper.cpp/blob/927cfce34f31707e17f2bff35c349632fb9e2c3a/examples/server/server.cpp),
`--convert` writes temporary files; keep it off and avoid other output/debug
dump options. Do not forward arbitrary page-selected request flags. Use upstream
no-context behavior between recordings so one dictation does not retain another's
transcript in decoder context.

No recording files, cached blobs, browser storage, separate transcription history,
request/response logs or telemetry. Do not persist Whisper stdout/stderr, debug
dumps or audio in crash reports; report necessary failure state inline without
its content. Disable owned-worker core dumps and clear/release buffers on success,
cancellation or failure. The only retained transcription is the ordinary chat
text/draft and native Pi conversation the user submits. Normal text submission
continues to the selected LLM provider.
Handle real memory/resource exhaustion visibly rather than silently spilling
audio to disk. Validate the selected command against these capture/privacy
requirements before enabling the microphone, including after a custom edit.

### Unmodified llama.cpp streams

The user's launch command/configuration decides whether llama.cpp requires an
API bearer token. Carry the client's Authorization header unchanged; never
insert the Authelia carrier token, replace the llama token, strip `/v1`, parse
and re-emit SSE or buffer the response. Outer credentials never become target
application headers. Apply the same transparent behavior to other services.

Termux Pi/pillama uses the actual phone-local mapped URL through its supported
provider settings. A remote Pi uses the host endpoint instead; localhost refers
to the machine running that Pi. Update only explicitly BashKitten-managed
provider settings when an automatic local port changes.

Upstream documents [resumable streaming](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README-dev.md#resumable-streaming-sse-replay-buffer)
using `X-Conversation-Id`, `GET /v1/stream?conv_id=<id>&from=<byte-offset>`,
lookup and explicit stream deletion, including router/model-child forwarding.
Preserve these headers/paths/queries and response bytes. A broken TCP connection
still requires the capable client to reconnect and ask for native byte-offset
replay. Chisel must not repeat a generation POST or invent a resume protocol.
Do not claim Pi resumes automatically unless its actual provider/pillama client
does so; verify native resume and Pi behavior separately.

Use real models to verify multiple router children, native bearer and token-free
modes, simultaneous streams, interruption and exact replay without gaps/duplicates,
plus expired/unknown stream errors. Compare application bytes, not packet or
HTTP chunk boundaries. Preserve pillama's native progress/cache/speed display.

## 8. Identity reissue and failure recovery

**Reissue identity** is an action in the host browser's Share Local panel with
confirmation that old clients will disconnect. It is not a remote account-takeover
endpoint. Collect the new username/password, then:

1. Persist replacement-in-progress; reject new remote work. Close carriers,
   handshakes, remote Agent/browser-control sessions and ingress. Stop the owned
   remote Tor, Chisel, Authelia/session-store and Caddy, verifying exact ownership.
2. Delete the old remote user/hash/TOTP, OAuth registration/signing/token/session
   state, onion identity/client authorizations, Chisel key, remote CA/client grants
   and encrypted QR. Old downloaded QR images cannot be erased but no longer
   authorize this server. No reachable fallback to the old generation.
3. Generate all new remote material, create the chosen account, require fresh
   TOTP enrollment/verification, and issue a new QR encrypted with the new
   Authelia password. Publish only after readiness/authentication succeeds.
4. On interruption or failure, stay remotely closed and show host setup again.
   A restart must not restore the old identity or publish a partial replacement.
   Persist generation/state transitions atomically and durably.

Separate remote-generation paths from native Local trust before this change.
Stopping shared Caddy can briefly interrupt Local; restart its local listener
with unchanged trust and restore the view automatically. Preserve local Pi chats,
provider logins, projects, models, service definitions and unrelated remotes.
Keep local service applications running unless whole-Agent power/Quit is requested;
their remote carriers are closed throughout reissue. Reconcile owned units after
failure without killing unrelated terminal processes.

Publishing Off/On, app restart, logout, client disconnect and Reissue identity
are distinct actions. Ordinary restart retains identity and remembered login;
retrying a network problem must never silently rotate credentials.

## 9. Linux startup, tray and Quit

Native settings add **Start BashKitten when I log in** and **Keep running in the
tray when the window closes**. Startup is opt-in; close-to-tray is the requested
default where a working tray host exists. Use per-user XDG autostart and the
existing single-instance path, without sudo, another profile/window or a system
boot daemon. Service Launch on startup remains a separate per-service choice.

Use a small native StatusNotifier/AppIndicator integration with the BashKitten
icon. Tray actions: **Open BashKitten**, real Agent/remote status and **Quit**.
Hide/show the existing window so its lifetime guard/adopted runtime stays alive;
do not destroy the final Gecko window and try to revive the stopped backend.
OS URL launches/another invocation reveal the same instance. Autostart can enter
the tray when supported. With no functioning tray host, retain a reachable window
and explain the setting; never hide the only route back to the app.

Quit prevents restarts, closes client mappings/control channels, stops adopted
Pi/backend/auth/Tor/Chisel and product-owned service units, removes the icon and
exits. Preserve data/unrelated daemons and finish active package transactions
safely. Independent CLI servers remain independent until adopted. Browser death
still invokes existing group cleanup; hiding does not. Reopening starts only
enabled startup services without duplicate units. Explicit Stop stays respected
during the current runtime.

## 10. Implementation map and upstream maintenance

| Area | Changes |
| --- | --- |
| `agent/src/server/access/{remote,accounts,stack,paths,hosting}.mjs` | Remote generations, chosen account, QR delivery, Authelia OAuth config, catalogue/actions, Tor/Caddy routes |
| `agent/src/server/control.mjs`, runtime ownership/guard | Remote reset/lifecycle, owned service units, safe Quit and reconciliation |
| `agent/src/server/platform/linux/{llama,llama-provider}.mjs` | Command/config service ownership; remove duplicate HTTP token-injecting relay behavior |
| Desktop native Agent controls, private controller and `agent/src/server/models/` | LocalAI page, runtime/custom binary selection, router INI/pickers and relocated downloader; preserve workers/jobs and automatically configure the owned Pi provider |
| `agent/src/web` composer, protected browser capture, authenticated inference and owned Whisper worker | User-triggered recording, Stop/Cancel, on-demand transcription on the configured Agent host and exactly-once normal text submission; no disk staging, content logs or telemetry |
| New `openresearchtools/bashkitten-localai` workflows | Mainstream llama.cpp and whisper.cpp amd64/arm64 CUDA/Vulkan builds, upstream tracking, independent engine releases, downloadable artifacts, checksums/source/notices; no TurboQuant |
| Existing `agent/src/web` settings and remote HTTP/RPC management | Remove host publishing/account/QR/identity/permission/service-definition controls and routes; retain chat and permitted file-manager operations |
| `agent/src/server/http/server.mjs`, shared `files/` operations/jobs and web Files/Changes UI | Host-owned remote file-manager capability, complete route/transport enforcement, editor parity and live revocation without a privileged fallback |
| Android `AgentPanel.java`, `AgentRuntime.java`, `AgentRemotesActivity.java` and Fenix Agent navigation | Native Share Local through private Termux bridge, remote-first onboarding/back, image import, service actions/mappings, foreground ownership and logo-based navigation |
| Android native Agent panel, package visibility and `TermuxConnection.java` | Local-only Display sheet, compatible X11 detection/download, saved-command editing and private launcher actions; dismiss/deny actions after switching to Remote |
| Termux platform/controller, `agent/packaging/build.py`, Pi integration and environment note | Package `bashkitten-display`, one durable editable launch script, owned display lifecycle/status, X11 companion dependency and local `termux-display` skill; retain headless Xvfb |
| Android `TorManager.java`, `TorGateway.java`, `SecretStore.java` | Reuse native Tor, scoped trust and protected credentials; add native tunnel client without Termux |
| Desktop `components/{agent,tor}` | Native Share Local over protected local IPC, equivalent connection UI, protected Agent transport/storage; replace `LlamaRelay` with common native core |
| Android/desktop native tab and network routing | Private Tor context before onion navigation; Tor-only subresources, DNS, redirects and downloads; block unsupported direct transports; keep native mapped-service routing separately scoped |
| Desktop native GTK/lifetime integration | Tray, hide/reopen, autostart and real Quit |
| `auth`, packaging/workflows/notices | Full source imports, native builds, minimal staged patches, provenance/source/license bundles and four artifacts |
| `auth/chisel-termux/`, native core build and `auth-native.yml` | Native Bionic Termux host executable from the same Chisel source as the APK client; declare dependencies and reuse the pinned Termux toolchain |
| `agent/pi/vendor/pillama`, `agent/PI_UPSTREAM.md`, adapter and packaging notices | Complete pinned pillama source/build metadata in this repository; package the required runtime subset from that local source |

Put one small shared Go integration under `agent/native/remote/`, derived from
v2's inspected tunnel/OAuth/encrypted-bundle code with its Apache attribution.
Build a Linux helper over private existing native/controller channels, an
Android JNI/AAR client library, and a native Termux aarch64 host executable.
All three use the same pinned Chisel/core sources with thin platform adapters.
Compile host-only functionality out of the APK client library; the Termux
executable supplies Android hosting. Reuse platform Tor/credential stores and
the current UI/controller, not the entire donor app or duplicated account
managers on each platform.

Keep Chisel, age and retained QR libraries pristine/pinned. First build the
unmodified client for Android; **zero Chisel source patches is preferable when
sufficient**. Keep only necessary Go/NDK/link/path adaptations in a documented
staged patch series outside upstream trees. A patch failure stops the build.
No custom cryptography, SSH protocol, token issuer, HTTP rewriter or generic
supervisor. Caddy/Authelia remain upstream components with small integration
changes. Do not duplicate Node/Pi behavior in Go or claim this multi-process
stack is one PID. Document exact process ownership and private IPC.

### Complete pillama source in the product repository

The current `agent/pi/vendor/pillama/` contains the unmodified 0.2.1 production
subset at `e37e76a2d4b3c8f9e5287d003d50eddc4b5a7e7f`, plus its MIT notice.
Extend this to the complete source tree of the exact selected upstream revision,
including its package/dependency lock files where supplied and build metadata,
with recorded commit/hash/provenance. Keep upstream files pristine and the small
BashKitten adapter separate. No submodule, runtime Git clone or release-time
fetch from the pillama repository is required to obtain product sources.

Build/package the runtime extension from this checked-in tree on Linux/Termux;
include the full corresponding tree in source releases and accurate notices in
both browser platforms. Upstream development/test files may remain as source
provenance but are not installed or executed as BashKitten product tests. Preserve
native Pi discovery/RPC and telemetry behavior. Audit the release manifests so
every bundled component is traceable to source/build material in this product
repository; no binary-only pillama payload or version label without matching
source. This does not vendor the user's models or unrelated external OS packages.

## 11. Ordered gates, migration and release

| Gate | Work and required proof |
| --- | --- |
| 1. Sources/native boundary | Pin/import complete Chisel/crypto/QR/pillama and donor provenance; update Caddy; build Linux helper, APK client and native Termux host without host-only APK dependencies; verify ABI/licenses/16 KB alignment |
| 2. Host/tunnel | Actual Tor/Caddy/Authelia/Chisel on Linux and Termux, chosen account/TOTP, encrypted image and service mapping; reject invalid identity/auth/target |
| 3. Native setup and one-login UI | Share Local in both browser selectors; remove web management controls/routes; protected Agent/OAuth integration, no-Termux client onboarding, image import, Back to remote and remembered restart |
| 4. Services/localhost/files | Host command/config/startup UI, real remote actions, automatic/chosen ports, concurrent remotes and Local Pi using an enabled remote mapping; host-controlled file-manager permission and complete Files/Changes/edit/transfer enforcement |
| 5. Real applications | Multi-model llama router, bearer/no-bearer, byte-offset replay, pillama status, web application uploads/downloads/cookies/WebSockets; strict Tor-tab routing and ordinary private onion navigation |
| 6. Reset/lifetime | Complete and interrupted identity rotation; old exports/sessions fail; tray/hide/reopen/autostart/Quit and owned-group cleanup |
| 6a. Android Local Display | Compatible X11 installer, visible software-rendered XFCE, one launcher/script shared by native panel and Pi, truthful owned lifecycle and optional device-verified GPU skill |
| 6b. Desktop LocalAI/dictation | Native launcher/INI/downloader, managed/custom runtime and Pi preset, Share llama.cpp toggle, real Whisper CPU/GPU transcription with verified non-persistence and cancellation |
| 7. Delivery | Existing-data migration, four complete app artifacts plus required local-AI runtime matrix, offline notices/source, manual platform acceptance, release/APT/runtime publication with testing warning |

Work directly on main in focused commits and push finished slices. Record actual
evidence per exact candidate commit. Resolve early integration gates before full
Gecko iterations; reuse unchanged component artifacts under existing provenance
rules. Keep the three app builders; the requested `bashkitten-localai` runtime
builder is the sole new repository in this extension. No new fingerprinting scheme.

Preserve Local data, providers, Pi history/runtime, drafts, native permissions and
saved remotes. Never clear app/Termux data to make an upgrade work. Existing hosts
get an explicit migration to the encrypted bundle; no silent account/identity
replacement. Old v1 plaintext exports cannot supply new tunnel credentials:
provide actionable re-enrollment after host migration. Retain only necessary
bounded legacy compatibility, then remove superseded export/HTTP-relay paths;
never negotiate a weaker fallback from the new tunnel flow.

Use the current independent Linux arm64/amd64 and Android build repositories.
Collect artifacts as soon as they upload; each builder keeps manually downloadable
Actions artifacts and publishes no release. Build matching Termux aarch64 with
current Pi/pillama/skills and prior Local recovery fixes. Preserve `com.bashkitten`,
APK signer and increasing version code. Publish four installable artifacts,
checksums, corresponding source/build material and offline Android/Linux notices,
including Chisel, age, QR dependencies and reused TorKitten. BashKitten remains
AGPL-3.0-only; preserve every retained dependency's own license.

## 12. Manual acceptance

Use visible ordinary Cuttlefish UI, Linux browsers, APT and normal package
installers. No ADB/root/hidden permissions or BashKitten-owned scripted product
tests. Source integrity/compiler/artifact checks are necessary but not user-flow
proof. Keep evidence outside product source/artifacts. Record actual Android/VM
configuration and the previously authorized child-process toggle; do not claim
a physical Pixel or untouched default settings. Preserve the running browser/VM
except where an explicit restart case requires otherwise.

| Case | Required evidence |
| --- | --- |
| Fresh Android without Termux | Immediate remote option, image import, actual TOTP login, Agent and mapped service URL; no Termux prompts |
| Native host administration | Share Local beside Local/remotes on Linux/Android; compact account/authenticator/QR flow; remote web UI/direct management requests cannot change publishing, permissions/service definitions, export keys or reset identity; legacy routes, spoofed native markers and manager writes to private host-policy/key files remain denied even with file manager enabled |
| Android host | Ordinary Termux setup then native Share Local; actual phone-hosted Agent and configured web service reached from Linux/another client through Tor/Chisel; remembered restart, screen-off/background, Off/On, OS process recovery and fresh-setup behavior after Termux removal |
| Switching/setup/reinstall | Unconfigured Local has Back to remote; login/draft retained; later normal Termux setup; removal/reinstall does not break saved remotes |
| QR inputs | Real screen-to-camera scan and PNG import on both platforms; wrong password, damaged image and camera denial handled without replacing working state |
| Auth lifecycle | No access before TOTP; actual consent, remembered restart, refresh, expiry/logout/revocation, valid TLS leaf renewal under the same pinned CA, incorrect TLS/mTLS/fingerprint rejection, no repeated login merely to open Agent |
| Service controls | All published stopped/running services listed; real Start/Stop/Reload; mapping Off leaves host application running |
| Local ports | Actual auto/chosen/conflicting ports, two remotes with same service name, retained mapping while using Local, recovery after process death |
| Pi/browser tools | Real Pi turn using phone-local remote llama; browser controls ordinary service tabs but excludes Agent/auth/QR; approved Termux calls run without repeated prompts |
| Web apps | Real navigation/login if app requires it, file upload/download and WebSockets; service contexts receive no Agent cookies or native privileges |
| File manager enabled | Explicit host opt-in exposes remote Files/Changes on Android/Linux; navigate real host subdirectories, edit/save, view Git diffs, upload/download/ZIP and perform existing file actions with normal scope/permission checks |
| File manager denied | Fresh/legacy/missing/invalid permission state rejects manager file/folder/diff/preview/job APIs, stale manager URLs, alternate transports and spoofed Local markers; no manager metadata/content/writes or client self-grant; native Local access remains unchanged |
| Chat files with manager off | Real Pi chat upload, attachment download and image preview still work on Android/Linux; active chat transfers survive manager revocation; chat artifact authorization does not become an arbitrary-path/directory-listing fallback |
| File-manager revocation | Switch off during real manager upload/download/ZIP/edit: manager streams/jobs stop, pending manager writes cannot commit, stale manager clients/links remain denied; restart retains Off and reissue defaults Off; re-enable does not replay cancelled work |
| Tor tab network boundary | On Android/Linux manually browse real onion and public pages in Tor tabs with HTTP/HTTPS assets, frames, requests, redirects, downloads and WebSockets; inspect external network evidence for no direct destination/DNS or WebRTC/UDP escape; stop Tor during loading and confirm failure without direct fallback |
| Onion entry and tunnel exception | Typed/clicked/OS-opened/redirected/automation-opened public onion URLs enter private Tor without import prompts; linked public hosts stay on Tor; native mapped APIs still work locally; Tor-page loopback/LAN requests cannot use the native exception; storage stays separate |
| llama/router | Two actual models, bearer and token-free modes, concurrent streams, pillama status, network interruption and exact native byte-offset replay |
| Access removal | Disconnect/logout/revoke/reset during streaming closes access; old QR/session fails; service removal/target change closes old carriers |
| Identity reset | New user/password/TOTP/onion/client grant/CA/Chisel key; old account removed; interrupted rotation closed; local chats/provider logins/models/service definitions preserved |
| Desktop | Supported X11/Wayland tray and icon; serving while hidden, same-window reopen, actual login autostart and disabled-autostart check, missing-tray fallback, complete Quit cleanup |
| Android UI/lifetime | Screen-off/background runtime, reopen/reconnect, rotation/keyboard for every password/TOTP/port field; input and controls remain visible |
| Mobile Agent logo | Current logo replaces navigation text beside the address bar and in the tabs screen; accessible Agent name, full touch target, light/dark/selected states; new tabs and setup/remote screens retain access and existing chat/draft |
| Display installation/Local boundary | GitHub Termux uses compatible shared-UID X11; F-Droid/other signers use a verified compatible standalone/source option; normal installer acceptance/cancellation/OS rejection and return detection on supported stock Android; Remote mode has no Display button, dismisses an open sheet and cannot dispatch its actions |
| Display operation/layout | Start a real XFCE desktop, Open X11, launch and interact with a GUI app, Stop, repeat Start without duplicates; small light/dark sheet and keyboard-visible editor; activity closure, background/resume, actual crash/status, Agent Off cleanup, independent Xvfb/X11 and occupied display numbers handled correctly |
| Shared display command/skill | User edit, Pi edit and direct saved-script edit all become the next actual launch and appear in the panel; no execution on Save, syntax errors/concurrent changes visible, custom data path and package upgrade preserve the same command; Pi launches a GUI app using reported environment and can restore software default |
| Display prompt | Copy prompt produces the short `termux-display` request exactly, with visible feedback; pasting it into Local chat lets stock Pi discover the skill and use the shared launcher; copying alone performs no chat/display action |
| Display GPU coverage | Skill reads current primary sources for actual device/driver, verifies renderer and visible app before reporting acceleration, owns helper cleanup and restores working software command on failure; emulator-only coverage never establishes physical-device GPU support |
| Native LocalAI migration | Local-only desktop button, binary/folder/model pickers, command and router INI edit/Save as/reload; existing models/jobs/HF credentials preserved; removed web management routes cannot configure runtimes or start downloads; native downloader works with the panel closed |
| LocalAI builds/updates | Mainstream-only llama and Whisper amd64/arm64 CUDA/Vulkan artifacts and source/notices downloadable; real compatible CUDA, Vulkan and CPU runs, missing-driver/ABI errors, safe idle update/failed-update recovery, no interruption of active inference; Custom preserves the selected executable/libraries and stops that engine's update checks/replacements |
| LocalAI sharing/Pi | One Share llama.cpp checkbox exposes the same service; Off closes remote access while Local still runs; two router models selected in real Pi with automatic actual endpoint/IDs, no manual provider entry; remote mapping remains usable from Local Termux Pi and custom provider settings are preserved |
| Pi import choice | New LocalAI configuration defaults checked; unchecked Save leaves Pi untouched, checked Save imports once without changing selected/default model; remote Add to Pi selects import but writes only on Save using this client's actual localhost endpoint; pending/error/conflict status is truthful, opt-out stops later writes, no-Termux remote mode remains usable and multiple/custom providers survive |
| Whisper model/runtime | Same downloader retrieves a compatible Whisper model, existing model picker works, actual on-demand load/inference on CPU and available GPU, truthful failures, cancellation and owned worker/model cleanup |
| Microphone privacy/flow | Real spoken recording from local desktop and authenticated Android/Linux remote clients until Stop; Cancel, permission denial, silence, startup/transcription/send failure and chat switch; identified transcription host, preserved draft/attachments, exactly one text turn, no third-party speech service; manually inspect client/host filesystem, browser storage and process output after success/error/cancel/restart for no recording, separate transcript or content log remnants |
| Upgrade/licenses | Signed APK/APT updates retain state; accurate full notices/source available offline before backend/login on Android/Linux |
| Pillama source/package | Complete pinned upstream tree present in this repo/source archive; installed extension comes from it, MIT/provenance retained, actual Pi RPC telemetry works without fetching another product repository |

Record results on all target platforms before release. Missing runtime coverage
remains missing, never inferred from compilation. Fix observed failures, rebuild
affected components and repeat the affected real flow. Do not publish an earlier
candidate as if it contains these features. Every release retains the README's
testing-warning SVG and explicit testing-only/not-ready-for-production text.

Prior work is not silently complete: candidate
`919f94522b2c08154a15981f421e62b59bf0fa09` predates this architecture. Its Android
Local re-enrollment/clean-Termux-reinstall and fully authenticated remote checks
remain unfinished. Include browser-skill package-lookup fix
`9bebe11479c8d530268df0ffe1ddf8e6cf226832` and finish those regressions as part of
the eventual release, rather than losing them during migration.

## 13. Implementation evidence, 5 October

The full plan remains incomplete. These records identify finished source/build
slices and their limits; they do not replace the manual acceptance table.

- `b9c922ee01`: recorded the requested scope/minimal-code/no-fallback constraints
  before implementation.
- `b1a42ff038`: complete pillama 0.2.1 source, lock and build metadata imported;
  source tree matches upstream `7c17c7208812828bf007b576b62b9ceb17b34632`.
  Packaging reads its declared runtime files and leaves upstream development/tests
  in source releases only. Installed-package/Pi acceptance remains pending.
- `4088b4f8dd`: pristine Chisel 1.12.0 and age 1.3.2 imported, Caddy updated to
  2.11.7, with exact archive hashes and source-tree matches. Native access-stack
  [run 37257679830](https://github.com/openresearchtools/BashKitten/actions/runs/37257679830)
  passed Linux amd64/arm64 and Termux aarch64 builds, assembly and notices.
  Downloaded Chisel uses `/system/bin/linker64` and 16 KB ELF load alignment.
  **No Chisel source patches.** Device/tunnel operation remains pending.
- `af56d0cbbb`: complete pinned barcode/gozxing source imported and verified
  against the donor's exact upstream source trees.
- `fa945a089e`: shared tunnel adapter and `TK2:` age/gzip/encrypted QR codec,
  with host adapter excluded from the Android client build. Native core
  [run 37258757560](https://github.com/openresearchtools/BashKitten/actions/runs/37258757560)
  compiled Linux amd64/arm64 and Android arm64 client packages. This is library
  compilation, not a JNI/APK integration or authentication acceptance result.
- `0f5bdf12c8`: Android navigation uses the existing kitten logo; Local setup
  offers Connect to remote and remembers the previous remote for Back to remote.
  [APK candidate run 37258390184](https://github.com/openresearchtools/BashKitten/actions/runs/37258390184)
  succeeded. Its signed APK was installed through the ordinary Android Package
  Installer in the existing Cuttlefish guest without clearing data. Opening it
  restored Local chat without the earlier saved-certificate-change error or an
  account prompt after the prior fresh Termux setup. The logo is visible beside
  the address bar, at the left of the tabs tray and after New tab; returning to
  Agent preserved the exact unsent draft. Provider/model turns, no-Termux remote
  setup, keyboard and full lifecycle acceptance remain pending. This candidate
  does not contain the new tunnel architecture.
- `362db52356`: private native host executable, controller-pipe commands,
  service-ID Unix listener and active-carrier authorization rechecks. Native
  [run 37259995050](https://github.com/openresearchtools/BashKitten/actions/runs/37259995050)
  built Linux amd64/arm64 and Termux aarch64 executables with complete linked
  notices/source, plus the Android client source boundary. No public host
  management port or Chisel source patch was added.
- `87df811a2b`: shared Authelia PAR/PKCE browser authorization, token exchange,
  refresh/revocation and an onion-confined Tor/TLS HTTP transport. The intended
  native navigation callback preserves the protected Agent's real browser cookie;
  browser callback and client-certificate wiring are still pending. Native
  [run 37260351793](https://github.com/openresearchtools/BashKitten/actions/runs/37260351793)
  passed all executable/client builds. Downloaded Termux payload/source hashes
  match; its helper uses `/system/bin/linker64`, AArch64 PIE and 0x4000 LOAD
  alignment, and includes TorKitten and linked dependency license texts.
- `c2fac8fca9`: added the helper to normal auth/package/source/license assembly
  and supplied its private pipe adapter through the existing AccessStack process
  owner. Native source compilation
  [run 37260611280](https://github.com/openresearchtools/BashKitten/actions/runs/37260611280)
  passed. Full auth assembly
  [run 37260611311](https://github.com/openresearchtools/BashKitten/actions/runs/37260611311)
  passed all Linux amd64/arm64 and Termux aarch64 component, runtime-guard and
  assembly jobs. Share Local has not activated the new helper; old remote
  management removal and migration remain pending, not silently complete.
- `d4d21f23d3`: Gecko has a parent-only enrollment API for the remote client certificate
  and PKCS#8 key, scoped to the exact onion:443 and protected Agent origin
  attributes, including its first-party network partition. The normal TLS
  verifier still runs before selection. Keys stay in memory, use NSS session
  objects for signing and are wiped when cleared; no persistent key/certificate
  import or ordinary picker decision is created. Clearing/changing the enrolled
  CA clears the credential and closes TLS connections. The existing socket-process
  signing bridge carries public certificate objects only and rejects removed
  credentials. Ordinary remembered/automatic certificate selection excludes
  these identities. Gecko's own IDL compiler accepts the API declarations;
  the first Linux arm64 build caught a hidden NSS allocation-function name,
  corrected by explicitly qualifying the NSS call. Browser compilation, native
  platform enrollment wiring and real TLS/login acceptance remain pending.
  This is not an authenticated client release.
- `8199a6a7e6`: shared native `client` source owns per-enrollment login/cancellation,
  serialized refresh, remembered-token persistence callbacks and service mappings.
  Normal Close preserves saved credentials; explicit Logout closes local access
  before revoking and clearing them. Token rotation erases the saved old token
  before exchange, preventing replay after a failed request or process death.
  A failed replacement-port bind preserves the working mapping. Native
  [run 37264273374](https://github.com/openresearchtools/BashKitten/actions/runs/37264273374)
  compiled Linux amd64/arm64 and the Android arm64 client source boundary.
  This has not yet been wired to native platform storage/UI or accepted through
  a real tunnel.
- `ea52747b9f`: the complete pristine Go mobile binding source at
  `8b95e45f8d3e224183cc3d760609cef9896e498c` is pinned under `auth/mobile`;
  its staged Git tree matches upstream `ab655246bc7a4398102f04d3b4ac393a0d6fd53a`.
  The native Java binding wraps the shared client, uses the native encrypted-store
  callback and produces private Gecko certificate enrollment data. Android build
  integration adds the ARM64 AAR, complete linked notices and Go/generated-Java
  source to the candidate, with ABI/16 KB and library-hash checks. Native
  [run 37265727085](https://github.com/openresearchtools/BashKitten/actions/runs/37265727085)
  passed the ARM64 JNI library and all three source compilation targets. The
  downloaded artifact checksums, generated Java classes and AArch64 16 KB ELF
  load alignment match its manifest. Host packages are excluded and full linked
  dependency/Go source plus original license/patent/attribution files are present.
  APK integration/device loading and new remote UI/login remain pending.
- Android browser build 37264655266 at `0a7bc4f027` reached linking and found
  two unavailable NSS symbols in the client-certificate integration. Use NSS's
  already-decoded digital-signature usage bit and its exported item-equality
  function, retaining the same key-usage and public-key matching checks without
  modifying upstream NSS exports. The replacement full browser builds must pass
  before claiming the API is available in an installed product.
- Android's native `NativeRemote` adapter uses the generated Java binding and
  existing Keystore/AtomicFile store for synchronous refresh-token rotation.
  Tokens are separate from the connection catalogue and keyed by the validated
  bundle identity. Normal Close retains them; Logout invokes native revocation.
  Transient byte arrays are cleared. The protected Gecko configuration accepts
  the corresponding client certificate/PKCS#8 data only for its enrolled
  onion:443, excludes it from ordinary routing and refuses credential omission
  after enrollment. Its NSS copy is cleared with the existing scoped CA/session
  lifetime. Native [run 37266464187](https://github.com/openresearchtools/BashKitten/actions/runs/37266464187)
  at `2dbd964683` passed all three source compilation targets, the ARM64 JNI/AAR
  build and Java compilation against its actual generated binding and Android
  API. APK/device operation and connection-screen/controller activation remain
  pending; this is not yet the one-login user flow.
- Host account creation now calls the private native helper using the same
  pinned `go-crypt/crypt` Argon2id library and explicit parameters as Authelia's
  file provider/CLI. No password enters process arguments, environment or logs;
  the Node WASM hasher is removed. New passwords are validated against the
  QR's 12–256 Unicode-character rule before account setup starts. Existing
  account verification retains its original password rules. The helper belongs
  to the existing authentication process group and stops with it; no new
  supervisor or public hashing endpoint. Native builds and actual Authelia
  account/TOTP acceptance for this change remain pending. Native compilation
  [run 37267463370](https://github.com/openresearchtools/BashKitten/actions/runs/37267463370)
  and full access-stack assembly
  [run 37267463395](https://github.com/openresearchtools/BashKitten/actions/runs/37267463395)
  at `3a37ad1149` subsequently passed all requested native targets.
- Linux browser candidates `37266283224` (arm64) and `37266262457` (amd64)
  at `6f6cbf9dfd` reached final package assembly. Both failed because the product
  license collector expected `auth/bin/remote` instead of the actual packaged
  `auth/bin/bashkitten-remote`; Android candidate `37266258560` found the same
  mismatch while collecting companion notices. Correct the executable lookup,
  retaining the mandatory component and full license checks. No complete package
  or Android browser-build acceptance is claimed from these failed runs.
- `56826130cc`: native enrollment keys use the host-only helper and upstream
  crypto libraries. Native compilation `37269656504` and complete access-stack
  assembly `37269656471` passed, including Android JNI/AAR/Java and native Termux
  host targets. This does not establish account enrollment or tunnel operation.
- Host setup now has private Share Local commands and desktop browser-owned
  username/password/TOTP/encrypted-image controls. Remote account/session/Tor/CA
  keys live separately from Local trust; initialized missing keys fail rather
  than being silently replaced. Publishing and old service-definition controls
  and routes were removed from the shared web UI. Android Share Local and the
  new native client connection flow remain unfinished.
- File-manager requests now pass a host-owned, default-deny capability check
  before route lookup/body parsing. Jobs belong to the authenticated session.
  Private policy changes block admission, drain remote requests/workers, then
  persist the choice before releasing admission and notifying clients. Local
  jobs and chat transfers are separate. Manager paths/archives/copies/Git checks
  exclude host policy, keys, sockets and launch configuration, including canonical
  aliases and hard links; chat image requests must reference that session's
  actual message content. These are source changes only. Editor/save parity,
  complete path/concurrency review and real enabled/denied/revocation/manual
  acceptance remain pending; do not publish this as a completed security gate.
  Changed JavaScript and the extracted shared UI script parse; backend module
  imports resolve against pinned dependencies in external staging. No scripted
  product tests or manual acceptance claim accompanies these checks.
- Files now includes a compact UTF-8 text editor behind that same manager gate.
  It opens pinned file descriptors, rejects binary/invalid UTF-8 content, compares
  the opened revision before saving, serializes same-file saves and atomically
  replaces the file while preserving its permissions. Permission revocation
  closes/clears the editor and drains pending saves before persisting Off.
  JavaScript parsing and staged module imports passed; real mobile editing,
  keyboard, conflict and mid-save revocation checks remain pending.
- Linux candidates `37269742411` (arm64) and `37269746445` (amd64) at
  `21fea9040d` built Gecko but failed final packaging: the helper's primary
  license is stored under its Go module name, not `remote/LICENSE`. The collector
  now uses that actual packaged path and retains mandatory full-text validation.
  Android candidate `37269733347` built Gecko but failed APK assembly because
  the build-only repository lacked the template's native AAR build step. Its
  workflow was synced in `a35f3cf406`; replacement parent `37272154905` / child
  `37272351099` is building `50fc9bc287` with the newer native host helper.
  These failed candidates produced no complete installable app acceptance.
- Android now has a non-exported native Share Local page beside Local/remotes,
  using the private Termux controller for chosen credentials, authenticator
  verification, encrypted QR display/save, publishing, file-manager permission
  and confirmed identity reissue. Pending credentials/factor stay only in a
  lifecycle ViewModel across rotation; the normal Android document picker saves
  the encrypted image. Missing Local setup uses the existing permission/battery
  flow and Back to remote. A ready Local host can start while the selected remote
  document remains selected, retaining whole-Agent shutdown ownership. Removed
  the obsolete Android Local account/enrollment UI; older backend authentication
  modes now ask for a package update instead of invoking removed commands.
  Cancellation on both platforms is tied to the actual setup ID. Native bridge
  timeouts now cover the controller's three-minute Share Local operations.
  Changed JavaScript parses and the source diff is clean. Android compilation,
  real enrollment/publishing, rotation/keyboard, file save and lifecycle checks
  are pending; this source change is not a working-release claim.
- The Android gateway now has a separate native credential per protected remote
  route, confined to that enrolled onion on port 443. Login can use its Tor
  route; native activation switches it to the Chisel listener and closes existing
  login sockets. Tunnel failure has no direct route fallback. Ordinary Tor tabs
  retain their separate route and receive none of these credentials. The native
  client now distinguishes login-required from transport failure, and the private
  Gecko login operation uses Authelia's actual first-factor API/cookie jar to
  reuse a transient QR password. JavaScript parsing and diff checks pass. Native
  binding/gateway compilation and real login/tunnel acceptance are pending;
  connection-screen/controller activation is still being implemented.
  Native core [run 37273992184](https://github.com/openresearchtools/BashKitten/actions/runs/37273992184)
  at `9223a35207` subsequently passed Linux amd64/arm64 and Android client builds,
  including the generated binding and actual Android API compilation of
  `NativeRemote`, `SecretStore` and `TorGateway`. Full access-stack
  [run 37273991841](https://github.com/openresearchtools/BashKitten/actions/runs/37273991841)
  passed all components and assembly for Linux amd64/arm64 and Termux aarch64.
  Gateway-only changes now trigger that native compilation workflow too.
  These results establish compilation/assembly, not an installed APK or the
  pending encrypted-import, real Authelia login and tunnel user flow.
- Android connection import now uses native TK2 camera/image decoding and local
  password decryption, replacing plaintext JSON/manual address/key enrollment.
  A transient ViewModel preserves an unfinished import across rotation without
  writing its password to saved state. The native runtime owns one tunnel client
  per enrollment, reuses the imported password once for real Authelia first-factor
  login, intercepts the PKCE callback before navigation and switches the protected
  onion origin to its reserved Agent mapping after authorization. Selecting Local
  retains established client owners; Turn off closes all owned mappings. Forget
  closes the selected enrollment and erases its token with synchronization against
  in-flight token writes. Old records remain visible with explicit QR migration;
  there is no old enrollment/transport fallback. Remote failures show remote
  retry/import actions without a Termux download prompt. Protected-view suspension
  clears its scoped client credential while retaining the captured draft and
  cookies. Source review, JavaScript parsing and diff checks pass. Native Java/APK
  compilation and actual QR/password/TOTP/consent, draft, cancellation and tunnel
  acceptance remain pending; service cards and desktop client migration remain
  unfinished.
  Native [run 37275524625](https://github.com/openresearchtools/BashKitten/actions/runs/37275524625)
  at `a29c5d70ff` subsequently passed all three source targets, JNI/AAR and Java
  compilation, including `RemoteAgentConnection`. APK parent `37275535857` /
  child `37275735339` is building this integration with auth `37273991841`.
  A follow-up preserves active remote owners after a failed Local startup and
  avoids leaving a forgotten connection as Back to remote. These paths still
  require actual device lifecycle checks.
- Linux candidates `37272904289` (arm64) and `37272890571` (amd64) at
  `fc4ef81966` completed successfully after the helper-license path correction.
  Their package assembly is verified by the workflows, not an installation or
  complete runtime/manual acceptance result.
  The downloaded ARM64 package reports the exact `fc4ef81966` source, version
  153.4 and arm64 architecture. Its SHA-256 matches its accompanying metadata
  (`142c0e360c505fb6c0346fc58dde86d00791fb43b7f791c034939f65913aadc3`),
  and the payload includes `auth/bin/bashkitten-remote` plus full helper/dependency
  notices. The currently running browser and Cuttlefish guest were left intact;
  this download/integrity check did not install or accept that package.

- Desktop remote connections now use the shared native client via private child
  pipes, encrypted QR import, NSS-acknowledged token persistence and protected
  Authelia/PKCE navigation. A credentialed, exact-origin SOCKS bridge carries the
  protected Agent TLS connection through its native mapping without HTTP/header
  rewriting. Switching to Local retains ready owners; Disconnect/Turn off close
  them and late callbacks cannot restore a closed route. The old desktop
  `LlamaRelay`, hosted subdomain login and plaintext export paths are removed;
  old saved enrollments require a new encrypted QR. Source compilation passed
  for the local Linux architecture and Android client boundary, module integrity
  and changed JavaScript parsing/diff checks. Actual desktop QR/TOTP/certificate,
  remembered login, tunnel and lifecycle acceptance are still pending. Native
  service cards/configuration and the remaining plan features are still required;
  no full application build was dispatched for this slice.
- Existing Android builder `37275735339` completed successfully at 08:05 UTC
  with the `a29c5d70ff` candidate. It predates Display and desktop migration;
  completion of that build is not manual or full-feature acceptance.

- Host services now have one private catalogue and native Share Local editors on
  Android/Linux: loopback TCP/Unix target, name/type/web path, explicit executable
  argument array/environment/working directory, remote availability, startup and
  Start/Stop/Reload. External targets have no process controls. Definitions remain
  outside remote file-manager access, and old HTTP-route definitions remain
  unexposed until explicitly saved. Definition changes remove prior carriers
  before persistence; failures remain errors without restoring another route.
  Linux uses systemd **user scope units** so commands retain the existing native
  guard's process ancestry (detached service units would escape that owner on
  controller death). Termux uses the same guard with native direct execution.
  This follows systemd's documented scope execution model; actual unit/guard
  cleanup still needs manual verification.
- The native service catalogue/action endpoint verifies Authelia Bearer access,
  forwards only fixed service IDs/actions over the existing private controller
  socket, and includes the host generation chosen at startup. Reissued or disabled
  generations cannot execute queued requests. No client target, command, arbitrary
  path, headers or body reaches host configuration. Shared client/mobile bindings
  expose catalogue and action calls. Linux native and Android client source
  compilation, changed JavaScript parsing and diff checks pass. Android/desktop
  native UI compilation, real process/target/lifecycle checks and remote service
  mapping cards/Pi import are pending. No full application build was dispatched.

- Desktop lifetime source now uses a GTK StatusNotifier item with the packaged
  BashKitten icon and Gecko's existing DBusMenu integration. Hiding requires a
  registered tray host; losing that host reveals the same native window. Open,
  selected Agent state/connected-remote count and Quit are available in the tray.
  Native General settings have opt-in per-user XDG login startup and the requested
  default-on close-to-tray choice. Another invocation reveals the existing window.
  Normal Quit blocks new local work, drains pending private operations, closes
  client mappings/control channels and requests exact-owner shutdown until active
  package work finishes safely, showing its actual phase/output. No new process
  supervisor was added; browser death still uses the existing guard and independent
  CLI groups remain unowned. JavaScript parsing, XPIDL header generation and source
  diff checks pass. Full GTK compilation, X11/Wayland tray/host-loss/reopen/autostart,
  package-drain and owned-service cleanup acceptance remain pending. No full app
  build or scripted product test was dispatched for this source slice.

- Android's protected Agent now has an audio-only Gecko permission delegate for
  Whisper dictation. It uses the existing Android RECORD_AUDIO permission and a
  native site prompt identifying the selected Agent; there is no automatic or
  persistent site grant. Requests must match the current protected HTTPS origin,
  session and selected connection. Navigation, hiding/switching Agent and activity
  destruction reject pending requests, as do camera requests and dialog failures.
  Java 8 syntax parsing and source diff checks pass. The actual GeckoView/Android
  integration still needs the final APK compilation and normal visible microphone
  permission, denial, recording/cancellation and dictation acceptance checks.
  No full app build or scripted product test was run for this source slice.

Additional observed evidence, 5 October:

- Android Local now has a native Display dialog wired to the private Termux
  controller, with compatible official X11 downloads, command Copy/Edit/Save,
  explicit default restore, Start/Stop/Open X11 and Copy prompt. Remote selection
  hides/dismisses it and is checked before dispatch. Its ViewModel retains an
  unfinished command/action across rotation. One packaged `bashkitten-display`
  launcher and durable script serve the panel, terminal user and local Pi;
  the existing process guard owns GUI descendants and whole-Agent shutdown.
  Saving validates syntax without executing or interrupting the current desktop.
  Status checks X/window-manager readiness and reports unrelated display sockets.
  Native Termux dependencies include X11, xprop and Mesa. Stock Pi registers the
  local-only `termux-display` skill (1,316 o200k_base / 1,313 cl100k_base tokens).
  Changed JavaScript/Python parse and diff checks pass. Android compilation,
  installer/XFCE operation, edit/conflict/lifecycle and real GPU/manual acceptance
  remain pending; no full application build was dispatched for this source slice.

- Android builder `37272351099` at `50fc9bc287` completed in 63m19s. Gecko took
  15m15s; APK assembly took 40m12s. Final sccache reported 4,960 hits, 3 misses
  (99.94%), five cache errors and one write error. Gradle ran 4,425 tasks with
  no task-output cache enabled; its R8 interval was about 31 minutes. Separate
  compiler caches were intact. Enable Gradle task caching through `GRADLE_FLAGS`
  and retain its snapshots as Actions artifacts, outside the compiler-cache quota.
  The next full candidate must establish actual reuse/timing; no speedup is yet
  measured. The three build repositories and their cache limits remain unchanged.
- The Termux package at `7544113eb9`, assembled with successful auth
  `37273991841` and search `37231795625` components, was downloaded, checksum
  verified and reinstalled using the guest's visible Termux UI. SHA-256:
  `25e017c7fd4a6d39bf68a6a0c325b25bb5fd87d82ca315f54b03abf952450693`.
  APT finished successfully. Reopening BashKitten started Local without an
  account/CA prompt. Entering `/login` opened Providers. The installed APK was
  still `0f5bdf12`; this does not validate the new native connection screen.
  No provider was connected, so no inference/browser-tool turn was accepted.

Manual evidence is outside product source/artifacts under the 5 October native
remote verification directory. The existing Cuttlefish guest uses the previously
installed Termux candidate and authorized child-process setting. Android System
UI hung before APK installation; its own ANR dialog's Close app action recovered
the system UI, followed by an ordinary lock-screen swipe. No browser/VM restart,
ADB, root, app-data clearing or scripted product test was used. This is emulator
coverage, not a physical Pixel or a complete application acceptance result.

Next: finish Android Share Local and the native clients, prove the actual host
enrollment and protected Agent/Authelia one-login path, and complete the editor
and manager boundary's manual acceptance. Continue all remaining gates,
including service/file-manager boundaries, Tor routing, lifetime, Display,
LocalAI/dictation, migration and the complete verified release.

### 5 October Tor routing source completion (manual verification pending)

Tor contexts now keep their route for public HTTP/HTTPS assets and navigation;
unenrolled onions move to private Tor, including from a persistent onion context.
The shared Gecko changes prevent direct DNS/speculative connections and disable
WebRTC, WebTransport and HTTP/3 in Tor/protected Agent contexts only. Proxy
resolution errors cannot silently become direct requests, and Tor's rejected
localhost routes cannot be converted into direct connections by Gecko's normal
loopback-proxy exception. Ordinary browser/service tabs retain normal transports.

Mapped-service tabs open their actual localhost endpoint in a separate cookie
context. They have no additional browser SOCKS layer, Tor public-asset policy or
service-only transport restrictions. Native mapping removal invalidates their
context. The old hosted onion-subdomain trust/cookie-copy path is removed.

Android uses genuine private Gecko sessions for Tor and preserves Tor when
opening another tab. Native downloads carry the originating context through
permission prompts, retries, database storage and GeckoView fetches. Older
stored downloads did not record this context; their network retries fail closed
instead of guessing a direct route. Completed files remain available, and a new
download can be started from its original page.

Node module syntax, whitespace and the upstream XPIDL parser passed for this
source slice. Native compilation and manual Android/Linux Tor, service,
download/retry and ordinary-browsing checks remain required; this entry is not
an end-to-end acceptance result.

### 5 October Android remote service controls (source complete, manual checks pending)

The native connections screen now lists authenticated host services, host
Start/Stop/Reload actions, automatic or chosen local ports, actual localhost
links and Copy/Open controls. Mappings keep separate ordinary browser cookie
contexts and remain available while Local Pi is selected. The former hosted
subdomain/sign-in UI is removed; service tabs do not use an additional SOCKS
proxy or Tor-only browser policy.

Llama service cards have Add to Pi, a saved import checkbox and an optional
application key stored with the encrypted native connection settings. Import
uses the actual mapped `/v1` endpoint and the existing private Termux control
command. Missing Local setup, failed mappings and backend pending/error results
are shown on the card without starting setup or disrupting remote access.
Unsaved checkbox/key edits do not enable import, and saved opt-out is rechecked
before dispatch. Replaced/closed connections complete pending UI requests with
an error instead of leaving the screen busy indefinitely.

All six changed Java files passed JDK parse-only validation and whitespace
checks. Android/Gecko/native-binding type compilation, APK build and visible
manual connection, mapping, host controls and Pi-import flows remain pending.
No scripted product test or device/debugging command was used for this slice.

### 5 October LocalAI and dictation source integration (acceptance pending)

Desktop Local now owns the LocalAI panel, both engine commands, Managed/Custom
llama selection, GPU/CPU selection, runtime jobs, native model pickers/downloader,
router INI editing and the saved default-on Pi-import choice. Shared Agent HTML
and its HTTP forwarding no longer expose model/runtime management. The existing
HostedServices owner runs both engines; the prior ManagedLlama supervisor is
removed. Saving configuration/INI leaves running inference intact until explicit
Reload. Custom binaries are left in place, managed activation waits for the
chosen runtime to stop, and actual initialization errors do not select another
runtime. File-manager exclusions cover the configured binary/INI/key and actual
library files without banning their arbitrary parent folders.

The protected composer obtains normal microphone permission, records until
Stop/Cancel, converts mono PCM WAV in memory, and calls only its selected host's
authenticated dictation operation. Whisper starts on demand and uses its upstream
in-memory inference endpoint without conversion/dump flags. Cancellation drains
pending startup before stopping the same owned process; output is discarded and
owned worker core dumps are disabled. Successful text is submitted once through
the existing chat queue, preserving independent drafts/attachments. Remote clients
need no local inference binary or Termux for host-side dictation. These statements
describe source behavior; actual device permission, audio privacy and queue/lifecycle
acceptance remain pending.

The requested [bashkitten-localai](https://github.com/openresearchtools/bashkitten-localai)
builder is created. It pins pristine llama.cpp v0.5.0 at
`7fe450e19305b828c199d602c23a8337aaa1f03b` and whisper.cpp v1.9.4 at
`927cfce34f31707e17f2bff35c349632fb9e2c3a`. Each engine has native amd64/arm64
CPU/Vulkan/CUDA builds with immediate Actions artifacts, matching full source,
build records, offline notices, checksums and a testing-only release manifest.
The first runtime compile identified GCC 13's missing ARM SME support; the
builder uses GCC 14 without patching upstream. Runtime builds
[llama 37308116410](https://github.com/openresearchtools/bashkitten-localai/actions/runs/37308116410)
and [Whisper 37308122209](https://github.com/openresearchtools/bashkitten-localai/actions/runs/37308122209)
passed all twelve variants and published separate testing prereleases. Their
six-variant manifests, exact source pins, checksums and builder-source inventories
were checked; downloaded Vulkan/CUDA ELF dependencies match the declared ordinary
runtime libraries and external GPU requirements. Linux packaging now explicitly
depends on libstdc++6, libgomp1 and libvulkan1; no GPU drivers are bundled.

Changed JavaScript, inline browser script and Python parse checks, native guard
C syntax and source whitespace checks passed. Still required: native desktop/app
compilation, real managed/custom GPU and CPU starts,
INI/download/import interaction, unchanged mapped llama streaming, and manual
Linux/Android dictation permission, cancellation, exactly-once submission and
no-retained-audio checks. No scripted product test was added or run.

### 5 October TLS lifecycle correction (source checked)

Agent CA/client-certificate changes and Android authenticated-onion removal no
longer send Gecko's global active-connection cancellation. They retain NSS
internal/external session-cache invalidation and use the existing
`net:prune-all-connections` path: idle connections close, active connections
become non-reusable, and existing unrelated streams finish normally. This is
upstream HTTP connection cleanup, not another transport or identity layer.

The source trace confirms desktop disconnect blocks its Agent route before
closing the native helper; that helper closes its gateway sockets before client
mappings. Android closes its owned AgentRoute sockets before its native client,
and protected-view suspension cancels its requests. Local/remote identity
replacement remains gated by the existing reset/remove flow. Source diff and
call-site checks passed; native compilation and simultaneous-download/remote
stream manual verification remain pending.

Desktop dictation also has a protected-browser microphone prompt: the Agent view
is outside the ordinary selected-tab popup anchor, so its WebRTC request reaches
its native owner directly. The owner admits only microphone requests from the
current protected top-level document, asks the user, then uses Gecko's normal OS
permission check and rechecks selection before allowing that device. Other tabs
retain upstream permission behavior; there is no automatic/persistent Agent grant.
This source path still requires visible desktop microphone acceptance.

### 5 October Local startup and Share Local repair (source checked)

Local startup and status no longer depend on readable remote account/identity
metadata. Local starts its existing authenticated listener first; a failed
publishing attempt closes remote ingress and authentication while preserving
Local's trust/session and the saved publishing choice. Failure to restore Local
still invokes the existing whole-group failure path. Native Share Local on both
platforms shows the publishing error and offers the existing confirmed Reissue
action when saved remote state is unreadable. Only that explicit action replaces
the old identity; ordinary startup never generates replacement remote keys.

Changed JavaScript syntax, Java 8 parse-only and source whitespace checks passed.
Full native compilation and manual damaged-state/startup/Reissue checks remain
pending; no scripted product test or installed-runtime acceptance is claimed.

The installed Linux ARM64 candidate `d773ea374f` exposed a missing tray component
after a full Quit/relaunch. The product configure file defined `MOZ_BASHKITTEN`
for C++ but omitted its build substitution, excluding the tray source, XPIDL and
static component registration. Exporting the same setting through `set_config`
fixes those build gates. Build-file parsing and upstream XPIDL header generation
pass; the newly included native code still needs the corrected desktop build and
visible tray/hide/reopen/Quit acceptance.

The corrected Linux ARM64 builder `37327473242` then reached the previously
excluded tray source and reported an XML raw-string delimiter collision plus
an ambiguous D-Bus menu callback type. The source uses a named raw-string delimiter
and the existing `mozilla::widget` type explicitly. These are compiler corrections;
a successful rebuilt package and installed tray acceptance remain pending.

Linux ARM64 `37334285351` at `c08317bc96` compiled the corrected tray source,
then exposed an incomplete `nsWindow` type from its inline constructor in the
static component factory. The default constructor now lives beside the destructor
in the source file that includes `nsWindow.h`. Native factory compilation and
installed tray acceptance still require a corrected candidate.

### 5 October obsolete enrollment exception removed

The old `setAgentOnionEnrollment` API, its temporary CA-less verifier state and
associated issuer exception are removed. A repository-wide caller trace found
only their own declarations/implementation and verifier branch; neither current
native client used them. TK2 supplies the CA and client certificate directly to
`setAgentCA` and `setAgentClientCertificate`. Exact enrolled-CA verification,
mTLS and Android's separate ordinary authenticated-onion policy are unchanged.
The XPIDL parser and whitespace checks passed; no old symbols remain in browser
or Agent source. Native compilation and manual acceptance remain pending.

### 5 October blocked Tor requests cancel their channels

Android and desktop routing now cancel blocked or unavailable requests instead
of constructing a SOCKS route to a presumed unused local port. This also removes
fabricated proxy credentials. Gecko's HTTP source treats proxy-resolution errors
as permission to try a direct connection; cancelling the channel prevents that
retry. The filter callback still completes once. Desktop requests can still wait
for actual Tor startup and recheck their native route afterwards. Protected Agent
origin checks and ordinary mapped-service routing remain in place.

Both modules passed JavaScript syntax and whitespace checks. No scripted product
test was added or run; native builds and manual routing acceptance remain pending.

### 5 October actual Share Local enrollment failure

Installed candidate `d773ea374f` reached native Share Local but Authelia rejected
the OAuth registration: its bearer authorization scope requires `form_post`.
Changing only that response mode in a private copy of the generated configuration
passes the installed upstream validator. Native registration/PAR now use that
mode, with the original issuer, state, PKCE and single-use checks preserved.
Desktop captures the exact callback's form POST in its current protected login
context, checks its source principal and complete body, and cancels the channel
before network access. It passes the form through private native IPC; no callback
listener or authorization code in a URL is introduced. Android uses its protected
native event path for the same contract. Native compilation and JavaScript syntax
checks pass; integrated builds and actual TOTP/consent/tunnel acceptance are still
required. The failed setup did not establish a working remote connection.

Android's URI delegate admits only the exact pending issuer-origin callback to
the protected native POST interceptor; stale callbacks remain blocked. The form
uses a private Gecko/native event outside the page host-call allowlist. Runtime
selection and pending-login checks precede the native two-argument completion.
Only that callback's intentional cancellation is excluded from the generic load
error UI. JavaScript syntax and five Java parse-only checks passed; fresh generated
binding/APK type compilation and manual sign-in acceptance remain pending.

### 5 October disabled speculation also suppresses DNS

Source tracing found that Fenix autocomplete can queue Gecko's context-free
`speculativeConnect` during startup. `nsAppShell::SpeculativeConnect` supplies
empty origin attributes; `nsHttpConnectionMgr::DoSpeculativeConnectionInternal`
can request HTTPS DNS records before checking the configured parallel limit.
The existing Android limit of zero therefore did not suppress that DNS path.
The URI-based `nsHttpHandler::SpeculativeConnectInternal` now returns immediately
when that limit is zero, before dispatching speculative work. Enabled speculation
and ordinary request handling are unchanged.

Whitespace and the existing member/call-path source checks passed. Native
compilation and manual verification of this correction remain pending. The
guest-wide capture's UDP traffic to `8.8.8.8:443` is not attributed to BashKitten
or this path; no runtime leak claim is made from that capture.

### 5 October dictation capability request correction

Installed desktop `d773ea374f` saved the real Whisper model successfully, but the
chat microphone stayed hidden, including after Agent Off/On. The HTTP capability
handler omitted the private controller request body, causing a GET; that controller
requires POST for every operation except status. Passing the empty command body
uses its existing protocol. The public capability endpoint remains authenticated
and read-only. JavaScript syntax and whitespace checks pass; installed microphone
and transcription acceptance still require the rebuilt package.

The shipped pristine Whisper `927cfce34f31707e17f2bff35c349632fb9e2c3a` source sets
server `no_context` to true and passes it into inference, which clears both prior
prompt buffers. No upstream patch or extra request flag is needed for that contract.
