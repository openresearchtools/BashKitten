# Using BashKitten

BashKitten is a Firefox-based browser with a protected Agent view for stock
Pi 1.0.2. Linux packages include the browser and server; Android runs the server
in ordinary Termux. Current releases are for testing and are not ready for
production; see the [README](../README.md).

## Install and start

On Linux, install the complete package for your architecture from the
[Open Research Tools package repository](https://github.com/openresearchtools/apt).
Launch **BashKitten**, select **Agent → Local**, and use **Turn on**.

On Android, install the signed `com.bashkitten` APK from
[Releases](https://github.com/openresearchtools/bashkitten/releases). Local setup
offers the official Termux download if needed. Open Termux to complete its
bootstrap, then paste the single command shown by BashKitten. It first upgrades
all Termux packages through APT, then downloads our
[setup script](https://github.com/openresearchtools/BashKitten/blob/main/agent/packaging/termux/install.sh).
The script installs the verified repository keyring and `bashkitten` with its
declared dependencies. It enables the external-command bridge and
returns to BashKitten. Allow Android's request to run commands in Termux;
BashKitten verifies the connection and starts Agent automatically. There is no
separate Connect or Install packages step. Existing compatible Termux can be
used; no Termux:API, Termux:X11 APK, root or ADB is required.

For an existing Android installation, update the APK and the BashKitten Termux
package together. Install the APK update, then use **Settings → App → Update
packages**, or upgrade the installed Termux packages through APT. The native
local connection needs the matching browser and server; provider logins and
chat history are preserved.

If an older install command stops with `CANNOT LINK EXECUTABLE` and a missing
SSL/library symbol, run `apt update && apt full-upgrade` in Termux, then retry
setup. `pkg` itself uses `curl`, so a broken curl library can prevent its mirror
checks from working. If APT also fails, retain the exact error for diagnosis;
do not delete Termux data or disable HTTPS verification.
See [Termux's library recovery guidance](https://github.com/termux/termux-packages/wiki/Termux-execution-environment#package-dependencies-are-outdated).

Turn on requests missing background battery access for BashKitten and, for Local,
Termux. Approve Android's dialog to continue. Cancellation leaves a visible retry
or **Continue with battery restrictions** choice. Already allowed apps are
skipped; remote-only use requests access for BashKitten alone.

For local Termux on Android 14+, also enable **Developer options → Disable child
process restrictions** and keep Developer options enabled. If hidden, tap
**Build number** seven times in **About phone**, then open Developer options in
**System**. Setup provides a Settings shortcut. This setting is separate from
battery exemptions and wake locks; the app cannot silently change it.
See the [Termux maintainer's guide](https://github.com/agnostic-apollo/Android-Docs/blob/master/en/docs/apps/processes/phantom-cached-and-empty-processes.md#commands-for-android-14-and-higher).

Local connects automatically through the browser's private native bridge,
without creating an account or entering a password or two-factor code. It uses
the discovered `https://127.0.0.1:<port>` endpoint and its enrolled certificate
identity. The port can change; do not use a fixed HTTP URL. The local credential
stays in the protected Agent cookie context and renews automatically after a
service restart. Pi provider credentials and chat history remain in their stores.

## Cookie banners

**Automatically dismiss cookie banners** is on by default. Find it in Android's
**Settings → Privacy and security**, or desktop **Settings → Ad Blocking**.
It rejects optional cookies on supported sites and enables the selected bundled
cookie-banner filters. Turn it off to handle banners yourself in normal and
private tabs, then reload open pages. This keeps other ad/tracker protection and
your individual filter-list choices. It does not erase previously saved consent
cookies or change filters supplied by extensions or custom lists.

## Providers and chats

Open **Settings → Providers**, or enter `/login` or `/providers`. Choose the
provider's API-key or browser-login method and follow the instructions in that
provider's block. Pi receives supported local OAuth callbacks; remote providers
may need their displayed code/manual callback step. Credentials stay in Pi's
native store.

Choose a working folder and model, then send. Linux Local uses the native folder
picker; Android and remotes browse the server's folders. Android working folders
are inside Termux home, displayed as `~`.

- Chats are grouped by project. Sending to a stopped chat resumes its native Pi
  session; **Resume Pi** also resumes it.
- `/clone` creates and selects another chat with the existing history. `/fork`
  opens native branch selection and returns the selected user message to the
  new chat's composer.
- Attach images/files using the ordinary picker, paste or drag/drop. Follow-ups
  queued during a turn support editing, steering and removal.
- Files supports uploads, downloads, backend ZIP downloads and confirmed bulk
  operations. Changes displays Git differences without staging or committing.
  Linux Local uses Changes and native folder opening.
- **Settings → Providers → Open an existing Pi session** adds a native session to
  the sidebar. Avoid opening the same session concurrently in another Pi client.
- **Download models** saves selected Hugging Face files to the server's models
  directory. Linux can use it with its managed llama.cpp runtime.

Pi supplies tools, extensions, skills, models and compaction. BashKitten uses its
own Pi profile at `~/.local/share/bashkitten-pi/pi`, including provider/OAuth
credentials, settings, models, extensions, packages, themes, prompts and native
session history. It does not import or update standalone Pi's `~/.pi/agent`.
Use `pi install` for standalone Pi, or `bashkitten-pi install` for BashKitten.
Browser and search skills ship in the integration package. The browser guide
matches the authorized client platform.

## Remotes and browser control

Use the browser's **Local / remote** selector to add, import and select a remote.
On Linux, **Settings → Remote access → Publish over Tor** enables publishing.
First use opens account creation and authenticator enrollment; verify a code
before publishing starts. Existing accounts are reused. The panel then shows
the address, connection QR and file export. Publishing defaults off, remembers
your choice and keeps Local on loopback. **Stop publishing** disables remote
access without interrupting Local. Android runs its local Termux Agent or
connects to a Linux remote; it does not publish its own backend.

Remote connections still require the exported Tor authorization, enrolled TLS
identity and account with a second factor. Exports omit passwords and factor
seeds. **Remember me** retains remote sessions across browser/service restarts
until expiry or logout. Authelia and its durable session store run on the Linux
publisher, separate from automatic local authentication.

The same server panel can publish named loopback websites as authenticated onion
services. Available sites appear above chat. Linux also supports a separately
authenticated llama.cpp endpoint and browser loopback relay.

Tools control ordinary tabs, including containers, private and Tor tabs. They
cannot inspect the protected Agent/authentication views. Android requests native
approval when Termux first controls the browser; this is separate from permission
for BashKitten to command Termux. Remote Agent control of the client browser
requires its own native approval.

## Power and storage

**Turn on/off** owns the Agent services and their Pi workers. On Android it also
acquires/releases the browser CPU wake lock and Termux's stock app-wide lock.
Closing the Android browser leaves Termux work running. Closing the Linux browser
stops its adopted local group. Turning off a remote-only client disconnects it
without stopping the remote machine. A standalone CLI server stays independent
until the Linux browser adopts it.

Wake locks do not prevent Android from killing an app under memory pressure or
after force-stop. Reopening reconciles actual services. Explicit Turn off stays
off during that app run; a fresh user launch defaults to Turn on.

Server data defaults to `~/.local/share/bashkitten-pi/`;
`BASHKITTEN_DATA_DIR` overrides it, including the `pi/` profile beneath it.
BashKitten sets Pi's supported directory environment variables for every SDK,
CLI, package operation and worker; inherited standalone Pi directory overrides
do not select its profile. No existing credentials or extensions are copied.
Project-local Pi resources still belong to the selected project. Pi keeps its
session files; BashKitten stores sidebar metadata,
attachments and access-stack state separately. Removing a sidebar entry does not
delete native Pi history or attachments.

## Development and packaging

Source lives under `agent/src/web/`, `agent/src/server/`, `browser/` and `auth/`.
Install locked Node dependencies from `agent/` with `npm ci --ignore-scripts`
(Node >=22.19). A checkout alone does not supply native authentication/search
binaries. Use complete packages for ordinary setup; `bashkittenctl start`,
`status` and `stop` control a packaged standalone server.

See [packaging](../agent/packaging/README.md) for GitHub Actions builds and the
[integration plan](browser-integration-plan.md) for requirements and verification
boundaries. Verification material stays outside product source and artifacts.

Agent code is [AGPL-3.0-only](../LICENSE). Browser and dependency licenses retain
their own terms. Full notices are available offline in browser About and in
[third-party notices](../agent/THIRD_PARTY_NOTICES.md).
