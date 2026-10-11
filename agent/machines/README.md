# Native Linux machine component

The native browser calls `machineControl(action, value)` in
`src/server/machines/index.mjs`. A separate systemd user service owns provisioning,
private Podman and the persistent guest display/media/backend lifetime. It is not
under Local's runtime guard. Missing rootless-user/systemd prerequisites are
reported; no system-Podman or alternate-runtime fallback is used.

The service reports the package revision and the Node executable it loaded.
After an update, its owner refuses new provisioning/start/configuration work,
while reads, Stop and Cancel remain available. It retires only when accepted
operations, running containers and their display/media processes have finished;
the next native request starts the installed version. A native ownership lock
serializes replacement across browser/controller processes. Browser Quit never
stops this persistent owner. Older services without this drain protocol require
a desktop sign-out or computer restart, which is reported explicitly; a client
does not kill a legacy owner from a potentially stale idle snapshot.

Each named machine has a stable UUID directory below `$BASHKITTEN_DATA_DIR/machines`.
`launch.json` is the canonical editable executable/argv/environment/cwd definition;
`Containerfile` is its saved installation recipe. Runtime status and credentials
are separate. The empty rootfs anchor and external bind-root preserve guest package
installations and mapped ownership across native stop/start. Machine deletion
stops owned services and removes the unmounted rootfs through Podman's user
namespace before deleting the catalogue record. Shared image storage stays intact.
Temporary sockets use a short private directory below the owned XDG runtime root;
no persistent guest data is stored there. The guest receives only its Wayland
socket directory, never the host presenter/control endpoints.

The initial native command includes `/dev/fuse` and `SYS_ADMIN` within its rootless
user namespace for the guest's FUSE/AppImage bridge. It never uses host root,
`--privileged`, or host namespace sharing. Removing these editable native options
can make direct AppImage mounting unavailable; failure never selects extraction
or disables an application's sandbox automatically.

Native operations (not remote HTTP management):

| Action | Input/result |
| --- | --- |
| `list` | `{machines:[{id,name,state,autostart,pendingChanges,lastError,...}]}` |
| `create` | `{name,displayCapabilities?}` → `{machine,operation}` immediately |
| `get` / `save` | `{id}` → `{machine,config,containerfileText}`; save `{id,config,containerfileText?}` |
| `start` / `stop` / `restart` / `retry` | `{id,displayCapabilities?}` → asynchronous operation; retry resumes failed creation safely |
| `operation` | `{id,cursor:0}` → actual phase/state/exitCode and the next output chunk/cursor |
| `cancel` | `{id}` cancels the active operation; closing its view does not cancel |
| `delete` | `{id,confirmName}` confirms guest files/packages/private Pi history |
| `startup` | Starts configured autostart machines; does not change existing running machines |
| `endpoint` | Guest's actual local-session HTTPS URL/identity/cookie and owned UDS/control paths; native only |
| `display` | Trusted container descriptor and presenter socket, including software/fallback status |
| `guest-control` | Selected existing native Share Local/service controls, scoped to this guest |
| `media-devices` | Actual host PipeWire names/serials; saved choices never silently select a different device |
| `clipboard` | Explicit UTF-8 text/PNG read/write in this guest's X11 session; no clipboard watcher |
| `activations` | `{wait:true}` waits for guest-tray Open; `{ack:{machineId,id}}` acknowledges after host activation |

Pass native Display capabilities `{formats,drmRenderNode}` at creation/start and
startup. The saved device choice is retained; missing/unusable GPU capability is
reported as software display by the gateway. A running X session is never silently
recreated following a presentation failure.

Guest services use an isolated D-Bus/PipeWire/X11 session. `/run/bashkitten-host`
contains only that guest's allocated endpoints; keep-id maps guest UID 1000 to the
host owner so mode-0600 sockets remain private and usable. The HTTPS socket carries
unchanged TLS bytes to guest Caddy; it does not replace authentication or CSRF.
The protected Agent remains in the host browser. Guest tray Quit/Stop stops only
that guest's BashKitten group; closing a window/tray does not stop the environment.

`build-guest.py` produces the native amd64/arm64 guest service `.deb` offline from
the pinned sudo bridge/libc source. Main release composition stages matching
BashKitten, BashKitten OS and guest service `.deb` artifacts into `image/packages`
with `manifest.json` (revision, architecture, package file/checksum entries).
Provisioning verifies this manifest before building the pinned Debian image. Its
installed package/source/version inventory is retained under `/usr/share/bashkitten`.
The private engine component is built by `packaging/machines/build.py`.

These source/build checks do not establish product acceptance. Native candidate
creation, reconnection, configuration, sudo PTY/redirected I/O, all media/clipboard
routes, real Xorg/Wayland display and protected Agent flows must be exercised in
the installed application under the agreed plan.
