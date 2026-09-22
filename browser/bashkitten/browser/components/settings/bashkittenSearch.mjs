/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";

const CLICK_SELECTS_ALL_PREF = "browser.urlbar.clickSelectsAll";
const DOUBLE_CLICK_SELECTS_ALL_PREF = "browser.urlbar.doubleClickSelectsAll";

const SUGGEST_GROUP_ID = "firefoxSuggest";
const SUGGEST_HEADER_ID = "locationBarGroupHeader";

// The Firefox Suggest sponsored and dismissed suggestion controls are nested
// under the address bar header. BashKitten locks Suggest off, so these never apply
// and are removed from the search pane.
const HIDDEN_SUGGEST_ITEM_IDS = [
  "firefoxSuggestAll",
  "dismissedSuggestionsDescription",
];

// Mozilla shows the Suggest brand name as the address bar header when Suggest is
// enabled; BashKitten uses a neutral "Suggestions" label instead.
const MOZ_SUGGEST_HEADER_L10N_ID = "addressbar-header-firefox-suggest-2";
const BASHKITTEN_SUGGEST_HEADER_L10N_ID =
  "bashkitten-addressbar-header-suggestions";

const ADDRESS_BAR_BEHAVIOR_ITEM = {
  id: "bashkittenAddressBarBehavior",
  l10nId: "bashkitten-search-address-bar-behavior-heading",
  control: "moz-fieldset",
  controlAttrs: {
    badge: "bashkitten-exclusive",
    headinglevel: 2,
  },
  items: [
    {
      id: "bashkittenClickSelectsAll",
      l10nId: "bashkitten-search-click-selects-all-toggle",
      control: "moz-toggle",
      controlAttrs: {
        searchkeywords: "address bar search bar click select all",
      },
    },
    {
      id: "bashkittenDoubleClickSelectsAll",
      l10nId: "bashkitten-search-double-click-selects-all-toggle",
      control: "moz-toggle",
      controlAttrs: {
        searchkeywords: "address bar search bar double click select all",
      },
    },
  ],
};

Preferences.addAll([
  { id: CLICK_SELECTS_ALL_PREF, type: "bool" },
  { id: DOUBLE_CLICK_SELECTS_ALL_PREF, type: "bool" },
]);

Preferences.addSetting({ id: "bashkittenAddressBarBehavior" });
Preferences.addSetting({
  id: "bashkittenClickSelectsAll",
  pref: CLICK_SELECTS_ALL_PREF,
});
Preferences.addSetting({
  id: "bashkittenDoubleClickSelectsAll",
  pref: DOUBLE_CLICK_SELECTS_ALL_PREF,
});

function appendAddressBarBehavior(group) {
  if (group.items.some(item => item.id === "bashkittenAddressBarBehavior")) {
    return;
  }
  group.items.push(ADDRESS_BAR_BEHAVIOR_ITEM);
}

function removeSponsoredSuggestItems(group) {
  const header = group.items.find(item => item.id === SUGGEST_HEADER_ID);
  if (!header || !Array.isArray(header.items)) {
    return;
  }
  header.items = header.items.filter(
    item => !HIDDEN_SUGGEST_ITEM_IDS.includes(item.id)
  );
}

function amendSuggestGroup(group) {
  if (!group || !Array.isArray(group.items)) {
    return;
  }
  removeSponsoredSuggestItems(group);
  appendAddressBarBehavior(group);
}

// config/search.mjs registers the firefoxSuggest group when the search pane
// loads, which is after this module. Amend it whether it is already registered
// or registers later.
try {
  amendSuggestGroup(SettingGroupManager.get(SUGGEST_GROUP_ID));
} catch (_ex) {
  // Not registered yet; the wrapper below catches it.
}

const origRegisterGroups =
  SettingGroupManager.registerGroups.bind(SettingGroupManager);
SettingGroupManager.registerGroups = groups => {
  if (groups?.[SUGGEST_GROUP_ID]) {
    amendSuggestGroup(groups[SUGGEST_GROUP_ID]);
  }
  return origRegisterGroups(groups);
};

// Rewrite the address bar header label without editing the Mozilla setting.
function wrapSuggestHeaderLabel(config) {
  if (config._bashkittenGenericLabel) {
    return;
  }
  config._bashkittenGenericLabel = true;
  const origGetControlConfig = config.getControlConfig;
  config.getControlConfig = (...args) => {
    const result = origGetControlConfig
      ? origGetControlConfig(...args)
      : args[0];
    if (result?.l10nId === MOZ_SUGGEST_HEADER_L10N_ID) {
      return { ...result, l10nId: BASHKITTEN_SUGGEST_HEADER_L10N_ID };
    }
    return result;
  };
}

const existingHeader = Preferences.getSetting(SUGGEST_HEADER_ID);
if (existingHeader) {
  wrapSuggestHeaderLabel(existingHeader.config);
}

const origAddSetting = Preferences.addSetting.bind(Preferences);
Preferences.addSetting = config => {
  if (
    config.id === SUGGEST_HEADER_ID &&
    !Preferences.getSetting(SUGGEST_HEADER_ID)
  ) {
    wrapSuggestHeaderLabel(config);
  }
  return origAddSetting(config);
};
