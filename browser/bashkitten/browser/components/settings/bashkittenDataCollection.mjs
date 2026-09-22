/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";

Preferences.addSetting({ id: "bashkitten-data-collection" });

SettingGroupManager.registerGroups({
  bashkittenDataCollection: {
    items: [
      {
        id: "bashkitten-data-collection",
        l10nId: "bashkitten-data-collection-group",
        control: "moz-fieldset",
        iconSrc: "chrome://global/skin/icons/trending.svg",
        controlAttrs: {
          headinglevel: 2,
          badge: "bashkitten-exclusive",
          "data-l10n-attrs": "searchkeywords",
        },
      },
    ],
  },
});
