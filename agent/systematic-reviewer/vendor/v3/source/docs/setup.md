# Configure OpenAlex and local Zotero

Use only the services needed for the current work. The helper scripts share an
optional OpenAlex key, while the researcher keeps control of searches, libraries,
outputs and scientific decisions. Configuration is per user, outside the review
project. Local Zotero needs no API key.

In Pi, `/review-setup` shows OpenAlex status and account guidance, plus local
Zotero instructions. An agent can check whether OpenAlex is configured without
seeing its key. Enter credentials yourself in a local setup interface; do not paste
them into the conversation or ask the agent to read the credential file.

The Pi command offers OpenAlex account links, key entry/replacement,
removal and browser-setup instructions. Pi's standard input dialog is visible
while typing; its value goes directly to the command handler, not into a model
message. Choose the hidden terminal prompt option if you prefer. Sign in through
your own browser; setup does not handle account passwords or email verification.

## Optional browser form

For a local browser form instead of terminal entry, run this command from the
package directory:

```sh
node scripts/setup.mjs set openalex --web
```

Alternatively, open the same setup page with:

```sh
node scripts/setup.mjs serve
# Optional fixed local port:
node scripts/setup.mjs serve --port 8765
```

The helper prints a temporary URL. Open that exact URL in a browser or ask the
agent to open it in a new tab, then enter the key yourself in the password field.
The page has an OpenAlex key form and local Zotero instructions. It shows
OpenAlex status and official account links. It uses the same private credential
storage as terminal setup and never returns an existing key
to the page or agent. Saving a key does not validate it with the service.

The server listens only on `127.0.0.1`, chooses an available port by default,
and stops after ten minutes, when you select **Done**, or on **Ctrl-C** in its
terminal. Keep the command running while using the page. `/review-setup` offers
the command to run; it does not start a background server. The page is for
service setup, with research work continuing in Pi and the independent helpers.

The browser must be on the same host/network environment as the helper. In a
remote session or container, the browser's `127.0.0.1` may point somewhere else.
Use the hidden terminal prompt there, or an intentionally configured local
forwarding arrangement; the helper has no public or `0.0.0.0` bind option. An
agent or web/custom Pi interface can run the command and open the returned URL
in a separate tab when its browser can reach that loopback address.

## OpenAlex

Open [OpenAlex signup](https://openalex.org/signup) in your browser if you need
an account, then sign in and visit the
[API key settings](https://openalex.org/settings/api-key). Copy the key and run
this from the package directory in your own terminal:

```sh
node scripts/setup.mjs set openalex
```

Paste the key at the hidden prompt and press Enter. Nothing is echoed. The
OpenAlex harvest helper reuses the saved key. Setup itself makes no requests to
research services and does not create an account, start a browser or validate
the key against a paid or rate-limited endpoint. The optional web form accepts
local browser requests. Configured means a key is available; the next service
request confirms whether it is accepted.

## Zotero

Zotero access is local only. Open the user's normal Zotero profile, enable local
API access in Zotero's advanced settings, and keep Zotero running. The helpers use
the HTTP interface; they never open or edit Zotero's SQLite database. Do not
create a separate profile unless the user asks for one.

No Zotero key is configured or requested. The default endpoint is
`http://127.0.0.1:23119/api/`; `ZOTERO_LOCAL_URL` may select another loopback
address with the same `/api/` path. Use an offline reference snapshot when live
access is unnecessary. Specify the intended library in the research command.

On Termux, the project targets its owner's native Zotero port,
installable with apt from the user's configured repository. Follow that port's
repository and package instructions; stock Termux availability is not assumed.
This target does not establish a new installation or local-API validation on
every device. See the [validation log](implementation-plan.md) for checks run.

## Inspect, replace or remove a key

```sh
node scripts/setup.mjs status
node scripts/setup.mjs set openalex
node scripts/setup.mjs set openalex --web
node scripts/setup.mjs serve
node scripts/setup.mjs remove openalex
node scripts/setup.mjs help
```

Status shows whether OpenAlex is configured, its source, the credential path
and official account URLs, plus local Zotero guidance. It never shows a key,
suffix or length. `set openalex` explicitly replaces the saved value;
`remove openalex` deletes it. An environment override remains in effect until
removed from the environment that launches Pi or the helper.

An existing nonempty `OPENALEX_API_KEY` takes precedence over its saved value.
For unattended setup, `set openalex --stdin` accepts one key from standard
input, such as the output of a password manager. Keys are never accepted as
command arguments. Avoid
commands that put literal keys in shell history or output them to a terminal.

## Storage and portability

The default path is
`$XDG_CONFIG_HOME/pi-systematic-reviewer/credentials.json`, falling back to
`~/.config/pi-systematic-reviewer/credentials.json`. This is a **plaintext** file
protected by filesystem permissions, not encryption or an operating-system
keychain. New configuration directories use `0700`; credential files use
`0600`. The scripts refuse credential files readable by other users and refuse
symlink credential files. Missing configuration is normal and read-only
commands create no directories or files.

`SYSTEMATIC_REVIEW_CONFIG` may select an absolute file path for an isolated
environment or tests. Keep it outside Git repositories and shared directories.
Malformed files are reported without exposing their contents and are not
overwritten automatically. Do not hand secrets to an agent to repair them.

Updates hold an exclusive `credentials.json.lock` file beside the credential
file so simultaneous setup processes cannot overwrite each other's changes. A
competing update fails explicitly; retry after the other command finishes. A
crashed process may leave the lock behind. Only after confirming that no setup
command is running, remove that `.lock` sidecar yourself and retry. The helpers
never guess that a lock is stale or remove another process's lock automatically.

The setup code uses Node's standard library without shell commands, native
add-ons or global installs. The same commands apply on x86-64/ARM64 Linux and
Termux with the package's supported Node version. Filesystem permissions need a
private native filesystem; Android shared storage is unsuitable for credentials.
Live account checks and physical-device coverage are separate from the offline
synthetic tests.
