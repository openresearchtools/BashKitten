/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";

const TABBAR_POSITION_PREF = "browser.tabs.toolbarposition";
const BOOKMARKS_POSITION_PREF = "browser.bookmarks.toolbarposition";
const VERTICAL_TABS_PREF = "sidebar.verticalTabs";
const AUTO_GROUP_PREF = "browser.tabs.autoGroupNewTabs";
const PLACEMENT_PREF = "browser.tabs.autoGroupNewTabs.placement";

const TREE_ENABLED_PREF = "browser.tabs.verticalTabs.tree.enabled";
const TREE_AUTO_ATTACH_PREF = "browser.tabs.verticalTabs.tree.autoAttach";
const TREE_AUTO_COLLAPSE_SELECT_PREF =
  "browser.tabs.verticalTabs.tree.autoCollapse.onSelect";
const TREE_AUTO_EXPAND_ATTACH_PREF =
  "browser.tabs.verticalTabs.tree.autoExpand.onAttach";
const TREE_CLOSE_PARENT_PREF =
  "browser.tabs.verticalTabs.tree.closeParentBehavior";
const TREE_DOUBLE_CLICK_PREF =
  "browser.tabs.verticalTabs.tree.doubleClickBehavior";
const TREE_STICKY_ACTIVE_PREF =
  "browser.tabs.verticalTabs.tree.sticky.activeTab";
const TREE_PROPAGATE_MUTED_PREF =
  "browser.tabs.verticalTabs.tree.propagateMutedState";
const TREE_MAX_DEPTH_PREF = "browser.tabs.verticalTabs.tree.maxDepth";

const TOGGLES = [
  {
    id: "bashkitten-tabs-duplicate-menu",
    l10nId: "bashkitten-tabs-duplicate-menu-toggle",
    pref: "browser.tabs.duplicateTab",
    fieldset: "menu",
  },
  {
    id: "bashkitten-tabs-copy-url-menu",
    l10nId: "bashkitten-tabs-copy-url-menu-toggle",
    pref: "browser.tabs.copyurl",
    fieldset: "menu",
  },
  {
    id: "bashkitten-tabs-copy-active-url",
    l10nId: "bashkitten-tabs-copy-active-url-toggle",
    pref: "browser.tabs.copyurl.activetab",
    fieldset: "menu",
  },
  {
    id: "bashkitten-tabs-copy-all-urls-menu",
    l10nId: "bashkitten-tabs-copy-all-urls-menu-toggle",
    pref: "browser.tabs.copyallurls",
    fieldset: "menu",
  },
  {
    id: "bashkitten-tabs-restart-menu",
    l10nId: "bashkitten-tabs-restart-menu-toggle",
    pref: "browser.restart_menu.showpanelmenubtn",
    fieldset: "restart",
  },
  {
    id: "bashkitten-tabs-restart-confirm",
    l10nId: "bashkitten-tabs-restart-confirm-toggle",
    pref: "browser.restart_menu.requireconfirm",
    fieldset: "restart",
  },
  {
    id: "bashkitten-tabs-restart-clear-cache",
    l10nId: "bashkitten-tabs-restart-clear-cache-toggle",
    pref: "browser.restart_menu.purgecache",
    fieldset: "restart",
  },
  {
    id: "bashkitten-tabs-pinned-icon-only",
    l10nId: "bashkitten-tabs-pinned-icon-only-toggle",
    pref: "browser.tabs.pinnedIconOnly",
    fieldset: "display",
  },
  {
    id: "bashkitten-tabs-hide-close-buttons",
    l10nId: "bashkitten-tabs-hide-close-buttons-toggle",
    pref: "browser.tabs.closeButtons",
    fieldset: "display",
  },
  {
    id: "bashkitten-tabs-private-new-tab-button",
    l10nId: "bashkitten-tabs-private-new-tab-button-toggle",
    pref: "browser.privateTab.showNewTabButton",
    fieldset: "display",
  },
];

