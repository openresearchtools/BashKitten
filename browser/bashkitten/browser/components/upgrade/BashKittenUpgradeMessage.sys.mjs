/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const DIALOG_VERSION = 153;
const ENABLED_PREF = "browser.startup.upgradeDialog.enabled";

function styleAction(value) {
  return {
    type: "BASHKITTEN_ONBOARDING",
    data: {
      action: "style",
      value,
    },
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
    action: styleAction(style),
  };
}

const BASHKITTEN_153_UPGRADE = {
  id: "BASHKITTEN_153_UPGRADE",
  template: "spotlight",
  targeting: "true",
  content: {
    id: "BASHKITTEN_153_UPGRADE",
    template: "multistage",
    modal: "tab",
    transitions: true,
    metrics: "block",
    screens: [
      {
        id: "BASHKITTEN_153_UPGRADE_WELCOME",
        content: {
          position: "center",
          screen_style: {
            width: "560px",
          },
          logo: {},
          title: {
            string_id: "bashkitten-upgrade-dialog-title",
          },
          subtitle: {
            string_id: "bashkitten-upgrade-dialog-subtitle",
          },
          primary_button: {
            label: {
              string_id: "bashkitten-upgrade-dialog-continue-button",
            },
            action: {
              navigate: true,
            },
          },
        },
      },
      {
        id: "BASHKITTEN_153_UPGRADE_APPEARANCE",
        content: {
          position: "center",
          screen_style: {
            width: "560px",
          },
          logo: {},
          title: {
            string_id: "bashkitten-upgrade-dialog-appearance-title",
          },
          subtitle: {
            string_id: "bashkitten-upgrade-dialog-appearance-subtitle",
          },
          tiles: {
            type: "single-select",
            class_name: "bashkitten-style",
            selected: "bashkitten-style-photon",
            action: {
              picker: "<event>",
            },
            data: [styleTile("photon"), styleTile("nova")],
          },
          primary_button: {
            label: {
              string_id: "bashkitten-upgrade-dialog-primary-button",
            },
            action: {
              navigate: true,
            },
          },
        },
      },
    ],
  },
};

export const BashKittenUpgradeMessage = {
  dialogVersion: DIALOG_VERSION,

  get enabled() {
    return Services.prefs.getBoolPref(ENABLED_PREF, true);
  },

  async getUpgradeMessage() {
    return Cu.cloneInto(BASHKITTEN_153_UPGRADE, {});
  },
};
