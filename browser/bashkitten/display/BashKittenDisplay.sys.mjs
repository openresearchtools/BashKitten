/* SPDX-License-Identifier: AGPL-3.0-only */
import { SessionStore } from "resource:///modules/sessionstore/SessionStore.sys.mjs";
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";
const records = new WeakMap(), restoring = new WeakMap();
const TAB_KEY = "bashkitten-display";
const validId = id => typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
const URI = "chrome://browser/content/bashkitten/display.xhtml";
function savedDisplay(tab, uri = tab?.linkedBrowser.currentURI?.spec) {
  if (!tab || tab.closing || uri !== URI) return null;
  try {
    const saved = JSON.parse(SessionStore.getCustomTabValue(tab, TAB_KEY));
    if (validId(saved?.id) && typeof saved.interactive === "boolean")
      return { id: saved.id, interactive: saved.interactive };
  } catch {}
  return null;
}

/** Native-only adapter: the sidecar supplies a descriptor from its private owner. */
export const BashKittenDisplay = {
  hasSavedDisplaySelected(window) {
    const tab = window.gBrowser.selectedTab;
    try {
      const state = JSON.parse(SessionStore.getTabState(tab));
      return Boolean(savedDisplay(tab, state.entries?.[(state.index || state.entries.length) - 1]?.url));
    } catch { return false; }
  },
  tab(window, id) {
    return [...window.gBrowser.tabs].find(tab => !tab.closing &&
      (records.get(tab.linkedBrowser)?.id === id || savedDisplay(tab)?.id === id));
  },
  selected(window) {
    const tab = window.gBrowser.selectedTab;
    if (!tab || tab.closing || tab.linkedBrowser.currentURI?.spec !== URI) return null;
    const saved = savedDisplay(tab);
    // Session metadata identifies presentation only, never a renderer endpoint.
    return records.get(tab.linkedBrowser) || (saved && {
      ...saved, name: tab.label, state: "starting", running: false,
    });
  },
  close(window, id) {
    const tab = this.tab(window, id);
    if (!tab) return false;
    // Removing a presenter never sends a desktop/container stop command.
    window.gBrowser.removeTab(tab, { animate: false, closeWindowWithLastTab: false });
    return true;
  },
  capabilities() {
    return JSON.parse(Cc["@bashkitten.org/native-display;1"].createInstance(Ci.nsIBashKittenDisplay).capabilities);
  },
  open(window, environment, controls = {}) {
    if (!environment || environment.kind !== "container" || !validId(environment.id) ||
        !environment.presenterSocket?.startsWith("/")) {
      throw new Error("Display requires a running local container.");
    }
    const existing = this.tab(window, environment.id);
    if (existing) {
      const browser = existing.linkedBrowser, record = records.get(browser);
      if (!record?.socket) {
        // A saved unavailable tab can reconnect after its container starts.
        // Fence its old restore before adopting this freshly verified endpoint.
        restoring.get(browser)?.cancel(); restoring.delete(browser);
        if (record) {
          Object.assign(record, {
            name: environment.name, socket: environment.presenterSocket, state: environment.state,
            running: environment.running, error: environment.error,
            clipboard: controls.clipboard, service: controls.service, pending: false,
          });
          existing.label = environment.name;
        } else this.own(window, existing, environment, controls, savedDisplay(existing).interactive);
        browser.loadURI(Services.io.newURI(URI), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      }
      window.gBrowser.selectedTab = existing;
      window.BashKittenAgent?.browse();
      return existing;
    }
    const tab = window.gBrowser.addTab("about:blank", {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      forceNotRemote: true, skipAnimation: true,
    });
    this.own(window, tab, environment, controls);
    tab.linkedBrowser.loadURI(Services.io.newURI(URI), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    window.gBrowser.selectedTab = tab;
    window.BashKittenAgent?.browse();
    window.dispatchEvent(new window.Event("BashKittenDisplayChanged"));
    return tab;
  },
  own(window, tab, environment, controls, interactive = true) {
    const executable = Services.dirsvc.get("GreD", Ci.nsIFile);
    executable.append("runtime"); executable.append("display"); executable.append("bashkitten-display");
    const browser = tab.linkedBrowser;
    browser.setAttribute("bashkitten-native-display", environment.id);
    browser.setAttribute("bashkitten-protected", "true");
    records.set(browser, { window, tab, id: environment.id, name: environment.name,
      socket: environment.presenterSocket, executable: executable.path, clipboard: controls.clipboard,
      state: environment.state, running: environment.running, error: environment.error,
      service: controls.service, interactive, controller: null });
    SessionStore.setCustomTabValue(tab, TAB_KEY, JSON.stringify({ id: environment.id, interactive }));
    tab.label = environment.name;
    const close = () => {
      if (!records.delete(browser)) return;
      window.removeEventListener("unload", close);
      tab.removeEventListener("TabClose", close);
      window.gBrowser.removeTabsProgressListener(navigation);
      browser.removeAttribute("bashkitten-native-display");
      browser.removeAttribute("bashkitten-protected");
      if (browser.contentDocument?.documentURI === URI) {
        browser.contentWindow.dispatchEvent(new browser.contentWindow.Event("BashKittenDisplayDetach"));
      }
      window.dispatchEvent(new window.Event("BashKittenDisplayChanged"));
    };
    const navigation = { onLocationChange(changedBrowser, progress, _request, location) {
      if (changedBrowser !== browser || !progress.isTopLevel) return;
      // Home/bookmarks or other native navigation turn this into an ordinary
      // tab. Retire the presenter, its authority and its toolbar state together.
      if (location.spec !== URI) {
        SessionStore.deleteCustomTabValue(tab, TAB_KEY);
        close();
      }
      else window.dispatchEvent(new window.Event("BashKittenDisplayChanged"));
    } };
    window.gBrowser.addTabsProgressListener(navigation);
    tab.addEventListener("TabClose", close, { once: true });
    window.addEventListener("unload", close, { once: true });
    window.dispatchEvent(new window.Event("BashKittenDisplayChanged"));
  },
  async prepare(document) {
    if (!document.nodePrincipal.isSystemPrincipal || document.documentURI !== URI) throw new Error("Native display owner required.");
    const browser = document.defaultView.docShell.chromeEventHandler;
    if (browser.contentDocument !== document) throw new Error("This Display document was replaced.");
    if (records.get(browser)?.socket && !records.get(browser).pending) return this.record(document);
    const window = browser.ownerDocument.defaultView, tab = window.gBrowser.getTabForBrowser(browser);
    const saved = savedDisplay(tab);
    if (!saved)
      throw new Error("This saved Display tab has no container identity. Close it and open Display from its container.");
    if (!records.has(browser)) this.own(window, tab, {
      id: saved.id, name: tab.label, state: "starting", running: false,
    }, {}, saved.interactive);
    Object.assign(this.record(document), { pending: true, state: "starting", running: false, error: null });
    const token = {};
    restoring.get(browser)?.cancel();
    restoring.set(browser, token);
    let cancel, timer, pauseTimer;
    const cancelled = new Promise((_, reject) => { cancel = message => reject(new Error(message)); });
    token.cancel = () => cancel("This Display restoration was replaced.");
    const closed = () => cancel("This Display tab was closed.");
    const check = () => {
      if (restoring.get(browser) !== token || window.closed || window.BashKittenLifetime?.quitting || tab.closing ||
          browser.contentDocument !== document || browser.currentURI?.spec !== URI ||
          !window.gBrowser.tabs.includes(tab)) throw new Error("This Display tab is no longer attached.");
    };
    const wait = async task => { const value = await Promise.race([task, cancelled]); check(); return value; };
    tab.addEventListener("TabClose", closed);
    document.defaultView.addEventListener("unload", closed);
    window.addEventListener("unload", closed);
    timer = setTimeout(() => cancel("Container startup is still in progress. Close and reopen Display when it finishes."), 180000);
    try {
      await wait(window.delayedStartupPromise);
      const host = window.BashKittenAgent;
      if (!host) throw new Error("Display is unavailable in this browser window.");
      await wait(host.machineStartupReady);
      let operation = await wait(host.machineDisplayOperation(saved.id, 0));
      if (operation.state === "running") {
        if (!["create", "start", "restart", "retry"].includes(operation.kind)) throw new Error(operation.phase || "The container is stopping.");
        const id = operation.id;
        while (operation.state === "running") {
          await wait(new Promise(resolve => { pauseTimer = setTimeout(resolve, 500); }));
          operation = await wait(host.machineDisplayOperation(saved.id, operation.cursor));
          if (operation.id !== id) throw new Error("The container operation changed. Reopen Display to connect again.");
        }
        if (operation.state !== "complete") throw new Error(operation.error || "The container did not start.");
      }
      const { environment, controls } = await wait(host.machineDisplayDescriptor(saved.id));
      if (environment.id !== saved.id || environment.kind !== "container" || !environment.presenterSocket?.startsWith("/"))
        throw new Error("The restored Display owner did not match its container.");
      const existing = this.tab(window, saved.id);
      if (existing && existing !== tab) throw new Error("This container’s Display is already open in another tab.");
      Object.assign(this.record(document), {
        name: environment.name, socket: environment.presenterSocket, state: environment.state,
        running: environment.running, error: environment.error,
        clipboard: controls.clipboard, service: controls.service, pending: false,
      });
      tab.label = environment.name;
      window.dispatchEvent(new window.Event("BashKittenDisplayChanged"));
      return this.record(document);
    } catch (error) {
      check();
      // A stopped/deleted backend still has an owned native tab with its saved
      // input mode and truthful error, but no endpoint or service authority.
      Object.assign(this.record(document), { state: "error", running: false, error: error.message, pending: false });
      window.dispatchEvent(new window.Event("BashKittenDisplayChanged"));
      return this.record(document);
    } finally {
      clearTimeout(timer); clearTimeout(pauseTimer);
      tab.removeEventListener("TabClose", closed);
      document.defaultView.removeEventListener("unload", closed);
      window.removeEventListener("unload", closed);
      if (restoring.get(browser) === token) restoring.delete(browser);
    }
  },
  async clipboard(document, request) {
    const record = this.record(document);
    if (!record.interactive || record.state !== "running") throw new Error("Turn on interaction to use the desktop clipboard.");
    if (typeof record.clipboard !== "function") throw new Error("Clipboard is unavailable for this desktop.");
    if (!["read", "write"].includes(request.action)) throw new Error("Invalid clipboard action.");
    return record.clipboard(request);
  },
  bind(document, controller) {
    this.record(document).controller = controller;
  },
  update(document, state, interactive, running, presentation = {}) {
    const record = this.record(document);
    record.state = state;
    if (record.interactive !== interactive) {
      record.interactive = interactive;
      SessionStore.setCustomTabValue(record.tab, TAB_KEY, JSON.stringify({ id: record.id, interactive }));
    }
    record.running = running;
    const { clipboardBusy = false, clipboardStatus = "", renderMode = "", renderReason = "" } = presentation;
    Object.assign(record, { clipboardBusy, clipboardStatus, renderMode, renderReason });
    const { window } = record;
    window.dispatchEvent(new window.Event("BashKittenDisplayChanged"));
  },
  async service(document, action) {
    const record = this.record(document);
    if (!["status", "start", "stop"].includes(action) || typeof record.service !== "function") throw new Error("Display service is unavailable.");
    return record.service(action);
  },
  control(window, action, value) {
    const browser = window.gBrowser.selectedBrowser;
    const record = this.selected(window), document = browser?.contentDocument;
    if (!record || this.record(document) !== record || !record.controller) return;
    if (action === "clipboard-read" || action === "clipboard-write") {
      // Only a real activation in this browser window can request a snapshot.
      // Call the owned controller directly; never manufacture a content event.
      if (!value?.isTrusted || value.currentTarget?.ownerDocument !== window.document ||
          !record.interactive || record.state !== "running" || record.clipboardBusy) return;
      return record.controller.clipboard(action === "clipboard-read" ? "read" : "write",
        () => this.selected(window) === record && browser.contentDocument === document &&
          records.get(browser) === record && !record.tab.closing);
    }
    if (action === "enabled") return record.controller.enabled(value);
    else if (action === "interactive") return record.controller.interactive(value);
    else throw new Error("Unknown Display control.");
  },
  record(document) {
    if (!document.nodePrincipal.isSystemPrincipal || document.documentURI !== URI) throw new Error("Native display owner required.");
    const browser = document.defaultView.docShell.chromeEventHandler;
    const record = records.get(browser);
    if (!record || browser.contentDocument !== document) throw new Error("This Display tab is no longer attached. Open Display from its container.");
    return record;
  },
  attach(document, surface, observer) {
    const record = this.record(document);
    if (!record.socket?.startsWith("/")) throw new Error("Display has no live container connection.");
    const receiver = Cc["@bashkitten.org/native-display;1"].createInstance(Ci.nsIBashKittenDisplay);
    receiver.attach(surface, record.socket, record.executable, observer);
    return receiver;
  },
};
