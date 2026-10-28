/* SPDX-License-Identifier: AGPL-3.0-only */

import { BashKittenDrafts } from "resource:///modules/BashKittenDrafts.sys.mjs";
import { DesktopLifetime } from "resource:///modules/DesktopLifetime.sys.mjs";
import { autostartController, localAutostart } from "resource:///modules/DesktopAutostart.sys.mjs";
import { Subprocess } from "resource://gre/modules/Subprocess.sys.mjs";
import { AsyncShutdown } from "resource://gre/modules/AsyncShutdown.sys.mjs";
import { BashKittenSettings, SETTINGS_URI } from "resource:///modules/BashKittenSettings.sys.mjs";
import { LinuxPerformanceMonitor } from "resource:///modules/Performance.sys.mjs";
import { remoteSettingsCall } from "resource:///modules/RemoteSettings.sys.mjs";
import { openProviderLogin } from "resource:///modules/ProviderLogin.sys.mjs";
import { NativeSidecar } from "resource:///modules/NativeSidecar.sys.mjs";
import { connectMachine, disconnectMachine, machineFilesRoute } from "resource:///modules/ContainerConnection.sys.mjs";
import { AgentRemotes } from "resource:///modules/AgentRemotes.sys.mjs";
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";

const HTML = "http://www.w3.org/1999/xhtml";
const CONTROLLER = "/usr/bin/bashkittenctl";
const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  PanelMultiView: "moz-src:///browser/components/customizableui/PanelMultiView.sys.mjs",
  BashKittenDisplay: "resource:///modules/BashKittenDisplay.sys.mjs",
  BrowserControlChannel: "resource:///modules/BrowserControlChannel.sys.mjs",
  SessionStore: "resource:///modules/sessionstore/SessionStore.sys.mjs",
});
const contexts = new Map();
const ownedViews = new WeakMap();
const shownLocalAISetups = new Set();
let actorRegistered = false;
let browserOwner;
let closingLocal = false;
const localProcesses = new Set();

let shuttingDown;
function shutdown() {
  if (!shuttingDown) {
    closingLocal = true;
    let deadline;
    shuttingDown = Promise.race([
      stopOwnedRuntime(),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Owned runtime cleanup did not finish within 105 seconds.")), 105000); }),
    ]).finally(() => { clearTimeout(deadline); closingLocal = false; });
    // Keep this same bounded result for Gecko's later shutdown blocker. A
    // cancelled Quit followed by new native activity resets it in control().
  }
  return shuttingDown;
}
async function stopOwnedRuntime() {
  // Fence the owners immediately, before draft capture or an unfinished native
  // request can delay their guards. Stop request clients too: an in-flight
  // startup client must not retry and recreate an owner during Quit.
  const owners = [stopOwnedMachines(), stopOwnedLocal()];
  for (const process of localProcesses) void process.kill(0).catch(console.error);
  const draft = (async () => {
    let timer;
    try {
      await Promise.race([
        DesktopLifetime.view?.saveCurrentDraft(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Draft capture timed out.")), 2000); }),
      ]);
    } catch (error) { console.error("Could not save the Agent draft before Quit", error); }
    finally { clearTimeout(timer); }
  })();
  // Every owner must receive shutdown even if another cleanup fails. Machines
  // are independent of Local and may be running while its heading is Off.
  const stopped = await Promise.allSettled([
    ...owners,
    lazy.BrowserControlChannel.close("browser quitting"),
    draft.then(() => AgentRemotes.deactivate()),
  ]);
  const failures = stopped.filter(result => result.status === "rejected");
  if (failures.length) throw new Error(failures.map(result => result.reason?.message || result.reason).join("; "));
}
async function stopOwnedMachines() {
  if (!browserOwner) return;
  const status = await localControl("machines.browser-shutdown", { browserOwner: await browserOwner }, 90000);
  if (status.stopped !== true) throw new Error(status.error || "Owned containers have not stopped.");
}
async function stopOwnedLocal() {
  if (!browserOwner) return;
  const owner = await browserOwner;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const status = await localControl("browser-shutdown", { browserOwner: owner }, deadline - Date.now());
    DesktopLifetime.shutdownStatus(status);
    if (status.web?.status === "stopped" || status.web?.status === "off") return;
    if (status.web?.status === "stopping" || status.web?.status === "running") {
      await new Promise(resolve => setTimeout(resolve, Math.min(1000, Math.max(0, deadline - Date.now()))));
    } else throw new Error(status.web?.error || "Owned services have not stopped.");
  }
  throw new Error("Owned services have not confirmed shutdown within 45 seconds.");
}


async function localBrowserOwner() {
  if (!browserOwner) {
    browserOwner = (async () => {
      const pid = Services.appinfo.processID;
      // procfs reports a zero file size; request bytes explicitly instead.
      const stat = new TextDecoder().decode(await IOUtils.read(`/proc/${pid}/stat`, { maxBytes: 4096 }));
      const started = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
      if (!/^[1-9][0-9]*$/.test(started)) throw new Error("Could not identify the browser process.");
      const owner = { pid, started };
      AsyncShutdown.profileBeforeChange.addBlocker("BashKitten: stop owned runtime", async () => {
        try { await shutdown(); }
        catch (error) { console.error("BashKitten Agent shutdown failed", error); }
      });
      return owner;
    })().catch(error => { browserOwner = null; throw error; });
  }
  return browserOwner;
}