// sidebar.verticalTabs is already registered by the Mozilla pane module,
// so the dependency watches the pref directly instead of re adding it.
Preferences.addAll([
  { id: TABBAR_POSITION_PREF, type: "string" },
  { id: BOOKMARKS_POSITION_PREF, type: "string" },
  { id: AUTO_GROUP_PREF, type: "bool" },
  { id: PLACEMENT_PREF, type: "string" },
  { id: TREE_AUTO_ATTACH_PREF, type: "int" },
  { id: TREE_AUTO_COLLAPSE_SELECT_PREF, type: "bool" },
  { id: TREE_AUTO_EXPAND_ATTACH_PREF, type: "bool" },
  { id: TREE_CLOSE_PARENT_PREF, type: "int" },
  { id: TREE_DOUBLE_CLICK_PREF, type: "int" },
  { id: TREE_STICKY_ACTIVE_PREF, type: "bool" },
  { id: TREE_PROPAGATE_MUTED_PREF, type: "bool" },
  { id: TREE_MAX_DEPTH_PREF, type: "int" },
  ...TOGGLES.map(toggle => ({ id: toggle.pref, type: "bool" })),
]);

Preferences.addSetting({
  id: "bashkitten-vertical-tabs-active",
  get: () => Services.prefs.getBoolPref(VERTICAL_TABS_PREF, false),
  setup(emitChange) {
    Services.prefs.addObserver(VERTICAL_TABS_PREF, emitChange);
    return () => Services.prefs.removeObserver(VERTICAL_TABS_PREF, emitChange);
  },
});

Preferences.addSetting({
  id: "bashkitten-tab-bar-position",
  pref: TABBAR_POSITION_PREF,
  deps: ["bashkitten-vertical-tabs-active"],
  // The position pref only applies to the horizontal strip.
  disabled: deps => deps["bashkitten-vertical-tabs-active"].value,
});

Preferences.addSetting({
  id: "bashkitten-bookmarks-bar-position",
  pref: BOOKMARKS_POSITION_PREF,
});

Preferences.addSetting({
  id: "bashkitten-auto-group-tabs",
  pref: AUTO_GROUP_PREF,
});

Preferences.addSetting({
  id: "bashkitten-auto-group-placement",
  pref: PLACEMENT_PREF,
  deps: ["bashkitten-auto-group-tabs"],
  disabled: deps => !deps["bashkitten-auto-group-tabs"].value,
});

for (let toggle of TOGGLES) {
  Preferences.addSetting({ id: toggle.id, pref: toggle.pref });
}

// The tree master switch turns vertical tabs on alongside the tree, since the
// tree only renders in vertical mode. Turning it off leaves vertical tabs as is.
Preferences.addSetting({
  id: "bashkitten-tree-tabs-enabled",
  get: () => Services.prefs.getBoolPref(TREE_ENABLED_PREF, false),
  set: value => {
    if (value) {
      Services.prefs.setBoolPref(VERTICAL_TABS_PREF, true);
    }
    Services.prefs.setBoolPref(TREE_ENABLED_PREF, !!value);
  },
  setup(emitChange) {
    Services.prefs.addObserver(TREE_ENABLED_PREF, emitChange);
    return () => Services.prefs.removeObserver(TREE_ENABLED_PREF, emitChange);
  },
});

// Every tree behavior control follows the master switch and greys out while
// the tree is off.
for (let [id, pref] of [
  ["bashkitten-tree-auto-attach", TREE_AUTO_ATTACH_PREF],
  ["bashkitten-tree-auto-collapse-on-select", TREE_AUTO_COLLAPSE_SELECT_PREF],
  ["bashkitten-tree-auto-collapse-on-attach", TREE_AUTO_EXPAND_ATTACH_PREF],
  ["bashkitten-tree-close-parent", TREE_CLOSE_PARENT_PREF],
  ["bashkitten-tree-double-click", TREE_DOUBLE_CLICK_PREF],
  ["bashkitten-tree-sticky-active", TREE_STICKY_ACTIVE_PREF],
  ["bashkitten-tree-propagate-muted", TREE_PROPAGATE_MUTED_PREF],
  ["bashkitten-tree-max-depth", TREE_MAX_DEPTH_PREF],
]) {
  Preferences.addSetting({
    id,
    pref,
    deps: ["bashkitten-tree-tabs-enabled"],
    disabled: deps => !deps["bashkitten-tree-tabs-enabled"].value,
  });
}

