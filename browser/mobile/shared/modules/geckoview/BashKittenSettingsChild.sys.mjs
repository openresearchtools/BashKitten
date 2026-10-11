// SPDX-License-Identifier: AGPL-3.0-only
export class BashKittenSettingsChild extends JSWindowActorChild {
  async handleEvent(event) {
    if (this.installed || this.installing || this.browsingContext !== this.browsingContext.top || event.target !== this.document) return;
    this.installing = true;
    try {
      const info = await this.sendQuery("Ready"), window = this.contentWindow;
      if (!window || window.closed || window.document !== this.document) return;
      const bridge = Cu.createObjectIn(window);
      bridge.info = Cu.cloneInto(info, window);
      this.listeners = new Map();
      Cu.exportFunction((command, args = {}) => new window.Promise((resolve, reject) => {
        try {
          if (typeof command !== "string" || !args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid settings arguments");
          const json = JSON.stringify(args);
          this.sendQuery("Call", { command, args: json }).then(value => resolve(Cu.cloneInto(value, window)), error => reject(new window.Error(error.message)));
        } catch (error) { reject(new window.Error(error.message)); }
      }), bridge, { defineAs: "call" });
      Cu.exportFunction((type, listener) => {
        if (typeof type !== "string" || typeof listener !== "function") throw new window.Error("Expected an event listener");
        const entry = { type, listener };
        this.listeners.set(entry, entry);
        return Cu.exportFunction(() => this.listeners?.delete(entry), window);
      }, bridge, { defineAs: "subscribe" });
      Object.freeze(bridge.info); Object.freeze(bridge);
      Object.defineProperty(Cu.waiveXrays(window), "bashkittenSettings", { value: bridge });
      this.installed = true;
      window.dispatchEvent(new window.Event("bashkitten-settings-ready"));
    } catch (_) {
      // An ordinary manually opened copy is inert and reports that clearly.
      const window = this.contentWindow;
      window?.dispatchEvent(new window.CustomEvent("bashkitten-settings-error", {
        detail: Cu.cloneInto({ message: "Open these settings from BashKitten’s settings menu." }, window),
      }));
    }
    finally { this.installing = false; }
  }
  async receiveMessage({ name, data }) {
    if (name !== "Event") return;
    await this.sendQuery("Ready");
    const window = this.contentWindow;
    if (!window || window.closed || window.document !== this.document) return;
    for (const { type, listener } of this.listeners?.values() || []) {
      if (type !== data?.type) continue;
      try { listener(Cu.cloneInto(data.data, window)); } catch (_) {}
    }
  }
  didDestroy() { this.listeners?.clear(); }
}
