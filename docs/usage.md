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
- **Local → LocalAI → Models** saves selected Hugging Face files to the local
  host's models directory. Android runs these models natively inside Termux.

Pi supplies tools, extensions, skills, models and compaction. BashKitten uses its
own Pi profile at `~/.local/share/bashkitten-pi/pi`, including provider/OAuth
credentials, settings, models, extensions, packages, themes, prompts and native
session history. It does not import or update standalone Pi's `~/.pi/agent`.
Inside BashKitten's agent shells, `pi install` uses this private runtime and
profile. From an ordinary terminal, use `bashkitten-pi install` for BashKitten;
an independently installed `pi` keeps its own profile.
Browser and search skills ship in the integration package. The browser guide
matches the authorized client platform.

## Local models, dictation and speech

**LocalAI** uses the same runtime controller, router INI and resumable downloader
on Linux and Android/Termux. On Android, its chip icon is beside the Display
monitor icon. Android offers **CPU** or **GPU (Vulkan)**; GPU sends all model
layers to the selected native driver. An unavailable driver reports its error
without changing the saved choice. Linux retains its CUDA/Vulkan/CPU choices.
Custom llama binaries disable managed updates for that engine.

Save the device/runtime choice, download its native runtime, then open **Models**.
The verified list starts with the smallest files and includes Qwen3.5 0.8B, 2B
and 4B, with Q4_0 and Q4_K_M choices. **Use** adds the actual downloaded path to
the router INI; **Reload** applies it. **Keep router available while Agent is on**
starts the server without eagerly loading models. The saved Pi import checkbox
updates only BashKitten's owned provider; existing/default chat selections stay
unchanged. Android path fields refer to Termux files, not Android shared storage.

Whisper and Parakeet use the same single microphone beside Send. Click to record,
then click again to transcribe. **Automatically send voice messages** defaults on;
turn it off to append the transcript to the composer. Whisper uses its in-memory
server endpoint; Parakeet uses its upstream stdin decoder and exits afterwards.
Neither recording path stores audio. Parakeet has no always-running server option.

**Speech synthesis** uses `llama-tts` from the managed llama.cpp runtime. Download
a listed Pocket TTS or Qwen3-TTS model with its matching projector, select a
reference voice recording, save, then enter text and a new output WAV path.
Pocket currently offers its verified F16 pair; the official Qwen3-TTS 1.7B
catalogue includes Q4_K_M and Q8_0. Other engines' similarly named model formats
are not interchangeable. Generated speech is saved only to the requested output.

Android's **Performance** gauge opens a closable native overlay. It reads device
counters once per second only while visible, stopping when closed or backgrounded.
RAM shows used/total GB to two decimal places. CPU/GPU percentages require counters
that Android and the device driver permit the app to read; restricted counters
show **—**, never a fabricated zero or the app's own usage presented as system use.

## Remotes and browser control

Use the browser's **Local / remote** selector to add, import and select a remote.
On Linux, **Settings → Remote access → Publish over Tor** enables publishing.
First use opens account creation and authenticator enrollment; verify a code
before publishing starts. Existing accounts are reused. The panel then shows
the address, connection QR and file export. Publishing defaults off, remembers
your choice and keeps Local on loopback. **Stop publishing** disables remote
access without interrupting Local. Android can run its local Termux Agent,
publish it through **Share local**, or connect to an authorized remote.

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
Installed desktop and Termux packages bundle their own Node 24 LTS and npm.
Their launchers and all Pi workers use that native executable; a missing private
runtime is an installation error. A development checkout uses its current Node.
BashKitten-owned npm configuration lives at `pi/npm-config/{user,global}.npmrc`,
its cache at `pi/npm-cache/`, and the default global prefix at `pi/npm/` beneath
the data directory. Inherited npm routing overrides and Node module/preload
settings are cleared for child processes. Standalone `~/.npmrc`, system npm
configuration and another Pi installation are not imported.
The private runtime, its `pi` launcher and `pi/npm/bin` are first on the Agent's
PATH. `pi install` uses BashKitten's selected Pi runtime even when another Pi is
installed on the host. Development checkouts supply an owned `pi/bin/pi` shim. Ordinary
`npm install -g` installs tools privately. Pi's own user package manager installs
extensions under `pi/npm/node_modules`; trusted project dependencies and project
configuration still belong to the selected project. This is not a shell sandbox:
explicit package arguments and normal project `.npmrc` files retain npm behavior.
Native npm addons use the bundled headers and private `npm-cache/node-gyp`
cache. Node/npm itself is updated with BashKitten, while the package panel's npm updates
cover tools in the private global prefix.

Project-local Pi resources still belong to the selected project. Pi keeps its
session files; BashKitten stores sidebar metadata,
attachments and access-stack state separately. Removing a sidebar entry does not
delete native Pi history or attachments.

## Development and packaging

Source lives under `agent/src/web/`, `agent/src/server/`, `browser/` and `auth/`.
Install locked Node dependencies from `agent/` with `npm ci --ignore-scripts`
(Node 24 LTS recommended; minimum 22.19). A checkout alone does not supply native authentication/search
binaries. Use complete packages for ordinary setup; `bashkittenctl start`,
`status` and `stop` control a packaged standalone server.

See [packaging](../agent/packaging/README.md) for GitHub Actions builds and the
[integration plan](browser-integration-plan.md) for requirements and verification
boundaries. Verification material stays outside product source and artifacts.

Agent code is [AGPL-3.0-only](../LICENSE). Browser and dependency licenses retain
their own terms. Full notices are available offline in browser About and in
[third-party notices](../agent/THIRD_PARTY_NOTICES.md).

Pocket TTS downloads use the verified F16 model and matching projector. After
selecting that original model in Speech synthesis, **Create Pocket Q4_0 copy** or
**Create Pocket Q8_0 copy** produces a smaller sibling file with the managed
`llama-quantize`. It preserves the original and refuses to replace an existing
output. Refresh status, then **Use created Pocket model** to select it. The
projector stays the same; cancellation and Agent off stop the conversion.
