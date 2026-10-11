/* SPDX-License-Identifier: AGPL-3.0-only */

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";
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

SettingGroupManager.registerGroup("bashkittenDesktop", {
  l10nId: "bashkitten-desktop-heading",
  items: [
    { id: "bashkittenStartOnLogin", l10nId: "bashkitten-start-on-login" },
  ],
});
