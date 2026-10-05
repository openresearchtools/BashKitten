/* SPDX-License-Identifier: AGPL-3.0-only */

import { DesktopLifetime } from "resource:///modules/DesktopLifetime.sys.mjs";
import { Subprocess } from "resource://gre/modules/Subprocess.sys.mjs";
import { AsyncShutdown } from "resource://gre/modules/AsyncShutdown.sys.mjs";
import { localAISettings } from "resource:///modules/LocalAI.sys.mjs";
import { serviceSettings } from "resource:///modules/ServiceSettings.sys.mjs";
import { remoteServices } from "resource:///modules/RemoteServices.sys.mjs";
import { AgentRemotes } from "resource:///modules/AgentRemotes.sys.mjs";
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";

const HTML = "http://www.w3.org/1999/xhtml";
const CONTROLLER = "/usr/bin/bashkittenctl";
const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, { BrowserControlChannel: "resource:///modules/BrowserControlChannel.sys.mjs" });
const contexts = new Map();
const ownedViews = new WeakMap();
let actorRegistered = false;
let browserOwner;
let adoptedLocal = false;
let closingLocal = false;
const localOperations = new Set();

let shuttingDown;
function shutdown() {
  if (!shuttingDown) {
    closingLocal = true;
    shuttingDown = stopOwnedRuntime().finally(() => { closingLocal = false; shuttingDown = null; });
  }
  return shuttingDown;
}
async function stopOwnedRuntime() {
  await Promise.allSettled([...localOperations]);
  await lazy.BrowserControlChannel.close("browser quitting");
  await AgentRemotes.deactivate();
  if (!browserOwner || !adoptedLocal) return;
  const owner = await browserOwner;
  let status;
  do {
    status = await localControl("browser-shutdown", { browserOwner: owner });
    DesktopLifetime.shutdownStatus(status);
    if (status.web?.status === "stopping" || status.web?.status === "running") {
      await new Promise(resolve => setTimeout(resolve, 1000));
    } else break;
  } while (true);
  if (status.web?.status !== "stopped" && status.web?.status !== "off") {
    throw new Error(status.web?.error || "Owned services have not stopped.");
  }
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
      AsyncShutdown.profileBeforeChange.addBlocker("BashKitten: stop owned local Agent", async () => {
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
  const operation = localControl(command, data);
  localOperations.add(operation);
  operation.then(() => localOperations.delete(operation), () => localOperations.delete(operation));
  return operation;
}
async function localControl(command, data = {}) {
  if (!["start", "status", "stop", "browser-shutdown", "remote-pi-import", "share-status", "share-setup", "share-reissue", "share-confirm", "share-cancel", "share-publish", "share-files", "service-status", "service-save", "service-remove", "service-action", "local-session", "project-root", "native-file", "localai-status", "localai-save", "localai-ini", "localai-check", "localai-install", "localai-cancel", "localai-share", "localai-action", "localai-refresh", "native-models-status", "native-models-settings", "native-models-search", "native-models-repository", "native-models-download", "native-models-action"].includes(command)) {
    throw new Error("Unknown local Agent operation.");
  }
  if (command === "start") data = { ...data, browserOwner: await localBrowserOwner() };
  const process = await Subprocess.call({
    command: CONTROLLER, arguments: [command, "--stdin"], stderr: "pipe",
  });
  const output = Promise.all([readPipe(process.stdout), readPipe(process.stderr)]);
  await process.stdin.write(JSON.stringify(data));
  await process.stdin.close();
  const timeout = setTimeout(() => process.kill(), 180000);
  let result;
  try { result = await process.wait(); } finally { clearTimeout(timeout); }
  const [stdout, stderr] = await output;
  let response;
  try { response = JSON.parse(stdout || stderr); } catch { throw new Error("The local Agent controller did not return a valid response."); }
  if (result.exitCode || response.error) throw new Error(response.error || stderr.slice(-2000) || "The local Agent operation failed.");
  if (command === "start") adoptedLocal = true;
  if ((command === "stop" || command === "browser-shutdown") && response.web?.status === "stopped") adoptedLocal = false;
  return response;
}

/** Parent actors must verify the actual protected browser, not just its URL. */
export function protectedAgentView(actor) {
  const context = actor.browsingContext;
  if (!context || context !== context.top) return null;
  const browser = context.embedderElement;
  const entry = ownedViews.get(browser);
  if (!entry || entry.host.off || entry.host.activeBrowser !== browser) return null;
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
        child: { esModuleURI: "resource:///modules/BashKittenAgentChild.sys.mjs", events: { DOMDocElementInserted: {}, DOMContentLoaded: {}, BashKittenDraftReady: { capture: true, wantUntrusted: true } } },
        allFrames: false,
        messageManagerGroups: ["bashkitten-agent"],
        matches: ["https://*/*"],
      });
      actorRegistered = true;
    }
    win.BashKittenAgent = new AgentView(win);
    win.BashKittenAgent.init().catch(error => win.BashKittenAgent.failure(error));
  },
};

