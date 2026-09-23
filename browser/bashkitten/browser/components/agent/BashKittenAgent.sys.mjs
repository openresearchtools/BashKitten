/* SPDX-License-Identifier: GPL-3.0-only */

import { Subprocess } from "resource://gre/modules/Subprocess.sys.mjs";
import { AsyncShutdown } from "resource://gre/modules/AsyncShutdown.sys.mjs";
import { AgentRemotes } from "resource:///modules/AgentRemotes.sys.mjs";
import { TorRouting } from "resource:///modules/TorRouting.sys.mjs";
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";

const HTML = "http://www.w3.org/1999/xhtml";
const CONTROLLER = "/usr/bin/bashkittenctl";
const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, { BrowserControlChannel: "resource:///modules/BrowserControlChannel.sys.mjs" });
const contexts = new Map();
const ownedViews = new WeakMap();
let actorRegistered = false;
let browserOwner;

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
        try { await control("browser-shutdown", { browserOwner: owner }); }
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
async function control(command, data = {}) {
  if (!["start", "status", "stop", "browser-shutdown", "account-create", "account-enroll", "account-totp", "hosting-client", "project-root", "native-file"].includes(command)) {
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
        child: { esModuleURI: "resource:///modules/BashKittenAgentChild.sys.mjs", events: { DOMDocElementInserted: {}, DOMContentLoaded: {}, BashKittenDraftReady: { wantUntrusted: true } } },
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
    this.enrollmentPrompted = false;
    this.pendingHosted = null;
  }

  async init() {
    const doc = this.doc;
    this.win.windowUtils.loadSheetUsingURIString("chrome://browser/content/bashkitten/agent/agent.css", Ci.nsIStyleSheetService.AUTHOR_SHEET);
    this.pane = xul(doc, "vbox", { id: "bashkitten-agent-pane" });
    const bar = html(doc, "div", { id: "bashkitten-agent-bar", style: "display:flex" });
    bar.append(html(doc, "label", {}, "Agent"));
    this.choice = html(doc, "select", { id: "bashkitten-agent-choice", "aria-label": "Agent server" });
    this.choice.addEventListener("change", () => this.run(() => {
      if (this.choice.value === "connect-remote") {
        this.choice.value = this.remote?.id || "";
        return this.remotes();
      }
      return this.choose(this.choice.value);
    }));
    bar.append(this.choice);
    this.power = html(doc, "button", { id: "bashkitten-agent-power", type: "button" }, "Starting…");
    this.power.addEventListener("click", () => this.run(() => this.off ? this.start() : this.stop()));
    bar.append(this.power);
    const menu = html(doc, "button", { type: "button", "aria-label": "Browser menu", "aria-haspopup": "menu" }, "☰");
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
    this.show();
    await this.refreshRemotes();
    const selected = Services.prefs.getStringPref("bashkitten.agent.selectedRemote", "");
    if (selected && [...this.choice.options].some(option => option.value === selected)) await this.choose(selected);
    else await this.start();
  }

  async run(operation) {
    if (this.busy) return;
    this.busy = true;
    this.power.disabled = true;
    try { await operation(); } catch (error) { this.failure(error); }
    finally { this.busy = false; this.power.disabled = false; }
  }

  show() {
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
    if (!entry?.local || entry.authFor || this.off || this.activeBrowser !== browser) throw new Error("Select the local Agent to open this file.");
    const url = new URL(value);
    if (url.origin !== new URL(entry.connection.url).origin || url.protocol !== "https:" || url.hostname !== "127.0.0.1" || url.username || url.password ||
        !/^\/api\/(?:files\/content|sessions\/[a-f0-9-]{36}\/attachments\/[^/]+\/[^/]+)$/.test(url.pathname)) throw new Error("Only local Agent files can be opened.");
    // Authenticate in the enrolled document's cookie context, then resolve the
    // existing file through the same private controller that owns Local. Only
    // its path crosses this bridge; file contents stay on disk.
    const response = await AgentRemotes.request(entry.connection, "/api/bootstrap");
    if (response.status !== 200 || !response.data?.authenticated) throw new Error("Sign in again to open this file.");
    let current = ownedViews.get(browser);
    if (this.off || this.activeBrowser !== browser || !current?.local || current.authFor || current.connection !== entry.connection) throw new Error("The selected Agent changed.");
    const file = await control("native-file", { url: url.href });
    current = ownedViews.get(browser);
    if (this.off || this.activeBrowser !== browser || !current?.local || current.authFor || current.connection !== entry.connection) throw new Error("The selected Agent changed.");
    return file;
  }

  async chooseFolder(browser, { title, path } = {}) {
    const entry = ownedViews.get(browser);
    if (!entry?.local || entry.authFor || this.off || this.activeBrowser !== browser) throw new Error("Select the local Agent to choose a folder.");
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
    if (this.off || this.activeBrowser !== browser || !current?.local || current.authFor || current.connection !== entry.connection) throw new Error("The selected Agent changed.");
    return control("project-root", { path: picker.file.path });
  }

  async openHosted(browser, url, { tab = null, forceSignIn = false } = {}) {
    const entry = ownedViews.get(browser);
    if (!entry || entry.authFor || this.off || this.activeBrowser !== browser) throw new Error("Select the Agent that hosts this site.");
    let prepared = await AgentRemotes.prepareHosted(entry.connection, url);
    if (prepared.needsLocalEnrollment) {
      const record = await control("hosting-client");
      prepared = await AgentRemotes.prepareHosted(entry.connection, url, { localRecord: record });
    }
    if (this.off || this.activeBrowser !== browser) throw new Error("The selected Agent changed.");
    if (!prepared.ready || forceSignIn) {
      this.pendingHosted = { browser, url, tab };
      const connection = prepared.authentication;
      const origin = new URL(connection.url).origin;
      await this.connect({ ...connection, url: origin + "/login?rd=" + encodeURIComponent(origin + "/") }, entry.local, { authFor: browser });
      this.show();
      return;
    }
    const uri = Services.io.newURI(prepared.site.url);
    if (!tab || tab.closing || !tab.isConnected || tab.userContextId != TorRouting.userContextId) {
      tab = await TorRouting.createTab(this.win, { uri });
    }
    this.win.gBrowser.selectedTab = tab;
    tab.linkedBrowser.loadURI(uri, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    this.browse();
  }

  routeHostedLink(browser, value) {
    const entry = ownedViews.get(browser);
    let target;
    try { target = new URL(value); } catch { return false; }
    if (!entry || this.off || this.activeBrowser !== browser || target.protocol != "https:" ||
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z2-7]{56}\.onion$/.test(target.hostname)) return false;
    // Native context-menu and middle-click tab opening take this same path as
    // the web bookmark bridge; no protected opener or cookie context escapes.
    (async () => {
      const response = await AgentRemotes.request(entry.connection, "/api/hosting");
      if (response.status == 200 && response.data?.services?.some(site => site.enabled && site.url == target.href)) {
        await this.openHosted(browser, target.href);
      } else {
        this.win.openTrustedLinkIn(target.href, "tab");
      }
    })().catch(error => Services.prompt.alert(this.win, "Could not open hosted website", error.message || String(error)));
    return true;
  }

  async hostedSignIn(ownerId, url, tab) {
    if (this.pendingHosted) return;
    const selected = ownedViews.get(this.activeBrowser)?.connection.id;
    if (selected != ownerId) await this.choose(ownerId == "local" ? "" : ownerId);
    await this.openHosted(this.activeBrowser, url, { tab, forceSignIn: true });
  }

  async refreshRemotes() {
    const remotes = await AgentRemotes.list();
    this.choice.replaceChildren(html(this.doc, "option", { value: "" }, "Local"));
    for (const remote of remotes) {
      if (remote.kind === "llama") continue;
      this.choice.append(html(this.doc, "option", { value: remote.id }, remote.name));
    }
    this.choice.append(html(this.doc, "option", { value: "connect-remote" }, "Connect to remote…"));
    this.choice.value = this.selection;
  }

  async choose(id) {
    this.pendingHosted = null;
    this.selection = id;
    clearTimeout(this.timer);
    lazy.BrowserControlChannel.close("remote switch");
    await AgentRemotes.deactivate();
    this.remote = null;
    this.activeBrowser = null;
    for (const browser of this.views.values()) browser.hidden = true;
    Services.prefs.setStringPref("bashkitten.agent.selectedRemote", id);
    if (!id) return this.local();
    const connection = await AgentRemotes.activate(id);
    await this.selectRemote(connection || await AgentRemotes.connection(id));
  }

  async selectRemote(connection) {
    this.selection = connection.id;
    this.remote = connection;
    this.off = false;
    this.choice.value = connection.id;
    await this.connect(connection, false);
  }

  async local() {
    this.selection = "";
    this.remote = null;
    this.choice.value = "";
    this.currentIdentity = null;
    this.localConnection = null;
    return this.start();
  }

  async start() {
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
    this.pendingHosted = null;
    clearTimeout(this.timer);
    this.off = true;
    await lazy.BrowserControlChannel.close("Agent turned off");
    await AgentRemotes.deactivate();
    this.localConnection = null;
    this.power.textContent = "Stopping…";
    this.message("Stopping Agent", "Waiting for owned services to stop safely…");
    if (this.remote) {
      await AgentRemotes.deactivate();
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

  async update(status) {
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
    if (web.auth?.enrollmentRequired || web.auth?.initialized === false) {
      this.message("Set up Agent", "Create your local account and verify a two-factor code to continue.", () => this.enroll());
      this.power.textContent = "Turn off";
      if (!this.enrollmentPrompted) {
        this.enrollmentPrompted = true;
        await this.enroll();
      }
      return;
    }
    if (ownedViews.get(this.activeBrowser)?.authFor) return;
    await this.connect(connection, true);
  }

  async connect(connection, local, { authFor = null } = {}) {
    if (!connection?.url || !Number.isInteger(connection.userContextId)) throw new Error("The Agent connection is missing its protected browser identity.");
    const origin = new URL(connection.url).origin;
    contexts.set(connection.userContextId, { origin, local });
    Services.ppmm.sharedData.set("BashKittenAgentContexts", [...contexts]);
    Services.ppmm.sharedData.flush();
    const key = (connection.id || connection.identity?.instanceId || `local:${connection.userContextId}`) + (authFor ? ":auth" : "");
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
      const host = this;
      browser.addProgressListener({
        QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
        onLocationChange(progress, request, location) {
          if (!progress.isTopLevel || location.spec === "about:blank") return;
          const expected = ownedViews.get(browser)?.connection;
          if (!expected) return;
          let uri;
          try { uri = new URL(location.spec); } catch { return; }
          if (uri.origin !== new URL(expected.url).origin) {
            browser.stop();
            if (["https:", "http:"].includes(uri.protocol) && !host.routeHostedLink(browser, uri.href)) host.win.openTrustedLinkIn(uri.href, "tab");
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
    ownedViews.set(browser, { host: this, connection, local, key, authFor });
    for (const item of this.views.values()) item.hidden = item !== browser;
    this.activeBrowser = browser;
    this.state.hidden = true;
    this.viewBox.hidden = false;
    this.power.textContent = "Turn off";
    this.power.title = local ? "Stop Agent services and Pi processes" : "Disconnect this client";
    if (browser.getAttribute("data-agent-url") !== connection.url) {
      if (browser.hasAttribute("data-agent-url") && !authFor) {
        try {
          const draft = await browser.browsingContext.currentWindowGlobal.getActor("BashKittenAgent").sendQuery("CaptureDraft");
          if (draft) this.drafts.set(key, draft);
        } catch (error) { console.warn("Could not retain Agent draft after a content crash", error); }
      }
      browser.setAttribute("data-agent-url", connection.url);
      const target = new URL(connection.url);
      const draftSession = this.drafts.get(key)?.sessionId;
      const savedHash = draftSession ? `#session=${draftSession}` : this.drafts.get(key)?.sessionHash;
      if (!authFor && typeof savedHash === "string" && /^#session=[a-f0-9-]{36}$/.test(savedHash)) target.hash = savedHash;
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
    const previous = this.activeBrowser;
    previous?.removeAttribute("data-agent-url");
    await this.update(await control("status"));
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

  async enroll() {
    if (this.remote) return;
    if (this.enrollmentDialog?.open) return this.enrollmentDialog.focus();
    const { dialog, content } = this.dialog("Set up your local Agent");
    this.enrollmentDialog = dialog;
    const form = html(this.doc, "form");
    const error = html(this.doc, "p", { role: "alert" });
    const field = (title, type, name) => {
      const label = html(this.doc, "label", {}, title);
      const input = html(this.doc, "input", { type, name, required: "", autocomplete: type === "password" ? "new-password" : "username" });
      label.append(input); form.append(label); return input;
    };
    const username = field("Username", "text", "username");
    const password = field("Password", "password", "password");
    const submit = html(this.doc, "button", { type: "submit" }, "Create account");
    const resume = html(this.doc, "button", { type: "button" }, "Continue existing setup");
    let setupId;
    let code;
    let secret;
    let authenticatorURI;
    dialog.addEventListener("close", () => {
      password.value = "";
      if (code) code.value = "";
      secret = authenticatorURI = null;
      this.enrollmentDialog = null;
    }, { once: true });
    const create = async command => {
      const result = await control(command, { username: username.value, password: password.value });
      password.value = "";
      setupId = result.setupId;
      if (!/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(result.qrDataUrl || "")) throw new Error("The controller did not supply an enrollment QR code.");
      form.replaceChildren(html(this.doc, "p", {}, "Scan this code in your authenticator, then enter its current six-digit code."));
      form.append(html(this.doc, "img", { src: result.qrDataUrl, alt: "Two-factor enrollment QR code" }));
      if (/^[A-Z2-7]+=*$/i.test(result.secret || "")) {
        secret = result.secret;
        const copy = html(this.doc, "button", { type: "button" }, "Copy setup key");
        copy.addEventListener("click", () => {
          Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(secret);
          copy.textContent = "Key copied";
        });
        form.append(copy);
      }
      if (result.otpauthUrl?.startsWith("otpauth://totp/")) {
        authenticatorURI = Services.io.newURI(result.otpauthUrl);
        const open = html(this.doc, "button", { type: "button" }, "Open authenticator app");
        open.addEventListener("click", () => {
          Cc["@mozilla.org/uriloader/external-protocol-service;1"].getService(Ci.nsIExternalProtocolService).loadURI(
            authenticatorURI, Services.scriptSecurityManager.getSystemPrincipal(), null,
            this.win.browsingContext, false, true
          );
        });
        form.append(open);
      }
      code = field("Authenticator code", "text", "code");
      code.inputMode = "numeric"; code.autocomplete = "one-time-code";
      code.pattern = "[0-9]{6}"; code.maxLength = 6;
      submit.textContent = "Verify and continue";
      form.append(submit, error);
    };
    resume.addEventListener("click", async () => {
      if (!form.reportValidity()) return;
      submit.disabled = resume.disabled = true;
      try { await create("account-enroll"); } catch (e) { error.textContent = e.message; }
      finally { submit.disabled = resume.disabled = false; }
    });
    form.addEventListener("submit", async event => {
      event.preventDefault(); submit.disabled = resume.disabled = true; error.textContent = "";
      try {
        if (setupId) {
          await control("account-totp", { setupId, code: code.value });
          code.value = ""; dialog.close(); await this.reconnect();
        } else await create("account-create");
      } catch (e) { error.textContent = e.message; }
      finally { submit.disabled = resume.disabled = false; }
    });
    form.append(submit, resume, error); content.append(form);
  }

  async remotes() {
    const { dialog, content } = this.dialog("Browser connections");
    content.append(html(this.doc, "p", {}, "Saved in this browser. Choose Local or a saved server from the Agent selector."));
    const error = html(this.doc, "p", { role: "alert" });
    const saved = html(this.doc, "div");
    const report = async task => { try { error.textContent = ""; await task(); } catch (e) { error.textContent = e.message; } };
    const button = (title, action) => {
      const node = html(this.doc, "button", { type: "button" }, title);
      node.addEventListener("click", async () => { node.disabled = true; await report(action); node.disabled = false; });
      return node;
    };
    const refresh = async () => {
      saved.replaceChildren();
      for (const record of await AgentRemotes.list()) {
        const item = html(this.doc, "section", { style: "padding:12px 0;border-bottom:1px solid var(--border-color,ThreeDShadow)" });
        item.append(html(this.doc, "strong", {}, record.name), html(this.doc, "p", {}, record.url));
        if (record.kind === "llama") {
          item.append(html(this.doc, "p", {}, `${record.health}${record.port ? ` · http://127.0.0.1:${record.port}` : ""}`));
          item.append(button(record.running ? "Stop relay" : "Start relay", async () => {
            if (record.running) await AgentRemotes.stopRelay(record.id); else await AgentRemotes.startRelay(record.id);
            await refresh();
          }), button("Check connection", async () => { await AgentRemotes.checkRelay(record.id); await refresh(); }), button("Use another port", async () => {
            await AgentRemotes.stopRelay(record.id); await AgentRemotes.startRelay(record.id, { port: 0 }); await refresh();
          }));
        } else {
          item.append(button("Connect", async () => { await this.choose(record.id); dialog.close(); }));
          item.append(button("Allow browser control", async () => {
            lazy.BrowserControlChannel.allowAgain(record.id);
            if (this.remote?.id !== record.id) await this.choose(record.id);
            await lazy.BrowserControlChannel.start(this.remote, { window: this.win });
          }), button("Revoke browser control", () => lazy.BrowserControlChannel.revoke(record.id)));
        }
        item.append(button("Save connection", async () => {
          const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
          picker.init(this.win.browsingContext, "Save connection", Ci.nsIFilePicker.modeSave);
          picker.defaultString = "bashkitten-connection.json";
          picker.appendFilter("Connection file", "*.json");
          const selected = await new Promise(resolve => picker.open(resolve));
          if (selected !== Ci.nsIFilePicker.returnOK && selected !== Ci.nsIFilePicker.returnReplace) return;
          await IOUtils.writeUTF8(picker.file.path, await AgentRemotes.exportConnection(record.id));
          await IOUtils.setPermissions(picker.file.path, 0o600);
        }), button("Remove", async () => {
          if (!Services.prompt.confirm(this.win, "Remove connection?", `Remove “${record.name}” and its saved login from this browser?`)) return;
          if (this.remote?.id === record.id) { await this.stop(); this.remote = null; }
          await AgentRemotes.remove(record.id); await refresh(); await this.refreshRemotes();
        }));
        saved.append(item);
      }
    };
    const form = html(this.doc, "form");
    const kind = html(this.doc, "select", { "aria-label": "Connection type" });
    kind.append(html(this.doc, "option", { value: "agent" }, "Agent"), html(this.doc, "option", { value: "llama" }, "llama.cpp relay"));
    form.append(kind);
    const field = (title, type, placeholder = "") => {
      const label = html(this.doc, "label", {}, title);
      const input = html(this.doc, "input", { type, placeholder }); label.append(input); form.append(label); return input;
    };
    const name = field("Name", "text", "My server");
    const url = field("Onion address", "url", "https://…onion/");
    const key = field("Client authorization key", "password");
    const token = field("llama.cpp bearer token", "password");
    token.parentNode.hidden = true;
    kind.addEventListener("change", () => { token.parentNode.hidden = kind.value !== "llama"; });
    const reveal = html(this.doc, "input", { type: "checkbox" });
    const revealLabel = html(this.doc, "label", {}, "Show entered keys"); revealLabel.prepend(reveal);
    reveal.addEventListener("change", () => { key.type = token.type = reveal.checked ? "text" : "password"; });
    form.append(revealLabel);
    const add = html(this.doc, "button", { type: "submit" }, "Add connection");
    form.append(add);
    const enroll = async record => { await AgentRemotes.enroll(record); await refresh(); await this.refreshRemotes(); };
    form.addEventListener("submit", async event => {
      event.preventDefault(); add.disabled = true;
      await report(async () => { await enroll({ version: 1, kind: kind.value, name: name.value, url: url.value, clientAuthorization: key.value, ...(kind.value === "llama" ? { bearerToken: token.value } : {}) }); key.value = token.value = ""; });
      add.disabled = false;
    });
    const file = html(this.doc, "input", { type: "file", accept: ".json,application/json,image/*", "aria-label": "Import connection file or QR image" });
    file.addEventListener("change", () => report(async () => {
      const selected = file.files[0]; if (!selected) return;
      const source = selected.type.startsWith("image/") ? await this.decodeQR(await this.win.createImageBitmap(selected)) : await selected.text();
      await enroll(JSON.parse(source)); file.value = "";
    }));
    const input = html(this.doc, "textarea", { rows: "3", placeholder: "Paste connection JSON", "aria-label": "Connection JSON" });
    const paste = button("Import pasted connection", async () => { await enroll(JSON.parse(input.value)); input.value = ""; });
    const camera = button("Scan QR with camera", async () => {
      const video = html(this.doc, "video", { autoplay: "", muted: "", style: "width:100%;max-height:260px" });
      const stream = await this.win.navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      video.srcObject = stream; content.append(video);
      let timer;
      const stop = () => { clearTimeout(timer); stream.getTracks().forEach(track => track.stop()); video.remove(); };
      dialog.addEventListener("close", stop, { once: true });
      const scan = async () => {
        if (!dialog.open) return stop();
        try {
          if (video.readyState >= 2) {
            const source = await this.decodeQR(video);
            await enroll(JSON.parse(source)); stop(); return;
          }
        } catch (e) { if (e.message !== "No connection QR code was found.") { error.textContent = e.message; stop(); return; } }
        timer = setTimeout(scan, 250);
      };
      await video.play(); scan();
    });
    content.append(saved, html(this.doc, "h3", {}, "Add connection"), form, html(this.doc, "h3", {}, "Import"), html(this.doc, "p", {}, "Import a connection file, scan its QR, or paste its JSON. Your account password and two-factor code are never included."), file, camera, input, paste, error);
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
    if (entry.authFor) {
      const authBrowser = this.activeBrowser;
      const original = entry.authFor;
      const originalEntry = ownedViews.get(original);
      this.activeBrowser = original;
      original.hidden = false;
      authBrowser.remove();
      this.views.delete(entry.key);
      ownedViews.delete(authBrowser);
      original.browsingContext.currentWindowGlobal.getActor("BashKittenAgent").sendAsyncMessage("Authenticated");
      if (originalEntry) this.contentReady(originalEntry, null);
      const pending = this.pendingHosted;
      this.pendingHosted = null;
      if (pending?.browser == original) await this.openHosted(original, pending.url, { tab: pending.tab });
      return;
    }
    if (draftReady && actor && this.drafts.has(entry.key)) {
      await actor.sendQuery("RestoreDraft", this.drafts.get(entry.key));
      this.drafts.delete(entry.key);
    }
    lazy.BrowserControlChannel.start(entry.connection, { local: entry.local, window: this.win }).catch(error => console.error("Browser control connection failed", error));
  }

  async signIn() {
    if (!this.activeBrowser) return;
    const original = this.activeBrowser;
    const entry = ownedViews.get(original);
    if (!entry || entry.authFor) return;
    lazy.BrowserControlChannel.close("sign in");
    const origin = new URL(entry.connection.url).origin;
    const returnTo = origin + "/";
    await this.connect({ ...entry.connection, url: origin + "/login?rd=" + encodeURIComponent(returnTo) }, entry.local, { authFor: original });
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
    clearTimeout(this.timer);
    lazy.BrowserControlChannel.close("browser closed");
    this.win.removeEventListener("keydown", this.tabKey, true);
    Services.obs.removeObserver(this.observer, "bashkitten-agent-remote-changed");
    // Closing the browser does not stop the independent Agent service group.
    for (const browser of this.views.values()) ownedViews.delete(browser);
  }
}
