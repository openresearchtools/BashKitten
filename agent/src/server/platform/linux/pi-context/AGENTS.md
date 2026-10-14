## Linux environment

Home: {{HOME}}. Work in the selected project as the current user. Check
/etc/os-release and available tools before choosing distribution-specific
package commands; do not assume root or sudo access. Global skills are in
{{PI_AGENT_DIR}}/skills/ and ~/.agents/skills/; trusted projects may add
.pi/skills/ or .agents/skills/. Read relevant SKILL.md files on demand.
The packaged `browser` and `websearch` skills use BashKitten's native
browser controls and packaged DDGS helper. Load the guide for the actual client
browser when controlling an authorized remote; it may run a different OS.

Node and npm on PATH are BashKitten’s private runtime. Pi settings, OAuth,
extensions and sessions belong to {{PI_AGENT_DIR}}. Use `pi install` for Pi
packages and ordinary `npm -g` for tools; their installs and caches stay inside
that profile. Project npm dependencies remain in the selected project. Do not
change the system Node/Pi installation for this environment. Use native
`tool_search` to load the deferred browser, websearch and agents tools when needed.

Custom program/server autostart uses `{{AUTOSTART_CONFIG}}`, the same file as
Configuration → Autostart, inside this Local or container environment. Run
`bashkittenctl autostart-status` to read its `file`, `revision`, `commands` and
actual status. Save with `bashkittenctl autostart-save --stdin`, sending JSON
`{"revision":"the read revision","commands":[...]}`. Preserve unrelated entries;
on a revision conflict, reread and merge before retrying. Each command has a
stable UUID v4 `id`, `name`, boolean `enabled`, `argv` array (absolute executable
first), absolute `cwd`, and `env` object of string values. Arguments have no shell
expansion; use an explicit shell only when needed. The file format is
`{"version":1,"commands":[...]}`; keep direct edits private and atomic.
Saving does not start/restart commands: edits and enabled switches apply at the
next environment start. Removing through the controller also stops its owned
process. Use the controller for removal; a file edit alone does not stop a live
process. Do not create a separate system service. Close preserves work; desktop
Quit/crash or stopping this container ends its owned commands and descendants.

When referring to a file in a reply, use a normal Markdown link to its actual
path, such as `[report.md](./report.md)` or `[My Report](</home/user/My Report.md>)`.
Relative paths resolve from this chat’s working folder on this backend. These
links open BashKitten’s existing preview/download controls when Files is enabled.
Verify that the file exists; never substitute a path on the client’s computer.
Put line numbers in the link label or surrounding text, not in the path.
