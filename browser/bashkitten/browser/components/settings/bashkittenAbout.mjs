/* SPDX-License-Identifier: AGPL-3.0-or-later */

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";

Preferences.addSetting({
  id: "bashkittenAboutDescription",
  getControlConfig(config) {
    config.l10nArgs = {
      version: Services.appinfo.version,
      engine: Services.appinfo.platformVersion,
    };
    return config;
  },
});

const links = [
  ["bashkittenEngineLicenses", "bashkitten-engine-licenses", "about:license"],
  [
    "bashkittenAboutSource",
    "bashkitten-about-source",
    "https://github.com/openresearchtools/bashkitten",
  ],
  ["bashkittenAboutBuild", "bashkitten-about-build", "about:buildconfig"],
  [
    "bashkittenAboutSupport",
    "bashkitten-about-support",
    "https://github.com/openresearchtools/bashkitten/issues",
  ],
];
for (const [id] of links) {
  Preferences.addSetting({ id });
}

Preferences.addSetting({
  id: "bashkittenAboutLicenses",
  onUserClick(event) {
    event.preventDefault();
    window.browsingContext.topChromeWindow.BashKittenAgent.licenses();
  },
});
Preferences.addSetting({ id: "bashkittenPackageUpdatesDescription" });
Preferences.addSetting({ id: "bashkittenReleases" });

Preferences.addSetting({
  id: "bashkittenCheckSpelling",
  pref: "layout.spellcheckDefault",
  get: value => value !== 0,
  set: value => (value ? 1 : 0),
});

SettingGroupManager.registerGroups({
  bashkittenAbout: {
    headingLevel: 2,
    items: [
      {
        id: "bashkittenAboutDescription",
        l10nId: "bashkitten-about-description",
        control: "moz-box-item",
      },
    ],
  },
  bashkittenPackageUpdates: {
    headingLevel: 2,
    l10nId: "bashkitten-updates-heading",
    items: [
      {
        id: "bashkittenPackageUpdatesDescription",
        l10nId: "bashkitten-updates-description",
        control: "moz-box-item",
      },
      {
        id: "bashkittenReleases",
        l10nId: "bashkitten-updates-releases",
        control: "moz-box-link",
        controlAttrs: {
          href: "https://github.com/openresearchtools/bashkitten/releases",
        },
      },
    ],
  },
  bashkittenAboutLinks: {
    headingLevel: 2,
    l10nId: "bashkitten-about-project-heading",
    items: [
      {
        id: "bashkittenAboutLicenses",
        l10nId: "bashkitten-about-licenses",
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
  bashkittenSpelling: {
    headingLevel: 2,
    l10nId: "bashkitten-spelling-heading",
    items: [
      {
        id: "bashkittenCheckSpelling",
        l10nId: "bashkitten-spelling-enabled",
      },
    ],
  },
});
