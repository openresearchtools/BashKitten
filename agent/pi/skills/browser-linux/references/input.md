# Desktop inspection and input

Every command requires `tabId`. `snapshot` accepts `mode:"full"|"interactive"`
(default full), `depth?`, `maxNodes?`, `maxBytes?`. It returns text in `content`,
`refs:[{ref,role,name}]`, URL and `truncated`. `diff` captures changes since the
previous snapshot/diff and updates the baseline. `act` also returns a diff.
Retake a snapshot for stale refs. Desktop snapshot has no container `target`.

`act` takes `tabId,kind` and the fields below. Use opaque snapshot `ref` IDs,
not raw Gecko target objects. Refs resolve their child frame automatically.
Coordinates are viewport CSS pixels in the top document without a ref.

| Kind | Additional fields |
| --- | --- |
| `click` | `ref`, optional `button:"left"|"middle"|"right"`, `clickCount` (default1) |
| `click_at` | `x,y`, optional `button,clickCount` |
| `hover` | `ref` |
| `hover_at` | `x,y` |
| `focus` | `ref` |
| `fill` | `ref,value`, or `fields:[{ref,value},...]`; `clear:true` replaces instead of appends |
| `type` | `text`, optional `clear`; current focus |
| `type_at` | `x,y,text`, optional `clear`; clicks then types |
| `press` | `key`, e.g. `"Enter"`, `"Control+a"`, `"Shift+ArrowLeft"` |
| `check` / `uncheck` | `ref`; verifies resulting checked state |
| `select` | `ref,value`; native option value or visible text; returns selected values |
| `scroll` | `direction:"up"|"down"|"left"|"right"`, `amount?` (default3 ×120px), `ref?` for scroll container |
| `drag` | `ref,targetRef` or `ref,endX,endY` |
| `drag_at` | `startX,startY,endX,endY` |
| `dialog_accept` | `text?` for a JavaScript prompt |
| `dialog_dismiss` | none |

Keys: characters, Backspace, Tab, Enter, Escape, Space, PageUp/Down, Home, End,
arrows, Insert, Delete, Shift/Control/Alt/Meta and F1–F12. Aliases include Ctrl,
Cmd/Command, Option, Esc, Del, Return and Left/Right/Up/Down. Focus/click first;
press acts on current focus. Fill/type append unless `clear:true`. File inputs
use upload. Coordinate input must account for resized screenshot dimensions.

An action can return `pendingDialog`: use the appropriate dialog action and
inspect again. These are page JavaScript dialogs, not native OS permissions.

`wait {tabId,for:"text"|"selector",value,timeout?}` waits for text or a CSS
selector's existence (not necessarily visibility). Timeout defaults to2000ms.
Inspect `matched`: false means timeout. An intentional pause uses
`{tabId,for:"time",value:milliseconds}`. Prefer page conditions for loading.

`type`, `type_at` and `fill` also accept `delayMs` (default0), a non-negative
inter-character delay for terminals/remote viewers that need paced input.
Modifiers are held across each key; shifted punctuation and uppercase generate
the corresponding physical Shift events. Inspect the destination after typing.