for (let fieldset of [
  "bashkitten-tabs-position",
  "bashkitten-tabs-menu",
  "bashkitten-tabs-restart",
  "bashkitten-tabs-display",
  "bashkitten-tabs-grouping",
  "bashkitten-tabs-tree",
]) {
  Preferences.addSetting({ id: fieldset });
}

function toggleItems(fieldset) {
  return TOGGLES.filter(toggle => toggle.fieldset == fieldset).map(toggle => ({
    id: toggle.id,
    l10nId: toggle.l10nId,
    control: "moz-toggle",
  }));
}

SettingGroupManager.registerGroups({
  bashkittenTabs: {
    l10nId: "bashkitten-tabs-group",
    headingLevel: 2,
    controlAttrs: { badge: "bashkitten-exclusive" },
    items: [
      {
        id: "bashkitten-tabs-position",
        control: "moz-fieldset",
        l10nId: "bashkitten-tabs-position-heading",
        headingLevel: 3,
        items: [
          {
            id: "bashkitten-tab-bar-position",
            l10nId: "bashkitten-tabs-tab-bar-position-select",
            control: "moz-select",
            controlAttrs: {
              searchkeywords: "tab bar position bottom toolbar",
            },
            options: [
              {
                value: "topabove",
                l10nId: "bashkitten-tabs-tab-bar-option-top-above",
              },
              {
                value: "topbelow",
                l10nId: "bashkitten-tabs-tab-bar-option-top-below",
              },
              {
                value: "bottomabove",
                l10nId: "bashkitten-tabs-tab-bar-option-bottom-above",
              },
              {
                value: "bottombelow",
                l10nId: "bashkitten-tabs-tab-bar-option-bottom-below",
              },
            ],
          },
          {
            id: "bashkitten-bookmarks-bar-position",
            l10nId: "bashkitten-tabs-bookmarks-bar-position-select",
            control: "moz-select",
            controlAttrs: {
              searchkeywords: "bookmarks toolbar position bottom",
            },
            options: [
              {
                value: "top",
                l10nId: "bashkitten-tabs-bookmarks-bar-option-top",
              },
              {
                value: "bottom",
                l10nId: "bashkitten-tabs-bookmarks-bar-option-bottom",
              },
            ],
          },
        ],
      },
      {
        id: "bashkitten-tabs-menu",
        control: "moz-fieldset",
        l10nId: "bashkitten-tabs-menu-heading",
        headingLevel: 3,
        items: toggleItems("menu"),
      },
      {
        id: "bashkitten-tabs-restart",
        control: "moz-fieldset",
        l10nId: "bashkitten-tabs-restart-heading",
        headingLevel: 3,
        items: toggleItems("restart"),
      },
      {
        id: "bashkitten-tabs-display",
        control: "moz-fieldset",
        l10nId: "bashkitten-tabs-display-heading",
        headingLevel: 3,
        items: toggleItems("display"),
      },
      {
        id: "bashkitten-tabs-grouping",
        control: "moz-fieldset",
        l10nId: "bashkitten-tabs-grouping-heading",
        headingLevel: 3,
        items: [
          {
            id: "bashkitten-auto-group-tabs",
            l10nId: "bashkitten-tabs-auto-group-toggle",
            control: "moz-toggle",
            controlAttrs: {
              searchkeywords: "automatic tab grouping group new tabs",
            },
          },
          {
            id: "bashkitten-auto-group-placement",
            l10nId: "bashkitten-tabs-auto-group-placement-select",
            control: "moz-select",
            options: [
              {
                value: "after",
                l10nId: "bashkitten-tabs-auto-group-placement-option-after",
              },
              {
                value: "first",
                l10nId: "bashkitten-tabs-auto-group-placement-option-first",
              },
              {
                value: "last",
                l10nId: "bashkitten-tabs-auto-group-placement-option-last",
              },
            ],
          },
        ],
      },
      {
        id: "bashkitten-tabs-tree",
        control: "moz-fieldset",
        l10nId: "bashkitten-tabs-tree-heading",
        headingLevel: 3,
        items: [
          {
            id: "bashkitten-tree-tabs-enabled",
            l10nId: "bashkitten-tabs-tree-enable-toggle",
            control: "moz-toggle",
            controlAttrs: {
              searchkeywords: "tree style tabs nesting vertical",
            },
          },
          {
            id: "bashkitten-tree-auto-attach",
            l10nId: "bashkitten-tabs-tree-auto-attach-select",
            control: "moz-select",
            options: [
              {
                value: 0,
                l10nId: "bashkitten-tabs-tree-auto-attach-option-root",
              },
              {
                value: 1,
                l10nId: "bashkitten-tabs-tree-auto-attach-option-child",
              },
              {
                value: 2,
                l10nId: "bashkitten-tabs-tree-auto-attach-option-sibling",
              },
            ],
          },
          {
            id: "bashkitten-tree-auto-collapse-on-select",
            l10nId: "bashkitten-tabs-tree-auto-collapse-on-select-toggle",
            control: "moz-toggle",
          },
          {
            id: "bashkitten-tree-auto-collapse-on-attach",
            l10nId: "bashkitten-tabs-tree-auto-collapse-on-attach-toggle",
            control: "moz-toggle",
          },
          {
            id: "bashkitten-tree-close-parent",
            l10nId: "bashkitten-tabs-tree-close-parent-select",
            control: "moz-select",
            options: [
              {
                value: 0,
                l10nId:
                  "bashkitten-tabs-tree-close-parent-option-promote-first",
              },
              {
                value: 1,
                l10nId: "bashkitten-tabs-tree-close-parent-option-promote-all",
              },
              {
                value: 2,
                l10nId: "bashkitten-tabs-tree-close-parent-option-close-all",
              },
              {
                value: 3,
                l10nId: "bashkitten-tabs-tree-close-parent-option-detach",
              },
            ],
          },
          {
            id: "bashkitten-tree-double-click",
            l10nId: "bashkitten-tabs-tree-double-click-select",
            control: "moz-select",
            options: [
              {
                value: 0,
                l10nId: "bashkitten-tabs-tree-double-click-option-toggle",
              },
              {
                value: 1,
                l10nId: "bashkitten-tabs-tree-double-click-option-close",
              },
              {
                value: 2,
                l10nId: "bashkitten-tabs-tree-double-click-option-none",
              },
            ],
          },
          {
            id: "bashkitten-tree-sticky-active",
            l10nId: "bashkitten-tabs-tree-sticky-active-toggle",
            control: "moz-toggle",
          },
          {
            id: "bashkitten-tree-propagate-muted",
            l10nId: "bashkitten-tabs-tree-propagate-muted-toggle",
            control: "moz-toggle",
          },
          {
            id: "bashkitten-tree-max-depth",
            l10nId: "bashkitten-tabs-tree-max-depth-select",
            control: "moz-select",
            options: [
              {
                value: -1,
                l10nId: "bashkitten-tabs-tree-max-depth-option-unlimited",
              },
              { value: 2, controlAttrs: { label: "2" } },
              { value: 3, controlAttrs: { label: "3" } },
              { value: 4, controlAttrs: { label: "4" } },
              { value: 5, controlAttrs: { label: "5" } },
              { value: 6, controlAttrs: { label: "6" } },
            ],
          },
        ],
      },
    ],
  },
});

// Tree style tabs is a vertical tabs layout feature, so its controls render in
// the Firefox Browser layout group beneath the Show sidebar toggle instead of
// the BashKitten tabs section. Move the fieldset there and tag it as exclusive.
try {
  const tabsGroup = SettingGroupManager.get("bashkittenTabs");
  const layoutGroup = SettingGroupManager.get("browserLayout");
  const treeIndex = tabsGroup.items.findIndex(
    item => item.id == "bashkitten-tabs-tree"
  );
  const alreadyMoved = layoutGroup.items.some(
    item => item.id == "bashkitten-tabs-tree"
  );
  if (treeIndex != -1 && !alreadyMoved) {
    const [treeFieldset] = tabsGroup.items.splice(treeIndex, 1);
    treeFieldset.controlAttrs = {
      ...treeFieldset.controlAttrs,
      badge: "bashkitten-exclusive",
    };
    const sidebarIndex = layoutGroup.items.findIndex(
      item => item.id == "browserLayoutShowSidebar"
    );
    layoutGroup.items.splice(
      sidebarIndex == -1 ? layoutGroup.items.length : sidebarIndex + 1,
      0,
      treeFieldset
    );
  }
} catch (_ex) {
  // Browser layout group unavailable; leave the tree controls in place.
}
