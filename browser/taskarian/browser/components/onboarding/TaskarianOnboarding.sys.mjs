/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { TaskarianThemeColors } from "resource:///modules/TaskarianThemeColors.sys.mjs";

const SPLIT_BACKGROUND =
  "var(--taskarian-onboarding-split-background, linear-gradient(135deg, color-mix(in srgb, var(--button-background-color-primary) 14%, var(--background-color-canvas)), var(--background-color-canvas)))";

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

function taskarianAction(action, value, navigate = false) {
  return {
    type: "TASKARIAN_ONBOARDING",
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
    id: `taskarian-theme-mode-${mode}`,
    type: "taskarian-theme-mode-option",
    label: {
      string_id: stringId,
    },
    icon: {},
    action: taskarianAction("theme-mode", mode),
  };
}

function themeColorTile({ id, labelId, swatch }) {
  return {
    id: `taskarian-color-${id}`,
    type: "taskarian-color-option",
    label: {
      string_id: labelId,
    },
    icon: {
      background: swatch,
    },
    action: taskarianAction("theme-color", id),
  };
}

function styleTile(style) {
  return {
    id: `taskarian-style-${style}`,
    label: {
      string_id: `taskarian-onboarding-style-${style}-label`,
    },
    body: {
      string_id: `taskarian-onboarding-style-${style}-body`,
    },
    icon: {
      background: `center / contain no-repeat url('chrome://browser/content/taskarian/style/taskarian-style-${style}.svg')`,
    },
    action: taskarianAction("style", style),
  };
}

function densityTile(density, stringId) {
  return {
    id: `taskarian-density-${density}`,
    type: "taskarian-density-option",
    label: {
      string_id: stringId,
    },
    icon: {},
    action: taskarianAction("density", density),
  };
}

function layoutTile({ id, labelId, bodyId, icon }) {
  return {
    id: `taskarian-layout-${id}`,
    label: {
      string_id: labelId,
    },
    body: {
      string_id: bodyId,
    },
    icon: {
      background: `center / contain no-repeat url('${icon}')`,
    },
    action: taskarianAction("layout", id),
  };
}

function tabLocationTile(location, stringId) {
  return {
    id: `taskarian-location-${location}`,
    type: "taskarian-location-option",
    label: {
      string_id: stringId,
    },
    icon: {},
    action: taskarianAction("tab-location", location),
  };
}

