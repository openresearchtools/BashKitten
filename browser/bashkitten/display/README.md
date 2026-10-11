# Native Linux Display module

This is the Linux implementation of the viewport boundary in the agreed
`f71686dcb76402ec43bac3e6a7db8979ef0fb119` native-environments plan. Android's
Termux:X11 module has its own host adapter. This module does not implement remote
Display, container administration or a second Agent/browser UI.

## Owners and upgrade seam

`BashKittenDisplay.sys.mjs` accepts a descriptor obtained by the native machine
controller: `{kind:"container",id,name,presenterSocket}`. The optional third
argument provides a native `clipboard(request)` callback. It keeps these values
in a private WeakMap; they are never placed in a URL or an ordinary page. The
chrome viewport checks its exact document, system principal and current browser
ownership on every native attachment/clipboard call. The existing protected-tab
marker excludes the viewport from browser-use automation.

The small Gecko adapter is the XPCOM component in `native/`, its module/jar
registration and the product `moz.build` entry. Its native `VideoFrameContainer`
feeds Gecko's existing asynchronous ImageContainer/compositor. The HTML video
is only the native surface host: no canvas rendering, stream codec, web display
transport, host-compositor socket forwarding or second GTK viewer is involved.
Firefox upgrades need to verify the video/container, DMA-BUF descriptor and
component registration APIs here; no layout/network/process-selection patches
are scattered through Firefox.

Each visible viewport launches its own disposable `bashkitten-display renderer`
process. Only the selected private socket, one inherited packet FD and graphics/
cache environment are passed. Parsing, software snapshots, EGL/GBM import/blit,
PNG cursor encoding and GPU waits run in that process. The parent component has
one dedicated receiver thread for packet/FD validation, mmap/import and image
submission. The main thread only handles bounded input/state/layout work and
coalesced invalidation. Socket backpressure and frame/cursor leases are bounded;
key/button transitions retain order. Hidden views suspend frames, resize uses
actual drawable pixels and stale geometry is discarded. A failed or stalled
renderer reports a view error. Closing it never sends desktop shutdown.

The persistent `gateway` process is owned by the machine lifecycle controller.
It adapts Buzzard's private Wayland server to rootful Xwayland and accepts both
primary wl_shm and negotiated DMA-BUF buffers. It retains one current guest
lease for immediate reattachment, paces callbacks independently of viewers and
releases replaced buffers. It never reports fabricated physical presentation
feedback. Saved XFCE UI scaling is independent of viewport output geometry.
The CPU path works without a DRM node or a host Wayland connection. GPU startup
uses only formats supplied by the native receiver, validates actual allocation/import/blit on the selected EGL
context and reports software fallback with the original reason. A later GPU
failure reports an error instead of restarting the running X server.

## Private runtime contract

```
bashkitten-display gateway --directory ABSOLUTE_PRIVATE_DIRECTORY \
  --width PIXELS --height PIXELS \
  [--drm-render-node DEVICE --formats-file PRIVATE_JSON]
bashkitten-display renderer --gateway ABSOLUTE_PRESENTER_SOCKET --host-fd FD
```

The gateway creates mode-0700 `guest/`, mode-0600 `guest/wayland-0` and
`presenter.sock`, then writes `ready.json` after its Wayland server initializes.
Readiness contains `schema`, `pid`, `waylandSocket`, `presenterSocket`, `mode`
(`gpu` or `software`) and `fallbackReason`. The lifecycle owner records PID/start
identity and removes stale sockets only after verifying their process is gone.
Only `guest/` is mounted into the selected container, never the presenter socket,
capability JSON, real host X/Wayland sockets or session D-Bus. The guest numeric
UID must map to the owning host user. Host packet peers must have that UID; this
is not isolation from hostile code already running as the host user.

The formats file accepts an array or `{formats:[{fourcc,modifier}]}`. Modifiers
are decimal strings when crossing JavaScript because DRM values are 64-bit.
The loader also accepts integer JSON for native component probes. Startup
capabilities must come from the actual Gecko receiver; a previously saved list
is checked against the current renderer on attachment. `XKB_DEFAULT_MODEL`,
`XKB_DEFAULT_LAYOUT`, `XKB_DEFAULT_VARIANT` and `XKB_DEFAULT_OPTIONS` configure
the private XKB map, with the donor's validation and ordinary pc105/us defaults.

`machines.clipboard` is separate, native-only and user-initiated. Its request is
`{action:"read"|"write",type:"text/plain"|"image/png",text?,dataBase64?}`; read
returns `{type,text|dataBase64}`. The machine owner executes bounded guest xclip
work using that machine's X authority. The viewport uses the browser's async
clipboard/image APIs for explicit host snapshots. Attaching, focusing or hiding
a viewport never reads the clipboard. No clipboard watcher is installed.

## Sources and packaging

The pristine Buzzard source subset and complete notices were imported in
`43cc7d04f1`, at donor commit `6c1b89f25c196ae7ab4a8f20e166b27e4ee94cc0`.
`vendor/buzzardos/UPSTREAM.json` pins/checksums every pristine file. Adaptations
are in `patches/`; `linux/` contains the new native service/renderer/wire code.
Retained donor code remains AGPL-3.0-or-later, BashKitten additions AGPL-3.0-only.
The materialized Cargo sources include checksums, upstream VCS commit metadata,
full individual licenses and an exact Cargo.lock. No build follows moving refs.

`build.py --work-dir OUTSIDE_SOURCE --output ARTIFACT_DIRECTORY` verifies donor
hashes, applies named patches with zero fuzz and builds Cargo offline/locked.
Use a native Linux amd64 or arm64 runner; cross-architecture targets are rejected.
`--debug` is for independent development probes. The output is
`display-runtime-linux-{amd64,arm64}.tar.gz` plus `SHA256SUMS`, containing:

- `display/bashkitten-display`;
- `display/manifest.json`, `provenance.json` and full-text `licenses.json` inventory;
- `display/notices/` containing full licenses and modification/attribution notices.

Install one copy at the app's `display/` and link the browser's
`runtime/display/` to it. Runtime distro dependencies are libxkbcommon0, libdrm2,
libgbm1, libegl1 and libgles2; the XKB data is from xkb-data. Development builds
need matching headers, pkg-config, Rust and a C linker. The matching release
source archive includes this whole tracked module, patches and dependency trees.
No service has a network listener, telemetry emitter or developer callback.

Component compilation and protocol probes do not establish product acceptance.
The installed BashKitten candidate must still exercise the viewport, clipboard,
keyboard, host shortcuts, rotation/resizing, hidden views, renderer failure,
load and close/reopen on both a Wayland host and the required real-Xorg VM.
GPU import/driver behavior must be checked with the candidate's actual format
list; software fallback and relevant physical GPUs require separate evidence.
