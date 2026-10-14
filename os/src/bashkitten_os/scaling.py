# SPDX-License-Identifier: MIT
# Scaling algorithms adapted from PeGPU v0.1.106 (aae5382f).
# Changes: owning session only, dynamic panels, shared settings, no WM restart.
from __future__ import annotations
import fcntl, os, subprocess, time
from pathlib import Path
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterable
from .common import settings, owned_session
SUPPORTED_SCALES = ("1", "1.25", "1.50", "1.75", "2", "2.25", "2.50", "2.75", "3")
LOCK_WAIT_SECONDS = 2.0

def lock_path():
    return Path(os.environ.get("XDG_RUNTIME_DIR", os.environ.get("TMPDIR", "/tmp"))) / f"bashkitten-os-scale-{os.getuid()}.lock"

@dataclass(frozen=True)
class ScaleProfile:
    gtk_scale: int
    dpi: int
    cursor: int
    gtk_menu_icon: int
    gtk_large_toolbar_icon: int
    gtk_dnd_icon: int
    gtk_dialog_icon: int
    panel: int
    desktop_icon: int
    title_points: int


SCALE_PROFILES: dict[str, ScaleProfile] = {
    "1": ScaleProfile(1, 96, 24, 20, 28, 40, 48, 32, 48, 9),
    "1.25": ScaleProfile(1, 120, 30, 25, 35, 50, 60, 40, 60, 10),
    "1.50": ScaleProfile(1, 144, 36, 30, 42, 60, 72, 48, 72, 11),
    "1.75": ScaleProfile(1, 168, 42, 35, 49, 70, 84, 56, 84, 11),
    "2": ScaleProfile(2, 96, 48, 20, 28, 40, 48, 40, 48, 12),
    "2.25": ScaleProfile(2, 108, 54, 23, 32, 45, 54, 45, 54, 13),
    "2.50": ScaleProfile(2, 120, 60, 25, 35, 50, 60, 50, 60, 14),
    "2.75": ScaleProfile(2, 132, 66, 28, 39, 55, 66, 55, 66, 15),
    "3": ScaleProfile(3, 96, 72, 20, 28, 40, 48, 40, 48, 16),
}


@dataclass(frozen=True)
class XfconfSetting:
    channel: str
    path: str
    value_type: str


@dataclass(frozen=True)
class PlannedSetting:
    setting: XfconfSetting
    value: str


@contextmanager
def scale_transaction(wait_seconds: float = LOCK_WAIT_SECONDS) -> Iterable[None]:
    path = lock_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as lock_file:
        deadline = time.monotonic() + wait_seconds
        while True:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError as exc:
                if time.monotonic() >= deadline:
                    raise RuntimeError("BashKitten OS scaling is already applying changes; try again in a moment") from exc
                time.sleep(0.05)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def display_name(display: str | None = None) -> str:
    return (display or os.environ.get("DISPLAY") or "").strip()


def require_display(display: str | None = None) -> str:
    resolved = display_name(display)
    if not resolved:
        raise RuntimeError("DISPLAY is not set; run inside an X11 session or pass --display")
    return resolved


def run_command(
    args: list[str],
    env: dict[str, str] | None = None,
    check: bool = False,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        env=env,
        input=input_text,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=check,
        timeout=15,
    )


def xrdb_resources(env: dict[str, str]) -> dict[str, str] | None:
    result = run_command(["xrdb", "-query"], env=env)
    if result.returncode != 0:
        return None
    resources: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if ":" not in line:
            continue
        name, value = line.split(":", 1)
        name = name.strip()
        if name:
            resources[name] = value.strip()
    return resources


def xrdb_load(resources: dict[str, str], env: dict[str, str]) -> None:
    data = "".join(f"{name}: {value}\n" for name, value in resources.items())
    run_command(["xrdb", "-load"], env=env, input_text=data)


def apply_xcursor_size(size: int, env: dict[str, str]) -> bool:
    resources = xrdb_resources(env)
    if resources is None:
        return False
    value = str(size)
    if resources.get("Xcursor.size") == value:
        return False
    resources["Xcursor.size"] = value
    xrdb_load(resources, env)
    return True


