/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  TaskarianBlockerExtensionDetector:
    "resource:///modules/TaskarianBlockerExtensionDetector.sys.mjs",
  TaskarianBlockerPanel:
    "resource:///modules/TaskarianBlockerPanel.sys.mjs",
  TaskarianBlockerService:
    "resource:///modules/TaskarianBlockerService.sys.mjs",
});

export const TaskarianBlockerStartup = {
  _initialized: false,

  init() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    ChromeUtils.registerWindowActor("TaskarianBlocker", {
      parent: {
        esModuleURI: "resource:///modules/TaskarianBlockerParent.sys.mjs",
      },
      child: {
        esModuleURI: "resource:///modules/TaskarianBlockerChild.sys.mjs",
        events: {
          DOMWindowCreated: {},
          DOMDocElementInserted: {},
        },
      },
      allFrames: true,
      messageManagerGroups: ["browsers"],
      remoteTypes: ["web"],
    });

    ChromeUtils.registerWindowActor("TaskarianBlockedPage", {
      parent: {
        esModuleURI: "resource:///modules/TaskarianBlockedPageParent.sys.mjs",
      },
      child: {
        esModuleURI: "resource:///modules/TaskarianBlockedPageChild.sys.mjs",
        events: {
          click: {},
        },
      },
      matches: ["about:contentblocked?*"],
      allFrames: true,
    });

    if (Services.appinfo.OS !== "Android") {
      lazy.TaskarianBlockerPanel.init();
      lazy.TaskarianBlockerExtensionDetector.init();
    }
    lazy.TaskarianBlockerService.init().catch(error =>
      console.error("Taskarian blocker startup failed", error)
    );
  },
};
