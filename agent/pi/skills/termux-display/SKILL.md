---
name: termux-display
description: Start or configure this phone's visible XFCE desktop through BashKitten's shared Termux:X11 launcher; choose software rendering or verify a supported device-specific GPU setup.
---

# Local Android desktop

Use this skill in **local Termux** for visible desktop applications. XFCE supplies
the desktop inside BashKitten’s native Display tab. Remote browser access does not
give a remote Pi control of this phone's display. For explicitly headless work,
use your own Xvfb session instead, with `-nolisten tcp` and owned cleanup.

**Configuration → Display**, the user and Pi share one launcher and script.
The Display button opens the desktop; Configuration opens its launch settings.
Do not create another startup service, edit this skill, or put competing commands
in `.bashrc`. BashKitten's packages supply XFCE, Mesa and the paired `bashkitten-x11` loader.
The native engine is included in BashKitten; no separate X11 app is needed.
Turn on the local Agent before starting its desktop.

## Commands and results

```sh
bashkitten-display status
bashkitten-display command
bashkitten-display command --path
bashkitten-display command --set < new-launch.sh
bashkitten-display command --reset
bashkitten-display start
bashkitten-display stop
```

`status`, `start` and `stop` print JSON: `state` (`stopped`, `starting`, `running`,
`stopping`, `failed`), `error`, recent `output`, `command`, `commandPath`,
`previousCommandPath`, `environment` and `savedForNextStart`. `otherDisplaySockets`
lists unmanaged X socket names (a stale socket alone does not prove a live server).
Errors exit nonzero;
read stderr and refreshed status. Do not report success from a spawned PID alone.
Start waits for the X server/window manager and is idempotent while owned work
exists. Stop terminates only BashKitten's owned desktop and descendants.

`command` prints the complete script; `--path` prints its resolved absolute path:
`$BASHKITTEN_DATA_DIR/display/launch.sh`, normally
`~/.local/share/bashkitten-pi/display/launch.sh`. Read that resolved path rather
than assuming the default. `--set` validates shell syntax and saves atomically,
detecting intervening edits; `--reset` explicitly saves the packaged default.
Neither save executes anything. Direct edits are also read on the next Start.
Package upgrades preserve custom scripts; only the exact untouched old generated
`termux-x11` default migrates to `bashkitten-x11`. If status includes `launcherNote`,
update that saved server command explicitly before expecting native attachment. A running desktop keeps its original
command until an explicit Stop/Start; coordinate that interruption with the user.

The default starts visible software-rendered XFCE:

```sh
exec bashkitten-x11 "$DISPLAY" -nolisten tcp -xstartup \
  'env LIBGL_ALWAYS_SOFTWARE=true dbus-launch --exit-with-session xfce4-session'
```

The launcher selects an unused display and supplies `DISPLAY`. A custom script
must use it, disable X TCP listening and keep the X server in the foreground.
Background any required GPU helper **inside this script**, so the existing
process guard owns it too. Do not remove X sockets/locks or kill other displays.
Closing the Display tab does not stop the server; use launcher Stop.
Local Agent Off stops the owned display. Switching the chat to Remote does
not stop it; the phone's local Display remains available.

After Start, read `environment.DISPLAY` from status and use that actual value
for GUI applications, for example `DISPLAY=:2 mousepad` **only if status reports
`:2`**. Do not restart Pi or overwrite global shell settings to use the display.
Ask the user to open Display when a visible interaction is needed. Report independent
X servers separately; never claim they belong to this launcher.

## Device-specific GPU setup

1. Inspect the actual phone, Android version, ABI, available GPU/driver and native
   Termux packages. `getprop ro.product.model`, `getprop ro.build.version.release`,
   `getprop ro.product.cpu.abilist` and `pkg list-installed` help establish context.
   A chipset name or emulator renderer alone does not prove hardware acceleration.
2. Read current primary documentation below for that exact combination. Consider
   Turnip/Zink or VirGL only when supported by its hardware, driver and packages.
   Explain the chosen change; do not install arbitrary driver binaries, root,
   proot or change Android developer settings. Do not apply black-screen/colour
   workaround flags unless the actual device needs them.
3. Preserve the current script before editing. Save a candidate via `command
   --set`, then explicitly Stop/Start when the user is ready. A failed launch
   stays failed; there is no silent renderer/configuration substitution.
4. Verify the actual GL/Vulkan renderer using the appropriate native diagnostic
   tool and interact with a visible GUI application before claiming acceleration.
   If unsupported/unproven, explain that software remains available. Restore it
   explicitly with `command --reset` or restore a known working saved script
   through `--set`. `previousCommandPath` holds the last command that reached
   desktop readiness; readiness itself does not prove GPU acceleration.

Primary references:

- [Termux:X11 setup and launch](https://github.com/termux/termux-x11#setup-instructions)
  for native rendering/launch options. BashKitten uses its embedded engine and
  paired loader; do not install an upstream X11 APK or replace Termux to configure it.
- [Native package recipes](https://github.com/termux/termux-packages): check current
  names, dependencies and device restrictions before installation.
- [Mesa drivers](https://github.com/termux/termux-packages/tree/master/packages/mesa)
  and [VirGL Android](https://github.com/termux/termux-packages/tree/master/packages/virglrenderer-android):
  inspect the native build/driver support; a recipe is not proof for this device.
- [Mesa environment variables](https://docs.mesa3d.org/envvars.html): rendering
  overrides, including the default's session-scoped `LIBGL_ALWAYS_SOFTWARE=true`.
