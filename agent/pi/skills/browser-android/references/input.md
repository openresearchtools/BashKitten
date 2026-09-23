# Android inspection and input

Page commands require `tabId`; optional `frameId` must identify an observed frame
inside that tab. Never supply raw Gecko references or invent frame IDs.

`snapshot` returns nested `root` nodes with roles/names/states, opaque `reference`
strings, frame/document metadata and `truncated`. Options: `target` (previous
container reference), `depth`, `maxNodes` (default200), `maxBytes` (default60000).
These defaults can be increased. Each snapshot replaces the old reference map,
including subtree snapshots. No Android interactive mode or diff command exists.
Snapshot after an action to verify its outcome; acceptance is not proof of success.

`act` takes `tabId,kind` and:

| Kind | Additional fields |
| --- | --- |
| `click` | `target`, optional `button:"left"|"middle"|"right"`, `clickCount` (1) |
| `click_at` | `x,y`, optional `button,clickCount` |
| `hover` | `target` |
| `focus` | `target` |
| `fill` | `target,value` or `fields:[{target,value},...]`; `clear:true` replaces |
| `type` | `text`, optional `clear`; current focus |
| `type_at` | `x,y,text`, optional `clear`; clicks then types |
| `press` | `key`, e.g. `"Enter"`, `"Control+a"`, `"Shift+ArrowLeft"` |
| `check` / `uncheck` | `target`; verifies checked state |
| `select` | `target,value` for native option value or visible text |
| `scroll` | `direction:"up"|"down"|"left"|"right"`, `amount?` (3 ×120px), `target?` for container |

Targets are snapshot reference strings. Fill/type append unless clear:true.
Focus/click first for press. Keys include characters, Backspace, Tab, Enter,
Escape, Space, PageUp/Down, Home, End, arrows, Insert, Delete, Shift/Control/Alt/Meta
and F1–F12. Aliases: Ctrl, Cmd/Command, Option, Esc, Del, Return, Left/Right/Up/Down.
Coordinates are viewport CSS pixels, not Android capture pixels: use viewport
and capture dimensions. Native pickers/system dialogs are not page elements.
Android does not expose desktop drag, hover_at or JavaScript-dialog actions.

`wait`: `for:"text"|"selector",value`, optional `timeout` (default10000ms).
Selector means existence, not necessarily visibility. Returns `matched`; false
means timeout. For a pause use `for:"time",value:milliseconds`. After uncertain
input inspect the page instead of automatically replaying the action.
