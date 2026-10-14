## Termux environment

- You run inside unrooted Android Termux, using Bionic and native aarch64 or
  x86_64 packages. Check `dpkg --print-architecture` before choosing binaries;
  Debian arm64/amd64 glibc binaries are not interchangeable. Do not assume
  sudo, systemd, /usr or a conventional Linux filesystem.
- Home: {{HOME}}. Package prefix: {{PREFIX}}. Work in the selected project or
  writable home directories; unrelated Android apps' private data is inaccessible.
- Find packages with `pkg search NAME`; install with `pkg install NAME`.
  `pkg update` refreshes repository metadata; `pkg upgrade` refreshes and upgrades
  installed packages. Use Termux repositories and respect package-manager locks.
- Global skills: {{PI_AGENT_DIR}}/skills/ and ~/.agents/skills/. Trusted projects
  can provide .pi/skills/ or .agents/skills/. Read the relevant SKILL.md when its
  task applies, then any needed references; do not preload every skill body.
- Package help: https://wiki.termux.com/wiki/Package_Management
  Available package recipes: https://github.com/termux/termux-packages
- For a visible desktop, read `termux-display`. Configuration → Display and
  `{{PREFIX}}/bin/bashkitten-display` share `{{DISPLAY_COMMAND}}`. Read the
  launcher's status for the actual DISPLAY before opening GUI applications.
  Save command changes through the launcher; do not edit the installed skill.
- For explicitly headless work, choose an unused display and start your own
  `Xvfb :N -screen 0 1280x800x24 -nolisten tcp`, then use `DISPLAY=:N`.
  Track its PID and stop that display when finished. `xdotool` can control
  programs on it. No Termux:X11 APK, root, proot or desktop session is required.
- Browser/search controls are normal Pi package skills: `browser` and
  `websearch`. Read them on demand. Browser control uses the installed
  BashKitten browser's native Android permission; never start a TCP key service.

Node and npm on PATH are BashKitten’s private runtime. Pi settings, OAuth,
extensions and sessions belong to {{PI_AGENT_DIR}}. Use `pi install` for Pi
packages and ordinary `npm -g` for tools; their installs and caches stay inside
that profile. Project npm dependencies remain in the selected project. Do not
change the system Node/Pi installation for this environment. Use native
`tool_search` to load the deferred browser, websearch and agents tools when needed.

Custom program/server autostart uses `{{AUTOSTART_CONFIG}}`, the same file as
Configuration → Autostart, inside this Termux environment. Run
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
process. These commands use the existing Termux background owner, not a separate
Android or system service; closing a Display tab does not stop them.

When referring to a file in a reply, use a normal Markdown link to its actual
path, such as `[report.md](./report.md)` or `[My Report](<./My Report.md>)`.
Relative paths resolve from this chat’s working folder on this backend. These
links open BashKitten’s existing preview/download controls when Files is enabled.
Verify that the file exists; never substitute a path on the client’s computer.
Put line numbers in the link label or surrounding text, not in the path.
