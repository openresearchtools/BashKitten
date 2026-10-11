# Packaged Pi tools and skills

Planned addition, 10 October: the
[native environments plan](native-environments-display-plan.md#small-pi-skill-for-finding-and-reading-other-chats)
adds a concise `chats` skill and one stock-deferred read-only list/search/read
adapter. It resolves backend/project/chat names to existing native Pi sessions
using the same metadata as the sidecar, without copying history, loading it
eagerly, starting workers or sending messages. This is planned work; the
installed-tool inventory below is not a claim that `chats` is already shipped.

The same plan's [Phone module section](native-environments-display-plan.md#12-android-phone-control-and-the-mcp-port)
adds the Termux `phoneuse` CLI and a concise normally discovered Pi skill.
Only live local BashKitten-owned Pi workers receive scoped Phone authorization;
the native Android module enforces master/feature/grant policy on every request.
The guide directs agents to current enabled-capability help instead of loading
an MCP catalog or describing disabled commands. Accessibility stays optional;
the Phone CLI has no camera/microphone control. This is planned work, bundled
into the main APK with the CLI in Termux, not an installed capability yet.
The port retains device tools/controls only. It has no donor provider connections
or MCP server/client/protocol underneath the CLI; existing Pi continues to own
model/provider configuration and agent execution.

The [desktop-use skill plan](native-environments-display-plan.md#one-shared-skill-with-backend-specific-names)
adds one shared XFCE guide named `termux-use` in the owned Termux backend and
`computer-use` in managed containers. Role-specific package registration and
stock skill filters select only that backend's guide; ordinary Linux
host/unmanaged Pi gets neither, and user exclusions/`--no-skills` are respected.
It teaches
xdotool input, scrot screenshots and available AT-SPI trees through stock shell
and image/file tools. Keep the actual desktop X11/D-Bus context current, with
no new CUA/MCP server. This is planned work; the installed inventory below is
unchanged. `termux-display` remains setup/launch guidance, and Android device
control remains the separately authorized `phoneuse` feature.

Planned additions, 11 October: the main plan's
[usage section](native-environments-display-plan.md#14-chatgpt-usage-and-reset-status)
adds a narrow MIT-licensed `pi-codex-usage` adaptation using Pi's selected
subscription OAuth and existing terminal/RPC status APIs. It shows actual
weekly/short limits and reset times in Pi and the web UI, independently of
Pillama's status, without a Codex process, credential scraping or Pi/provider
patches. Usage status is replaceable metadata, not a transcript message.

The [question section](native-environments-display-plan.md#15-nonblocking-agent-questions)
adds a deferred `ask_user` tool and concise `ask-user` guide. The tool returns a
pending ID immediately; choices and custom reply appear inline while Pi keeps
working. One backend owner resolves answers or the initial 120-second deadline,
then delivers an attributed answer or no-response instruction through the stock
Pi queue/RPC path. Silence means proceed with the best long-term solution for
optional questions, never permission approval. Stop/Off and uncertain crash
delivery remain authoritative; no waiting UI/tool promise or JSONL edits.

The [calling section](native-environments-display-plan.md#13-native-telephony-contacts-and-call-hooks)
brings Phony-based telephony into the main APK, with independent setup above the
Phone controls section. The per-chat Phone hook after Subagents sends final
turns and questions through one authenticated, deduplicated invitation owner;
web and spoken/keypad replies resolve the same question. Phone-side Termux
handles speech even for registered remote chats, preserving the existing
encrypted remote route. Call-origin work/replies enable the hook. This adds no
camera/microphone commands or telephony authority to `phoneuse`. These are
planned capabilities, not changes to the installed inventory below.

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
