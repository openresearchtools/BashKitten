/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";
const { TaskarianAbout } = ChromeUtils.importESModule("resource:///modules/TaskarianAbout.sys.mjs");

Preferences.addSetting({
  id: "taskarianAboutDescription",
  getControlConfig(config) {
    config.l10nArgs = {
      version: Services.appinfo.version,
      engine: Services.appinfo.platformVersion,
    };
    return config;
  },
});

const links = [
  ["taskarianEngineLicenses", "taskarian-engine-licenses", "about:license"],
  [
    "taskarianAboutSource",
    "taskarian-about-source",
    "https://github.com/openresearchtools/Taskarian",
  ],
  ["taskarianAboutBuild", "taskarian-about-build", "about:buildconfig"],
  [
    "taskarianAboutSupport",
    "taskarian-about-support",
    "https://github.com/openresearchtools/Taskarian/issues",
  ],
];
for (const [id] of links) {
  Preferences.addSetting({ id });
}

Preferences.addSetting({
  id: "taskarianAboutLicenses",
  onUserClick(event) {
    event.preventDefault();
    TaskarianAbout.licenses(window.browsingContext.topChromeWindow);
  },
});
Preferences.addSetting({ id: "taskarianPackageUpdatesDescription" });
Preferences.addSetting({ id: "taskarianReleases" });

Preferences.addSetting({
  id: "taskarianCheckSpelling",
  pref: "layout.spellcheckDefault",
  get: value => value !== 0,
  set: value => (value ? 1 : 0),
});

SettingGroupManager.registerGroups({
  taskarianAbout: {
    headingLevel: 2,
    items: [
      {
        id: "taskarianAboutDescription",
        l10nId: "taskarian-about-description",
        control: "moz-box-item",
      },
    ],
  },
  taskarianPackageUpdates: {
    headingLevel: 2,
    l10nId: "taskarian-updates-heading",
    items: [
      {
        id: "taskarianPackageUpdatesDescription",
        l10nId: "taskarian-updates-description",
        control: "moz-box-item",
      },
      {
        id: "taskarianReleases",
        l10nId: "taskarian-updates-releases",
        control: "moz-box-link",
        controlAttrs: {
          href: "https://github.com/openresearchtools/Taskarian/releases",
        },
      },
    ],
  },
  taskarianAboutLinks: {
    headingLevel: 2,
    l10nId: "taskarian-about-project-heading",
    items: [
      {
        id: "taskarianAboutLicenses",
        l10nId: "taskarian-about-licenses",
        control: "moz-box-button",
      },
      ...links.map(([id, l10nId, href]) => ({
        id,
        l10nId,
        control: "moz-box-link",
        controlAttrs: { href },
      })),
    ],
  },
  taskarianSpelling: {
    headingLevel: 2,
    l10nId: "taskarian-spelling-heading",
    items: [
      {
        id: "taskarianCheckSpelling",
        l10nId: "taskarian-spelling-enabled",
      },
    ],
  },
});
