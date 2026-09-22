/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { SettingPaneManager } from "chrome://browser/content/preferences/config/SettingPaneManager.mjs";

if (Services.prefs.getBoolPref("browser.settings-redesign.enabled", false)) {
  // The appearance and tabs panes already have Mozilla modules in their
  // slots, so the BashKitten group modules load here instead.
  const appearancePane = SettingPaneManager.get("appearance");
  appearancePane.groupIds = ["bashkittenThemeColors"];
  ChromeUtils.importESModule(
    "chrome://browser/content/bashkitten/settings/bashkittenAppearance.mjs",
    { global: "current" }
  );

  const aboutPane = SettingPaneManager.get("about");
  aboutPane.groupIds = ["bashkittenAbout", "bashkittenPackageUpdates", "bashkittenAboutLinks"];
  ChromeUtils.importESModule(
    "chrome://browser/content/bashkitten/settings/bashkittenAbout.mjs",
    { global: "current" }
  );

  const tabsPane = SettingPaneManager.get("tabsBrowsing");
  tabsPane.groupIds = [
    "bashkittenTabs",
    "bashkittenSpelling",
    ...tabsPane.groupIds.filter(id => id != "recommendations"),
  ];
  ChromeUtils.importESModule(
    "chrome://browser/content/bashkitten/settings/bashkittenTabs.mjs",
    { global: "current" }
  );

  // The local import group is registered by main.js, independently of Sync.
  const homePane = SettingPaneManager.get("home");
  homePane.groupIds.push("importBrowserData");

  // The Home pane's groups are registered by AboutPreferences.observe(); the
  // custom new tab URL control attaches to them at runtime, so this module only
  // needs to load before the home pane registers.
  ChromeUtils.importESModule(
    "chrome://browser/content/bashkitten/settings/bashkittenHome.mjs",
    { global: "current" }
  );

  // The search pane keeps its Mozilla module; bashkittenSearch amends its
  // firefoxSuggest group at runtime, so it only needs to load before that pane.
  ChromeUtils.importESModule(
    "chrome://browser/content/bashkitten/settings/bashkittenSearch.mjs",
    { global: "current" }
  );

  // The privacy pane keeps its Mozilla module; bashkittenPrivacy adjusts its Safe
  // Browsing status warning at runtime, so it only needs to load before that pane.
  ChromeUtils.importESModule(
    "chrome://browser/content/bashkitten/settings/bashkittenPrivacy.mjs",
    { global: "current" }
  );

  // The BashKitten notice renders where Mozilla's data collection group sits;
  // that group stays empty in builds without data reporting.
  const permissionsPane = SettingPaneManager.get("permissionsData");
  permissionsPane.groupIds = [
    "bashkittenDataCollection",
    ...permissionsPane.groupIds.filter(id => id != "dataCollection"),
  ];
  ChromeUtils.importESModule(
    "chrome://browser/content/bashkitten/settings/bashkittenDataCollection.mjs",
    { global: "current" }
  );
}
