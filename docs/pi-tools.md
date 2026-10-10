# Packaged Pi tools and skills

Planned addition, 10 October: the
[native environments plan](native-environments-display-plan.md#small-pi-skill-for-finding-and-reading-other-chats)
adds a concise `chats` skill and one stock-deferred read-only list/search/read
adapter. It resolves backend/project/chat names to existing native Pi sessions
using the same metadata as the sidecar, without copying history, loading it
eagerly, starting workers or sending messages. This is planned work; the
installed-tool inventory below is not a claim that `chats` is already shipped.

The installed integration exposes `browser`, `browser_screenshot`,
`browser_downloads`, `websearch` and `agents`. These use stock Pi 1.0.2's
`deferred` exposure. Its built-in `tool_search` is activated without replacing
the existing active tool set. Pi owns discovery, schema activation and transcript
recording; no custom tool loader or Pi patch is involved. Once a tool is loaded,
its declaration remains subject to Pi's ordinary session/history behavior.

`agents` is hidden while delegation is Off and the chat has no family to message.
Enabling delegation or membership in an existing family makes it discoverable.
The backend independently checks delegation settings, group membership, direct
parent authority, live child limits and durable Stop intent for each operation.
Completed child turns reach the direct parent using native session entries.
Messages and retried spawn tasks use stable delivery IDs to avoid duplicate
queue entries; a stopped recipient receives a held draft.

Search uses one thin deferred tool adapter to the existing packaged Python
query-or-URL helper. Input validation, extraction, saved full Markdown and errors
remain owned by that helper. No second search implementation or service is added.

`agent/packaging/pi-skills.py` builds the shipped guides from the source references.
Both targets discover `browser`, `websearch` and `subagents`; only Termux includes
`termux-display`. Curation uses reviewed, exact prose replacements and fails if
those source passages change. Command contracts, working examples, permission
boundaries and attribution are retained. Pi's native skill discovery adds only
the short name/description/path until the agent reads a guide.

The selected browser guide is `skills/browser/SKILL.md`. The other platform's
curated reference is outside skill discovery: an authorized remote connection
can control a browser whose OS differs from Pi's host. `browser capabilities`
and `help` select that connected client's complete guide, still named `browser`.
Agents do not choose a platform tool name. The uncurated source references keep
their platform directories and local shell entry points for development and
other coding agents.

The normal managed skill selection upgrades to the new packaged paths. Explicit
custom package skill filters are preserved. Architecture acceptance uses the
fresh private BashKitten Pi profile requested on 8 October; standalone Pi and npm
profiles are not imported.

On 8 October, installed Android APK/backend `8ecc1a1d16` passed an actual
subagent flow through the desktop BashKitten Cuttlefish UI. The managed r1
llama.cpp router used Qwen3.5 2B Q4_0, explicit CPU, a 32,768-token context and
two threads. The parent activated `agents` through stock `tool_search`, spawned
Answerer and Questioner, and both children inherited its model and Reasoning Off.
Questioner's peer question reached Answerer. Four separate completed Answerer
turns each produced exactly one automatic parent report, verified with stock
Pi's native session parser and the corresponding delivery metadata.

The model did not autonomously complete the requested two-way protocol: it sent
extra follow-ups and claimed a reverse reply without a matching tool call.
Ordinary user prompts in the saved child chats then resumed both and explicitly
requested that reply. Answerer's `send` returned accepted; Questioner received
the matching message once, acknowledged it, and its completed turn reached the
parent once. Both chats were stopped with the native Stop Pi control; read-only
process inspection confirmed both workers had exited. This verifies the actual
peer/report/stop transport with user steering, not autonomous model reliability.
