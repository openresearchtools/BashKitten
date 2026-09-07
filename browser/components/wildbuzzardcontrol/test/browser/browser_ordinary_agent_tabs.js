/* SPDX-License-Identifier: AGPL-3.0-or-later */

"use strict";

const { BrowserControl } = ChromeUtils.importESModule(
  "chrome://remote/content/wildbuzzard/BrowserControl.sys.mjs"
);
const { Subprocess } = ChromeUtils.importESModule(
  "resource://gre/modules/Subprocess.sys.mjs"
);
const FIXTURE =
  "https://example.com/browser/browser/components/wildbuzzardcontrol/test/browser/file_gecko_render.sjs";
const ACTIVE_ATTRIBUTE = "wildbuzzard-automation-active";

add_task(async function test_ordinary_tabs_and_transient_activity() {
  const { WildBuzzardControlStartup: startup } = ChromeUtils.importESModule(
    "resource:///modules/WildBuzzardControlStartup.sys.mjs"
  );
  const { SessionStore } = ChromeUtils.importESModule(
    "resource:///modules/sessionstore/SessionStore.sys.mjs"
  );
  const wasStarted = Boolean(startup.task);
  const endpoint = await startup.init();
  const tabs = [];
  async function read(pipe) {
    let result = "";
    for (let chunk; (chunk = await pipe.readString()); ) {
      result += chunk;
    }
    return result;
  }
  async function cli(session, ...argv) {
    const process = await Subprocess.call({
      command: Services.dirsvc.get("XREExeF", Ci.nsIFile).path,
      arguments: ["--json", "--session", session, ...argv.map(String)],
      environmentAppend: true,
      environment: {
        WILDBUZZARD_CONTROL_SOCKET: endpoint.socketPath,
        WILDBUZZARD_NO_START: "1",
      },
      stderr: "pipe",
    });
    await process.stdin.close();
    const [stdout, stderr, result] = await Promise.all([
      read(process.stdout),
      read(process.stderr),
      process.wait(),
    ]);
    Assert.equal(result.exitCode, 0, `${argv[0]}: ${stderr}`);
    return JSON.parse(stdout);
  }
  const dispatch = (tool, args, signal = new AbortController().signal) =>
    BrowserControl.dispatch(
      tool,
      args,
      PathUtils.profileDir,
      "activity-test",
      signal
    );
  try {
    for (let index = 0; index < 3; index++) {
      tabs.push(await BrowserTestUtils.openNewForegroundTab(gBrowser, FIXTURE));
    }
    const [first, second, third] = tabs;
    const page = BrowserControl.pageIdFor(third.linkedBrowser);
    const initialTabs = [...gBrowser.tabs];
    const initialWindows = [...BrowserControl.windows()].length;
    const initialGroups = [...gBrowser.tabGroups];
    const snapshot = await cli("ordinary-agent-a", "snapshot");
    Assert.equal(
      snapshot.details.page,
      page,
      "a fresh session uses the user's selected tab"
    );
    Assert.equal(
      (await cli("ordinary-agent-b", "snapshot", "--page", page)).details.page,
      page,
      "another agent can snapshot the same user tab without a claim"
    );
    Assert.ok(
      !third.hasAttribute(ACTIVE_ATTRIBUTE),
      "snapshot leaves no activity marker"
    );
    const changes = [];
    const observer = new MutationObserver(records => changes.push(...records));
    observer.observe(third, {
      attributes: true,
      attributeFilter: [ACTIVE_ATTRIBUTE],
    });
    await cli("ordinary-agent-c", "snapshot", "--page", page);
    changes.push(...observer.takeRecords());
    observer.disconnect();
    Assert.equal(
      changes.length,
      0,
      "read-only snapshot never marks the tab active"
    );
    const firstPage = BrowserControl.pageIdFor(first.linkedBrowser);
    await cli(
      "ordinary-agent-b",
      "evaluate",
      "--page",
      firstPage,
      "--code",
      "document.body.dataset.agent = 'b'; return document.body.dataset.agent;"
    );
    const evaluated = await cli(
      "ordinary-agent-a",
      "evaluate",
      "--page",
      firstPage,
      "--code",
      "return document.body.dataset.agent;"
    );
    Assert.equal(
      evaluated.details.value,
      "b",
      "agents can manipulate each other's current tab"
    );
    Assert.deepEqual(
      [...gBrowser.tabs],
      initialTabs,
      "existing tab commands create no extra tab"
    );
    Assert.equal(
      [...BrowserControl.windows()].length,
      initialWindows,
      "no extra control window"
    );
    Assert.deepEqual(
      [...gBrowser.tabGroups],
      initialGroups,
      "no automatic control group"
    );
    Assert.equal(
      SessionStore.getCustomTabValue(first, "wildbuzzard-control-owner"),
      "",
      "automation does not persist ownership"
    );

    const code =
      "return new Promise(resolve => setTimeout(() => resolve('finished'), 400));";
    const pending = dispatch("evaluate", { page, code });
    Assert.ok(
      third.hasAttribute(ACTIVE_ATTRIBUTE),
      "an ongoing command marks its target"
    );
    Assert.ok(
      !first.hasAttribute(ACTIVE_ATTRIBUTE),
      "other tabs stay ordinary"
    );
    const listed = (
      await cli("ordinary-agent-b", "tabs", "list")
    ).details.pages.find(p => p.page === page);
    Assert.ok(
      listed.automationActive,
      "activity is observable without session ownership"
    );
    Assert.ok(
      !("ownership" in listed),
      "tab listing has no ownership classification"
    );
    await pending;
    Assert.ok(
      !third.hasAttribute(ACTIVE_ATTRIBUTE),
      "completion removes the dot"
    );

    const firstOperation = dispatch("evaluate", { page, code });
    const secondOperation = dispatch("evaluate", {
      page,
      code: "return new Promise(resolve => setTimeout(resolve, 900));",
    });
    await firstOperation;
    Assert.ok(
      third.hasAttribute(ACTIVE_ATTRIBUTE),
      "overlapping command keeps its marker"
    );
    await secondOperation;
    Assert.ok(
      !third.hasAttribute(ACTIVE_ATTRIBUTE),
      "last completion removes the marker"
    );
    await Assert.rejects(
      dispatch("evaluate", {
        page,
        code: "throw new Error('activity failure');",
      }),
      /activity failure/,
      "command errors propagate"
    );
    Assert.ok(
      !third.hasAttribute(ACTIVE_ATTRIBUTE),
      "failure removes the marker"
    );
    const abort = new AbortController();
    const navigation = dispatch(
      "navigate",
      { page, url: `${FIXTURE}?mode=slow&delay=2000` },
      abort.signal
    );
    Assert.ok(
      third.hasAttribute(ACTIVE_ATTRIBUTE),
      "navigation is marked while running"
    );
    abort.abort();
    await Assert.rejects(
      navigation,
      /abort|cancel/i,
      "navigation cancellation propagates"
    );
    Assert.ok(
      !third.hasAttribute(ACTIVE_ATTRIBUTE),
      "cancellation removes the marker"
    );
    third.linkedBrowser.stop();

    const secondPage = BrowserControl.pageIdFor(second.linkedBrowser);
    await cli("ordinary-agent-a", "snapshot", "--page", secondPage);
    BrowserTestUtils.removeTab(second);
    gBrowser.selectedTab = first;
    Assert.equal(
      (await cli("ordinary-agent-a", "snapshot")).details.page,
      firstPage,
      "a closed remembered tab falls back to the selected tab"
    );
    const opened = await cli("ordinary-agent-b", "open", FIXTURE);
    const openedTab = BrowserControl.pageForId(opened.details.page).tab;
    tabs.push(openedTab);
    Assert.equal(
      openedTab.documentGlobal,
      window,
      "open uses the existing window"
    );
    Assert.equal(
      openedTab.group,
      null,
      "open creates an ordinary ungrouped tab"
    );

    const legacy = gBrowser.addTabGroup([first, third], {
      label: "control/wildbuzzard-cli-release",
      color: "blue",
    });
    const ordinary = gBrowser.addTabGroup([openedTab], {
      label: "Reading",
      color: "green",
    });
    SessionStore.setCustomTabValue(
      first,
      "wildbuzzard-control-owner",
      "old-agent"
    );
    const beforeMigration = [...gBrowser.tabs];
    const removed = BrowserTestUtils.waitForEvent(legacy, "TabGroupRemoved");
    BrowserControl.removeLegacyControlState();
    await removed;
    Assert.ok(!legacy.isConnected, "legacy control group is removed");
    Assert.equal(first.group, null, "legacy member becomes an ordinary tab");
    Assert.equal(
      third.group,
      null,
      "all legacy members are preserved and ungrouped"
    );
    Assert.equal(
      openedTab.group,
      ordinary,
      "user-created groups remain unchanged"
    );
    Assert.deepEqual(
      [...gBrowser.tabs],
      beforeMigration,
      "migration preserves every tab and its order"
    );
    Assert.equal(
      SessionStore.getCustomTabValue(first, "wildbuzzard-control-owner"),
      "",
      "legacy ownership is removed from session state"
    );
  } finally {
    for (const tab of tabs) {
      if (tab.isConnected) {
        BrowserTestUtils.removeTab(tab);
      }
    }
    if (!wasStarted) {
      await startup.uninit();
    }
  }
});
