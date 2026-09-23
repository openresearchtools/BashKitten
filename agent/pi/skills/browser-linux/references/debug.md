# Desktop console, network and debugging

Every command requires `tabId`. These are bounded recent page records, not a
complete traffic archive. Inspect truncated/unavailable fields; an absent record
does not prove a request never occurred. Capture around the relevant action.

## Console

- `list_console_messages`: optional `level,sinceMs,textContains,source` (exact
  source URL), `limit` (50), `format:"text"|"json"`, `saveTo,preview` (characters).
  Returns messages/counts and `hasMore`.
- `clear_console_messages`: clears captured console messages for this page.

## Network

- `list_network_requests`: optional `sinceMs,urlContains,method` (HTTP verb),
  `status,statusMin,statusMax,isXHR,resourceType,limit` (50),
  `sortBy:"timestamp"|"duration"|"status"`, `detail:"summary"|"full"`,
  `format:"text"|"json"`, `saveTo,preview`. Returns request IDs/counts/hasMore.
- `get_network_request`: required `id` from the list or exact unambiguous `url`;
  optional `saveTo,preview`. Returns request/response metadata, available bodies,
  encodings and unavailable reasons. saveTo preserves complete captured bodies.

`saveTo:true` creates a unique file; `saveTo:"path"` requests a browser-host path.
Saving console/network lists without explicit limit includes all captured matches.
Preview defaults to0 when saving. sinceMs filters by age in milliseconds.

## Scripts and logpoints

1. `enable_debugger {tabId}` enables inspection of the ordinary page.
2. `list_scripts {tabId}` returns URLs, source/executable lines and
   `possibleLinesComplete`; discovery also enables the debugger.
3. `get_script_source {tabId,scriptUrl,saveTo?,preview?}` returns source/path.
   Long source saves automatically.
4. `set_logpoint {tabId,url,line,expression}` uses script URL, **one-based**
   executable line and JavaScript expression. Returns `logpoint` ID and live
   `installed` count; zero may be pending, not evidence of execution.
5. Perform the page action; `get_logpoint_results {tabId,logpoint}` returns recent
   values/errors/timestamps (retains100 per logpoint site).
6. `remove_logpoint {tabId,logpoint}` removes it afterwards.

Expressions execute in a page frame and may have side effects; prefer reading
needed values. No raw debugging protocol, pause/step, browser preferences or
process/window control is exposed.
