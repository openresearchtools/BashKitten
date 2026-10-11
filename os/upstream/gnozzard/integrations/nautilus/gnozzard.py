# SPDX-License-Identifier: GPL-3.0-or-later

from gi.repository import Gio, GObject, Nautilus


class GnozzardAppImageMenuProvider(GObject.GObject, Nautilus.MenuProvider):
    """Nautilus secondary-click actions for local application packages."""

    def _command(self, command: str, path: str) -> None:
        Gio.Subprocess.new(
            ["/usr/libexec/gnozzard", command, path],
            Gio.SubprocessFlags.NONE,
        )

    def _register(self, path: str, desktop: bool) -> None:
        arguments = ["/usr/libexec/gnozzard", "register", path]
        if desktop:
            arguments.append("--desktop")
        Gio.Subprocess.new(arguments, Gio.SubprocessFlags.NONE)

    def _desktop_register(self, path: str, desktop: bool) -> None:
        arguments = ["/usr/libexec/gnozzard", "desktop-register", path]
        if desktop:
            arguments.append("--desktop")
        Gio.Subprocess.new(arguments, Gio.SubprocessFlags.NONE)

    def get_file_items(self, files):
        if len(files) != 1:
            return []
        selected = files[0]
        location = selected.get_location()
        if location is None or not location.is_native():
            return []
        path = location.get_path()
        lowered = path.lower()
        if lowered.endswith(".deb"):
            install = Nautilus.MenuItem(
                name="Gnozzard::DebInstall",
                label="Install Debian Package…",
                tip="Confirm and install this package with dependency resolution",
            )
            install.connect("activate", lambda _item: self._command("install-deb", path))
            return [install]

        if lowered.endswith(".desktop"):
            run = Nautilus.MenuItem(
                name="Gnozzard::DesktopRun",
                label="Run Desktop Launcher",
                tip="Validate and run this local desktop launcher",
            )
            run.connect("activate", lambda _item: self._command("desktop-launch", path))
            applications = Nautilus.MenuItem(
                name="Gnozzard::DesktopApplications",
                label="Add Launcher to Applications",
                tip="Install this desktop launcher for the current user",
            )
            applications.connect(
                "activate", lambda _item: self._desktop_register(path, False)
            )
            desktop = Nautilus.MenuItem(
                name="Gnozzard::DesktopDesktop",
                label="Add Launcher to Desktop",
                tip="Install this launcher and create a trusted desktop shortcut",
            )
            desktop.connect(
                "activate", lambda _item: self._desktop_register(path, True)
            )
            return [run, applications, desktop]

        if not lowered.endswith(".appimage"):
            return []

        run = Nautilus.MenuItem(
            name="Gnozzard::AppImageRun",
            label="Run AppImage",
            tip="Mark this AppImage executable and run it",
        )
        run.connect("activate", lambda _item: self._command("launch", path))
        extract_run = Nautilus.MenuItem(
            name="Gnozzard::AppImageExtractRun",
            label="Extract and Run AppImage (Persistent)",
            tip="Reuse or create a persistent .extracted folder beside this AppImage",
        )
        extract_run.connect(
            "activate", lambda _item: self._command("extract-and-run", path)
        )
        extract_run_no_sandbox = Nautilus.MenuItem(
            name="Gnozzard::AppImageExtractRunNoSandbox",
            label="Extract and Run --no-sandbox",
            tip="Extract persistently and request approval to disable the app sandbox",
        )
        extract_run_no_sandbox.connect(
            "activate",
            lambda _item: self._command("extract-and-run-no-sandbox", path),
        )

        applications = Nautilus.MenuItem(
            name="Gnozzard::AppImageApplications",
            label="Add AppImage to Applications",
            tip="Create an Applications menu entry for this AppImage",
        )
        applications.connect("activate", lambda _item: self._register(path, False))
        desktop = Nautilus.MenuItem(
            name="Gnozzard::AppImageDesktop",
            label="Add AppImage to Desktop",
            tip="Create Applications and desktop entries for this AppImage",
        )
        desktop.connect("activate", lambda _item: self._register(path, True))
        return [run, extract_run, extract_run_no_sandbox, applications, desktop]
