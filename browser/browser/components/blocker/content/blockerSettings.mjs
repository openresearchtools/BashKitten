/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global gSubDialog */

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  addonDisplayName: "resource:///modules/BashKittenBlockerUtils.sys.mjs",
  isEnabledAdblockAddon: "resource:///modules/BashKittenBlockerUtils.sys.mjs",
});

Preferences.addAll([{ id: "bashkitten.blocker.enabled", type: "bool" }]);

Preferences.addSetting({
  id: "bashkitten-blocker-enabled",
  pref: "bashkitten.blocker.enabled",
});

Preferences.addSetting({
  id: "bashkitten-blocker-extension-notice",
  deps: ["bashkitten-blocker-enabled"],
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
    deps["bashkitten-blocker-enabled"].on("change", refresh);
    return () => deps["bashkitten-blocker-enabled"].off("change", refresh);
  },
  visible(deps) {
    return !deps["bashkitten-blocker-enabled"].value && !!this._extensionName;
  },
  getControlConfig(config) {
    return {
      ...config,
      l10nArgs: { extensionName: this._extensionName },
    };
  },
});

Preferences.addSetting({ id: "bashkittenBlockerListsBoxGroup" });

Preferences.addSetting({
  id: "bashkitten-blocker-manage-lists",
  onUserClick(e) {
    e.preventDefault();
    gSubDialog.open(
      "chrome://browser/content/preferences/dialogs/bashkittenBlockerFilterLists.xhtml"
    );
  },
});

Preferences.addSetting({
  id: "bashkitten-blocker-custom-lists",
  onUserClick(e) {
    e.preventDefault();
    gSubDialog.open(
      "chrome://browser/content/preferences/dialogs/bashkittenBlockerCustomFilterLists.xhtml"
    );
  },
});

Preferences.addSetting({
  id: "bashkitten-blocker-my-filters",
  onUserClick(e) {
    e.preventDefault();
    gSubDialog.open(
      "chrome://browser/content/preferences/dialogs/bashkittenBlockerCustomFilters.xhtml"
    );
  },
});

Preferences.addSetting({
  id: "bashkitten-blocker-exceptions",
  onUserClick(e) {
    e.preventDefault();
    gSubDialog.open(
      "chrome://browser/content/preferences/dialogs/permissions.xhtml",
      undefined,
      {
        permissionType: "bashkitten-blocker",
        disableETPVisible: true,
        prefilledHost: "",
        hideStatusColumn: true,
      }
    );
  },
});

SettingGroupManager.registerGroups({
  bashkittenBlocker: {
    l10nId: "bashkitten-blocker-group",
    headingLevel: 2,
    items: [
      {
        id: "bashkitten-blocker-enabled",
        l10nId: "bashkitten-blocker-enabled-toggle",
        control: "moz-toggle",
        controlAttrs: {
          searchkeywords: "adblock adblocker ublock filter",
        },
      },
      {
        id: "bashkitten-blocker-extension-notice",
        l10nId: "bashkitten-blocker-extension-notice",
        control: "moz-message-bar",
        controlAttrs: {
          role: "status",
        },
      },
    ],
  },
  bashkittenBlockerLists: {
    l10nId: "bashkitten-blocker-lists-group",
    headingLevel: 2,
    items: [
      {
        id: "bashkittenBlockerListsBoxGroup",
        control: "moz-box-group",
        items: [
          {
            id: "bashkitten-blocker-manage-lists",
            l10nId: "bashkitten-blocker-manage-lists-button",
            control: "moz-box-button",
            controlAttrs: {
              "search-l10n-ids":
                "bashkitten-blocker-filter-lists-window.title,bashkitten-blocker-filter-lists-description.value",
            },
          },
          {
            id: "bashkitten-blocker-custom-lists",
            l10nId: "bashkitten-blocker-custom-lists-button",
            control: "moz-box-button",
            controlAttrs: {
              "search-l10n-ids":
                "bashkitten-blocker-custom-filter-lists-window.title,bashkitten-blocker-custom-filter-lists-description",
            },
          },
          {
            id: "bashkitten-blocker-my-filters",
            l10nId: "bashkitten-blocker-my-filters-button",
            control: "moz-box-button",
            controlAttrs: {
              "search-l10n-ids":
                "bashkitten-blocker-custom-filters-window.title,bashkitten-blocker-custom-filters-description",
            },
          },
        ],
      },
    ],
  },
  bashkittenBlockerExceptions: {
    l10nId: "bashkitten-blocker-exceptions-group",
    headingLevel: 2,
    items: [
      {
        id: "bashkitten-blocker-exceptions",
        l10nId: "bashkitten-blocker-exceptions-button",
        control: "moz-box-button",
        controlAttrs: {
          "search-l10n-ids":
            "permissions-exceptions-bashkitten-blocker-window2.title,permissions-exceptions-manage-bashkitten-blocker-desc",
        },
      },
    ],
  },
});
