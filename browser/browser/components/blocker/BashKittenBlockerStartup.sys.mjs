/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  BashKittenBlockerExtensionDetector:
    "resource:///modules/BashKittenBlockerExtensionDetector.sys.mjs",
  BashKittenBlockerPanel:
    "resource:///modules/BashKittenBlockerPanel.sys.mjs",
  BashKittenBlockerService:
    "resource:///modules/BashKittenBlockerService.sys.mjs",
});

export const BashKittenBlockerStartup = {
  _initialized: false,

  init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    ChromeUtils.registerWindowActor("BashKittenBlocker", {
      parent: {
        esModuleURI: "resource:///modules/BashKittenBlockerParent.sys.mjs",
      },
      child: {
        esModuleURI: "resource:///modules/BashKittenBlockerChild.sys.mjs",
        events: {
          DOMWindowCreated: {},
          DOMDocElementInserted: {},
        },
      },
      allFrames: true,
      messageManagerGroups: ["browsers"],
      remoteTypes: ["web"],
    });

    ChromeUtils.registerWindowActor("BashKittenBlockedPage", {
      parent: {
        esModuleURI: "resource:///modules/BashKittenBlockedPageParent.sys.mjs",
      },
      child: {
        esModuleURI: "resource:///modules/BashKittenBlockedPageChild.sys.mjs",
        events: {
          click: {},
        },
      },
      matches: ["about:contentblocked?*"],
      allFrames: true,
    });

    if (Services.appinfo.OS !== "Android") {
      lazy.BashKittenBlockerPanel.init();
      lazy.BashKittenBlockerExtensionDetector.init();
    }
    lazy.BashKittenBlockerService.init().catch(error =>
      console.error("BashKitten blocker startup failed", error)
    );
  },
};
