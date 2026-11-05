/* SPDX-License-Identifier: AGPL-3.0-only */

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";
// This pane loads in the Preferences window. Keep its runtime/remote/shutdown
// owners in the shared system global instead of instantiating them in that window.
const { loginAutostart, setLoginAutostart } = ChromeUtils.importESModule(
  "resource:///modules/DesktopAutostart.sys.mjs"
);

Preferences.addSetting({
  id: "taskarianStartOnLogin",
  enabled: false,
  busy: true,
  error: "",
  setup(emitChange) {
    loginAutostart().then(enabled => {
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
      await setLoginAutostart(enabled);
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

SettingGroupManager.registerGroup("taskarianDesktop", {
  l10nId: "taskarian-desktop-heading",
  items: [
    { id: "taskarianStartOnLogin", l10nId: "taskarian-start-on-login" },
  ],
});
