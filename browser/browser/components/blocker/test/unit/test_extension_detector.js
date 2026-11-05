/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

const { Spotlight } = ChromeUtils.importESModule(
  "resource:///modules/asrouter/Spotlight.sys.mjs"
);
const { TaskarianBlockerExtensionDetector } = ChromeUtils.importESModule(
  "resource:///modules/TaskarianBlockerExtensionDetector.sys.mjs"
);

const PREF_DISMISSED_INSTALL_WARNINGS =
  "taskarian.blocker.dismissedExtensionInstallWarnings";
const PREF_DETECTION_DISMISSED =
  "taskarian.blocker.extensionDetectionDismissed";

add_task(
  async function test_successful_string_preload_is_kept_for_sync_prompts() {
    TaskarianBlockerExtensionDetector._localizedStringCache.clear();
    TaskarianBlockerExtensionDetector._localizedStringLoadPromise = null;

    await TaskarianBlockerExtensionDetector._preloadLocalizedStrings();
    const preloadPromise =
      TaskarianBlockerExtensionDetector._localizedStringLoadPromise;

    Assert.ok(
      preloadPromise,
      "Successful string preload should keep the resolved promise"
    );

    await TaskarianBlockerExtensionDetector._preloadLocalizedStrings();
    Assert.equal(
      TaskarianBlockerExtensionDetector._localizedStringLoadPromise,
      preloadPromise,
      "Later preload calls should reuse the successful preload promise"
    );

    const originalPrompt = Services.prompt;
    const promptCalls = [];
    Services.prompt = {
      BUTTON_POS_0: originalPrompt.BUTTON_POS_0,
      BUTTON_POS_1: originalPrompt.BUTTON_POS_1,
      BUTTON_TITLE_IS_STRING: originalPrompt.BUTTON_TITLE_IS_STRING,
      MODAL_TYPE_TAB: originalPrompt.MODAL_TYPE_TAB,
      QueryInterface: ChromeUtils.generateQI(["nsIPromptService"]),
      confirmExBC(...args) {
        promptCalls.push(args);
        return 1;
      },
    };

    Services.prefs.clearUserPref(PREF_DISMISSED_INSTALL_WARNINGS);

    try {
      const result = TaskarianBlockerExtensionDetector._showInstallWarning(
        {
          gBrowser: {
            selectedBrowser: {
              browsingContext: {},
            },
          },
        },
        {
          id: "adblock@example.com",
          name: "Example Blocker",
        }
      );

      Assert.equal(result, false, "Button 1 should cancel the install");
      Assert.equal(
        promptCalls.length,
        1,
        "The install warning should prompt once"
      );

      const [, , title, message, , installAnyway, keepBuiltIn] = promptCalls[0];
      Assert.ok(
        !String(title).includes("taskarian-blocker-prompt-title"),
        "Prompt title should be localized"
      );
      Assert.ok(
        !String(message).includes(
          "taskarian-blocker-extension-install-warning"
        ),
        "Prompt message should use the localized warning"
      );
      Assert.ok(
        !String(message).includes(
          "taskarian-blocker-extension-install-manage-settings"
        ),
        "Prompt message should use the localized settings text"
      );
      Assert.ok(
        !String(installAnyway).includes(
          "taskarian-blocker-extension-install-anyway"
        ),
        "Install button should be localized"
      );
      Assert.ok(
        !String(keepBuiltIn).includes(
          "taskarian-blocker-extension-install-keep-built-in"
        ),
        "Cancel button should be localized"
      );
    } finally {
      Services.prompt = originalPrompt;
      Services.prefs.clearUserPref(PREF_DISMISSED_INSTALL_WARNINGS);
    }
  }
);

add_task(async function test_upgrade_message_ids_are_monotonic() {
  const originalPrewarm =
    TaskarianBlockerExtensionDetector._prewarmUpgradeMessage;
  const originalShowSpotlightDialog = Spotlight.showSpotlightDialog;
  const originalDateNow = Date.now;
  const shownMessages = [];

  TaskarianBlockerExtensionDetector._detectionActive = true;
  TaskarianBlockerExtensionDetector._messageIdCounter = 0;
  Services.prefs.clearUserPref(PREF_DETECTION_DISMISSED);
  Date.now = () => 1000;

  TaskarianBlockerExtensionDetector._prewarmUpgradeMessage = async () => ({
    content: {
      screens: [
        {
          content: {},
          id: "UPGRADE_SET_DEFAULT",
        },
      ],
    },
    id: "UPGRADE_BASE",
  });
  Spotlight.showSpotlightDialog = async (_browser, message) => {
    shownMessages.push({
      messageId: message.id,
      screenId: message.content.screens[0].id,
    });
    return true;
  };

  try {
    const win = { gBrowser: {} };
    const browser = {};

    Assert.equal(
      await TaskarianBlockerExtensionDetector._showDetectionUpgradeModal(
        win,
        browser,
        "Example Blocker"
      ),
      true,
      "First modal should be shown"
    );
    Assert.equal(
      await TaskarianBlockerExtensionDetector._showDetectionUpgradeModal(
        win,
        browser,
        "Example Blocker"
      ),
      true,
      "Second modal should be shown"
    );

    Assert.equal(shownMessages.length, 2, "Two messages should be shown");
    Assert.notEqual(
      shownMessages[0].messageId,
      shownMessages[1].messageId,
      "Message IDs should be unique even when Date.now is stable"
    );
    Assert.notEqual(
      shownMessages[0].screenId,
      shownMessages[1].screenId,
      "Screen IDs should be unique even when Date.now is stable"
    );
  } finally {
    TaskarianBlockerExtensionDetector._prewarmUpgradeMessage =
      originalPrewarm;
    TaskarianBlockerExtensionDetector._detectionActive = false;
    Spotlight.showSpotlightDialog = originalShowSpotlightDialog;
    Date.now = originalDateNow;
    Services.prefs.clearUserPref(PREF_DETECTION_DISMISSED);
  }
});
