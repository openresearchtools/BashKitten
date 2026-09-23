# Android tabs and navigation

Use `bashkitten_browser {method,params}`. `?` marks optional fields, not literal
parameter names. Tab IDs are opaque strings returned by the browser.

| Method | Parameters | Result / behavior |
| --- | --- | --- |
| `capabilities` | none | Platform/method inventory, authorization and foreground behavior; Pi adds guide/help paths. |
| `tabs.list` | none | Array of ordinary records: `id,url,title,tor,desktop,adblock,loading,error`, including restored tabs. |
| `tabs.create` | `url?` (about:blank), `tor?` (false) | New record; use its `id` as tabId. Initial URL may still be about:blank while loading. No desktop background/private/group options. |
| `tabs.show` | `tabId` | Shows the tab via Android's normal activity rules. |
| `tabs.close` | `tabId` | Closes that ordinary tab. |
| `navigate` | `tabId,url` | Starts navigation; wait/snapshot afterwards. |
| `back`, `forward`, `reload`, `stop` | `tabId` | Separate methods, unlike desktop navigate.action. |
| `tabs.setDesktopMode` | `tabId,enabled` (boolean) | Sets desktop-site mode. |
| `tabs.setAdblocking` | `tabId,enabled` (boolean) | Sets that tab's ad blocking. |
| `viewport` | `tabId,frameId?` | Reads width/height, fullWidth/fullHeight and scrollX/scrollY; does not resize. |
| `diagnostics` | `tabId,frameId?` | Read-only actual Gecko remote/debug/accessibility state and navigator.webdriver. |

Onion URLs automatically use isolated Tor routing even without tor:true.
Navigation to onion keeps the tab ID; do not assume its route stays direct.
Existing ordinary private/Tor tabs remain controllable. Restoration recreates
engine sessions on demand. If a tab closed, list again rather than inventing IDs.
No groups/history/bookmarks, profile/window creation or Quit API exists here.

Local Termux approval covers its installed signing identity and is shared by
Pi sessions in Termux. Denial/revocation is not a transport retry. Remote control
uses a separate explicit client grant and the same ordinary-tab dispatcher.