class AgentView {
  constructor(win) {
    this.win = win;
    this.doc = win.document;
    this.views = new Map();
    this.drafts = new Map();
    this.off = false;
    this.busy = false;
    this.remote = null;
    this.selection = "";
    this.timer = null;
    this.currentIdentity = null;
    this.layout = "full";
    this.browseWithAgent = Services.prefs.getBoolPref("bashkitten.agent.splitBrowsing", true);
  }

  async init() {
    AgentRemotes.importToPi = value => control("remote-pi-import", value);
    const doc = this.doc;
    this.win.windowUtils.loadSheetUsingURIString("chrome://browser/content/bashkitten/agent/agent.css", Ci.nsIStyleSheetService.AUTHOR_SHEET);
    this.pane = xul(doc, "vbox", { id: "bashkitten-agent-pane" });
    const bar = html(doc, "div", { id: "bashkitten-agent-bar", style: "display:flex" });
    bar.append(html(doc, "label", {}, "Agent"));
    this.choice = html(doc, "select", { id: "bashkitten-agent-choice", "aria-label": "Agent connection: Local or remote", title: "Choose Local, a saved remote, or Connect to remote…" });
    this.choice.addEventListener("change", () => this.run(() => {
      if (this.choice.value === "connect-remote") {
        this.choice.value = this.remote?.id || "";
        return this.remotes();
      }
      if (this.choice.value === "share-local") {
        this.choice.value = this.remote?.id || "";
        return this.shareLocal();
      }
      return this.choose(this.choice.value);
    }));
    bar.append(this.choice);
    this.power = html(doc, "button", { id: "bashkitten-agent-power", type: "button" }, "Starting…");
    this.power.addEventListener("click", () => this.run(() => this.off ? this.start() : this.stop()));
    bar.append(this.power);
    this.localAIButton = html(doc, "button", { type: "button" }, "LocalAI");
    this.localAIButton.addEventListener("click", () => this.run(() => this.localAI()));
    bar.append(this.localAIButton);
    const menu = html(doc, "button", { id: "bashkitten-agent-menu", type: "button", "aria-label": "Browser menu", "aria-haspopup": "menu" }, "☰");
    menu.addEventListener("click", event => this.win.PanelUI.toggle(event, menu));
    bar.append(menu);
    this.state = html(doc, "section", { id: "bashkitten-agent-state" });
    this.viewBox = xul(doc, "vbox", { id: "bashkitten-agent-views", flex: "1" });
    this.pane.append(bar, this.state, this.viewBox);
    const tabbox = doc.getElementById("tabbrowser-tabbox");
    tabbox.before(this.pane);
    this.button = xul(doc, "toolbarbutton", { id: "bashkitten-agent-button", label: "Agent", class: "toolbarbutton-1", role: "tab", removable: "false", skipintoolbarset: "true", tooltiptext: "Agent" });
    this.button.addEventListener("command", () => this.show());
    doc.getElementById("tabbrowser-tabs").before(this.button);
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
    for (const item of doc.querySelectorAll('[command="cmd_newNavigator"], [command="Tools:PrivateBrowsing"], [command^="Profiles:"], #key_newNavigator, #key_privatebrowsing')) item.remove();
    this.observer = { observe: () => this.refreshRemotes().catch(console.error) };
    Services.obs.addObserver(this.observer, "bashkitten-agent-remote-changed");
    this.win.addEventListener("unload", () => this.destroy(), { once: true });
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
    await this.refreshRemotes();
    const selected = Services.prefs.getStringPref("bashkitten.agent.selectedRemote", "");
    if (selected && [...this.choice.options].some(option => option.value === selected)) await this.choose(selected);
    else await this.start();
    DesktopLifetime.started();
  }

  async run(operation) {
    if (this.busy || DesktopLifetime.quitting) return;
    this.busy = true;
    this.power.disabled = true;
    try { await operation(); } catch (error) { this.failure(error); }
    finally { this.busy = false; this.power.disabled = DesktopLifetime.quitting; }
  }

  show() {
    this.closeConnections();
    this.layout = "full";
    this.pane.hidden = false;
    this.doc.documentElement.setAttribute("bashkitten-agent-visible", "true");
    this.doc.documentElement.setAttribute("bashkitten-agent-layout", "full");
    this.button.setAttribute("checked", "true");
    this.button.setAttribute("aria-selected", "true");
    this.activeBrowser?.focus();
  }
  browse() {
    const split = this.browseWithAgent;
    this.layout = split ? "split" : "browser";
    this.pane.hidden = !split;
    this.doc.documentElement.setAttribute("bashkitten-agent-visible", split);
    this.doc.documentElement.setAttribute("bashkitten-agent-layout", this.layout);
    this.paneToggle.setAttribute("label", split ? "Hide Agent" : "Show Agent");
    this.button.removeAttribute("checked");
    this.button.setAttribute("aria-selected", "false");
  }

