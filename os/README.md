# BashKitten OS

Shared XFCE customization installed inside BashKitten's owned Termux desktop or
Linux containers. It does not install XFCE into the user's host desktop.

The pristine donor imports and complete license texts are under `upstream/` and
`licenses/`; `NOTICE` describes retained code and changes. `src/`, `data/` and
`patches/` contain the product adaptations. Sources and source checksums are
validated before building. No build follows a moving upstream branch/tag.

`packaging/build.py` builds a native `BashKittenOS_VERSION_ARCH.deb`, its checksum
and provenance manifest. Use `--target linux|termux --architecture ARCH --version
VERSION --build-dir CACHE --output OUT`. Linux artifacts run against the guest
Debian ABI and must be built on the pinned Debian image, not a newer host glibc.
Termux uses `packaging/termux/build.sh` in the pinned Termux package framework,
including a private GTK3 libdbusmenu so StatusNotifier menus remain functional.
Panel and dependency compiler caches remain outside the repository.

The package supplies a private patched stock XFCE panel, the native Applications
launcher/settings/session process, and Linux-only Thunar application actions.
`bashkitten-os initialize` runs during explicit desktop provisioning; it seeds
missing profile configuration and merges owned Thunar action IDs while preserving
existing entries. Normal XDG autostart runs `bashkitten-os session`, which owns
runtime layout, the Settings portal and the optional guest indicator. No login
script installs packages or repeatedly resets desktop preferences.

The portal preference is seeded during that explicit provisioning only when
the owned profile has no generic or XFCE portal configuration. Its template
stays in BashKitten OS's private data directory; the package does not replace
`xfce4-session`'s system portal file or overwrite user portal choices.

The container owner exports its execution role, desktop context and guest service
status file. The Termux session records its actual X11/session-bus context in the
private owner-provided path. `bashkitten-desktop-context` resolves that context per
operation; `bashkitten-atspi` reads application/window trees. Pi discovery chooses
the shared guide's `termux-use` or `computer-use` name from the owned runtime role.

Building this package does not establish product acceptance. The pinned native
environments plan requires the installed BashKitten Display flows on Android,
Wayland and an actual Xorg host, including layout/dialogs, app installation,
scaling, accessibility, both tray protocols, user-setting preservation and
responsiveness under load.

The named panel resize patch publishes X11 reservations after the window manager
acknowledges the panel's latest geometry. It preserves first-map reservations,
user panel placement and autohide, without a hardcoded margin or UI-thread wait.
