/* SPDX-License-Identifier: AGPL-3.0-only */

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";
import { DesktopLifetime } from "resource:///modules/DesktopLifetime.sys.mjs";

const KEEP = "bashkitten.desktop.keepInTray";
const AUTOSTART = "[Desktop Entry]\nType=Application\nName=BashKitten\nExec=/usr/bin/bashkitten --start-in-tray\nTryExec=/usr/bin/bashkitten\nIcon=com.bashkitten\nTerminal=false\nStartupNotify=false\n";

function startupFile() {
  const xdg = Services.env.get("XDG_CONFIG_HOME");
  const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
  return PathUtils.join(xdg && PathUtils.isAbsolute(xdg) ? xdg : PathUtils.join(home, ".config"), "autostart", "com.bashkitten.desktop");
}

async function readStartup() {
  const file = startupFile();
  if (!await IOUtils.exists(file)) return false;
  if (await IOUtils.readUTF8(file) !== AUTOSTART) throw new Error("The BashKitten autostart file was edited outside the browser. Update or remove it there first.");
  return true;
}

Preferences.addSetting({
  id: "bashkittenStartOnLogin",
  enabled: false,
  busy: true,
  error: "",
  setup(emitChange) {
    readStartup().then(enabled => {
      this.enabled = enabled;
      this.busy = false;
      emitChange();
    }).catch(error => {
      this.error = error.message;
      emitChange();
    });
  },
  get() { return this.enabled; },
  disabled() { return this.busy; },
  async set(enabled, _deps, setting) {
    this.busy = true;
    this.error = "";
    setting.onChange();
    try {
      await readStartup();
      const file = startupFile();
      if (enabled) {
        await IOUtils.makeDirectory(PathUtils.parent(file), { permissions: 0o700, ignoreExisting: true });
        await IOUtils.writeUTF8(file, AUTOSTART, { tmpPath: file + ".tmp", flush: true });
      } else await IOUtils.remove(file, { ignoreAbsent: true });
      this.enabled = enabled;
    } catch (error) {
      this.error = error.message;
    } finally {
      this.busy = false;
      setting.onChange();
    }
  },
  getControlConfig(config) {
    return { ...config, controlAttrs: { ".description": this.error } };
  },
});

Preferences.add({ id: KEEP, type: "bool" });
Preferences.addSetting({
  id: "bashkittenKeepInTray",
  pref: KEEP,
  get: value => value ?? true,
  onUserChange(enabled) {
    if (!enabled) DesktopLifetime.reveal();
  },
  setup(emitChange) {
    Services.obs.addObserver(emitChange, "bashkitten-tray-changed");
    return () => Services.obs.removeObserver(emitChange, "bashkitten-tray-changed");
  },
  getControlConfig(config, _deps, setting) {
    const description = !setting.value ? "Closing the window quits BashKitten and stops its owned services." : DesktopLifetime.tray?.available ? "Closing hides this window. Use the tray icon to reopen it or Quit to stop owned services." : "No system tray is available. The window stays reachable; closing it quits BashKitten.";
    return { ...config, controlAttrs: { ".description": description } };
  },
});

SettingGroupManager.registerGroup("bashkittenDesktop", {
  l10nId: "bashkitten-desktop-heading",
  items: [
    { id: "bashkittenStartOnLogin", l10nId: "bashkitten-start-on-login" },
    { id: "bashkittenKeepInTray", l10nId: "bashkitten-keep-in-tray" },
  ],
});
