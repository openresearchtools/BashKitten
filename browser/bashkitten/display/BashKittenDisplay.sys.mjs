/* SPDX-License-Identifier: AGPL-3.0-only */
const records = new WeakMap();
const URI = "chrome://browser/content/bashkitten/display.xhtml";

/** Native-only adapter: the sidecar supplies a descriptor from its private owner. */
export const BashKittenDisplay = {
  capabilities() {
    return JSON.parse(Cc["@bashkitten.org/native-display;1"].createInstance(Ci.nsIBashKittenDisplay).capabilities);
  },
  open(window, environment, controls = {}) {
    if (!environment || environment.kind !== "container" || !environment.id ||
        !environment.presenterSocket?.startsWith("/")) {
      throw new Error("Display requires a running local container.");
    }
    for (const tab of window.gBrowser.tabs) {
      if (records.get(tab.linkedBrowser)?.id === environment.id) {
        window.gBrowser.selectedTab = tab;
        window.BashKittenAgent?.browse();
        return tab;
      }
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
    records.set(browser, Object.freeze({ id: environment.id, name: environment.name,
      socket: environment.presenterSocket, executable: executable.path, clipboard: controls.clipboard }));
    tab.label = environment.name;
    const close = () => { records.delete(browser); browser.contentWindow?.dispatchEvent(new browser.contentWindow.Event("BashKittenDisplayDetach")); };
    tab.addEventListener("TabClose", close, { once: true });
    window.addEventListener("unload", close, { once: true });
    browser.loadURI(Services.io.newURI(URI), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    window.gBrowser.selectedTab = tab;
    window.BashKittenAgent?.browse();
    return tab;
  },
  async clipboard(document, request) {
    const record = this.record(document);
    if (typeof record.clipboard !== "function") throw new Error("Clipboard is unavailable for this desktop.");
    if (!["read", "write"].includes(request.action)) throw new Error("Invalid clipboard action.");
    return record.clipboard(request);
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
