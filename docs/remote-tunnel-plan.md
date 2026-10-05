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

The deliverable is working Linux amd64/arm64 packages, the Android APK and matching
Termux package, source and notices, after builds and manual acceptance. Writing
this plan, building a helper or dispatching CI does not complete that deliverable.

## 1. Required user experience

| Where | Required result |
| --- | --- |
| Fresh Android Agent | The Termux setup page offers **Connect to remote** before any Termux install, command permission or package setup |
| Agent selector | Local, named remotes and Connect to remote remain reachable in every setup/connection state |
| Mobile Agent navigation | Replace the spelled-out **Agent** navigation button with the current BashKitten logo, retaining accessible naming, touch target and behavior |
| Unconfigured Local | Show the short-command setup and **Back to remote**, retaining the previous remote, login and draft |
| Android Local Display | One compact native panel: compatible X11 download if missing, current editable command, actual status, Start/Stop and Open X11; absent in Remote mode |
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

## 7. llama.cpp router passthrough

Treat llama.cpp as a normal managed service with a convenient command/config
form. Use the installed `llama-server` and supported router preset syntax, such
as `--models-preset <file>`, with an explicit loopback host/port. Verify against
the packaged version. Preserve model/config files, existing downloads/runtime
selection, and real readiness/errors. Do not introduce another llama supervisor
or modify Pi's agent loop.

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
| 7. Delivery | Existing-data migration, four complete artifacts, offline notices/source, manual platform acceptance, release/APT publication with testing warning |

Work directly on main in focused commits and push finished slices. Record actual
evidence per exact candidate commit. Resolve early integration gates before full
Gecko iterations; reuse unchanged component artifacts under existing provenance
rules. No new build repositories or fingerprinting scheme.

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
| Display GPU coverage | Skill reads current primary sources for actual device/driver, verifies renderer and visible app before reporting acceleration, owns helper cleanup and restores working software command on failure; emulator-only coverage never establishes physical-device GPU support |
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
