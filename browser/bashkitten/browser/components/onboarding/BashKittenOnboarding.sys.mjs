/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { BashKittenThemeColors } from "resource:///modules/BashKittenThemeColors.sys.mjs";

const SPLIT_BACKGROUND =
  "var(--bashkitten-onboarding-split-background, linear-gradient(135deg, color-mix(in srgb, var(--button-background-color-primary) 14%, var(--background-color-canvas)), var(--background-color-canvas)))";

function splitContent(content) {
  return {
    fullscreen: true,
    position: "split",
    progress_bar: true,
    background: SPLIT_BACKGROUND,
    split_content_justify_content: "center",
    ...content,
  };
}

function bashkittenAction(action, value, navigate = false) {
  return {
    type: "BASHKITTEN_ONBOARDING",
    navigate,
    data: {
      action,
      value,
    },
  };
}

function customizeSettingsAction(args) {
  return {
    type: "MULTI_ACTION",
    navigate: true,
    data: {
      orderedExecution: true,
      actions: [
        {
          type: "OPEN_ABOUT_PAGE",
          data: {
            args,
            where: "tabshifted",
          },
        },
      ],
    },
  };
}

function themeModeTile(mode, stringId) {
  return {
    id: `bashkitten-theme-mode-${mode}`,
    type: "bashkitten-theme-mode-option",
    label: {
      string_id: stringId,
    },
    icon: {},
    action: bashkittenAction("theme-mode", mode),
  };
}

function themeColorTile({ id, labelId, swatch }) {
  return {
    id: `bashkitten-color-${id}`,
    type: "bashkitten-color-option",
    label: {
      string_id: labelId,
    },
    icon: {
      background: swatch,
    },
    action: bashkittenAction("theme-color", id),
  };
}

function styleTile(style) {
  return {
    id: `bashkitten-style-${style}`,
    label: {
      string_id: `bashkitten-onboarding-style-${style}-label`,
    },
    body: {
      string_id: `bashkitten-onboarding-style-${style}-body`,
    },
    icon: {
      background: `center / contain no-repeat url('chrome://browser/content/bashkitten/style/bashkitten-style-${style}.svg')`,
    },
    action: bashkittenAction("style", style),
  };
}

function densityTile(density, stringId) {
  return {
    id: `bashkitten-density-${density}`,
    type: "bashkitten-density-option",
    label: {
      string_id: stringId,
    },
    icon: {},
    action: bashkittenAction("density", density),
  };
}

function layoutTile({ id, labelId, bodyId, icon }) {
  return {
    id: `bashkitten-layout-${id}`,
    label: {
      string_id: labelId,
    },
    body: {
      string_id: bodyId,
    },
    icon: {
      background: `center / contain no-repeat url('${icon}')`,
    },
    action: bashkittenAction("layout", id),
  };
}

function tabLocationTile(location, stringId) {
  return {
    id: `bashkitten-location-${location}`,
    type: "bashkitten-location-option",
    label: {
      string_id: stringId,
    },
    icon: {},
    action: bashkittenAction("tab-location", location),
  };
}

