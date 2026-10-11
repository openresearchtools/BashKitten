/* SPDX-License-Identifier: AGPL-3.0-only */
export class BashKittenSettingsChild extends JSWindowActorChild {
  async handleEvent(event) {
    if (event.type === "pagehide") { this.sendQuery("Pause").catch(() => {}); return; }
    const win = this.contentWindow;
    if (win.location.href !== "about:bashkitten-settings" || this.browsingContext !== this.browsingContext.top) return;
    try {
      const info = await this.sendQuery("Info");
      if (this.contentWindow !== win) return;
      this.listeners = new Map();
      const bridge = Cu.cloneInto({ info }, win);
      Cu.exportFunction((name, args = {}) => new win.Promise((resolve, reject) => {
        if (typeof name !== "string") { reject(new win.Error("Invalid settings operation")); return; }
        if (["clipboard-copy", "localai-open-record", "remotes.enroll", "remotes.service-key", "remotes.open-service", "remotes.copy-service", "share-save-qr", "share-open-authenticator"].includes(name) && !this.document.hasValidTransientUserGestureActivation) {
          reject(new win.Error("Use this action from the settings page.")); return;
        }
        this.sendQuery("Call", { name, args: Cu.cloneInto(args, {}) }).then(
          value => resolve(Cu.cloneInto(value, win)), error => reject(new win.Error(error.message)));
      }), bridge, { defineAs: "call" });
      Cu.exportFunction((name, listener) => {
        if (typeof name !== "string" || typeof listener !== "function") throw new win.Error("Invalid settings subscription");
        if (!this.listeners.has(name)) this.listeners.set(name, new Set());
        this.listeners.get(name).add(listener);
        return Cu.exportFunction(() => this.listeners?.get(name)?.delete(listener), win);
      }, bridge, { defineAs: "subscribe" });
      win.wrappedJSObject.Object.freeze(bridge.info);
      win.wrappedJSObject.Object.freeze(bridge);
      Object.defineProperty(win.wrappedJSObject, "bashkittenSettings", { value: bridge, writable: false, configurable: false });
      win.dispatchEvent(new win.Event("bashkitten-settings-ready"));
    } catch (error) {
      console.error("BashKitten settings could not attach", error);
      if (this.contentWindow === win) win.dispatchEvent(new win.CustomEvent("bashkitten-settings-error", { detail: Cu.cloneInto({ message: error.message }, win) }));
    }
  }
  receiveMessage({ name, data }) {
    const win = this.contentWindow;
    if (name === "Closed") { this.listeners?.clear(); win?.dispatchEvent(new win.Event("bashkitten-settings-closed")); }
    if (name === "Update") for (const listener of this.listeners?.get(data.name) || []) {
      try { listener(Cu.cloneInto(data.value, win)); } catch (error) { console.error(error); }
    }
  }
  didDestroy() { this.listeners?.clear(); }
}