const TASKARIAN_ONBOARDING = {
  id: "TASKARIAN_ONBOARDING",
  template: "multistage",
  transitions: Services.prefs.getBoolPref(
    "browser.aboutwelcome.transitions",
    true
  ),
  backdrop:
    "var(--mr-welcome-background-color) var(--mr-welcome-background-gradient)",
  screens: [
    {
      id: "AW_TASKARIAN_WELCOME",
      content: splitContent({
        logo: {
          imageURL: "chrome://branding/content/about-logo.svg",
          height: "80px",
          width: "80px",
        },
        title: {
          string_id: "taskarian-onboarding-welcome-title",
        },
        subtitle: {
          string_id: "taskarian-onboarding-welcome-subtitle",
        },
        primary_button: {
          label: {
            string_id: "taskarian-onboarding-start-button",
          },
          action: {
            navigate: true,
          },
        },
      }),
    },
    {
      id: "AW_TASKARIAN_STYLE",
      content: splitContent({
        logo: {},
        title: {
          string_id: "taskarian-onboarding-style-title",
        },
        subtitle: {
          string_id: "taskarian-onboarding-style-subtitle",
        },
        tiles: [
          {
            type: "single-select",
            class_name: "taskarian-style",
            selected: "taskarian-style-nova",
            action: {
              picker: "<event>",
            },
            data: [styleTile("nova"), styleTile("proton"), styleTile("photon")],
          },
          {
            type: "single-select",
            class_name: "taskarian-density",
            selected: "taskarian-density-compact",
            action: {
              picker: "<event>",
            },
            data: [
              densityTile(
                "compact",
                "taskarian-onboarding-density-compact-label"
              ),
              densityTile(
                "normal",
                "taskarian-onboarding-density-normal-label"
              ),
            ],
          },
        ],
        primary_button: {
          label: {
            string_id: "taskarian-onboarding-continue-button",
          },
          action: {
            navigate: true,
          },
        },
        secondary_button: {
          label: {
            string_id: "taskarian-onboarding-customize-appearance-button",
          },
          action: customizeSettingsAction("preferences#appearance"),
        },
      }),
    },
    {
      id: "AW_TASKARIAN_THEME_COLOR",
      content: splitContent({
        title: {
          string_id: "taskarian-onboarding-theme-color-title",
        },
        subtitle: {
          string_id: "taskarian-onboarding-theme-color-subtitle",
        },
        tiles: [
          {
            type: "single-select",
            class_name: "taskarian-theme-mode",
            selected: "taskarian-theme-mode-system",
            action: {
              picker: "<event>",
            },
            data: [
              themeModeTile(
                "system",
                "taskarian-onboarding-theme-mode-system-label"
              ),
              themeModeTile(
                "light",
                "taskarian-onboarding-theme-mode-light-label"
              ),
              themeModeTile(
                "dark",
                "taskarian-onboarding-theme-mode-dark-label"
              ),
            ],
          },
          {
            type: "single-select",
            class_name: "taskarian-color-grid",
            selected: "taskarian-color-default",
            action: {
              picker: "<event>",
            },
            data: TaskarianThemeColors.colors.map(themeColorTile),
          },
        ],
        primary_button: {
          label: {
            string_id: "taskarian-onboarding-save-continue-button",
          },
          action: {
            navigate: true,
          },
        },
        secondary_button: {
          label: {
            string_id: "taskarian-onboarding-skip-step-button",
          },
          has_arrow_icon: true,
          action: {
            navigate: true,
          },
        },
      }),
    },
    {
      id: "AW_TASKARIAN_TABS",
      content: splitContent({
        logo: {},
        title: {
          string_id: "taskarian-onboarding-tabs-title",
        },
        subtitle: {
          string_id: "taskarian-onboarding-tabs-subtitle",
        },
        tiles: [
          {
            type: "single-select",
            selected: "taskarian-layout-horizontal",
            action: {
              picker: "<event>",
            },
            data: [
              layoutTile({
                id: "horizontal",
                labelId: "taskarian-onboarding-tabs-horizontal-label",
                bodyId: "taskarian-onboarding-tabs-horizontal-body",
                icon: "chrome://browser/content/taskarian/onboarding/browser-layout-horizontal.svg",
              }),
              layoutTile({
                id: "vertical",
                labelId: "taskarian-onboarding-tabs-vertical-label",
                bodyId: "taskarian-onboarding-tabs-vertical-body",
                icon: "chrome://browser/content/taskarian/onboarding/browser-layout-vertical.svg",
              }),
              layoutTile({
                id: "tree",
                labelId: "taskarian-onboarding-tabs-tree-label",
                bodyId: "taskarian-onboarding-tabs-tree-body",
                icon: "chrome://browser/content/taskarian/onboarding/browser-layout-tree.svg",
              }),
            ],
          },
          {
            type: "single-select",
            class_name: "taskarian-tab-location",
            selected: "taskarian-location-topabove",
            action: {
              picker: "<event>",
            },
            data: [
              tabLocationTile(
                "topabove",
                "taskarian-onboarding-location-top-above-label"
              ),
              tabLocationTile(
                "topbelow",
                "taskarian-onboarding-location-top-below-label"
              ),
              tabLocationTile(
                "bottomabove",
                "taskarian-onboarding-location-bottom-above-label"
              ),
              tabLocationTile(
                "bottombelow",
                "taskarian-onboarding-location-bottom-below-label"
              ),
            ],
          },
        ],
        primary_button: {
          label: {
            string_id: "taskarian-onboarding-continue-button",
          },
          action: {
            navigate: true,
          },
        },
        secondary_button: {
          label: {
            string_id: "taskarian-onboarding-customize-tabs-button",
          },
          action: customizeSettingsAction("preferences#tabsBrowsing"),
        },
      }),
    },
    {
      id: "AW_TASKARIAN_PRIVACY",
      content: splitContent({
        logo: {},
        title: {
          string_id: "taskarian-onboarding-privacy-title",
        },
        subtitle: {
          string_id: "taskarian-onboarding-privacy-subtitle",
        },
        primary_button: {
          label: {
            string_id: "taskarian-onboarding-privacy-primary-button",
          },
          action: taskarianAction("privacy-defaults", true, true),
        },
        secondary_button: {
          label: {
            string_id: "taskarian-onboarding-customize-privacy-button",
          },
          action: customizeSettingsAction("preferences#adBlocking"),
        },
      }),
    },
    {
      id: "AW_TASKARIAN_DEFAULT_BROWSER",
      targeting: "needDefault",
      content: splitContent({
        logo: {},
        title: {
          string_id: "taskarian-onboarding-default-title",
        },
        subtitle: {
          string_id: "taskarian-onboarding-default-subtitle",
        },
        primary_button: {
          label: {
            string_id: "taskarian-onboarding-default-primary-button",
          },
          action: {
            type: "SET_DEFAULT_BROWSER",
            navigate: true,
          },
        },
        secondary_button: {
          label: {
            string_id: "taskarian-onboarding-skip-button",
          },
          action: {
            navigate: true,
          },
        },
      }),
    },
    {
      id: "AW_TASKARIAN_FINISH",
      content: splitContent({
        logo: {
          imageURL: "chrome://branding/content/about-logo.svg",
          height: "80px",
          width: "80px",
        },
        title: {
          string_id: "taskarian-onboarding-finish-title",
        },
        subtitle: {
          string_id: "taskarian-onboarding-finish-subtitle",
        },
        primary_button: {
          label: {
            string_id: "taskarian-onboarding-finish-primary-button",
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

export const TaskarianOnboarding = {
  getDefaults() {
    return Cu.cloneInto(TASKARIAN_ONBOARDING, {});
  },
};
