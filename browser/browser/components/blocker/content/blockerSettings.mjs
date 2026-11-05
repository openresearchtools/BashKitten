/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gSubDialog */

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  addonDisplayName: "resource:///modules/TaskarianBlockerUtils.sys.mjs",
  isEnabledAdblockAddon: "resource:///modules/TaskarianBlockerUtils.sys.mjs",
});

Preferences.addAll([
  { id: "taskarian.blocker.enabled", type: "bool" },
  { id: "cookiebanners.service.mode", type: "int" },
  { id: "cookiebanners.service.mode.privateBrowsing", type: "int" },
]);

Preferences.addSetting({
  id: "taskarian-blocker-enabled",
  pref: "taskarian.blocker.enabled",
});

Preferences.addSetting({
  id: "taskarian-cookie-banners-enabled",
  pref: "cookiebanners.service.mode",
  get(mode) {
    return mode !== Ci.nsICookieBannerService.MODE_DISABLED;
  },
  set(enabled) {
    const mode = enabled
      ? Ci.nsICookieBannerService.MODE_REJECT
      : Ci.nsICookieBannerService.MODE_DISABLED;
    Preferences.get("cookiebanners.service.mode.privateBrowsing").value = mode;
    return mode;
  },
});

Preferences.addSetting({
  id: "taskarian-blocker-extension-notice",
  deps: ["taskarian-blocker-enabled"],
  _extensionName: "",
  setup(emitChange, deps) {
    const refresh = () => {
      lazy.AddonManager.getAddonsByTypes(["extension"]).then(
        addons => {
          const detected = addons.find(addon =>
            lazy.isEnabledAdblockAddon(addon)
          );
          const detectedName = detected
            ? lazy.addonDisplayName(detected) || ""
            : "";
          if (detectedName !== this._extensionName) {
            this._extensionName = detectedName;
            emitChange();
          }
        },
        () => {}
      );
    };
    refresh();
    deps["taskarian-blocker-enabled"].on("change", refresh);
    return () => deps["taskarian-blocker-enabled"].off("change", refresh);
  },
  visible(deps) {
    return !deps["taskarian-blocker-enabled"].value && !!this._extensionName;
  },
  getControlConfig(config) {
    return {
      ...config,
      l10nArgs: { extensionName: this._extensionName },
    };
  },
});

Preferences.addSetting({ id: "taskarianBlockerListsBoxGroup" });

Preferences.addSetting({
  id: "taskarian-blocker-manage-lists",
  onUserClick(e) {
    e.preventDefault();
    gSubDialog.open(
      "chrome://browser/content/preferences/dialogs/taskarianBlockerFilterLists.xhtml"
    );
  },
});

Preferences.addSetting({
  id: "taskarian-blocker-custom-lists",
  onUserClick(e) {
    e.preventDefault();
    gSubDialog.open(
      "chrome://browser/content/preferences/dialogs/taskarianBlockerCustomFilterLists.xhtml"
    );
  },
});

Preferences.addSetting({
  id: "taskarian-blocker-my-filters",
  onUserClick(e) {
    e.preventDefault();
    gSubDialog.open(
      "chrome://browser/content/preferences/dialogs/taskarianBlockerCustomFilters.xhtml"
    );
  },
});

Preferences.addSetting({
  id: "taskarian-blocker-exceptions",
  onUserClick(e) {
    e.preventDefault();
    gSubDialog.open(
      "chrome://browser/content/preferences/dialogs/permissions.xhtml",
      undefined,
      {
        permissionType: "taskarian-blocker",
        disableETPVisible: true,
        prefilledHost: "",
        hideStatusColumn: true,
      }
    );
  },
});

SettingGroupManager.registerGroups({
  taskarianBlocker: {
    l10nId: "taskarian-blocker-group",
    headingLevel: 2,
    items: [
      {
        id: "taskarian-blocker-enabled",
        l10nId: "taskarian-blocker-enabled-toggle",
        control: "moz-toggle",
        controlAttrs: {
          searchkeywords: "adblock adblocker ublock filter",
        },
      },
      {
        id: "taskarian-cookie-banners-enabled",
        l10nId: "taskarian-cookie-banners-enabled-toggle",
        control: "moz-toggle",
        controlAttrs: {
          searchkeywords: "cookies consent banners reject dismiss hide",
        },
      },
      {
        id: "taskarian-blocker-extension-notice",
        l10nId: "taskarian-blocker-extension-notice",
        control: "moz-message-bar",
        controlAttrs: {
          role: "status",
        },
      },
    ],
  },
  taskarianBlockerLists: {
    l10nId: "taskarian-blocker-lists-group",
    headingLevel: 2,
    items: [
      {
        id: "taskarianBlockerListsBoxGroup",
        control: "moz-box-group",
        items: [
          {
            id: "taskarian-blocker-manage-lists",
            l10nId: "taskarian-blocker-manage-lists-button",
            control: "moz-box-button",
            controlAttrs: {
              "search-l10n-ids":
                "taskarian-blocker-filter-lists-window.title,taskarian-blocker-filter-lists-description.value",
            },
          },
          {
            id: "taskarian-blocker-custom-lists",
            l10nId: "taskarian-blocker-custom-lists-button",
            control: "moz-box-button",
            controlAttrs: {
              "search-l10n-ids":
                "taskarian-blocker-custom-filter-lists-window.title,taskarian-blocker-custom-filter-lists-description",
            },
          },
          {
            id: "taskarian-blocker-my-filters",
            l10nId: "taskarian-blocker-my-filters-button",
            control: "moz-box-button",
            controlAttrs: {
              "search-l10n-ids":
                "taskarian-blocker-custom-filters-window.title,taskarian-blocker-custom-filters-description",
            },
          },
        ],
      },
    ],
  },
  taskarianBlockerExceptions: {
    l10nId: "taskarian-blocker-exceptions-group",
    headingLevel: 2,
    items: [
      {
        id: "taskarian-blocker-exceptions",
        l10nId: "taskarian-blocker-exceptions-button",
        control: "moz-box-button",
        controlAttrs: {
          "search-l10n-ids":
            "permissions-exceptions-taskarian-blocker-window2.title,permissions-exceptions-manage-taskarian-blocker-desc",
        },
      },
    ],
  },
});