  saveFileFrom(browser, url, referrerInfo) {
    const entry = ownedViews.get(browser);
    if (!entry || this.off || this.activeBrowser !== browser) return false;
    const target = new URL(url);
    if (target.origin !== new URL(entry.connection.url).origin ||
        !/^\/api\/(?:files\/(?:content|archive|jobs\/[a-f0-9-]{36}\/download)|sessions\/[^/]+\/attachments\/[^/]+\/[^/]+)$/.test(target.pathname)) return false;
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
    if (!entry?.local || this.off || this.activeBrowser !== browser) throw new Error("Select the local Agent to open this file.");
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

  async chooseFolder(browser, { title, path } = {}) {
    const entry = ownedViews.get(browser);
    if (!entry?.local || this.off || this.activeBrowser !== browser) throw new Error("Select the local Agent to choose a folder.");
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
    const remotes = await AgentRemotes.list();
    this.choice.replaceChildren(html(this.doc, "option", { value: "" }, "Local"));
    for (const remote of remotes) {
      this.choice.append(html(this.doc, "option", { value: remote.id }, remote.name));
    }
    this.choice.append(html(this.doc, "option", { value: "connect-remote" }, "Connect to remote…"), html(this.doc, "option", { value: "share-local" }, "Share Local"));
    this.choice.value = this.selection;
    this.localAIButton.hidden = Boolean(this.selection);
  }

  async choose(id, password = "") {
    this.closeConnections();
    this.selection = id;
    this.localAIButton.hidden = Boolean(id);
    clearTimeout(this.timer);
    lazy.BrowserControlChannel.close("remote switch");
    await AgentRemotes.deactivate(false);
    this.remote = null;
    this.activeBrowser = null;
    for (const browser of this.views.values()) browser.hidden = true;
    Services.prefs.setStringPref("bashkitten.agent.selectedRemote", id);
    if (!id) return this.local();
    const connection = await AgentRemotes.activate(id);
    await this.selectRemote(connection || await AgentRemotes.connection(id), password);
  }

  async selectRemote(connection, password = "", forceLogin = false) {
    this.selection = connection.id;
    this.localAIButton.hidden = true;
    this.remote = connection;
    this.off = false;
    this.choice.value = connection.id;
    this.message("Connecting to remote", "Opening the enrolled Tor connection…");
    const result = await AgentRemotes.connect(connection.id, password, forceLogin);
    password = "";
    if (this.selection !== connection.id || this.off) return;
    this.remote = result.connection;
    if (result.loginURL) AgentRemotes.onLogin(connection.id, (error, ready) => {
      if (this.selection !== connection.id || this.off) return;
      if (error) { this.failure(error); return; }
      this.remote = ready;
      this.run(() => this.connect(ready, false, { reload: true }));
    });
    await this.connect(result.connection, false, { reload: Boolean(result.loginURL), navigateTo: result.loginURL });
  }

  async local() {
    this.localAIButton.hidden = false;
    this.selection = "";
    this.remote = null;
    this.choice.value = "";
    this.currentIdentity = null;
    this.localConnection = null;
    return this.start();
  }

  async start() {
    this.closeConnections();
    if (this.off) this.localConnection = null;
    this.off = false;
    this.power.textContent = "Starting…";
    this.message("Starting Agent", "Connecting to your local service…");
    if (this.remote) {
      const connection = await AgentRemotes.activate(this.remote.id);
      return this.selectRemote(connection || await AgentRemotes.connection(this.remote.id));
    }
    const status = await control("start");
    await this.update(status);
    this.schedule();
  }

  async stop() {
    this.closeConnections();
    clearTimeout(this.timer);
    this.off = true;
    await lazy.BrowserControlChannel.close("Agent turned off");
    await AgentRemotes.deactivate();
    this.localConnection = null;
    this.power.textContent = "Stopping…";
    this.message("Stopping Agent", "Waiting for owned services to stop safely…");
    if (this.remote && !adoptedLocal) {
      this.stopped();
      return;
    }
    let status = await control("stop");
    while (status.web?.status === "stopping" || status.web?.status === "running") {
      await new Promise(resolve => setTimeout(resolve, 1000));
      status = await control("stop");
    }
    if (status.web?.status !== "stopped" && status.web?.status !== "off") throw new Error(status.web?.error || "Agent shutdown has not been confirmed. Retry Turn off.");
    this.stopped();
  }

  stopped() {
    this.closeConnections();
    lazy.BrowserControlChannel.close("Agent stopped");
    AgentRemotes.deactivate().catch(console.error);
    this.localConnection = null;
    for (const browser of this.views.values()) {
      ownedViews.delete(browser);
      browser.remove();
    }
    this.views.clear();
    this.activeBrowser = null;
    this.power.textContent = "Turn on";
    this.message("Agent off", "Your browser remains open. Turn on to reconnect to your saved chats.");
  }

  async update(status, { reload = false } = {}) {
    if (this.off || this.selection) return;
    const web = status.web || {};
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
    if (url.protocol !== "https:" || url.hostname !== "127.0.0.1" || url.username || url.password) throw new Error("The local controller supplied an invalid HTTPS address.");
    if (this.currentIdentity && this.currentIdentity !== web.identity.caSha256) {
      throw Object.assign(new Error("The local Agent certificate identity changed. Check the service before trusting its replacement."), { code: "local_identity_changed" });
    }
    if (!this.localConnection || this.localConnection.url !== new URL(web.url).href || this.currentIdentity !== web.identity.caSha256) {
      await AgentRemotes.trustLocal({ url: web.url, ...web.identity });
      this.localConnection = await AgentRemotes.activate("local");
    }
    const connection = this.localConnection;
    this.currentIdentity = web.identity.caSha256;
    if (web.auth?.mode === "native-local") {
      if (!web.auth.generation) throw new Error("The local Agent session is unavailable.");
      if (this.localGeneration !== web.auth.generation) {
        const local = await control("local-session");
        if (this.off || this.selection) return;
        const cookieName = "__Host-bashkitten_local_" + web.identity.instanceId.replaceAll("-", "");
        if (local.url !== web.url || local.generation !== web.auth.generation ||
            local.identity?.caSha256 !== web.identity.caSha256 || local.identity?.instanceId !== web.identity.instanceId ||
            local.cookie?.name !== cookieName || !/^[a-f0-9]{64}$/.test(local.cookie?.value || "")) {
          throw new Error("The local Agent changed while connecting. Turn on to retry.");
        }
        Services.cookies.add("127.0.0.1", "/", cookieName, local.cookie.value, true, true, true,
          Date.now() + 400 * 86400000, { userContextId: connection.userContextId },
          Ci.nsICookie.SAMESITE_STRICT, Ci.nsICookie.SCHEME_HTTPS);
        this.localGeneration = local.generation;
        reload = true;
      }
    } else throw new Error("Update the local BashKitten package to use native Local authentication.");
    await this.connect(connection, true, { reload });
  }

  async connect(connection, local, { reload = false, navigateTo = null } = {}) {
    if (!connection?.url || !Number.isInteger(connection.userContextId)) throw new Error("The Agent connection is missing its protected browser identity.");
    const origin = new URL(connection.url).origin;
    contexts.set(connection.userContextId, { origin, local });
    Services.ppmm.sharedData.set("BashKittenAgentContexts", [...contexts]);
    Services.ppmm.sharedData.flush();
    const key = connection.id || connection.identity?.instanceId || `local:${connection.userContextId}`;
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
        if (!this.off) this.run(() => local ? this.reconnect() : this.selectRemote(this.remote));
      });
    }
    connection.requestContext = browser.browsingContext;
    ownedViews.set(browser, { host: this, connection, local, key });
    for (const item of this.views.values()) item.hidden = item !== browser;
    this.activeBrowser = browser;
    this.state.hidden = true;
    this.viewBox.hidden = false;
    this.power.textContent = "Turn off";
    this.power.title = local ? "Stop Agent services and Pi processes" : "Disconnect this client";
    if (reload || browser.getAttribute("data-agent-url") !== connection.url) {
      if (browser.hasAttribute("data-agent-url")) {
        try {
          const draft = await browser.browsingContext.currentWindowGlobal.getActor("BashKittenAgent").sendQuery("CaptureDraft");
          if (draft) this.drafts.set(key, draft);
        } catch (error) { console.warn("Could not retain Agent draft after a content crash", error); }
      }
      browser.setAttribute("data-agent-url", connection.url);
      const target = new URL(navigateTo || connection.url);
      const draftSession = this.drafts.get(key)?.sessionId;
      const savedHash = draftSession ? `#session=${draftSession}` : this.drafts.get(key)?.sessionHash;
      if (!navigateTo && typeof savedHash === "string" && /^#session=[a-f0-9-]{36}$/.test(savedHash)) target.hash = savedHash;
      browser.loadURI(Services.io.newURI(target.href), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    }
    return browser;
  }

  schedule() {
    clearTimeout(this.timer);
    if (this.off || this.selection) return;
    this.timer = setTimeout(async () => {
      try { await this.update(await control("status")); } catch (error) { this.failure(error); }
      this.schedule();
    }, 5000);
  }
  async reconnect() {
    if (this.off || this.remote) return;
    this.localGeneration = null;
    await this.update(await control("status"), { reload: true });
  }
  message(title, text, action) {
    this.state.replaceChildren(html(this.doc, "h2", {}, title), html(this.doc, "p", {}, text));
    this.state.hidden = false;
    this.viewBox.hidden = true;
    if (action) {
      const button = html(this.doc, "button", { type: "button" }, "Set up account");
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
    if (!this.remote && error.code === "local_identity_changed") {
      const review = html(this.doc, "button", { type: "button" }, "Review changed connection identity");
      review.addEventListener("click", () => this.localIdentity());
      this.state.append(review);
    }
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

  async localIdentity() {
    const { dialog, content } = this.dialog("Local connection identity");
    const message = html(this.doc, "p", {}, "Checking the private local controller…");
    content.append(message);
    try {
      const status = await control("status");
      const identity = status.web?.identity;
      if (!identity?.caSha256 || !identity?.instanceId) throw new Error("Start the local Agent service to read its identity.");
      let saved;
      try { saved = await AgentRemotes.connection("local"); } catch {}
      message.textContent = "The saved identity protects your login when the local HTTPS port changes.";
      content.append(html(this.doc, "p", {}, `Current local certificate: ${identity.caSha256}`));
      if (saved) content.append(html(this.doc, "p", {}, `Saved certificate: ${saved.identity}`));
      if (saved?.identity === identity.caSha256) return;
      const trust = html(this.doc, "button", { type: "button" }, "Trust this local installation");
      trust.addEventListener("click", async () => {
        trust.disabled = true;
        try {
          await lazy.BrowserControlChannel.close("local identity replaced");
          await AgentRemotes.remove("local");
          const browser = this.views.get("local");
          if (browser) { ownedViews.delete(browser); browser.remove(); this.views.delete("local"); }
          this.currentIdentity = null; this.localConnection = null;
          dialog.close(); await this.local();
        } catch (error) { message.textContent = error.message; trust.disabled = false; }
      });
      content.append(trust);
    } catch (error) { message.textContent = error.message; }
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
      if (!Services.prompt.confirm(this.win, "Use microphone?", `Allow Agent (${name}) to record this microphone message? Recording stops when you select Stop or Cancel.`)) return;
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

  async localAI() {
    if (this.selection || this.remote) throw new Error("Select Local to open LocalAI.");
    this.closeConnections();
    const { panel, content } = this.connectionPanel("LocalAI");
    await localAISettings(content, control, this.win, () => this.connectionsPanel === panel && !this.selection && !this.remote);
  }

  async shareLocal() {
    this.closeConnections();
    const { panel, content } = this.connectionPanel("Share Local");
    const description = html(this.doc, "p", {}, "Publish this device’s Local Agent through Tor. Other devices use your password and authenticator code.");
    const body = html(this.doc, "div");
    const error = html(this.doc, "p", { role: "alert" });
    content.append(description, body, error);
    let busy = false, setupId = null;
    const current = () => this.connectionsPanel === panel;
    const ensureLocal = async () => {
      const status = await control("start");
      if (!this.remote) { this.off = false; await this.update(status); this.schedule(); }
    };
    const run = async action => {
      if (busy || !current()) return;
      busy = true; error.textContent = "";
      for (const button of body.querySelectorAll("button")) button.disabled = true;
      try { await action(); } catch (failure) { if (current()) error.textContent = failure.message; }
      finally { busy = false; for (const button of body.querySelectorAll("button")) button.disabled = false; }
    };
    const button = (title, action) => {
      const node = html(this.doc, "button", { type: "button" }, title);
      node.addEventListener("click", () => run(action)); return node;
    };
    const image = (url, title) => {
      if (!/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(url || "")) throw new Error("The controller did not supply a valid QR image.");
      return html(this.doc, "img", { src: url, alt: title, style: "display:block;width:min(100%,320px);height:auto;margin-block:16px" });
    };
    const render = state => {
      if (!current()) return;
      setupId = null; body.replaceChildren();
      if (state.phase !== "ready") {
        if (state.migrationRequired) body.append(html(this.doc, "p", {}, "Replace the previous remote identity to use encrypted connections. Previously exported connections will stop working."));
        body.append(button(state.migrationRequired ? "Reissue identity" : "Turn on", () => account(state.migrationRequired)));
        return;
      }
      body.append(html(this.doc, "p", { role: "status" }, state.enabled ? (state.running ? "Publishing is on" : "Publishing resumes when Local is turned on") : "Publishing is off"));
      body.append(button(state.enabled ? "Turn off" : "Turn on", async () => {
        if (!state.enabled) await ensureLocal();
        render(await control("share-publish", { enabled: !state.enabled }));
      }));
      const allow = html(this.doc, "input", { type: "checkbox" });
      allow.checked = state.allowFileManager;
      const permission = html(this.doc, "label", {}, "Allow remote file manager"); permission.prepend(allow);
      allow.addEventListener("change", () => {
        const allowed = allow.checked; allow.checked = state.allowFileManager;
        run(async () => render(await control("share-files", { allowed })));
      });
      body.append(permission);
      body.append(html(this.doc, "p", {}, state.address));
      body.append(html(this.doc, "p", {}, "Connection QR — encrypted with your account password."));
      const download = async () => {
        const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
        picker.init(this.win.browsingContext, "Download QR image", Ci.nsIFilePicker.modeSave);
        picker.defaultString = "bashkitten-connection.png"; picker.appendFilter("PNG image", "*.png");
        const result = await new Promise(resolve => picker.open(resolve));
        if (result !== Ci.nsIFilePicker.returnOK && result !== Ci.nsIFilePicker.returnReplace) return;
        const bytes = Uint8Array.from(this.win.atob(state.qrDataUrl.split(",")[1]), char => char.charCodeAt(0));
        await IOUtils.write(picker.file.path, bytes, { permissions: 0o600 });
      };
      const qr = image(state.qrDataUrl, "Encrypted connection QR");
      const save = button("", download); save.setAttribute("aria-label", "Download QR image"); save.append(qr);
      body.append(save, button("Download QR image", download));
      body.append(button("Reissue identity", () => account(true)));
      const llama = html(this.doc, "div"); body.append(llama);
      control("localai-status").then(local => {
        if (!current() || !llama.isConnected) return;
        const checkbox = html(this.doc, "input", { type: "checkbox" }); checkbox.checked = Boolean(local.llama.service?.enabled);
        const label = html(this.doc, "label", {}, "Share llama.cpp"); label.prepend(checkbox); llama.append(label);
        llama.append(html(this.doc, "p", {}, local.llama.service ? local.llama.service.state : "Configure llama.cpp in LocalAI first."));
        checkbox.addEventListener("change", () => { const enabled = checkbox.checked; checkbox.checked = Boolean(local.llama.service?.enabled); run(async () => { await control("localai-share", { enabled }); render(await control("share-status")); }); });
        if (!this.selection) llama.append(button("Open LocalAI", () => this.localAI()));
      }).catch(failure => { if (llama.isConnected) llama.textContent = failure.message; });
      const services = html(this.doc, "details"); services.append(html(this.doc, "summary", {}, "Services"));
      const serviceBody = html(this.doc, "div"); services.append(serviceBody); body.append(services);
      services.addEventListener("toggle", () => {
        if (services.open && !serviceBody.hasChildNodes()) serviceSettings(serviceBody, control, this.win).catch(failure => { error.textContent = failure.message; });
      });
    };
    const account = reissue => {
      if (reissue && !Services.prompt.confirm(this.win, "Reissue identity?", "Disconnect all old clients and replace the remote account, authenticator and connection keys? Local chats and provider logins are kept.")) return;
      body.replaceChildren();
      const form = html(this.doc, "form");
      const field = (title, type, autocomplete) => {
        const label = html(this.doc, "label", {}, title), input = html(this.doc, "input", { type, required: "", autocomplete });
        label.append(input); form.append(label); return input;
      };
      const username = field("Username", "text", "username");
      const password = field("Password", "password", "new-password");
      const confirmation = field("Confirm password", "password", "new-password");
      const allow = html(this.doc, "input", { type: "checkbox" });
      const permission = html(this.doc, "label", {}, "Allow remote file manager"); permission.prepend(allow); form.append(permission);
      const submit = html(this.doc, "button", { type: "submit" }, "Set up authenticator");
      let code;
      form.append(submit); body.append(form);
      panel.addEventListener("close", () => { password.value = confirmation.value = ""; }, { once: true });
      form.addEventListener("submit", event => {
        event.preventDefault();
        run(async () => {
          if (setupId) {
            const result = await control("share-confirm", { setupId, code: code.value });
            code.value = ""; render(result); return;
          }
          if (password.value !== confirmation.value) throw new Error("The passwords do not match.");
          await ensureLocal();
          if (!current()) return;
          const request = control(reissue ? "share-reissue" : "share-setup", { username: username.value, password: password.value, allowFileManager: allow.checked });
          password.value = confirmation.value = "";
          const setup = await request;
          if (!current()) { await control("share-cancel", { setupId: setup.setupId }); return; }
          setupId = setup.setupId; form.replaceChildren();
          form.append(html(this.doc, "p", {}, "Add this account to your authenticator, then enter its six-digit code."), image(setup.qrDataUrl, "Authenticator setup QR"));
          if (setup.otpauthUrl?.startsWith("otpauth://totp/")) form.append(button("Open authenticator", async () => {
            Cc["@mozilla.org/uriloader/external-protocol-service;1"].getService(Ci.nsIExternalProtocolService).loadURI(
              Services.io.newURI(setup.otpauthUrl), Services.scriptSecurityManager.getSystemPrincipal(), null, this.win.browsingContext, false, true);
          }));
          code = field("Authenticator code", "text", "one-time-code"); code.inputMode = "numeric"; code.pattern = "[0-9]{6}"; code.maxLength = 6;
          panel.addEventListener("close", () => { code.value = ""; }, { once: true });
          submit.textContent = "Verify and publish"; form.append(submit);
          code.focus();
        });
      });
      username.focus();
    };
    panel.addEventListener("close", () => {
      body.replaceChildren();
      if (setupId) control("share-cancel", { setupId }).catch(console.error);
    }, { once: true });
    await run(async () => render(await control("share-status")));
  }

  connectionPanel(title) {
    const panel = html(this.doc, "section", { id: "bashkitten-agent-connections", "aria-labelledby": "bashkitten-connections-title" });
    const content = html(this.doc, "div", { class: "connections-content" });
    const heading = html(this.doc, "div", { class: "connections-heading" });
    const back = html(this.doc, "button", { type: "button" }, "Back to Agent");
    back.addEventListener("click", () => this.closeConnections());
    heading.append(back, html(this.doc, "h2", { id: "bashkitten-connections-title" }, title));
    content.append(heading); panel.append(content);
    this.connectionsPanel = panel; this.pane.append(panel); this.pane.setAttribute("data-connections", "true");
    back.focus(); return { panel, content };
  }

  closeConnections() {
    const panel = this.connectionsPanel;
    if (!panel) return;
    this.connectionsPanel = null;
    this.pane.removeAttribute("data-connections");
    panel.dispatchEvent(new this.win.Event("close"));
    panel.remove();
    this.activeBrowser?.focus();
  }

  async remotes() {
    if (this.connectionsPanel) { this.connectionsPanel.querySelector("button").focus(); return; }
    const { panel, content } = this.connectionPanel("Browser connections");
    const error = html(this.doc, "p", { role: "alert" }), saved = html(this.doc, "div");
    const report = async task => { try { error.textContent = ""; await task(); } catch (e) { error.textContent = e.message; } };
    const button = (title, action) => {
      const node = html(this.doc, "button", { type: "button" }, title);
      node.addEventListener("click", async () => { node.disabled = true; await report(action); node.disabled = false; }); return node;
    };
    const refresh = async () => {
      saved.replaceChildren();
      for (const record of await AgentRemotes.list()) {
        const item = html(this.doc, "section", { class: "connection-card" });
        item.append(html(this.doc, "strong", {}, record.name), html(this.doc, "p", {}, record.url),
          html(this.doc, "p", {}, record.migrationRequired ? "Import a new encrypted QR from this host’s Share Local setup." : record.state));
        if (record.error) item.append(html(this.doc, "p", { role: "alert" }, record.error));
        if (!record.migrationRequired) item.append(button("Connect", () => this.choose(record.id)),
          button("Disconnect", async () => {
            Services.obs.notifyObservers(null, "bashkitten-agent-control-revoke", record.id);
            await AgentRemotes.disconnect(record.id);
            if (this.remote?.id === record.id) {
              this.off = true; this.power.textContent = "Turn on";
              this.message("Remote disconnected", "Turn on to reconnect, or choose Local or another remote.");
            }
            await refresh();
          }),
          button("Allow browser control", async () => {
            lazy.BrowserControlChannel.allowAgain(record.id);
            if (this.remote?.id !== record.id) await this.choose(record.id);
            if ((await AgentRemotes.connection(record.id)).state !== "ready") throw new Error("Finish remote sign-in first.");
            await lazy.BrowserControlChannel.start(this.remote, { window: this.win });
          }), button("Revoke browser control", () => lazy.BrowserControlChannel.revoke(record.id)));
        item.append(button("Remove", async () => {
          if (!Services.prompt.confirm(this.win, "Remove connection?", `Remove “${record.name}” and its saved login from this browser?`)) return;
          await AgentRemotes.remove(record.id);
          if (this.remote?.id === record.id) { this.off = true; this.power.textContent = "Turn on"; this.message("Remote removed", "Choose Local or another saved remote."); }
          await refresh(); await this.refreshRemotes();
        }));
        saved.append(item);
        if (record.state === "ready") {
          const services = html(this.doc, "details"), serviceBody = html(this.doc, "div");
          services.append(html(this.doc, "summary", {}, "Services"), serviceBody); item.append(services);
          services.addEventListener("toggle", () => {
            if (services.open && !serviceBody.childElementCount) remoteServices(serviceBody, record.id, this.win, () => this.choose(record.id));
          });
        }
      }
    };
    const form = html(this.doc, "form");
    const passwordLabel = html(this.doc, "label", {}, "Connection password");
    const password = html(this.doc, "input", { type: "password", autocomplete: "off", required: "" });
    passwordLabel.append(password);
    const image = html(this.doc, "input", { type: "file", accept: "image/*", "aria-label": "Upload encrypted connection QR image" });
    const selected = html(this.doc, "p", { role: "status" });
    const add = html(this.doc, "button", { type: "submit", disabled: "" }, "Connect");
    let source = "", stopCamera = () => {};
    const accept = text => {
      if (!text.startsWith("TK2:")) throw new Error("Use the encrypted Connection QR from Share Local.");
      source = text; selected.textContent = "Connection image ready. Enter its password."; add.disabled = false; password.focus();
    };
    image.addEventListener("change", () => report(async () => {
      if (image.files[0]) accept(await this.decodeQR(await this.win.createImageBitmap(image.files[0])));
    }));
    const camera = button("Scan QR", async () => {
      stopCamera();
      const stream = await this.win.navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      if (this.connectionsPanel !== panel) { stream.getTracks().forEach(track => track.stop()); return; }
      const video = html(this.doc, "video", { autoplay: "", muted: "", style: "width:100%;max-height:260px" });
      let timer, stopped = false;
      const cancel = button("Cancel scan", () => stopCamera());
      stopCamera = () => { stopped = true; clearTimeout(timer); stream.getTracks().forEach(track => track.stop()); video.remove(); cancel.remove(); };
      video.srcObject = stream; form.append(video, cancel);
      const scan = async () => {
        if (stopped || this.connectionsPanel !== panel) return stopCamera();
        try {
          if (video.readyState >= 2) { const text = await this.decodeQR(video); if (stopped) return; accept(text); stopCamera(); return; }
        } catch (e) { if (e.message !== "No connection QR code was found.") { error.textContent = e.message; stopCamera(); return; } }
        timer = setTimeout(scan, 250);
      };
      try { await video.play(); scan(); } catch (e) { stopCamera(); throw e; }
    });
    form.append(image, camera, selected, passwordLabel, add);
    form.addEventListener("submit", event => {
      event.preventDefault(); add.disabled = true;
      report(async () => {
        const secret = password.value; password.value = "";
        const record = await AgentRemotes.enroll(source, secret);
        if (this.connectionsPanel !== panel) return;
        source = ""; await this.refreshRemotes(); await this.choose(record.id, secret);
      }).finally(() => { add.disabled = !source; });
    });
    panel.addEventListener("close", () => { source = password.value = image.value = ""; stopCamera(); }, { once: true });
    content.append(saved, html(this.doc, "h3", {}, "Connect to remote"),
      html(this.doc, "p", {}, "Scan or upload its Connection QR. Use the password chosen in Share Local, then your authenticator code to sign in."), form, error);
    await report(refresh);
  }

  async decodeQR(source) {
    if (!this.win.jsQR) Services.scriptloader.loadSubScript("chrome://browser/content/bashkitten/agent/jsQR.js", this.win);
    const width = source.videoWidth || source.width;
    const height = source.videoHeight || source.height;
    if (!width || !height) throw new Error("The QR image dimensions are invalid.");
    const scale = Math.min(1, 1600 / Math.max(width, height));
    const canvas = html(this.doc, "canvas"); canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = this.win.jsQR(image.data, image.width, image.height);
    source.close?.();
    if (!result?.data) throw new Error("No connection QR code was found.");
    return result.data;
  }

  async contentReady(entry, actor, draftReady = false) {
    const location = this.activeBrowser?.currentURI;
    if (!location || location.pathQueryRef.startsWith("/login")) {
      lazy.BrowserControlChannel.close("authentication required");
      return;
    }
    if (!entry.local && (await AgentRemotes.connection(entry.connection.id)).state !== "ready") return;
    if (draftReady && actor && this.drafts.has(entry.key)) {
      await actor.sendQuery("RestoreDraft", this.drafts.get(entry.key));
      this.drafts.delete(entry.key);
    }
    lazy.BrowserControlChannel.start(entry.connection, { local: entry.local, window: this.win }).catch(error => console.error("Browser control connection failed", error));
  }

  async signIn() {
    const entry = ownedViews.get(this.activeBrowser);
    if (!entry) return;
    if (entry.local) return this.reconnect();
    await lazy.BrowserControlChannel.close("sign in");
    return this.selectRemote(entry.connection, "", true);
  }

  async licenses() {
    const { content } = this.dialog("Bundled component licenses");
    try {
      const records = await IOUtils.readJSON("/usr/lib/bashkitten/licenses.json");
      content.append(html(this.doc, "p", {}, "Full notices for the bundled browser, Agent, Pi, search and authentication components. Node, Python and Linux system libraries retain their separately installed package licenses."));
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
      content.textContent = `Offline license files could not be opened: ${error.message || error}`;
    }
  }

  destroy() {
    this.closeConnections();
    clearTimeout(this.timer);
    lazy.BrowserControlChannel.close("browser closed");
    this.win.removeEventListener("keydown", this.tabKey, true);
    Services.obs.removeObserver(this.observer, "bashkitten-agent-remote-changed");
    // Native window hiding never unloads this view; actual Quit stops ownership.
    for (const browser of this.views.values()) ownedViews.delete(browser);
  }
}
