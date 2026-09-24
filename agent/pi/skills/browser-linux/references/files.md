# Desktop content and files

Every command takes `tabId`; other parameters below are optional unless stated.

- `read`: `format:"markdown"|"text"|"links"|"console"|"network"` (default
  markdown), CSS `selector` for content. Markdown accepts `includeLinks` (true),
  `includeImages`, `viewportOnly`. Text is in `content`; long content is saved
  completely. Inspect `path,writtenToFile,contentLength`, then read the saved file.
- `grep`: required `pattern` (case-insensitive regex), `over:"ax"|"text"`
  (default ax), `limit` (default50). Returns matching lines/count and saved path
  when inline output is shortened. ax refreshes snapshot refs too.
- `evaluate`: required `code` as an **async function body**, `timeout` (30000ms).
  Example `{"tabId":1,"code":"return {width:innerWidth,height:innerHeight};"}`.
  Use return for data. Result has `value` or a saved path for long output.
- `screenshot`: `format:"png"|"jpeg"` (png), `quality` (80), `fullPage` (false),
  `size:{width,height}` (output bounds), `clip:{x,y,width,height,scale?}` for
  viewport capture, `annotate` to label snapshot refs. Returns base64 `data`,
  `mimeType,width,height`. Viewport output defaults to1024×768 bounds; full-page
  defaults to full dimensions. Clip x/y are document coordinates, defaulting
  to scroll offset. Prefer `bashkitten_screenshot {tabId}` for image/saved path.
- `pdf`: `landscape`, `printBackground` (true), `preferCSSPageSize` (false).
  Prints the ordinary page and returns `path,bytes`.
- `upload`: required snapshot `ref` for an enabled file input and `file` or
  `files:[path,...]`. Paths must exist on the browser host; multiple files require
  an input accepting multiple. Returns `uploaded,files`.
- `download`: required snapshot `ref` for the actual link/button, optional
  existing `directory`. Clicks/saves a normal or page-generated download and
  returns its path, avoiding existing filenames. Current native timeout is50s;
  inspect the download/page after uncertainty before clicking again. Android's
  downloads helper is not a substitute for this command.

Native desktop paths belong to the browser host; relative paths resolve against
its command working directory. The Pi screenshot helper copies its image beside
the Pi session. A remote Pi must not treat browser-host paths as local or assume
upload transfers a Pi-local file across machines. Evaluation runs in page JS,
not browser chrome or OS; whole-window screenshots are unavailable.

For remote desktops/video, use the native screenshot, optionally with `clip` and
`scale` for readability. Drawing the video into a canvas can hide overlays or a
picture-in-picture placeholder and falsely suggest that clicks reach the screen.
After uncertain input, inspect the visible tab before repeating the action.