def xfconf_set(setting: XfconfSetting, value: str, env: dict[str, str]) -> None:
    base = ["xfconf-query", "-c", setting.channel, "-p", setting.path]
    result = run_command(base + ["-s", value], env=env)
    if result.returncode == 0:
        return
    created = run_command(base + ["-n", "-t", setting.value_type, "-s", value], env=env)
    if created.returncode != 0:
        raise RuntimeError(created.stderr.strip() or f"failed to set {setting.channel} {setting.path}")


def xfconf_remove(setting: XfconfSetting, env: dict[str, str]) -> None:
    run_command(["xfconf-query", "-c", setting.channel, "-p", setting.path, "-r"], env=env)


def xfconf_get(setting: XfconfSetting, env: dict[str, str]) -> str | None:
    result = run_command(["xfconf-query", "-c", setting.channel, "-p", setting.path], env=env)
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def xfconf_values_equal(setting: XfconfSetting, current: str | None, expected: str) -> bool:
    if current is None:
        return False
    if setting.value_type == "bool":
        return current.lower() == expected.lower()
    return current == expected


def xfconf_set_if_needed(setting: XfconfSetting, value: str, env: dict[str, str]) -> bool:
    if xfconf_values_equal(setting, xfconf_get(setting, env), value):
        return False
    xfconf_set(setting, value, env)
    return True


def normalize_scale(raw: str | float | int) -> str:
    text = str(raw).strip()
    try:
        value = float(text)
    except ValueError as exc:
        raise ValueError(f"unsupported scale: {raw}") from exc
    for label in SUPPORTED_SCALES:
        if abs(float(label) - value) < 0.001:
            return label
    raise ValueError(f"unsupported scale: {raw}")


def scale_number(label: str) -> float:
    return float(normalize_scale(label))


def scale_profile(label: str) -> ScaleProfile:
    return SCALE_PROFILES[normalize_scale(label)]


def gtk_icon_sizes(profile: ScaleProfile) -> str:
    sizes = {
        "gtk-menu": profile.gtk_menu_icon,
        "gtk-button": profile.gtk_menu_icon,
        "gtk-small-toolbar": profile.gtk_menu_icon,
        "gtk-large-toolbar": profile.gtk_large_toolbar_icon,
        "gtk-dnd": profile.gtk_dnd_icon,
        "gtk-dialog": profile.gtk_dialog_icon,
    }
    return ":".join(f"{name}={value},{value}" for name, value in sizes.items())


def scale_plan(label, panels):
    profile = scale_profile(label)
    plan = [
        ("xsettings", "/Xft/DPI", "int", profile.dpi),
        ("xsettings", "/Gdk/WindowScalingFactor", "int", profile.gtk_scale),
        ("xsettings", "/Gtk/CursorThemeSize", "int", profile.cursor),
        ("xsettings", "/Gtk/IconSizes", "string", gtk_icon_sizes(profile)),
        ("xfwm4", "/general/title_font", "string", f"Sans Bold {profile.title_points}"),
        ("xfce4-desktop", "/desktop-icons/icon-size", "uint", profile.desktop_icon),
    ]
    plan.extend(("xfce4-panel", f"/panels/panel-{panel}/size", "uint", profile.panel) for panel in panels)
    return plan


def apply_scale(label):
    owned_session()
    label = normalize_scale(label)
    profile = scale_profile(label)
    env = os.environ.copy()
    result = run_command(["xfconf-query", "-c", "xfce4-panel", "-p", "/panels"], env, check=True)
    plan = scale_plan(label, [int(panel) for panel in result.stdout.splitlines() if panel.strip().isdigit()])
    with scale_transaction():
        # Match the packaged decoration to the GDK integer factor, preserving a
        # deliberately selected third-party Xfwm theme. No WM replacement.
        theme=XfconfSetting('xfwm4','/general/theme','string')
        current=xfconf_get(theme,env)
        for family in ('BashKitten','BashKitten-Touch'):
            if current in (family,f'{family}-2x',f'{family}-3x'):
                xfconf_set_if_needed(theme,family if profile.gtk_scale==1 else f'{family}-{profile.gtk_scale}x',env)
                break
        for channel, path, kind, value in plan:
            xfconf_set_if_needed(XfconfSetting(channel, path, kind), str(value), env)
        apply_xcursor_size(profile.cursor, env)
        settings().set_string("scale", label)
    return label