const BASHKITTEN_ONBOARDING = {
  id: "BASHKITTEN_ONBOARDING",
  template: "multistage",
  transitions: Services.prefs.getBoolPref(
    "browser.aboutwelcome.transitions",
    true
  ),
  backdrop:
    "var(--mr-welcome-background-color) var(--mr-welcome-background-gradient)",
  screens: [
    {
      id: "AW_BASHKITTEN_WELCOME",
      content: splitContent({
        logo: {
          imageURL: "chrome://branding/content/about-logo.svg",
          height: "80px",
          width: "80px",
        },
        title: {
          string_id: "bashkitten-onboarding-welcome-title",
        },
        subtitle: {
          string_id: "bashkitten-onboarding-welcome-subtitle",
        },
        primary_button: {
          label: {
            string_id: "bashkitten-onboarding-start-button",
          },
          action: {
            navigate: true,
          },
        },
      }),
    },
    {
      id: "AW_BASHKITTEN_STYLE",
      content: splitContent({
        logo: {},
        title: {
          string_id: "bashkitten-onboarding-style-title",
        },
        subtitle: {
          string_id: "bashkitten-onboarding-style-subtitle",
        },
        tiles: [
          {
            type: "single-select",
            class_name: "bashkitten-style",
            selected: "bashkitten-style-nova",
            action: {
              picker: "<event>",
            },
            data: [styleTile("nova"), styleTile("proton"), styleTile("photon")],
          },
          {
            type: "single-select",
            class_name: "bashkitten-density",
            selected: "bashkitten-density-compact",
            action: {
              picker: "<event>",
            },
            data: [
              densityTile(
                "compact",
                "bashkitten-onboarding-density-compact-label"
              ),
              densityTile(
                "normal",
                "bashkitten-onboarding-density-normal-label"
              ),
            ],
          },
        ],
        primary_button: {
          label: {
            string_id: "bashkitten-onboarding-continue-button",
          },
          action: {
            navigate: true,
          },
        },
        secondary_button: {
          label: {
            string_id: "bashkitten-onboarding-customize-appearance-button",
          },
          action: customizeSettingsAction("preferences#appearance"),
        },
      }),
    },
    {
      id: "AW_BASHKITTEN_THEME_COLOR",
      content: splitContent({
        title: {
          string_id: "bashkitten-onboarding-theme-color-title",
        },
        subtitle: {
          string_id: "bashkitten-onboarding-theme-color-subtitle",
        },
        tiles: [
          {
            type: "single-select",
            class_name: "bashkitten-theme-mode",
            selected: "bashkitten-theme-mode-system",
            action: {
              picker: "<event>",
            },
            data: [
              themeModeTile(
                "system",
                "bashkitten-onboarding-theme-mode-system-label"
              ),
              themeModeTile(
                "light",
                "bashkitten-onboarding-theme-mode-light-label"
              ),
              themeModeTile(
                "dark",
                "bashkitten-onboarding-theme-mode-dark-label"
              ),
            ],
          },
          {
            type: "single-select",
            class_name: "bashkitten-color-grid",
            selected: "bashkitten-color-default",
            action: {
              picker: "<event>",
            },
            data: BashKittenThemeColors.colors.map(themeColorTile),
          },
        ],
        primary_button: {
          label: {
            string_id: "bashkitten-onboarding-save-continue-button",
          },
          action: {
            navigate: true,
          },
        },
        secondary_button: {
          label: {
            string_id: "bashkitten-onboarding-skip-step-button",
          },
          has_arrow_icon: true,
          action: {
            navigate: true,
          },
        },
      }),
    },
    {
      id: "AW_BASHKITTEN_TABS",
      content: splitContent({
        logo: {},
        title: {
          string_id: "bashkitten-onboarding-tabs-title",
        },
        subtitle: {
          string_id: "bashkitten-onboarding-tabs-subtitle",
        },
        tiles: [
          {
            type: "single-select",
            selected: "bashkitten-layout-horizontal",
            action: {
              picker: "<event>",
            },
            data: [
              layoutTile({
                id: "horizontal",
                labelId: "bashkitten-onboarding-tabs-horizontal-label",
                bodyId: "bashkitten-onboarding-tabs-horizontal-body",
                icon: "chrome://browser/content/bashkitten/onboarding/browser-layout-horizontal.svg",
              }),
              layoutTile({
                id: "vertical",
                labelId: "bashkitten-onboarding-tabs-vertical-label",
                bodyId: "bashkitten-onboarding-tabs-vertical-body",
                icon: "chrome://browser/content/bashkitten/onboarding/browser-layout-vertical.svg",
              }),
              layoutTile({
                id: "tree",
                labelId: "bashkitten-onboarding-tabs-tree-label",
                bodyId: "bashkitten-onboarding-tabs-tree-body",
                icon: "chrome://browser/content/bashkitten/onboarding/browser-layout-tree.svg",
              }),
            ],
          },
          {
            type: "single-select",
            class_name: "bashkitten-tab-location",
            selected: "bashkitten-location-topabove",
            action: {
              picker: "<event>",
            },
            data: [
              tabLocationTile(
                "topabove",
                "bashkitten-onboarding-location-top-above-label"
              ),
              tabLocationTile(
                "topbelow",
                "bashkitten-onboarding-location-top-below-label"
              ),
              tabLocationTile(
                "bottomabove",
                "bashkitten-onboarding-location-bottom-above-label"
              ),
              tabLocationTile(
                "bottombelow",
                "bashkitten-onboarding-location-bottom-below-label"
              ),
            ],
          },
        ],
        primary_button: {
          label: {
            string_id: "bashkitten-onboarding-continue-button",
          },
          action: {
            navigate: true,
          },
        },
        secondary_button: {
          label: {
            string_id: "bashkitten-onboarding-customize-tabs-button",
          },
          action: customizeSettingsAction("preferences#tabsBrowsing"),
        },
      }),
    },
    {
      id: "AW_BASHKITTEN_PRIVACY",
      content: splitContent({
        logo: {},
        title: {
          string_id: "bashkitten-onboarding-privacy-title",
        },
        subtitle: {
          string_id: "bashkitten-onboarding-privacy-subtitle",
        },
        primary_button: {
          label: {
            string_id: "bashkitten-onboarding-privacy-primary-button",
          },
          action: bashkittenAction("privacy-defaults", true, true),
        },
        secondary_button: {
          label: {
            string_id: "bashkitten-onboarding-customize-privacy-button",
          },
          action: customizeSettingsAction("preferences#adBlocking"),
        },
      }),
    },
    {
      id: "AW_BASHKITTEN_DEFAULT_BROWSER",
      targeting: "needDefault",
      content: splitContent({
        logo: {},
        title: {
          string_id: "bashkitten-onboarding-default-title",
        },
        subtitle: {
          string_id: "bashkitten-onboarding-default-subtitle",
        },
        primary_button: {
          label: {
            string_id: "bashkitten-onboarding-default-primary-button",
          },
          action: {
            type: "SET_DEFAULT_BROWSER",
            navigate: true,
          },
        },
        secondary_button: {
          label: {
            string_id: "bashkitten-onboarding-skip-button",
          },
          action: {
            navigate: true,
          },
        },
      }),
    },
    {
      id: "AW_BASHKITTEN_FINISH",
      content: splitContent({
        logo: {
          imageURL: "chrome://branding/content/about-logo.svg",
          height: "80px",
          width: "80px",
        },
        title: {
          string_id: "bashkitten-onboarding-finish-title",
        },
        subtitle: {
          string_id: "bashkitten-onboarding-finish-subtitle",
        },
        primary_button: {
          label: {
            string_id: "bashkitten-onboarding-finish-primary-button",
          },
          action: {
            type: "OPEN_ABOUT_PAGE",
            navigate: true,
            data: {
              args: "home",
              where: "current",
            },
          },
        },
      }),
    },
  ],
};

export const BashKittenOnboarding = {
  getDefaults() {
    return Cu.cloneInto(BASHKITTEN_ONBOARDING, {});
  },
};
