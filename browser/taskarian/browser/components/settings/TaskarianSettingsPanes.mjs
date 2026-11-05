/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { SettingPaneManager } from "chrome://browser/content/preferences/config/SettingPaneManager.mjs";
import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

if (AppConstants.platform === "linux") {
  ChromeUtils.importESModule(
    "chrome://browser/content/taskarian/settings/taskarianDesktop.mjs",
    { global: "current" }
  );
}

if (Services.prefs.getBoolPref("browser.settings-redesign.enabled", false)) {
  // The appearance and tabs panes already have Mozilla modules in their
  // slots, so the Taskarian group modules load here instead.
  const appearancePane = SettingPaneManager.get("appearance");
  appearancePane.groupIds = ["taskarianThemeColors"];
  ChromeUtils.importESModule(
    "chrome://browser/content/taskarian/settings/taskarianAppearance.mjs",
    { global: "current" }
  );

  const aboutPane = SettingPaneManager.get("about");
  aboutPane.groupIds = ["taskarianAbout", "taskarianPackageUpdates", "taskarianAboutLinks"];
  ChromeUtils.importESModule(
    "chrome://browser/content/taskarian/settings/taskarianAbout.mjs",
    { global: "current" }
  );

  const tabsPane = SettingPaneManager.get("tabsBrowsing");
  tabsPane.groupIds = [
    "taskarianTabs",
    "taskarianSpelling",
    ...tabsPane.groupIds.filter(id => id != "recommendations"),
  ];
  ChromeUtils.importESModule(
    "chrome://browser/content/taskarian/settings/taskarianTabs.mjs",
    { global: "current" }
  );

  // The local import group is registered by main.js, independently of Sync.
  const homePane = SettingPaneManager.get("home");
  if (AppConstants.platform === "linux") {
    homePane.groupIds.splice(2, 0, "taskarianDesktop");
  }
  homePane.groupIds.push("importBrowserData");

  // The Home pane's groups are registered by AboutPreferences.observe(); the
  // custom new tab URL control attaches to them at runtime, so this module only
  // needs to load before the home pane registers.
  ChromeUtils.importESModule(
    "chrome://browser/content/taskarian/settings/taskarianHome.mjs",
    { global: "current" }
  );

  // The search pane keeps its Mozilla module; taskarianSearch amends its
  // firefoxSuggest group at runtime, so it only needs to load before that pane.
  ChromeUtils.importESModule(
    "chrome://browser/content/taskarian/settings/taskarianSearch.mjs",
    { global: "current" }
  );

  // The privacy pane keeps its Mozilla module; taskarianPrivacy adjusts its Safe
  // Browsing status warning at runtime, so it only needs to load before that pane.
  ChromeUtils.importESModule(
    "chrome://browser/content/taskarian/settings/taskarianPrivacy.mjs",
    { global: "current" }
  );

  // The Taskarian notice renders where Mozilla's data collection group sits;
  // that group stays empty in builds without data reporting.
  const permissionsPane = SettingPaneManager.get("permissionsData");
  permissionsPane.groupIds = [
    "taskarianDataCollection",
    ...permissionsPane.groupIds.filter(id => id != "dataCollection"),
  ];
  ChromeUtils.importESModule(
    "chrome://browser/content/taskarian/settings/taskarianDataCollection.mjs",
    { global: "current" }
  );
}
