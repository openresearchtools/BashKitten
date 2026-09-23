/* SPDX-License-Identifier: GPL-3.0-only */

export class BashKittenAgentChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type === "DOMContentLoaded" || event.type === "BashKittenDraftReady") {
      this.sendAsyncMessage(event.type === "BashKittenDraftReady" ? "DraftReady" : "Ready");
      return;
    }
    const principal = this.document.nodePrincipal;
    const entry = new Map(Services.cpmm.sharedData.get("BashKittenAgentContexts") || []).get(principal.originAttributes.userContextId);
    if (!entry || principal.originNoSuffix !== entry.origin || this.browsingContext !== this.browsingContext.top) return;
    const win = this.contentWindow;
    const host = Cu.cloneInto({ platform: "linux", local: entry.local }, win);
    Cu.exportFunction((command, data = {}) => new win.Promise((resolve, reject) => {
      this.call(command, Cu.cloneInto(data, {}), entry).then(
        result => resolve(Cu.cloneInto(result, win)),
        error => reject(new win.Error(error.message))
      );
    }), host, { defineAs: "call" });
    win.wrappedJSObject.bashkittenHost = host;
  }

  async receiveMessage({ name, data }) {
    const api = this.contentWindow.wrappedJSObject.bashkittenDraft;
    if (name === "CaptureDraft") return api ? Cu.cloneInto(await api.capture(), {}, { wrapReflectors: true }) : null;
    if (name === "RestoreDraft") {
      if (!api) throw new Error("The Agent document is not ready to restore its draft.");
      await api.restore(Cu.cloneInto(data, this.contentWindow, { wrapReflectors: true }));
      return { ok: true };
    }
    if (name === "Authenticated") this.contentWindow.dispatchEvent(new this.contentWindow.Event("BashKittenAuthenticated"));
    return null;
  }

  async call(command, data, entry) {
    if (!this.document.hasValidTransientUserGestureActivation) throw new Error("Use this action from the Agent view.");
    if (command === "sign-in") return this.sendQuery("SignIn");
    if (command === "import-remote") return this.sendQuery("ImportRemote");
    if (command === "open-hosted" && typeof data.url === "string") return this.sendQuery("OpenHosted", { url: data.url });
    if (!entry.local) throw new Error("Files on a remote Agent use browser downloads.");
    if (command === "choose-folder") return this.sendQuery("ChooseFolder", { title: data.title, path: data.path });
    if (command === "open-folder" || command === "open-file" && typeof data.folder === "string") {
      return this.sendQuery("OpenFolder", { path: data.path || data.folder });
    }
    if (command !== "open-file" || typeof data.url !== "string") throw new Error("Unsupported native action.");
    const url = new URL(data.url, this.document.location.href);
    if (url.origin !== entry.origin || url.username || url.password ||
        !/^\/api\/(?:files\/content|sessions\/[a-f0-9-]{36}\/attachments\/[^/]+\/[^/]+)$/.test(url.pathname)) throw new Error("Only local Agent files can be opened.");
    return this.sendQuery("OpenFile", { url: url.href });
  }
}