function html(doc, name, attrs = {}, text) {
  const node = doc.createElementNS(HTML, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
function xul(doc, name, attrs = {}) {
  const node = doc.createXULElement(name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}
async function readPipe(pipe) {
  let output = "";
  for (;;) {
    const value = await pipe.readString();
    if (!value) return output;
    output += value;
  }
}

/** No public HTTP bootstrap endpoint and no command supplied by page content. */
function control(command, data = {}) {
  if (closingLocal || DesktopLifetime.quitting) return Promise.reject(new Error("BashKitten is quitting."));
  shuttingDown = null;
  return localControl(command, data);
}
async function localControl(command, data = {}, timeoutMs) {
  const machineCommands = ["machines.list", "machines.create", "machines.get", "machines.save", "machines.start", "machines.stop", "machines.restart", "machines.retry", "machines.delete", "machines.operation", "machines.cancel", "machines.endpoint", "machines.guest-control", "machines.startup", "machines.display", "machines.display-start", "machines.display-stop", "machines.clipboard", "machines.activations", "machines.media-devices", "machines.browser-shutdown", "machines.autostart-status", "machines.autostart-save"];
  if (![...machineCommands, "autostart-status", "autostart-save", "autostart-startup", "performance-sample", "performance-close", "phone-status", "start", "status", "stop", "browser-shutdown", "remote-pi-import", "share-status", "share-setup", "share-reissue", "share-confirm", "share-cancel", "share-publish", "share-startup", "share-files", "service-status", "service-save", "service-remove", "service-action", "local-session", "project-root", "native-file", "localai-status", "localai-first-run", "localai-record", "localai-save", "localai-model-use", "localai-model-device", "localai-synthesize", "localai-synthesis-cancel", "localai-quantize", "localai-ini", "localai-browse", "localai-router-models", "localai-router-model-save", "localai-router-model-test", "localai-router-model-test-status", "localai-router-model-test-cancel", "localai-check", "localai-install", "localai-cancel", "localai-share", "localai-action", "localai-refresh", "native-models-status", "native-models-catalogue", "native-models-preset", "native-models-settings", "native-models-search", "native-models-repository", "native-models-download", "native-models-action"].includes(command)) {
    throw new Error("Unknown local Agent operation.");
  }
  // Native requests can start owners without turning Local on (for example,
  // container startup or LocalAI settings). Bind every such owner to this exact
  // browser process. Shutdown must never create or adopt an absent owner.
  const stopping = ["browser-shutdown", "machines.browser-shutdown"].includes(command);
  if (!stopping) {
    data = { ...data, browserOwner: await localBrowserOwner() };
    if (closingLocal || DesktopLifetime.quitting) throw new Error("BashKitten is quitting.");
  }
  const process = await Subprocess.call({
    command: CONTROLLER, arguments: [command, "--stdin", ...(data.readOnly === true ? ["--read-only"] : [])], stderr: "pipe",
  });
  if (!stopping && (closingLocal || DesktopLifetime.quitting)) {
    void process.kill(0).catch(console.error);
    throw new Error("BashKitten is quitting.");
  }
  if (!stopping) localProcesses.add(process);
  let timeout;
  try {
    return await Promise.race([
      (async () => {
        const output = Promise.all([readPipe(process.stdout), readPipe(process.stderr)]);
        const request = (async () => { await process.stdin.write(JSON.stringify(data)); await process.stdin.close(); return process.wait(); })();
        const [result, [stdout, stderr]] = await Promise.all([request, output]);
        let response;
        try { response = JSON.parse(stdout || stderr); } catch { throw new Error("The local Agent controller did not return a valid response."); }
        if (result.exitCode || response.error) throw new Error(response.error || stderr.slice(-2000) || "The local Agent operation failed.");
        return response;
      })(),
      new Promise((_, reject) => { timeout = setTimeout(() => {
        void process.kill(0).catch(console.error);
        reject(new Error(stopping ? "Owned runtime shutdown has not been confirmed." : "The local Agent operation timed out."));
      }, Math.max(1, timeoutMs ?? (stopping ? 45000 : 180000))); }),
    ]);
  } finally { clearTimeout(timeout); localProcesses.delete(process); }
}

/** Parent actors must verify the actual protected browser, not just its URL. */
export function protectedAgentView(actor, allowQuitting = false) {
  const context = actor.browsingContext;
  if (!context || context !== context.top) return null;
  const browser = context.embedderElement;
  const entry = ownedViews.get(browser);
  if (!entry || (entry.host.off && !(allowQuitting && DesktopLifetime.quitting)) || entry.host.activeBrowser !== browser) return null;
  const principal = actor.manager.documentPrincipal;
  if (!principal?.isContentPrincipal || principal.originNoSuffix !== new URL(entry.connection.url).origin) return null;
  if (principal.originAttributes.userContextId !== entry.connection.userContextId) return null;
  return entry;
}

export const BashKittenAgent = {
  onWindowOpened(win) {
    if (win.BashKittenAgent) return;
    if (!actorRegistered) {
      ChromeUtils.registerWindowActor("BashKittenAgent", {
        parent: { esModuleURI: "resource:///modules/BashKittenAgentParent.sys.mjs" },
        child: { esModuleURI: "resource:///modules/BashKittenAgentChild.sys.mjs", events: { DOMDocElementInserted: {}, DOMContentLoaded: {}, click: { capture: true }, BashKittenDraftReady: { capture: true, wantUntrusted: true }, BashKittenDraftChanged: { capture: true, wantUntrusted: true }, BashKittenNavigationChanged: { capture: true, wantUntrusted: true } } },
        allFrames: false,
        messageManagerGroups: ["bashkitten-agent"],
        matches: ["https://*/*"],
      });
      actorRegistered = true;
    }
    win.BashKittenAgent = new AgentView(win);
    win.BashKittenAgent.init().catch(error => {
      win.BashKittenAgent.machineStartupResult.reject(error);
      win.BashKittenAgent.failure(error);
    });
  },
};

class AgentView {
  constructor(win) {
    this.win = win;
    this.doc = win.document;
    this.views = new Map();
    this.providerLogins = new Set();
    this.referencesPending = new Map();
    this.drafts = new Map();
    this.settingsVisited = new Set();
    this.machineStartupReady = new Promise((resolve, reject) => { this.machineStartupResult = { resolve, reject }; });
    this.machineStartupReady.catch(() => {});
    this.off = false;
    this.busy = false;
    this.remote = null;
    this.selection = "";
    this.timer = null;
    this.currentIdentity = null;
    this.layout = "full";
    this.browseWithAgent = Services.prefs.getBoolPref("bashkitten.agent.splitBrowsing", true);
    this.localOn = false;
  }

  async init() {
    AgentRemotes.importToPi = value => control("remote-pi-import", value);
    const doc = this.doc;
    this.win.windowUtils.loadSheetUsingURIString("chrome://browser/content/bashkitten/agent/agent.css", Ci.nsIStyleSheetService.AUTHOR_SHEET);
    this.pane = xul(doc, "vbox", { id: "bashkitten-agent-pane" });
    this.sidecar = new NativeSidecar(this, control);
    this.choice = { value: "" };
    this.power = html(doc, "button", { id: "bashkitten-agent-power", type: "button" }, "Starting…");
    this.power.addEventListener("click", () => this.run(() => this.off ? this.start() : this.stop()));
    this.state = html(doc, "section", { id: "bashkitten-agent-state" });
    this.viewBox = xul(doc, "vbox", { id: "bashkitten-agent-views", flex: "1" });
    const workspace = xul(doc, "hbox", { id: "bashkitten-native-workspace", flex: "1" });
    const chat = xul(doc, "vbox", { id: "bashkitten-native-chat", flex: "1" }); chat.append(this.state, this.viewBox);
    workspace.append(this.sidecar.root, chat); this.pane.append(workspace);
    const tabbox = doc.getElementById("tabbrowser-tabbox");
    tabbox.before(this.pane);
    this.chatsToggle = xul(doc, "toolbarbutton", { id: "bashkitten-chats-toggle", image: "chrome://branding/content/icon32.png", class: "toolbarbutton-1", tooltiptext: "Chats", "aria-label": "Chats", "aria-controls": "bashkitten-native-sidecar", "aria-expanded": String(this.sidecar.isOpen()) });
    this.chatsToggle.addEventListener("command", () => { if (this.layout !== "full" || this.connectionsPanel) { this.show(); this.sidecar.open(); } else this.sidecar.toggle(); });
    doc.getElementById("tabbrowser-tabs").before(this.chatsToggle);
    this.paneToggle = xul(doc, "toolbarbutton", { id: "bashkitten-agent-pane-toggle", label: "Hide Agent", class: "toolbarbutton-1", overflows: "false", tooltiptext: "Show or hide the Agent pane" });
    this.paneToggle.addEventListener("command", () => {
      this.browseWithAgent = !this.browseWithAgent;
      Services.prefs.setBoolPref("bashkitten.agent.splitBrowsing", this.browseWithAgent);
      this.browse();
    });
    doc.getElementById("urlbar-container").before(this.paneToggle);
    const appMenu = this.win.PanelUI.mainView.querySelector("#appMenu-settings-button");
    const nativeMenu = xul(doc, "toolbarbutton", { id: "appMenu-bashkitten-about", label: "About BashKitten", class: "subviewbutton" });
    nativeMenu.addEventListener("command", () => { this.win.PanelUI.hide(); this.win.openAboutDialog(); });
    appMenu.before(nativeMenu);
    this.installSettingsMenu();
    this.displayToggle = xul(doc, "toolbarbutton", { id: "bashkitten-display-toggle", image: "chrome://browser/skin/device-desktop.svg", class: "toolbarbutton-1", hidden: "true", checked: "true", "aria-pressed": "true" });
    this.displayToggle.addEventListener("command", () => {
      const display = lazy.BashKittenDisplay.selected(this.win);
      if (display) lazy.BashKittenDisplay.close(this.win, display.id);
    });
    doc.getElementById("bashkitten-settings-button").before(this.displayToggle);
    this.displayControls = xul(doc, "hbox", { id: "bashkitten-display-controls", align: "center", flex: "1", hidden: "true", overflows: "false" });
    const displaySwitch = (title, id) => {
      const label = html(doc, "label", { class: "native-display-switch" });
      const input = html(doc, "input", { type: "checkbox", id, "aria-label": title });
      const text = html(doc, "span", {}, title);
      label.append(input, text); this.displayControls.append(label);
      return { input, text };
    };
    this.displayPower = displaySwitch("Display", "bashkitten-display-power");
    this.displayPower.input.addEventListener("change", () => this.run(() => lazy.BashKittenDisplay.control(this.win, "enabled", this.displayPower.input.checked)));
    this.displayInteraction = displaySwitch("Interact", "bashkitten-display-interaction");
    this.displayInteraction.input.addEventListener("change", () => this.run(() => lazy.BashKittenDisplay.control(this.win, "interactive", this.displayInteraction.input.checked)));
    const command = xul(doc, "toolbarbutton", { class: "toolbarbutton-1", image: "chrome://global/skin/icons/edit.svg", tooltiptext: "Display command", "aria-label": "Edit the desktop launch command" });
    command.addEventListener("command", () => {
      const display = lazy.BashKittenDisplay.selected(this.win);
      if (display) this.run(() => this.openSettings("machine", { backendId: display.id, displayCommand: true }));
    });
    this.displayControls.append(command);
    this.displayClipboard = [
      ["read", "Copy from desktop", "chrome://global/skin/icons/edit-copy.svg"],
      ["write", "Paste to desktop", "chrome://browser/skin/edit-paste.svg"],
    ].map(([action, label, image]) => {
      const button = xul(doc, "toolbarbutton", { id: `bashkitten-display-clipboard-${action}`, class: "toolbarbutton-1", image, tooltiptext: label, "aria-label": label, disabled: "true" });
      button.addEventListener("command", event => {
        if (!event.isTrusted || DesktopLifetime.quitting) return;
        // Clipboard work must not hold the shared service-control busy flag:
        // Observe and Off remain available to cancel a pending transfer.
        try { Promise.resolve(lazy.BashKittenDisplay.control(this.win, `clipboard-${action}`, event)).catch(error => this.failure(error)); }
        catch (error) { this.failure(error); }
      });
      this.displayControls.append(button);
      return button;
    });
    this.displayStatus = html(doc, "span", { class: "native-display-status", role: "status" });
    this.displayControls.append(this.displayStatus);
    doc.getElementById("urlbar-container").before(this.displayControls);
    // Move the real Firefox control while its navigation toolbar is collapsed.
    // Keep its original node/listeners/anchor and exact browser-mode placement.
    this.browserMenuControl = doc.getElementById("PanelUI-button");
    this.browserMenuHome = doc.createComment("BashKitten Firefox menu home");
    this.browserMenuControl.before(this.browserMenuHome);
    this.browserMenuHost = xul(doc, "hbox", { id: "bashkitten-browser-menu-host", align: "center" });
    doc.querySelector('#TabsToolbar > .titlebar-spacer[type="post-tabs"]').before(this.browserMenuHost);
    for (const item of doc.querySelectorAll('[command="cmd_newNavigator"], [command="Tools:PrivateBrowsing"], [command^="Profiles:"], #key_newNavigator, #key_privatebrowsing')) item.remove();
    this.observer = { observe: () => {
      this.refreshRemotes().catch(console.error);
      if (this.settingsBrowser) BashKittenSettings.notify(this.settingsBrowser, "remotes.changed", {});
    } };
    Services.obs.addObserver(this.observer, "bashkitten-agent-remote-changed");
    this.win.addEventListener("unload", () => this.destroy(), { once: true });
    this.displayChanged = () => this.updateDisplayChrome();
    this.win.gBrowser.tabContainer.addEventListener("TabSelect", this.displayChanged);
    this.win.addEventListener("BashKittenDisplayChanged", this.displayChanged);
    // Listen to explicit tab choices, not TabSelect: restoration and the
    // replacement tab after closing the last tab must not select away from Agent.
    this.win.gBrowser.tabContainer.addEventListener("click", event => {
      if (event.button === 0 && event.target.closest(".tabbrowser-tab") &&
          !event.target.closest(".tab-close-button")) this.browse();
    });
    this.win.gBrowser.tabContainer.addEventListener("TabClose", event => {
      if (event.target._endRemoveArgs?.[1]) this.show();
    });
    this.tabKey = event => {
      const accel = event.ctrlKey || event.metaKey;
      if ((accel && ["Tab", "PageUp", "PageDown"].includes(event.key)) ||
          ((event.altKey || accel) && /^[1-9]$/.test(event.key))) this.browse();
    };
    this.win.addEventListener("keydown", this.tabKey, true);
    DesktopLifetime.attach(this, shutdown);
    this.show();
    const startupLayout = this.layoutEpoch;
    void lazy.SessionStore.promiseAllWindowsRestored.then(() => {
      if (!this.win.closed && !DesktopLifetime.quitting && this.layoutEpoch === startupLayout &&
          lazy.BashKittenDisplay.hasSavedDisplaySelected(this.win)) this.browse();
    }).catch(console.error);
    await this.refreshRemotes();
    void control("autostart-startup").then(result => this.updateStartupNotice(result))
      .catch(error => this.updateStartupNotice({ error: error.message }));
    void AgentRemotes.startup(() => !this.win.closed && !DesktopLifetime.quitting && !closingLocal)
      .catch(error => { this.sidecar.notice.textContent = `Connection startup: ${error.message}`; });
    void (async () => {
      const { BashKittenDisplay } = ChromeUtils.importESModule("resource:///modules/BashKittenDisplay.sys.mjs");
      const result = await control("machines.startup", { displayCapabilities: BashKittenDisplay.capabilities() });
      this.machineStartupResult.resolve(result);
      await this.sidecar.refresh();
    })().catch(error => { this.machineStartupResult.reject(error); this.sidecar.notice.textContent = `Container startup: ${error.message}`; });
    void this.watchMachineActivations();
    const selected = Services.prefs.getStringPref("bashkitten.agent.selectedRemote", "");
    await this.run(async () => {
      let status;
      if (localAutostart()) {
        try { status = await control("start"); this.localOn = status.web?.status === "running"; }
        catch (error) { this.sidecar.notice.textContent = `Local startup: ${error.message}`; }
      }
      if (DesktopLifetime.quitting || this.win.closed) return;
      const previous = this.sidecar.backends.find(backend => backend.id === selected);
      if (previous?.autostart && (previous.kind === "remote" || previous.state === "running")) return this.choose(selected);
      if (status) { this.off = false; await this.update(status); this.schedule(); }
      else { this.off = true; this.localOn = false; this.stopped(); await this.sidecar.render(); }
    });
    DesktopLifetime.started();
  }

  updateStartupNotice(result) {
    if (this.win.closed) return;
    const errors = Object.entries(result.startupErrors || {}).map(([name, message]) => `${name}: ${message}`);
    if (result.error) errors.push(result.error);
    for (const item of result.status || []) if (item.error) errors.push(item.error);
    const previous = this.startupNotice || "";
    this.startupNotice = errors.length ? `Service startup: ${errors.join("; ")}` : "";
    // Other sidebar operations own their own errors. Refresh only our notice.
    if (!this.sidecar.notice.textContent || this.sidecar.notice.textContent === previous) this.sidecar.notice.textContent = this.startupNotice;
  }

  installSettingsMenu() {
    const popup = xul(this.doc, "panel", { id: "bashkitten-settings-menu", class: "cui-widget-panel panel-no-padding", type: "arrow", flip: "slide", role: "group", noautofocus: "true" });
    const views = xul(this.doc, "panelmultiview", { mainViewId: "bashkitten-settings-mainView" });
    const view = xul(this.doc, "panelview", { id: "bashkitten-settings-mainView", class: "PanelUI-subView" });
    const body = xul(this.doc, "vbox", { class: "panel-subview-body" });
    const gear = xul(this.doc, "toolbarbutton", { id: "bashkitten-settings-button", image: "chrome://global/skin/icons/settings.svg", class: "toolbarbutton-1", tooltiptext: "Configuration", "aria-label": "Configuration", "aria-haspopup": "menu" });
    const toggle = event => {
      if (popup.state === "open") { lazy.PanelMultiView.hidePopup(popup); return; }
      if (popup.state !== "closed") return;
      if (popup.isWaylandPopup) {
        // An explicit constraint rectangle disables Gecko's compositor popup
        // positioning on Wayland. Fit the down-right popup by sizing instead.
        const anchor = gear.getBoundingClientRect();
        const width = Math.max(1, this.win.innerWidth - anchor.left);
        popup.style.minWidth = `${Math.min(250, width)}px`;
        popup.style.maxWidth = `${width}px`;
        popup.style.maxHeight = `${Math.max(1, this.win.innerHeight - anchor.bottom)}px`;
      } else {
        popup.setConstraintRect(new this.win.DOMRect(this.win.mozInnerScreenX,
          this.win.mozInnerScreenY, this.win.innerWidth, this.win.innerHeight));
      }
      void lazy.PanelMultiView.openPopup(popup, gear, { position: "after_start", triggerEvent: event }).catch(console.error);
    };
    // Match Firefox's PanelUI trigger: open during the pointer press with its
    // actual input event, not a later command without pointer coordinates.
    gear.addEventListener("mousedown", event => {
      if (event.button === 0) toggle(event);
    });
    gear.addEventListener("keypress", event => {
      if (event.key === " " || event.key === "Enter") {
        toggle(event);
        event.stopPropagation();
      }
    });
    this.chatsToggle.after(gear);
    for (const [section, title, image] of [
      ["localai", "Local AI", "chrome://global/skin/icons/lightbulb.svg"],
      ["remotes", "Remote Connections", "chrome://global/skin/icons/link.svg"],
      ["performance", "Performance", "chrome://global/skin/icons/performance.svg"],
      ["autostart", "Autostart", "chrome://global/skin/icons/settings.svg"],
      ["providers", "Providers", "chrome://browser/skin/login.svg"],
      ["general", "General settings", "chrome://global/skin/icons/settings.svg"],
    ]) {
      const item = xul(this.doc, "toolbarbutton", { label: title, image, class: "subviewbutton subviewbutton-iconic", role: "menuitem" });
      if (["localai", "performance"].includes(section)) {
        popup.addEventListener("popupshowing", () => {
          const backend = this.sidecar.backends?.find(value => value.id === (this.selection || "local"));
          item.hidden = !["local", "machine"].includes(backend?.kind);
        });
      }
      item.addEventListener("command", () => {
        lazy.PanelMultiView.hidePopup(popup);
        this.openSettings(section).catch(error => this.dialog(title).content.append(html(this.doc, "p", { role: "alert" }, error.message)));
      });
      body.append(item);
    }
    view.append(body); views.append(view); popup.append(views);
    this.doc.getElementById("mainPopupSet").append(popup);
  }

  async run(operation, { replace = false } = {}) {
    if (this.busy && (!replace || this.off) || DesktopLifetime.quitting) return;
    const running = {};
    this.busy = running;
    this.power.disabled = true;
    let epoch = this.selectionEpoch;
    try { const task = operation(); epoch = this.selectionEpoch; await task; }
    catch (error) { if (this.busy === running && epoch === this.selectionEpoch) this.failure(error); }
    finally {
      if (this.busy === running) { this.busy = false; this.power.disabled = DesktopLifetime.quitting; }
    }
  }

  show() {
    this.layoutEpoch = (this.layoutEpoch || 0) + 1;
    this.closeConnections();
    this.layout = "full";
    this.pane.hidden = false;
    this.doc.documentElement.setAttribute("bashkitten-agent-visible", "true");
    this.doc.documentElement.setAttribute("bashkitten-agent-layout", "full");
    this.updateDisplayChrome();
    this.activeBrowser?.focus();
  }
  browse() {
    this.layoutEpoch = (this.layoutEpoch || 0) + 1;
    const split = this.browseWithAgent;
    this.layout = split ? "split" : "browser";
    this.pane.hidden = !split;
    this.doc.documentElement.setAttribute("bashkitten-agent-visible", split);
    this.doc.documentElement.setAttribute("bashkitten-agent-layout", this.layout);
    this.paneToggle.setAttribute("label", split ? "Hide Agent" : "Show Agent");
    this.updateDisplayChrome();
  }

  updateDisplayChrome() {
    const display = this.layout !== "full" && lazy.BashKittenDisplay.selected(this.win);
    this.doc.documentElement.toggleAttribute("bashkitten-display-visible", Boolean(display));
    if (this.displayControls) {
      this.displayControls.hidden = !display;
      if (display) {
        this.displayPower.input.checked = display.running || display.state === "starting";
        this.displayPower.input.disabled = !display.service || ["starting", "stopping"].includes(display.state);
        this.displayPower.text.textContent = ({ starting: "Starting…", running: "Display on", stopping: "Stopping…", off: "Display off", error: "Display unavailable" })[display.state];
        this.displayPower.input.title = display.running ? "Turn off Display and close desktop apps. The agent keeps running." : "Start this container’s desktop";
        this.displayInteraction.input.checked = display.interactive;
        this.displayInteraction.input.disabled = !display.controller;
        this.displayInteraction.text.textContent = display.interactive ? "Interact" : "Observe only";
        this.displayInteraction.input.title = display.interactive ? "Send keyboard and pointer input to the desktop" : "Watch the desktop without sending input";
        for (const button of this.displayClipboard) button.disabled = !display.controller || !display.interactive || display.state !== "running" || display.clipboardBusy;
        this.displayStatus.textContent = [display.state === "running" ? display.renderMode : "", display.clipboardBusy ? "Transferring clipboard…" : display.clipboardStatus].filter(Boolean).join(" · ");
        this.displayStatus.title = [this.displayStatus.textContent, display.renderReason].filter(Boolean).join(" — ");
      }
    }
    if (this.displayToggle) {
      this.displayToggle.hidden = !display;
      const label = display ? `Close ${display.name} Display` : "Display";
      this.displayToggle.setAttribute("tooltiptext", label);
      this.displayToggle.setAttribute("aria-label", label);
    }
    if (this.layout === "full" || display) {
      if (this.browserMenuControl && this.browserMenuHost) this.browserMenuHost.append(this.browserMenuControl);
    } else if (this.browserMenuControl && this.browserMenuHome?.parentNode) {
      this.browserMenuHome.after(this.browserMenuControl);
    }
    this.sidecar.updateDisplays();
  }

  saveFileFrom(browser, url, referrerInfo) {
    const entry = ownedViews.get(browser);
    if (!entry || this.off || this.activeBrowser !== browser) return false;
    const target = new URL(url);
    if (target.origin !== new URL(entry.connection.url).origin || target.username || target.password || target.hash ||
        !/^\/api\/(?:files\/content|sessions\/[^/]+\/attachments\/[^/]+\/[^/]+)$/.test(target.pathname)) return false;
    const principal = browser.browsingContext.currentWindowGlobal.documentPrincipal;
    if (principal.originNoSuffix !== target.origin || principal.originAttributes.userContextId !== entry.connection.userContextId) {
      throw new Error("The file's protected Agent context is no longer available.");
    }
    // Reuse Gecko's streaming download path and response filename/MIME handling.
    // A normal tab must never inherit the Agent's authenticated storage context.
    this.win.nsContextMenu.prototype.saveHelper.call(
      { window: this.win, browser, principal }, target.href,
      (target.searchParams.get("path") || target.pathname).split("/").at(-1),
      null, true, null, referrerInfo, browser.cookieJarSettings,
      browser.outerWindowID, null, browser.browsingContext.usePrivateBrowsing
    );
    return true;
  }

  async resolveLocalFile(browser, value) {
    const entry = ownedViews.get(browser);
    if (!entry?.local || entry.connection.machineId || this.off || this.activeBrowser !== browser) throw new Error("Select the host Agent to open a host file.");
    const url = new URL(value);
    if (url.origin !== new URL(entry.connection.url).origin || url.protocol !== "https:" || url.hostname !== "127.0.0.1" || url.username || url.password ||
        !/^\/api\/(?:files\/content|sessions\/[a-f0-9-]{36}\/attachments\/[^/]+\/[^/]+)$/.test(url.pathname)) throw new Error("Only local Agent files can be opened.");
    // Authenticate in the enrolled document's cookie context, then resolve the
    // existing file through the same private controller that owns Local. Only
    // its path crosses this bridge; file contents stay on disk.
    const response = await AgentRemotes.request(entry.connection, "/api/bootstrap");
    if (response.status !== 200 || !response.data?.authenticated) throw new Error("Sign in again to open this file.");
    let current = ownedViews.get(browser);
    if (this.off || this.activeBrowser !== browser || !current?.local || current.connection !== entry.connection) throw new Error("The selected Agent changed.");
    const file = await control("native-file", { url: url.href });
    current = ownedViews.get(browser);
    if (this.off || this.activeBrowser !== browser || !current?.local || current.connection !== entry.connection) throw new Error("The selected Agent changed.");
    return file;
  }

  cancelProviderLogins() { for (const owner of [...this.providerLogins]) owner.cancel(); }
  cancelReferences() { for (const pending of [...this.referencesPending.values()]) pending.finish(new Error("The selected backend changed.")); }

  resolveReference(value, signal) {
    const browser = this.activeBrowser, entry = ownedViews.get(browser), global = browser?.browsingContext.currentWindowGlobal;
    const backendId = entry?.connection.id;
    const current = () => entry && !this.off && this.activeBrowser === browser && ownedViews.get(browser) === entry &&
      browser?.browsingContext.currentWindowGlobal === global && !this.win.closed && !DesktopLifetime.quitting && !signal?.aborted;
    if (!current() || (value.backendId && value.backendId !== backendId) ||
        !/^[a-f0-9-]{36}$/.test(value.projectId || "") || !/^[a-f0-9-]{36}$/.test(value.requestId || "")) throw new Error("Select the resolver job's owning backend and project.");
    if (this.referencesPending.has(value.requestId) || this.referencesPending.size >= 32) throw new Error("A resolver request is already pending.");
    if (!Services.obs.enumerateObservers("bashkitten-references-resolve").hasMoreElements()) throw new Error("References capture is not ready.");
    return new Promise((resolve, reject) => {
      let timer;
      const abort = () => pending.finish(new Error("Resolver request cancelled."));
      const pending = { backendId, projectId: value.projectId, current, finish: (error, result) => {
        if (this.referencesPending.get(value.requestId) !== pending) return;
        this.referencesPending.delete(value.requestId); clearTimeout(timer); signal?.removeEventListener("abort", abort);
        if (error) reject(error); else resolve(result);
      } };
      this.referencesPending.set(value.requestId, pending);
      timer = setTimeout(() => pending.finish(new Error("Resolver browser response timed out; check the job status.")), 600000);
      signal?.addEventListener("abort", abort, { once: true });
      Services.obs.notifyObservers(null, "bashkitten-references-resolve", JSON.stringify({ backendId, projectId: value.projectId, requestId: value.requestId }));
    });
  }

  openProviderLogin(actor, entry, value) {
    if (typeof value?.attemptId !== "string" || typeof value?.url !== "string") throw new Error("Invalid provider login.");
    const connection = entry.connection, epoch = this.selectionEpoch;
    const current = () => protectedAgentView(actor) === entry && actor.manager === actor.browsingContext.currentWindowGlobal &&
      entry.connection === connection && this.selection === connection.machineId && this.selectionEpoch === epoch &&
      !this.win.closed && !DesktopLifetime.quitting;
    return openProviderLogin({ host: this, current, request: (name, args) => this.machineLocalControl(connection.machineId, name, args), attemptId: value.attemptId, url: value.url });
  }

  async referencesRequest(envelope) {
    const browser = this.activeBrowser, entry = ownedViews.get(browser);
    const global = browser?.browsingContext.currentWindowGlobal;
    const backendId = entry?.connection.id;
    const current = () => !this.off && this.activeBrowser === browser && ownedViews.get(browser) === entry &&
      browser?.browsingContext.currentWindowGlobal === global && !this.win.closed && !DesktopLifetime.quitting;
    if (!entry || !global || !current()) throw new Error("Open the owning backend first.");
    if (envelope?.apiVersion !== 1) throw new Error("Unsupported References host API.");
    if (envelope.operation === "resolver-result") {
      const pending = this.referencesPending.get(envelope.requestId);
      if (!pending || !pending.current() || envelope.backendId !== pending.backendId || envelope.projectId !== pending.projectId ||
          JSON.stringify(envelope).length > 8192) throw new Error("Resolver request is no longer active.");
      pending.finish(envelope.error ? new Error(String(envelope.error).slice(0, 500)) : null, envelope.result);
      return { apiVersion: 1, body: { ok: true } };
    }
    if (envelope.operation === "context") {
      const snapshot = await this.sidecar.navigation("snapshot");
      if (!current()) throw new Error("The selected backend changed.");
      const projects = (snapshot.projects || []).map(({ id, name }) => ({ id, name }));
      const selectedProjectId = snapshot.sessions?.find(session => session.id === snapshot.selected)?.projectId || null;
      return { apiVersion: 1, body: { backendId, projects, selectedProjectId } };
    }
    if (!["request", "open"].includes(envelope.operation) || envelope.backendId !== backendId ||
        typeof envelope.projectId !== "string" || !/^[a-f0-9-]{36}$/.test(envelope.projectId)) {
      throw new Error("Select the capture's owning backend and project.");
    }
    if (envelope.operation === "open") {
      await this.openApplication({ component: "references", projectId: envelope.projectId });
      return { apiVersion: 1, body: { ok: true } };
    }
    // All methods and bounded upload chunks use one fixed project-authorized
    // gateway. Backend validation owns the Connector protocol and job storage.
    const bootstrap = await AgentRemotes.request(entry.connection, "/api/bootstrap");
    if (!current()) throw new Error("The selected backend changed.");
    if (bootstrap.status !== 200 || !bootstrap.data?.authenticated || !bootstrap.data.csrf) throw new Error("Sign in to the owning backend first.");
    const response = await AgentRemotes.request(entry.connection, "/api/references/connector", {
      method: "POST", body: envelope, csrf: bootstrap.data.csrf,
    });
    if (!current()) throw new Error("The selected backend changed.");
    if (response.status !== 200) throw new Error(response.data?.error || `References is unavailable (HTTP ${response.status}).`);
    return { ...response.data, apiVersion: 1 };
  }

  async openFiles(value = {}) {
    return this.openApplication({ ...value, component: "files" });
  }

  async openApplication(value = {}) {
    const route = await this.prepareApplication(value);
    this.win.gBrowser.selectedTab = this.win.gBrowser.addTrustedTab(route.url, { userContextId: route.userContextId });
    this.browse();
    return { ok: true };
  }

  async prepareApplication(value = {}) {
    const resolving = typeof value.url === "string";
    if (!resolving && !["files", "references"].includes(value.component)) throw new Error("Unsupported application.");
    const browser = this.activeBrowser, entry = ownedViews.get(browser);
    const global = browser?.browsingContext.currentWindowGlobal;
    const current = () => !this.off && this.activeBrowser === browser && ownedViews.get(browser) === entry &&
      browser?.browsingContext.currentWindowGlobal === global && !this.win.closed && !DesktopLifetime.quitting;
    if (!entry || !global || !current()) throw new Error("Connect to this backend first.");
    const launch = await this.sidecar.navigation(resolving ? "application-resolve" : "application-open", resolving ? { url: value.url } :
      { component: value.component, projectId: value.projectId, cwd: value.cwd });
    if (!current()) throw new Error("The selected backend changed.");
    if ((!resolving && launch?.component !== value.component) || launch?.serviceId !== "files" || !launch.identity || typeof launch.openPath !== "string" ||
        !launch.openPath.startsWith("/") || launch.openPath.startsWith("//") || /[\x00-\x20\x7f\\#]/.test(launch.openPath)) {
      throw new Error("Application did not return a valid launch address.");
    }
    if (entry.connection.machineId) {
      const route = await machineFilesRoute(entry.connection.machineId);
      if (!current()) throw new Error("The selected backend changed.");
      AgentRemotes.trustApplicationContext(route.userContextId, launch.identity);
      return { url: route.url + launch.openPath, userContextId: route.userContextId };
    } else if (!entry.local) {
      await AgentRemotes.services(entry.connection.id);
      if (!current()) throw new Error("The selected backend changed.");
      return AgentRemotes.applicationServiceRoute(entry.connection.id, "files", launch.openPath, current, launch.identity);
    } else {
      const url = new URL(launch.url);
      if (url.protocol !== "https:" || url.hostname !== "127.0.0.1" ||
          url.username || url.password || url.hash || url.pathname + url.search !== launch.openPath) {
        throw new Error("Application did not return a local service address.");
      }
      // The service exchanges its own one-use launch grant. Never copy the
      // protected Agent cookie context into an ordinary Files/Office/PDF tab.
      return { url: url.href, userContextId: AgentRemotes.applicationContext(entry.connection.id, Number(url.port) || 443, launch.identity) };
    }
  }

  async chooseFolder(browser, { title, path } = {}) {
    const entry = ownedViews.get(browser);
    if (!entry?.local || entry.connection.machineId || this.off || this.activeBrowser !== browser) throw new Error("Use this backend's folder picker.");
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    picker.init(this.win.browsingContext, typeof title === "string" ? title.slice(0, 200) : "Choose a folder", Ci.nsIFilePicker.modeGetFolder);
    if (typeof path === "string" && PathUtils.isAbsolute(path) && !path.includes("\0")) {
      try {
        const directory = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        directory.initWithPath(path);
        picker.displayDirectory = directory;
      } catch { /* A removed initial folder must not prevent choosing another. */ }
    }
    const selected = await new Promise(resolve => picker.open(resolve));
    if (selected !== Ci.nsIFilePicker.returnOK) return null;
    const current = ownedViews.get(browser);
    if (this.off || this.activeBrowser !== browser || !current?.local || current.connection !== entry.connection) throw new Error("The selected Agent changed.");
    return control("project-root", { path: picker.file.path });
  }

  async refreshRemotes() {
    this.choice.value = this.selection;
    await this.sidecar.refresh();
  }

  async choose(id) {
    const epoch = this.selectionEpoch = (this.selectionEpoch || 0) + 1;
    await this.saveCurrentDraft();
    if (epoch !== this.selectionEpoch || this.win.closed) return;
    this.cancelProviderLogins();
    this.cancelReferences();
    this.closeConnections();
    this.selection = id;
    clearTimeout(this.timer);
    lazy.BrowserControlChannel.close("remote switch");
    // Revoke pending remote authority now; Local must not wait for its process to exit.
    AgentRemotes.deactivate(false).catch(console.error);
    this.remote = null;
    this.machineId = null;
    this.activeBrowser = null;
    for (const browser of this.views.values()) browser.hidden = true;
    Services.prefs.setStringPref("bashkitten.agent.selectedRemote", id);
    try {
      if (!id) return await this.local(epoch);
      if (this.sidecar.backends?.some(backend => backend.id === id && backend.kind === "machine")) return await this.selectMachine(id, epoch);
      const connection = await AgentRemotes.activate(id);
      if (epoch !== this.selectionEpoch) return;
      const selected = connection || await AgentRemotes.connection(id);
      if (epoch !== this.selectionEpoch) return;
      await this.selectRemote(selected, false, epoch);
    } catch (error) {
      if (epoch !== this.selectionEpoch) return;
      this.failure(error);
      throw error;
    }
  }

  async selectMachine(id, epoch = this.selectionEpoch = (this.selectionEpoch || 0) + 1) {
    this.selection = id; this.remote = null; this.machineId = id;
    this.off = false;
    this.message("Connecting to container", "Opening its protected Agent…");
    const current = () => epoch === this.selectionEpoch && this.selection === id && !this.win.closed && !DesktopLifetime.quitting;
    const status = await this.machineLocalControl(id, "status");
    if (!current()) return;
    if (["stopped", "off", "error", "failed"].includes(status.web?.status)) {
      this.off = true;
      this.message("Container Agent off", status.web.error || "Turn on this container’s Agent to reconnect to its saved chats.", () => this.run(async () => {
        if (!current()) return;
        this.message("Starting container Agent", "Connecting to its local service…");
        await this.machineLocalControl(id, "start");
        if (current()) await this.selectMachine(id, epoch);
      }), "Turn on Agent");
      return;
    }
    const connection = await connectMachine(id, control, error => {
      if (epoch !== this.selectionEpoch || this.selection !== id || this.off) return;
      void this.disconnectSelected();
      this.message("Container disconnected", error.message);
      this.sidecar.notice.textContent = error.message;
    }, () => epoch === this.selectionEpoch && this.selection === id && !this.off && !this.win.closed);
    if (epoch !== this.selectionEpoch || this.selection !== id || this.off) { await disconnectMachine(id, connection.transportGeneration); return; }
    await this.connect(connection, true, { reload: true });
    void this.machineLocalControl(id, "status").then(status => {
      if (epoch === this.selectionEpoch) this.showLocalAISetup(status, id);
    }).catch(console.error);
  }

  machineLocalControl(id, command, value = {}) {
    const { browserOwner, ...guestValue } = value;
    return control("machines.guest-control", { id, command, value: guestValue });
  }

  async watchMachineActivations() {
    try {
      while (!this.win.closed && !DesktopLifetime.quitting) {
        const { activations } = await control("machines.activations", { wait: true });
        if (this.win.closed || DesktopLifetime.quitting) return;
        for (const activation of activations) {
          await this.sidecar.refresh();
          try {
            if (!this.sidecar.backends.some(backend => backend.id === activation.machineId)) continue;
            this.win.restore(); this.win.focus(); this.show();
            // An explicit guest-tray Open may replace a pending selection.
            // Do not consume it through run(), which can skip while busy.
            await this.choose(activation.machineId);
          } catch (error) { this.sidecar.notice.textContent = error.message; }
          finally { await control("machines.activations", { ack: activation }); }
        }
      }
    } catch (error) {
      if (!this.win.closed && !DesktopLifetime.quitting) this.sidecar.notice.textContent = `Container activation: ${error.message}`;
    }
  }

  async selectRemote(connection, forceLogin = false, epoch = this.selectionEpoch = (this.selectionEpoch || 0) + 1) {
    this.selection = connection.id;
    this.remote = connection;
    this.off = false;
    this.choice.value = connection.id;
    this.message("Connecting to remote", "Opening the enrolled Tor connection…");
    const result = await AgentRemotes.connect(connection.id, forceLogin);
    if (epoch !== this.selectionEpoch || this.selection !== connection.id || this.off) return;
    this.remote = result.connection;
    if (result.loginURL) AgentRemotes.onLogin(connection.id, (error, ready) => {
      if (epoch !== this.selectionEpoch || this.selection !== connection.id || this.off) return;
      if (error) { this.failure(error); return; }
      this.remote = ready;
      this.run(() => this.connect(ready, false, { reload: true }));
    });
    await this.connect(result.connection, false, { reload: Boolean(result.loginURL), navigateTo: result.loginURL });
  }

  async local(epoch = this.selectionEpoch = (this.selectionEpoch || 0) + 1) {
    this.machineId = null;
    this.selection = "";
    this.remote = null;
    this.choice.value = "";
    this.currentIdentity = null;
    this.localConnection = null;
    return this.start(epoch);
  }

  async start(epoch = this.selectionEpoch = (this.selectionEpoch || 0) + 1) {
    this.closeConnections();
    if (this.off) this.localConnection = null;
    this.off = false;
    this.power.textContent = "Starting…";
    this.message("Starting Agent", "Connecting to your local service…");
    if (this.machineId) return this.selectMachine(this.machineId, epoch);
    if (this.remote) {
      const connection = await AgentRemotes.activate(this.remote.id);
      if (epoch !== this.selectionEpoch) return;
      const selected = connection || await AgentRemotes.connection(this.remote.id);
      if (epoch !== this.selectionEpoch) return;
      return this.selectRemote(selected, false, epoch);
    }
    const status = await control("start");
    this.localOn = status.web?.status === "running";
    if (epoch !== this.selectionEpoch) return;
    await this.update(status);
    this.schedule();
  }

  async stop() {
    const epoch = this.selectionEpoch;
    if (this.machineId && this.selection === this.machineId) {
      const id = this.machineId;
      await control("machines.stop", { id });
      if (epoch === this.selectionEpoch && this.machineId === id) await this.disconnectSelected();
      await this.sidecar.refresh(); return;
    }
    if (this.remote) {
      await AgentRemotes.disconnect(this.remote.id);
      if (epoch === this.selectionEpoch) await this.disconnectSelected();
      await this.sidecar.refresh();
      return;
    }
    return this.stopLocal();
  }

  async disconnectSelected() {
    this.selectionEpoch = (this.selectionEpoch || 0) + 1;
    this.off = true;
    this.cancelProviderLogins();
    this.cancelReferences();
    lazy.BrowserControlChannel.close("Selected backend disconnected");
    if (this.activeBrowser) this.activeBrowser.hidden = true;
    this.message("Backend disconnected", "Reconnect from its heading. Its saved chats remain available.");
    if (this.machineId) await disconnectMachine(this.machineId);
  }

  async stopLocal() {
    const selectedLocal = !this.selection;
    const epoch = selectedLocal ? this.selectionEpoch = (this.selectionEpoch || 0) + 1 : this.selectionEpoch;
    if (selectedLocal) await this.saveCurrentDraft();
    clearTimeout(this.timer);
    if (selectedLocal && epoch === this.selectionEpoch) {
      this.cancelProviderLogins();
      this.cancelReferences();
      this.closeConnections();
      this.off = true;
      await lazy.BrowserControlChannel.close("Local Agent turned off");
      if (epoch === this.selectionEpoch && !this.selection) await AgentRemotes.deactivate(false);
    }
    this.localConnection = null;
    if (selectedLocal && epoch === this.selectionEpoch) {
      this.power.textContent = "Stopping…";
      this.message("Stopping Local", "Waiting for owned Local services to stop safely…");
    }
    let status = await control("stop");
    while (status.web?.status === "stopping" || status.web?.status === "running") {
      await new Promise(resolve => setTimeout(resolve, 1000));
      status = await control("stop");
    }
    if (status.web?.status !== "stopped" && status.web?.status !== "off") throw new Error(status.web?.error || "Agent shutdown has not been confirmed. Retry Turn off.");
    this.localOn = false;
    if (selectedLocal && epoch === this.selectionEpoch && !this.selection && this.off) this.stopped();
    await this.sidecar.refresh();
  }

  stopped() {
    this.closeConnections();
    lazy.BrowserControlChannel.close("Agent stopped");
    AgentRemotes.deactivate(false).catch(console.error);
    this.localConnection = null;
    for (const [key, browser] of this.views) {
      const entry = ownedViews.get(browser);
      if (!entry?.local || entry.connection.machineId) continue;
      ownedViews.delete(browser);
      browser.remove();
      this.views.delete(key);
    }
    this.activeBrowser = null;
    this.power.textContent = "Turn on";
    this.message("Agent off", "Your browser remains open. Turn on to reconnect to your saved chats.");
  }

  retireLocalIdentity(previous) {
    this.drafts.delete(`local:${previous.identity}`);
    const browser = this.views.get("local");
    if (browser && ownedViews.get(browser)?.connection.userContextId === previous.userContextId) {
      ownedViews.delete(browser);
      browser.stop(); browser.remove(); this.views.delete("local");
      if (this.activeBrowser === browser) this.activeBrowser = null;
    }
    this.localConnection = null;
    this.localGeneration = null;
    this.currentIdentity = null;
    this.currentInstanceId = null;
    if (!this.selection) this.closeConnections();
  }

  async update(status, { reload = false } = {}) {
    if (this.off || this.selection) return;
    const epoch = this.selectionEpoch;
    const revision = this.localUpdate = (this.localUpdate || 0) + 1;
    const current = () => !this.off && !this.selection && !this.win.closed && !DesktopLifetime.quitting &&
      this.selectionEpoch === epoch && this.localUpdate === revision;
    const web = status.web || {};
    this.localOn = web.status === "running";
    this.sidecar?.render();
    if (web.error || ["failed", "stopped", "off"].includes(web.status)) {
      this.off = true;
      this.stopped();
      if (web.error) this.message("Agent off", web.error);
      return;
    }
    if (!web.url || !web.identity) {
      this.message("Starting Agent", "Waiting for HTTPS and authentication…");
      return;
    }
    const url = new URL(web.url);
    if (url.protocol !== "https:" || url.hostname !== "127.0.0.1" || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) throw new Error("The local controller supplied an invalid HTTPS address.");
    if (web.auth?.mode !== "native-local") throw new Error("Update the local BashKitten package to use native Local authentication.");
    if (!web.auth.generation) throw new Error("The local Agent session is unavailable.");
    const enroll = !this.localConnection || this.localConnection.url !== url.href ||
      this.currentIdentity !== web.identity.caSha256 || this.currentInstanceId !== web.identity.instanceId;
    let local;
    if (enroll || this.localGeneration !== web.auth.generation) {
      try { local = await control("local-session"); }
      catch (error) { if (!current()) return; throw error; }
      if (!current()) return;
      if (typeof web.identity.instanceId !== "string") throw new Error("Missing local server identity.");
      const cookieName = "__Host-bashkitten_local_" + web.identity.instanceId.replaceAll("-", "");
      if (local.url !== web.url || local.generation !== web.auth.generation ||
          local.identity?.caSha256 !== web.identity.caSha256 || local.identity?.instanceId !== web.identity.instanceId ||
          local.cookie?.name !== cookieName || !/^[a-f0-9]{64}$/.test(local.cookie?.value || "")) {
        throw new Error("The local Agent changed while connecting. Turn on to retry.");
      }
    }
    if (enroll) {
      const selection = AgentRemotes.selection;
      try {
        await AgentRemotes.trustLocal({ url: web.url, ...web.identity }, {
          current: () => current() && AgentRemotes.selection === selection,
          replace: previous => {
            contexts.delete(previous.userContextId);
            Services.ppmm.sharedData.set("BashKittenAgentContexts", [...contexts]);
            Services.ppmm.sharedData.flush();
            for (const win of Services.wm.getEnumerator("navigator:browser")) win.BashKittenAgent?.retireLocalIdentity(previous);
          },
        });
      } catch (error) {
        if (!current() || AgentRemotes.selection !== selection) return;
        throw error;
      }
      if (!current() || AgentRemotes.selection !== selection) return;
      const activating = AgentRemotes.activate("local"), activation = AgentRemotes.selection;
      let connection;
      try { connection = await activating; }
      catch (error) {
        if (!current() || AgentRemotes.selection !== activation) return;
        throw error;
      }
      if (!current() || AgentRemotes.selection !== activation) return;
      this.localConnection = connection;
    }
    const connection = this.localConnection;
    this.currentIdentity = web.identity.caSha256;
    this.currentInstanceId = web.identity.instanceId;
    if (local) {
      Services.cookies.add("127.0.0.1", "/", local.cookie.name, local.cookie.value, true, true, true,
        Date.now() + 400 * 86400000, { userContextId: connection.userContextId },
        Ci.nsICookie.SAMESITE_STRICT, Ci.nsICookie.SCHEME_HTTPS);
      this.localGeneration = local.generation;
      reload = true;
    }
    await this.connect(connection, true, { reload });
    if (current()) this.showLocalAISetup(status);
  }

  showLocalAISetup(status, backendId = "local") {
    if (this.off || (this.selection || "local") !== backendId || this.win.closed || DesktopLifetime.quitting ||
        !["pending", "running", "interrupted"].includes(status.localAISetup?.status) || !status.web?.identity?.instanceId) return;
    const key = `${backendId}:${status.web.identity.instanceId}`;
    if (shownLocalAISetups.has(key)) return;
    shownLocalAISetups.add(key);
    // Show the existing nonblocking setup page once. Closing it or choosing
    // another settings page must not make status polling reopen it.
    if (!this.connectionsPanel && !this.settingsVisited.has(backendId) && this.layout === "full")
      void this.openSettings("localai", { backendId }).catch(console.error);
  }

  async connect(connection, local, { reload = false, navigateTo = null } = {}) {
    const epoch = this.selectionEpoch;
    if (!connection?.url || !Number.isInteger(connection.userContextId)) throw new Error("The Agent connection is missing its protected browser identity.");
    const origin = new URL(connection.url).origin;
    // Container filesystem operations belong to its backend picker/downloads;
    // native-local login does not grant access to host filesystem UI.
    contexts.set(connection.userContextId, { origin, local: local && !connection.machineId, providerLogin: Boolean(local && connection.machineId) });
    Services.ppmm.sharedData.set("BashKittenAgentContexts", [...contexts]);
    Services.ppmm.sharedData.flush();
    const key = connection.id || connection.identity?.instanceId || `local:${connection.userContextId}`;
    const draftKey = `${key}:${connection.identity}`;
    let browser = this.views.get(key);
    if (!browser) {
      browser = xul(this.doc, "browser", {
        type: "content", remote: "true", maychangeremoteness: "true", flex: "1",
        usercontextid: connection.userContextId, messagemanagergroup: "bashkitten-agent",
        "bashkitten-protected": "true", disablehistory: "true", disablefullscreen: "true",
        tooltip: "aHTMLTooltip", contextmenu: "contentAreaContextMenu",
      });
      this.views.set(key, browser);
      this.viewBox.append(browser);
      browser.bashkittenMediaPermissionPrompt = (actor, request) => this.microphonePermission(browser, actor, request);
      const host = this;
      browser.addProgressListener({
        QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
        onLocationChange(progress, request, location) {
          if (!progress.isTopLevel || location.spec === "about:blank") return;
          const expected = ownedViews.get(browser)?.connection;
          if (!expected) return;
          let uri;
          try { uri = new URL(location.spec); } catch { return; }
          if (uri.protocol === "http:" && uri.hostname === "127.0.0.1" && uri.pathname === "/oauth/callback") { browser.stop(); return; }
          if (uri.origin !== new URL(expected.url).origin) {
            browser.stop();
            if (["https:", "http:"].includes(uri.protocol)) host.win.openTrustedLinkIn(uri.href, "tab");
            browser.loadURI(Services.io.newURI(expected.url), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
          } else if (uri.pathname.startsWith("/login")) {
            lazy.BrowserControlChannel.close("authentication required");
          }
        },
        onStateChange() {}, onProgressChange() {}, onStatusChange() {}, onSecurityChange() {}, onContentBlockingEvent() {},
      }, Ci.nsIWebProgress.NOTIFY_LOCATION);
      browser.addEventListener("oop-browser-crashed", () => {
        browser.bashkittenCrashed = true;
        if (browser === this.activeBrowser && !this.off) this.run(() => ownedViews.get(browser)?.local ? this.reconnect() : this.selectRemote(this.remote));
      });
    }
    reload ||= Boolean(browser.bashkittenCrashed);
    browser.bashkittenCrashed = false;
    connection.requestContext = browser.browsingContext;
    const previousEntry = ownedViews.get(browser);
    if (previousEntry?.draftKey === draftKey && previousEntry.connection.url === connection.url) {
      previousEntry.connection = connection;
    } else ownedViews.set(browser, { host: this, connection, local, key, draftKey });
    for (const item of this.views.values()) item.hidden = item !== browser;
    this.activeBrowser = browser;
    this.state.hidden = true;
    this.viewBox.hidden = false;
    this.power.textContent = "Turn off";
    this.power.title = local ? "Stop Agent services and Pi processes" : "Disconnect this client";
    if (reload || browser.getAttribute("data-agent-url") !== connection.url) {
      if (browser.hasAttribute("data-agent-url") && previousEntry?.draftKey === draftKey) {
        try {
          const draft = await browser.browsingContext.currentWindowGlobal.getActor("BashKittenAgent").sendQuery("CaptureDraft");
          if (draft && epoch === this.selectionEpoch && !this.off && this.activeBrowser === browser &&
              browser.isConnected && ownedViews.get(browser) === previousEntry) this.drafts.set(draftKey, draft);
        } catch (error) { console.warn("Could not retain Agent draft after a content crash", error); }
      }
      if (epoch !== this.selectionEpoch || this.off || this.activeBrowser !== browser) return;
      browser.setAttribute("data-agent-url", connection.url);
      const target = new URL(navigateTo || connection.url);
      const draftSession = this.drafts.get(draftKey)?.sessionId;
      const savedHash = draftSession ? `#session=${draftSession}` : this.drafts.get(draftKey)?.sessionHash;
      if (!navigateTo && typeof savedHash === "string" && /^#session=[a-f0-9-]{36}$/.test(savedHash)) target.hash = savedHash;
      browser.loadURI(Services.io.newURI(target.href), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    }
    return browser;
  }

  schedule() {
    clearTimeout(this.timer);
    if (this.off || this.selection) return;
    const epoch = this.selectionEpoch;
    this.timer = setTimeout(async () => {
      try {
        const status = await control("status");
        if (epoch === this.selectionEpoch && !this.selection && !this.off) await this.update(status);
      } catch (error) { if (epoch === this.selectionEpoch && !this.selection && !this.off) this.failure(error); }
      if (epoch === this.selectionEpoch) this.schedule();
    }, 5000);
  }
  async reconnect() {
    if (this.machineId && this.selection === this.machineId && !this.off) return this.selectMachine(this.machineId);
    if (this.off || this.remote) return;
    const epoch = this.selectionEpoch;
    this.localGeneration = null;
    const status = await control("status");
    if (epoch !== this.selectionEpoch || this.off || this.selection) return;
    await this.update(status, { reload: true });
  }
  message(title, text, action, label = "Set up account") {
    this.state.replaceChildren(html(this.doc, "h2", {}, title), html(this.doc, "p", {}, text));
    this.state.hidden = false;
    this.viewBox.hidden = true;
    if (action) {
      const button = html(this.doc, "button", { type: "button" }, label);
      button.addEventListener("click", action);
      this.state.append(button);
    }
  }
  failure(error) {
    if (DesktopLifetime.quitting) return;
    clearTimeout(this.timer);
    // A failed stop remains a retryable stop, never a falsely confirmed Off.
    const stopping = this.off && this.power?.textContent === "Stopping…";
    this.off = !stopping;
    if (this.power) this.power.textContent = stopping ? "Retry Turn off" : "Turn on";
    if (this.state) this.message(stopping ? "Shutdown not confirmed" : "Agent unavailable", error.message || String(error));
    console.error("BashKitten Agent operation failed", error);
  }

  dialog(title) {
    const dialog = html(this.doc, "dialog", { class: "bashkitten-agent-dialog" });
    dialog.append(html(this.doc, "h2", {}, title));
    const content = html(this.doc, "div");
    dialog.append(content);
    const actions = html(this.doc, "div", { class: "actions" });
    const close = html(this.doc, "button", { type: "button" }, "Close");
    close.addEventListener("click", () => dialog.close());
    actions.append(close);
    dialog.append(actions);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    this.doc.documentElement.append(dialog);
    dialog.showModal();
    return { dialog, content, actions };
  }

  async microphonePermission(browser, actor, request) {
    let allowed = false;
    try {
      const current = () => protectedAgentView(actor)?.host === this && actor.browsingContext.embedderElement === browser &&
        actor.manager === browser.browsingContext.currentWindowGlobal && request.windowID === actor.manager.outerWindowId &&
        !this.pane.hidden && !browser.hidden && !new URL(request.documentURI).pathname.startsWith("/login");
      const device = request.audioInputDevices?.[0];
      if (!current() || !request.secure || request.requestTypes?.length !== 1 || request.requestTypes[0] !== "Microphone" ||
          !device || request.videoInputDevices?.length || request.audioOutputDevices?.length || request.sharingScreen || request.sharingAudio) return;
      const name = ownedViews.get(browser).connection.name || new URL(request.documentURI).hostname;
      if (!Services.prompt.confirm(this.win, "Use microphone?", `Allow Agent (${name}) to record this microphone message? Click the microphone again to stop recording.`)) return;
      if (!current()) return;
      if (!await actor.checkOSPermission(false, true, false)) return;
      if (!current()) return;
      actor.activateDevicePerm(request.windowID, device.mediaSource, device.rawId);
      actor.sendAsyncMessage("webrtc:Allow", { callID: request.callID, windowID: request.windowID, devices: [device.deviceIndex] });
      allowed = true;
    } catch {
      // A changed/destroyed protected document receives no permission.
    } finally {
      if (!allowed) { try { actor.denyRequest(request); } catch {} }
    }
  }

  async localAI() { return this.openSettings("localai"); }
  async connectToPhone(id, title = "Callback") { return this.openSettings(title === "Notifications" ? "notifications" : "telephone", { backendId: id }); }
  async shareMachine(id) { return this.openSettings("share-local", { backendId: id }); }

  async phoneStatus(backend) {
    let result;
    if (backend.kind === "machine") result = await this.machineLocalControl(backend.id, "phone-status");
    else if (backend.kind === "local") result = await control("phone-status");
    else {
      const browser = this.activeBrowser, view = ownedViews.get(browser), connection = view?.connection;
      const context = browser?.browsingContext, global = context?.currentWindowGlobal, epoch = this.selectionEpoch;
      const current = () => !this.off && !this.win.closed && !DesktopLifetime.quitting && this.selectionEpoch === epoch &&
        this.selection === backend.id && this.remote === connection && view?.host === this && !view.local &&
        connection?.id === backend.id && connection.requestContext === context && this.activeBrowser === browser &&
        browser.isConnected && ownedViews.get(browser) === view && global?.isCurrentGlobal && context.currentWindowGlobal === global;
      if (!current()) throw new Error("The selected remote Agent changed.");
      const { entry, owner } = AgentRemotes.serviceOwner(backend.id);
      const response = await AgentRemotes.request(connection, "/api/phone/status");
      AgentRemotes.current(entry, owner);
      if (!current()) throw new Error("The selected remote Agent changed.");
      if (response.status !== 200) throw new Error(response.data?.error || "Sign in to this backend before checking its phone registration.");
      result = response.data;
    }
    return { registrations: (result.registrations || []).map(({ name, connected, telephony, messages, lastSeenAt }) => ({ name, connected, telephony, messages, lastSeenAt })) };
  }

  async openSettings(section, options = {}) {
    this.settingsVisited.add(options.backendId || this.selection || "local");
    this.show();
    if (["general", "providers"].includes(section)) {
      await this.sidecar.select(this.selection || "local");
      return this.sidecar.navigation(section);
    }
    const backend = this.sidecar.backends?.find(item => item.id === (options.backendId || this.selection || "local"));
    if (!backend) throw new Error("This backend is no longer available.");
    if (section === "localai" && !["local", "machine"].includes(backend.kind)) throw new Error("Local AI is configured on its owning device.");
    if (section === "share-local" && backend.kind === "remote") throw new Error("Sharing is configured on the owning device.");
    if (section === "performance" && backend.kind === "remote") throw new Error("Performance is available for Local and owned containers.");
    if (section === "machine" && backend.kind !== "machine") throw new Error("Choose a managed container.");
    if (backend.kind === "remote" && ["telephone", "notifications"].includes(section)) {
      const layout = this.layoutEpoch;
      // Remote status uses that backend's authenticated protected chat, not
      // connection metadata or the previously selected backend's document.
      await this.sidecar.select(backend.id);
      if (layout !== this.layoutEpoch || this.selection !== backend.id || this.off || this.win.closed || DesktopLifetime.quitting) throw new Error("The settings owner changed.");
    }
    let epoch = this.selectionEpoch;
    const panel = xul(this.doc, "vbox", { id: "bashkitten-settings-view", flex: "1" });
    const browser = xul(this.doc, "browser", { type: "content", remote: "true", remoteType: "web", maychangeremoteness: "true", messagemanagergroup: "bashkitten-settings", flex: "1", disableglobalhistory: "true", "bashkitten-protected": "true" });
    panel.append(browser);
    this.connectionsPanel = panel; this.settingsBrowser = browser;
    this.pane.append(panel); this.pane.setAttribute("data-connections", "true");
    let closed = false;
    const current = () => !closed && this.connectionsPanel === panel && this.selectionEpoch === epoch && !DesktopLifetime.quitting;
    const request = (name, value = {}) => backend.kind === "machine" ? this.machineLocalControl(backend.id, name, value) : control(name, value);
    const startupCall = autostartController({ control, request, backend, current, startupStatus: result => this.updateStartupNotice(result) });
    const tests = new Set(), setups = new Map(), monitor = new LinuxPerformanceMonitor();
    let performanceSession = null, performanceTask = null;
    const pause = () => {
      monitor.reset();
      if (performanceSession) { const session = performanceSession; performanceSession = null; void request("performance-close", { session }).catch(() => {}); }
    };
    const theme = () => {
      const scheme = this.win.getComputedStyle(this.pane).colorScheme;
      if (scheme === "light" || scheme === "dark") return scheme;
      return this.win.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    };
    const themeObserver = new this.win.MutationObserver(() => BashKittenSettings.notify(browser, "theme", { theme: theme() }));
    themeObserver.observe(this.doc.documentElement, { attributes: true, attributeFilter: ["lwtheme", "lwtheme-brighttext", "lwthemetextcolor", "lwt-toolbar", "style"] });
    const themeMedia = this.win.matchMedia("(prefers-color-scheme: dark)");
    const themeChanged = () => BashKittenSettings.notify(browser, "theme", { theme: theme() });
    themeMedia.addEventListener("change", themeChanged);
    const cleanup = () => {
      if (closed) return; closed = true; pause(); themeObserver.disconnect(); themeMedia.removeEventListener("change", themeChanged);
      for (const owner of tests) void request("localai-router-model-test-cancel", { owner }).catch(console.error);
      for (const setupId of setups.keys()) void request("share-cancel", { setupId }).catch(console.error);
      tests.clear(); setups.clear();
    };
    const call = async (name, value) => {
      if (!current() || closed) throw new Error("The settings owner changed.");
      if (name.startsWith("autostart.")) return startupCall(name, value);
      if (name.startsWith("machines.")) {
        if (backend.kind !== "machine" || value.id !== undefined && value.id !== backend.id) throw new Error("This operation belongs to another container.");
        if (["machines.connect-phone", "machines.share-local"].includes(name)) {
          this.win.setTimeout(() => { if (current()) this.openSettings(name === "machines.connect-phone" ? "telephone" : "share-local", { backendId: backend.id }).catch(console.error); }, 0);
          return { ok: true };
        }
        const { BashKittenDisplay } = ChromeUtils.importESModule("resource:///modules/BashKittenDisplay.sys.mjs");
        if (name === "machines.display-capabilities") return BashKittenDisplay.capabilities();
        const payload = { ...value, id: backend.id };
        delete payload.displayCapabilities;
        if (["machines.save", "machines.start", "machines.restart", "machines.retry"].includes(name)) payload.displayCapabilities = BashKittenDisplay.capabilities();
        const result = await control(name, payload);
        if (current() && ["machines.stop", "machines.delete"].includes(name) && this.selection === backend.id) {
          await this.disconnectSelected();
          if (this.connectionsPanel === panel && this.selection === backend.id) epoch = this.selectionEpoch;
        }
        if (current() && (name !== "machines.operation" || ["complete", "failed", "cancelled"].includes(result.operation?.state || result.state))) void this.sidecar.refresh().catch(console.error);
        return result;
      }
      if (name === "phone-status") return this.phoneStatus(backend);
      if (name === "phone-share") {
        if (backend.kind === "remote") throw new Error("Sharing is configured on the owning device.");
        this.win.setTimeout(() => { if (current()) this.openSettings("share-local", { backendId: backend.id }).catch(console.error); }, 0);
        return { ok: true };
      }
      if (name.startsWith("remotes.")) return remoteSettingsCall(this, name, value, current, () => { epoch = this.selectionEpoch; }, backend);
      if (name === "clipboard-copy") {
        if (typeof value.text !== "string") throw new Error("Expected text to copy.");
        Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(value.text); return { ok: true };
      }
      if (name === "performance-close") { pause(); return { ok: true }; }
      if (name === "performance-sample") {
        if (this.pane.hidden || this.doc.hidden || !this.doc.hasFocus() || this.win.windowState === this.win.STATE_MINIMIZED) { pause(); throw new Error("Performance sampling is paused while the view is hidden."); }
        if (performanceTask) return performanceTask;
        const session = performanceSession ||= Services.uuid.generateUUID().toString().slice(1, -1);
        performanceTask = Promise.all([backend.kind === "local" ? monitor.sample() : Promise.resolve({}), request("performance-sample", { session }).catch(error => ({ cpuPercent: null, reason: error.message }))]).then(([system, workload]) => ({ ...system, workload })).finally(() => {
          performanceTask = null;
          if (performanceSession !== session) void request("performance-close", { session }).catch(() => {});
        });
        return performanceTask;
      }
      if (name === "share-open-localai") {
        if (!["local", "machine"].includes(backend.kind)) throw new Error("Open Local AI on the owning device.");
        this.win.setTimeout(() => { if (current()) this.openSettings("localai", { backendId: backend.id }).catch(console.error); }, 0); return { ok: true };
      }
      if (name === "share-save-qr") {
        const state = await request("share-status");
        if (!current() || typeof state.qrDataUrl !== "string" || !state.qrDataUrl.startsWith("data:image/png;base64,")) throw new Error("Connection QR is unavailable.");
        const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
        picker.init(this.win.browsingContext, "Download QR image", Ci.nsIFilePicker.modeSave); picker.defaultString = "bashkitten-connection.png"; picker.appendFilter("PNG image", "*.png");
        const result = await new Promise(resolve => picker.open(resolve));
        if (current() && [Ci.nsIFilePicker.returnOK, Ci.nsIFilePicker.returnReplace].includes(result)) await IOUtils.write(picker.file.path, Uint8Array.from(this.win.atob(state.qrDataUrl.split(",")[1]), char => char.charCodeAt(0)), { permissions: 0o600 });
        return { ok: true };
      }
      if (name === "share-open-authenticator") {
        const uri = setups.get(value.setupId);
        if (!uri?.startsWith("otpauth://totp/")) throw new Error("Authenticator setup is no longer active.");
        Cc["@mozilla.org/uriloader/external-protocol-service;1"].getService(Ci.nsIExternalProtocolService).loadURI(Services.io.newURI(uri), Services.scriptSecurityManager.getSystemPrincipal(), null, this.win.browsingContext, false, true); return { ok: true };
      }
      if (name === "localai-router-model-test") {
        if (typeof value.owner !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.owner)) throw new Error("Invalid model check identity.");
        tests.add(value.owner);
      }
      if (["localai-router-model-test-cancel", "localai-router-model-test-status"].includes(name) && !tests.has(value.owner)) throw new Error("This model check belongs to another settings view.");
      if (["share-confirm", "share-cancel"].includes(name) && !setups.has(value.setupId)) throw new Error("This account setup belongs to another settings view.");
      if (["share-setup", "share-reissue"].includes(name) || name === "share-publish" && value.enabled || name === "service-action" && ["start", "reload"].includes(value.action)) {
        const status = await request("start"); if (!current()) throw new Error("The settings owner changed.");
        if (backend.kind === "local" && !this.selection && !this.remote) { this.off = false; await this.update(status); this.schedule(); }
        else if (backend.kind === "machine" && this.selection === backend.id && this.off) {
          // Native startup may restore a guest whose protected chat is still
          // disconnected. Refresh its private session without replacing the
          // settings owner or changing the independent Display tab.
          await this.selectMachine(backend.id, epoch);
        }
        if (!current()) throw new Error("The settings owner changed.");
      }
      const result = await request(name, value);
      if (name === "localai-router-model-test" && (!current() || closed)) await request("localai-router-model-test-cancel", { owner: value.owner });
      if (["share-setup", "share-reissue"].includes(name) && result.setupId) {
        if (!current() || closed) await request("share-cancel", { setupId: result.setupId });
        else setups.set(result.setupId, result.otpauthUrl);
      }
      if (["share-confirm", "share-cancel"].includes(name)) setups.delete(value.setupId);
      return result;
    };
    const revoke = BashKittenSettings.enroll(browser, {
      info: { platform: "linux", section, backendName: section === "performance" && backend.kind === "local" ? "This Linux device" : backend.name, local: backend.kind === "local", backendKind: backend.kind, machineId: backend.kind === "machine" ? backend.id : null, operation: Boolean(options.operation), displayCommand: Boolean(options.displayCommand), theme: theme(), connectOnly: Boolean(options.connectOnly) },
      current, call, cleanup, pause, close: () => {
        this.closeConnections();
        // The chat browser can retain focus beneath this settings panel, so
        // closing it need not produce the window focus event used by the web UI.
        if (section === "localai" && (this.selection || "local") === backend.id)
          void this.sidecar.navigation("refresh").catch(console.error);
      },
    });
    panel.addEventListener("close", () => { revoke(); if (this.settingsBrowser === browser) this.settingsBrowser = null; }, { once: true });
    try { browser.loadURI(Services.io.newURI(SETTINGS_URI), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); }
    catch (error) { this.closeConnections(); throw error; }
  }

  machineDisplayOpen(id) { return Boolean(lazy.BashKittenDisplay.tab(this.win, id)); }

  async toggleMachineDisplay(id) {
    if (lazy.BashKittenDisplay.close(this.win, id)) return;
    const { environment, controls } = await this.machineDisplayDescriptor(id);
    if (this.win.closed || DesktopLifetime.quitting) return;
    return lazy.BashKittenDisplay.open(this.win, environment, controls);
  }

  machineDisplayOperation(id, cursor) { return control("machines.operation", { id, cursor }); }

  async machineDisplayDescriptor(id) {
    const endpoint = await control("machines.display", { id });
    return { environment: { kind: "container", id, name: endpoint.name,
      presenterSocket: endpoint.presenterSocket, running: endpoint.running, state: endpoint.state, error: endpoint.error }, controls: {
      clipboard: payload => control("machines.clipboard", { ...payload, id }),
      service: action => control(action === "status" ? "machines.display" : `machines.display-${action}`, { id }),
    } };
  }

  async shareLocal() { return this.openSettings("share-local", { backendId: "local" }); }

  closeConnections() {
    const panel = this.connectionsPanel;
    if (!panel) return;
    this.connectionsPanel = null;
    this.pane.removeAttribute("data-connections");
    panel.dispatchEvent(new this.win.Event("close"));
    panel.remove();
    this.activeBrowser?.focus();
  }

  async remotes(connectOnly = true) { return this.openSettings("remotes", { connectOnly }); }

  serviceKeyPrompt(title, current) {
    const { dialog, content, actions } = this.dialog(title + " API key");
    const input = html(this.doc, "input", { type: "password", autocomplete: "off", "aria-label": "Service API key" });
    content.append(html(this.doc, "p", {}, "Save an empty field to clear the key. Close keeps the existing key."), input);
    const save = html(this.doc, "button", { type: "button" }, "Save"); actions.prepend(save);
    return new Promise(resolve => {
      save.addEventListener("click", () => { if (!current()) return dialog.close(); const secret = input.value; input.value = ""; resolve(secret); dialog.close(); });
      dialog.addEventListener("close", () => { input.value = ""; resolve(null); }, { once: true });
      this.connectionsPanel?.addEventListener("close", () => dialog.close(), { once: true });
    });
  }

  async enrollRemote(method, current) {
    if (!["scan", "image"].includes(method)) throw new Error("Choose QR scan or image.");
    const { dialog, content } = this.dialog("Connect to remote");
    const password = html(this.doc, "input", { type: "password", autocomplete: "off", required: "", "aria-label": "Connection password" });
    const feedback = html(this.doc, "p", { role: "status" });
    const form = html(this.doc, "form"), submit = html(this.doc, "button", { type: "submit", disabled: "" }, "Connect");
    form.append(html(this.doc, "p", {}, "Use the encrypted Connection QR and the password chosen in Share Local."), password, submit, feedback); content.append(form);
    let source = "", stream = null, timer = null, enrolling = false, outcome = { ok: false };
    this.connectionsPanel?.addEventListener("close", () => dialog.close(), { once: true });
    const abort = new AbortController();
    const accept = text => { if (!text.startsWith("TK2:")) throw new Error("Use an encrypted Connection QR."); source = text; submit.disabled = false; feedback.textContent = "Connection image ready."; password.focus(); };
    const stop = () => { abort.abort(); clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); source = password.value = ""; };
    dialog.addEventListener("close", stop, { once: true });
    const result = new Promise(resolve => dialog.addEventListener("close", () => resolve(outcome), { once: true }));
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (enrolling || !dialog.open) return;
      enrolling = true; submit.disabled = true;
      const secret = password.value; password.value = "";
      try {
        if (!current()) throw new Error("The Remote Connections view is closed.");
        const record = await AgentRemotes.enroll(source, secret, {
          signal: abort.signal, current: () => current() && dialog.open && !this.win.closed && !DesktopLifetime.quitting,
        });
        if (!current() || !dialog.open) return;
        outcome = { ok: true, id: record.id }; dialog.close();
      } catch (error) { if (dialog.open) feedback.textContent = error.message; }
      finally { enrolling = false; submit.disabled = !source; }
    });
    try {
      if (method === "image") {
        const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
        picker.init(this.win.browsingContext, "Connection QR image", Ci.nsIFilePicker.modeOpen); picker.appendFilters(Ci.nsIFilePicker.filterImages);
        if (await new Promise(resolve => picker.open(resolve)) !== Ci.nsIFilePicker.returnOK) { dialog.close(); return { ok: false }; }
        const file = await this.win.File.createFromNsIFile(picker.file);
        if (!dialog.open) return { ok: false };
        accept(await this.decodeQR(await this.win.createImageBitmap(file), abort.signal));
      } else {
        stream = await this.win.navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!dialog.open) { stop(); return { ok: false }; }
        const video = html(this.doc, "video", { autoplay: "", muted: "", style: "width:100%;max-height:260px" }); video.srcObject = stream; form.prepend(video); await video.play();
        const scan = async () => {
          if (!dialog.open || abort.signal.aborted) return;
          try { if (video.readyState >= 2) { accept(await this.decodeQR(video, abort.signal)); stream.getTracks().forEach(track => track.stop()); video.remove(); return; } }
          catch (error) { if (error.message !== "No connection QR code was found." && dialog.open) feedback.textContent = error.message; }
          if (dialog.open) timer = setTimeout(scan, 250);
        }; void scan();
      }
    } catch (error) { if (dialog.open) feedback.textContent = error.message; }
    const completed = await result;
    if (completed.ok) this.win.setTimeout(() => { if (current()) this.choose(completed.id).catch(console.error); }, 0);
    return { ok: completed.ok };
  }

  async decodeQR(source, signal) {
    const bitmap = source.close ? source : await this.win.createImageBitmap(source);
    let worker, cancel;
    try {
      signal.throwIfAborted();
      worker = new this.win.Worker("chrome://browser/content/bashkitten/agent/ConnectionQR.worker.js");
      return await new Promise((resolve, reject) => {
        cancel = () => reject(signal.reason);
        signal.addEventListener("abort", cancel, { once: true });
        worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.text);
        worker.onerror = event => { event.preventDefault(); reject(new Error(event.message || "Connection QR decoder failed.")); };
        worker.postMessage(bitmap, [bitmap]);
      });
    } finally {
      if (cancel) signal.removeEventListener("abort", cancel);
      worker?.terminate();
      bitmap.close();
    }
  }

  async draftEnrollment(entry, actor) {
    if (protectedAgentView(actor, true) !== entry || actor.manager !== actor.browsingContext.currentWindowGlobal) {
      throw new Error("The selected Agent changed.");
    }
    const current = await AgentRemotes.connection(entry.connection.id);
    if (protectedAgentView(actor, true) !== entry || actor.manager !== actor.browsingContext.currentWindowGlobal ||
        current.identity !== entry.connection.identity || current.userContextId !== entry.connection.userContextId ||
        !AgentRemotes.contexts.get(current.userContextId)) {
      throw new Error("The Agent enrollment changed.");
    }
    return { identity: current.identity, attributes: { userContextId: current.userContextId } };
  }

  saveDraft(entry, actor) {
    actor.draftDirty = true;
    if (!actor.saving) actor.saving = Promise.resolve().then(async () => {
      try {
        do {
          actor.draftDirty = false;
          await this.draftEnrollment(entry, actor);
          const draft = await actor.sendQuery("CaptureDraft");
          if (!draft) return;
          await BashKittenDrafts.save(() => this.draftEnrollment(entry, actor), draft);
          await this.draftEnrollment(entry, actor);
          this.drafts.set(entry.draftKey, draft);
        } while (actor.draftDirty);
      } finally { actor.saving = null; }
    });
    return actor.saving;
  }

  async saveCurrentDraft() {
    const browser = this.activeBrowser;
    const global = browser?.browsingContext.currentWindowGlobal;
    if ((!this.off || DesktopLifetime.quitting) && global && new URL(browser.currentURI.spec).pathname === "/") {
      await this.saveDraft(ownedViews.get(browser), global.getActor("BashKittenAgent"));
    }
  }

  async contentReady(entry, actor, draftReady = false) {
    const epoch = this.selectionEpoch;
    const location = this.activeBrowser?.currentURI;
    if (!location || location.pathQueryRef.startsWith("/login")) {
      lazy.BrowserControlChannel.close("authentication required");
      return;
    }
    if (!entry.local && (await AgentRemotes.connection(entry.connection.id)).state !== "ready") return;
    if (draftReady && actor && !actor.draftInitialized) {
      const draft = this.drafts.get(entry.draftKey) || await BashKittenDrafts.load(() => this.draftEnrollment(entry, actor));
      await this.draftEnrollment(entry, actor);
      if (draft) await actor.sendQuery("RestoreDraft", draft);
      this.drafts.delete(entry.draftKey);
      actor.draftInitialized = true;
    }
    // The guest's ordinary browser owns container browser tools. Its Pi never
    // acquires the host browser simply because the host displays its chat.
    if (epoch !== this.selectionEpoch || this.off || !actor || protectedAgentView(actor) !== entry) return;
    if (!entry.connection.machineId) lazy.BrowserControlChannel.start(entry.connection, { local: entry.local, window: this.win }).catch(error => console.error("Browser control connection failed", error));
    void this.sidecar.refreshChats();
  }

  async signIn() {
    const entry = ownedViews.get(this.activeBrowser);
    if (!entry) return;
    if (entry.local) return this.reconnect();
    await lazy.BrowserControlChannel.close("sign in");
    return this.selectRemote(entry.connection, true);
  }

  async signOut(actor, entry, csrf) {
    if (entry.local || protectedAgentView(actor) !== entry || actor.manager !== actor.browsingContext.currentWindowGlobal) {
      throw new Error("Sign out from the selected remote Agent.");
    }
    const logout = AgentRemotes.logout(entry.connection, csrf);
    void lazy.BrowserControlChannel.close("sign out").catch(console.error);
    await logout;
    return { ok: true };
  }

  aiLicenses() {
    const { dialog, content, actions } = this.dialog("AI runtimes and models");
    dialog.firstElementChild.hidden = true; actions.hidden = true;
    content.style.cssText = "display:flex;width:100%;height:70vh";
    const browser = xul(this.doc, "browser", { type: "content", remote: "true", remoteType: "web", maychangeremoteness: "true", messagemanagergroup: "bashkitten-settings", flex: "1", disableglobalhistory: "true", "bashkitten-protected": "true" });
    content.append(browser);
    const current = () => dialog.open && dialog.isConnected && !this.win.closed && !DesktopLifetime.quitting;
    const scheme = this.win.getComputedStyle(this.pane || this.doc.documentElement).colorScheme;
    const revoke = BashKittenSettings.enroll(browser, {
      info: { platform: "linux", section: "licenses", backendName: "This device", local: true,
        theme: ["light", "dark"].includes(scheme) ? scheme : this.win.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" },
      current, close: () => dialog.close(),
      call: (name, value) => control(name === "localai-open-record" ? "localai-record" : name, { ...value, readOnly: true }),
    });
    dialog.addEventListener("close", revoke, { once: true });
    try { browser.loadURI(Services.io.newURI(SETTINGS_URI), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); }
    catch (error) { revoke(); dialog.close(); throw error; }
  }

  async licenses() {
    const { dialog, content } = this.dialog("Licenses and source");
    const downloaded = html(this.doc, "button", { type: "button" }, "AI runtimes and models");
    downloaded.addEventListener("click", () => { dialog.close(); this.aiLicenses(); }); content.append(downloaded);
    try {
      const records = await IOUtils.readJSON("/usr/lib/bashkitten/licenses.json");
      content.append(html(this.doc, "h3", {}, "Bundled components"));
      content.append(html(this.doc, "p", {}, "Full notices for the bundled browser, Agent, private Node/npm, Pi, search and authentication components. Python and Linux system libraries retain their separately installed package licenses."));
      for (const record of records) {
        const detail = html(this.doc, "details");
        detail.append(html(this.doc, "summary", {}, [record.name, record.version, record.license].filter(Boolean).join(" · ")));
        detail.addEventListener("toggle", () => {
          if (detail.open && detail.childElementCount === 1) {
            detail.append(html(this.doc, "pre", { style: "max-height:24rem;overflow:auto" }, record.text));
          }
        });
        content.append(detail);
      }
    } catch (error) {
      content.append(html(this.doc, "p", {}, `Offline license files could not be opened: ${error.message || error}`));
    }
  }

  destroy() {
    this.selectionEpoch = (this.selectionEpoch || 0) + 1;
    this.closeConnections();
    this.cancelProviderLogins();
    this.cancelReferences();
    clearTimeout(this.timer);
    lazy.BrowserControlChannel.close("browser closed");
    this.win.removeEventListener("keydown", this.tabKey, true);
    this.win.gBrowser.tabContainer.removeEventListener("TabSelect", this.displayChanged);
    this.win.removeEventListener("BashKittenDisplayChanged", this.displayChanged);
    Services.obs.removeObserver(this.observer, "bashkitten-agent-remote-changed");
    // Native window hiding never unloads this view; actual Quit stops ownership.
    for (const browser of this.views.values()) ownedViews.delete(browser);
  }
}
