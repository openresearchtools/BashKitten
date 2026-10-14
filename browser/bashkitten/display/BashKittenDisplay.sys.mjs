/* SPDX-License-Identifier: AGPL-3.0-only */
const records = new WeakMap();
const URI = "chrome://browser/content/bashkitten/display.xhtml";

/** Native-only adapter: the sidecar supplies a descriptor from its private owner. */
export const BashKittenDisplay = {
  tab(window, id) {
    return [...window.gBrowser.tabs].find(tab => !tab.closing && records.get(tab.linkedBrowser)?.id === id);
  },
  selected(window) {
    const tab = window.gBrowser.selectedTab;
    return tab && !tab.closing && tab.linkedBrowser.currentURI?.spec === URI
      ? records.get(tab.linkedBrowser) : null;
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
    if (!environment || environment.kind !== "container" || !environment.id ||
        !environment.presenterSocket?.startsWith("/")) {
      throw new Error("Display requires a running local container.");
    }
    const existing = this.tab(window, environment.id);
    if (existing) {
      window.gBrowser.selectedTab = existing;
      window.BashKittenAgent?.browse();
      return existing;
    }
    const executable = Services.dirsvc.get("GreD", Ci.nsIFile);
    executable.append("runtime"); executable.append("display"); executable.append("bashkitten-display");
    const tab = window.gBrowser.addTab("about:blank", {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      forceNotRemote: true, skipAnimation: true,
    });
    const browser = tab.linkedBrowser;
    browser.setAttribute("bashkitten-native-display", environment.id);
    browser.setAttribute("bashkitten-protected", "true");
    records.set(browser, { id: environment.id, name: environment.name,
      socket: environment.presenterSocket, executable: executable.path, clipboard: controls.clipboard,
      state: environment.state, running: environment.running, error: environment.error,
      service: controls.service, interactive: true, controller: null });
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
      if (location.spec !== URI) close();
      else window.dispatchEvent(new window.Event("BashKittenDisplayChanged"));
    } };
    window.gBrowser.addTabsProgressListener(navigation);
    tab.addEventListener("TabClose", close, { once: true });
    window.addEventListener("unload", close, { once: true });
    browser.loadURI(Services.io.newURI(URI), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    window.gBrowser.selectedTab = tab;
    window.BashKittenAgent?.browse();
    window.dispatchEvent(new window.Event("BashKittenDisplayChanged"));
    return tab;
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
  update(document, state, interactive, running) {
    const record = this.record(document);
    record.state = state;
    record.interactive = interactive;
    record.running = running;
    const window = document.defaultView.docShell.chromeEventHandler.ownerGlobal;
    window.dispatchEvent(new window.Event("BashKittenDisplayChanged"));
  },
  async service(document, action) {
    const record = this.record(document);
    if (!["status", "start", "stop"].includes(action) || typeof record.service !== "function") throw new Error("Display service is unavailable.");
    return record.service(action);
  },
  control(window, action, value) {
    const browser = window.gBrowser.selectedBrowser;
    const record = this.selected(window);
    if (!record || this.record(browser.contentDocument) !== record || !record.controller) return;
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
    const receiver = Cc["@bashkitten.org/native-display;1"].createInstance(Ci.nsIBashKittenDisplay);
    receiver.attach(surface, record.socket, record.executable, observer);
    return receiver;
  },
};
