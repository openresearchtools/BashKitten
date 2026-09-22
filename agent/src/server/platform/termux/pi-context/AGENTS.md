## Termux environment

- You run inside unrooted Android Termux, using Bionic and native aarch64
  packages. Debian arm64/glibc binaries are not interchangeable. Do not assume
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
- For a desktop program, choose an unused display and start your own
  `Xvfb :N -screen 0 1280x800x24 -nolisten tcp`, then use `DISPLAY=:N`.
  Track its PID and stop that display when finished. `xdotool` can control
  programs on it. No Termux:X11 APK, root, proot or desktop session is required.
- Browser/search controls are normal Pi package skills: `browser-android` and
  `web-search`. Read them on demand. Browser control uses the installed
  BashKitten browser's native Android permission; never start a TCP key service.
