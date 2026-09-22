// SPDX-License-Identifier: GPL-3.0-only

export class BashKittenHostChild extends JSWindowActorChild {
  async handleEvent(event) {
    if (this.browsingContext !== this.browsingContext.top || event.target !== this.document &&
        event.target !== this.contentWindow) return;
    if (event.type === "BashKittenDraftReady") {
      this.draftReady = true;
      this.sendQuery("DraftReady").catch(() => {});
      return;
    }
    if (this.installed || this.installing) return;
    this.installing = true;
    try {
      await this.sendQuery("Ready");
      const window = this.contentWindow;
      if (!window || window.closed || window.document !== this.document) return;
      const bridge = Cu.createObjectIn(window);
      bridge.platform = "android";
      Cu.exportFunction((command, args = {}) => new window.Promise((resolve, reject) => {
        let json;
        try {
          if (typeof command !== "string" || !args || typeof args !== "object" || Array.isArray(args)) {
            throw new Error("Invalid Agent host request");
          }
          json = JSON.stringify(args);
          if (json.length > 200000) throw new Error("Agent host request too large");
        } catch (error) {
          reject(new window.Error(String(error.message)));
          return;
        }
        this.sendQuery("Call", { command, args: json }).then(
          value => resolve(Cu.cloneInto(value, window)),
          error => reject(new window.Error(String(error.message)))
        );
      }), bridge, { defineAs: "call" });
      Object.freeze(bridge);
      Object.defineProperty(Cu.waiveXrays(window), "bashkittenHost", { value: bridge });
      this.installed = true;
      window.dispatchEvent(new window.Event("bashkitten-host-ready"));
    } catch (_) {
      // Ordinary tabs, login documents and obsolete enrollments receive no host.
    } finally {
      this.installing = false;
    }
  }

  async receiveMessage({ name, data }) {
    if (this.browsingContext !== this.browsingContext.top) throw new Error("Protected top document required");
    await this.sendQuery("Ready");
    const window = this.contentWindow;
    if (!window || window.closed || window.document !== this.document) {
      throw new Error("The Agent document changed");
    }
    const draft = Cu.waiveXrays(window).bashkittenDraft;
    if (name === "CaptureDraft") {
      return typeof draft?.capture === "function" ? structuredClone(draft.capture()) : null;
    }
    if (name === "RestoreDraft") {
      if (!this.draftReady || typeof draft?.restore !== "function") return false;
      await draft.restore(Cu.cloneInto(data, window));
      return true;
    }
    throw new Error("Unsupported native draft request");
  }
}
