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

When referring to a file in a reply, use a normal Markdown link to its actual
path, such as `[report.md](./report.md)` or `[My Report](</home/user/My Report.md>)`.
Relative paths resolve from this chat’s working folder on this backend. These
links open BashKitten’s existing preview/download controls when Files is enabled.
Verify that the file exists; never substitute a path on the client’s computer.
Put line numbers in the link label or surrounding text, not in the path.
