# Desktop tabs and navigation

Use `bashkitten_browser {method,params}`. `?` below means optional, not part of
the parameter name. IDs come from actual results.

| Method | Parameters | Result / behavior |
| --- | --- | --- |
| `capabilities` | none | Installed platform/method inventory; Pi adds guide/help paths. |
| `tabs.list` | none | Array with `tabId`, `page`, URL/title and private/Tor metadata. Includes ordinary container tabs. |
| `tabs.create` | `url?` (default `about:blank`), `background?` (default true), `private?`, `tor?`, `tabGroupId?` | Opens one tab and returns `tabId`; onion URLs automatically use Tor. |
| `tabs.show` | `tabId` | Selects the tab in the existing window. |
| `tabs.close` | `tabId` | Closes that ordinary tab. |
| `navigate` | `tabId,url`, optional `action:"url"` | Navigates and returns snapshot. |
| `navigate` | `tabId,action:"back"|"forward"|"reload"` | History navigation/reload and snapshot. No desktop `stop`. |

Low-level `tabs` takes `action:"list"|"new"|"activate"|"close"` and the same
fields. Prefer dotted aliases. `tabs.open` aliases create. `page` is a legacy
alias for `tabId`; do not mix them. New tabs default to background. No session,
window or profile ID is used. Onion authorization requires normal user enrollment.

## Groups

`tab_groups` takes `action`:

- `list` (default): returns groups with `groupId,title,color,collapsed,pageIds`.
- `create`: `pages:[tabId,...]`, optional `title,color`; or `groupId` to add to
  an existing group (omit title in that case). Returns `group`.
- `update`: `groupId` plus at least one of `title,color,collapsed`.
- `ungroup`: `pages:[tabId,...]`; keeps tabs open.
- `close`: `groupId`; closes the group **and its tabs**.

## History and bookmarks

`history`: `action:"list"|"open"` (default list), `maxResults?` (default100).
Returns `entries`; open also opens the native sidebar. Long text returns a saved
`path`. No history-delete operation is exposed.

`bookmarks` takes `action` (default list):

- `list`/`open`: optional `tabId` or exact `url`, `query`, `maxResults` (default100).
  Open also opens the native bookmarks sidebar; returns `bookmarks`.
- `create`: `tabId` or `url`, optional `title,folder:"menu"|"toolbar"|"unfiled"`.
  Returns `bookmark,created`; existing URL is reused.
- `remove`: `guid`, `tabId` or `url`. URL removal removes matching bookmarks.

Native sidebars are not page DOMs. Use these commands for user-requested changes.
