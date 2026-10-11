---
name: desktop-use
description: Inspect and control applications in this backend's owned XFCE desktop using accessibility, screenshots and focused input.
---

# Desktop use

Use this guide for this backend's running desktop. Its Display button starts the
saved desktop configuration; use that owning backend's settings for setup.
One desktop has one pointer and keyboard focus: coordinate with other agents and
the user. Use shell/file tools for terminal work instead of screenshotting terminals.

Run each operation through `bashkitten-desktop-context --timeout 30 -- COMMAND`.
It resolves the owner's current desktop generation, X authorization and session bus.
`bashkitten-desktop-context --status` reports readiness. If stopped or stale, ask the
owner to start Display; do not guess `:0`, scrape another process, use `xhost +`,
start a second D-Bus session or borrow another backend's context.

1. Identify the intended window using `xdotool search --name 'TITLE'`,
   `getwindowname ID` and `getwindowgeometry --shell ID`; `xprop -id ID WM_CLASS`
   reads its application class.
   Resolve ambiguous matches before input.
2. Inspect accessibility when available: `bashkitten-atspi list`, then
   `bashkitten-atspi tree --application INDEX --output /private/path/tree.jsonl`.
   `--path 0/2` inspects a current subtree. Inspect the final `complete` field;
   a disconnected/stalled bus is not an empty successful tree. Paths are valid
   only for this inspection. Some custom widgets expose no useful tree.
3. Capture a fresh image with `scrot /private/path/unique-shot.png`, then read it
   with Pi's image-reading tool. Coordinates belong to the guest framebuffer,
   not the host browser or a scaled preview. Use unique private output paths.
4. Focus the observed target before input: `xdotool windowactivate --sync ID`.
   Verify focus with `getactivewindow`. Input examples: `mousemove --sync X Y`,
   `click 1`, `click --repeat 3 5` (scroll down), `key ctrl+l`,
   `type --clearmodifiers -- 'text'`. For a drag use `mousedown 1`, movement and
   `mouseup 1`; always release held buttons/modifiers on failure/cancellation.
   Targeted `--window` events are not equivalent to focused XTEST input and
   are not supported by all applications.
5. Re-inspect/capture after scrolling, focus/window changes, resizing, scaling,
   rotation or keyboard insets. Use current bounds or seen pixels; never invent
   coordinates or describe OCR as an accessibility tree.
6. Verify the actual result with a relevant tree read or fresh screenshot.
   Command success alone is not application success. Use bounded waits for the
   requested state rather than blind repeated clicks. Remove owned temporary
   captures after use, preserving user-requested saved artifacts.

There is no background capture or polling. Screenshot and tree inspection are
both supported; say which one is being used. X11 input/capture has desktop-wide
authority, not per-window isolation. This guide controls this desktop only.
Use separately discovered tools for phone controls and browser tabs. Desktop
automation does not expose the protected Agent/authentication surface.
