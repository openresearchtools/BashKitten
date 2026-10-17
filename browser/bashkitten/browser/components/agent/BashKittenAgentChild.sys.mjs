/* SPDX-License-Identifier: AGPL-3.0-only */

export class BashKittenAgentChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type === "BashKittenNavigationChanged") { this.sendAsyncMessage("NavigationChanged"); return; }
    if (event.type === "BashKittenDraftReady") {
      this.draftChanged = false;
      this.draftStarting = this.sendQuery("DraftReady").then(() => {
        this.draftStarting = null;
        return this.sendQuery("DraftChanged");
      }).catch(error => { this.draftStarting = null; this.draftError(error); });
      return;
    }
    if (event.type === "BashKittenDraftChanged") {
      this.draftChanged = true;
      if (!this.draftStarting) this.sendQuery("DraftChanged").catch(error => this.draftError(error));
      return;
    }
    if (event.type === "DOMContentLoaded") { this.sendAsyncMessage("Ready"); return; }
    const principal = this.document.nodePrincipal;
    const entry = new Map(Services.cpmm.sharedData.get("BashKittenAgentContexts") || []).get(principal.originAttributes.userContextId);
    if (!entry || principal.originNoSuffix !== entry.origin || this.browsingContext !== this.browsingContext.top) return;
    if (event.type === "click") {
      if (!event.isTrusted || event.defaultPrevented || event.button !== 0 ||
          event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
          !this.document.hasValidTransientUserGestureActivation) return;
      const link = event.target.closest?.("a[download]");
      if (!link || link.ownerDocument !== this.document) return;
      const url = new URL(link.href);
      if (url.origin !== entry.origin || url.username || url.password || url.hash ||
          !/^\/api\/(?:files\/(?:content|archive|jobs\/[a-f0-9-]{36}\/download)|sessions\/[^/]+\/attachments\/[^/]+\/[^/]+)$/.test(url.pathname)) return;
      // An explicit download must use Gecko's forced-save path. Letting a PDF
      // navigate first can create a viewer popup carrying the Agent's context.
      event.preventDefault();
      this.sendQuery("DownloadFile", { url: url.href }).catch(error => this.contentWindow?.alert(error.message));
      return;
    }
    const win = this.contentWindow;
    const host = Cu.cloneInto({ platform: "linux", local: entry.local, navigation: true, providerLogin: entry.providerLogin === true }, win);
    Cu.exportFunction((command, data = {}) => new win.Promise((resolve, reject) => {
      this.call(command, Cu.cloneInto(data, {}), entry).then(
        result => resolve(Cu.cloneInto(result, win)),
        error => reject(new win.Error(error.message))
      );
    }), host, { defineAs: "call" });
    win.wrappedJSObject.bashkittenHost = host;
  }

  draftError(error) {
    const win = this.contentWindow;
    win?.dispatchEvent(new win.CustomEvent("BashKittenDraftError", { detail: error.message }));
  }

  async receiveMessage({ name, data }) {
    if (name === "Navigation") {
      const navigation = this.contentWindow.wrappedJSObject.bashkittenNavigation;
      if (!navigation) throw new Error("The chat is still connecting");
      return Cu.cloneInto(await navigation.call(data.action, Cu.cloneInto(data.value || {}, this.contentWindow)), {});
    }
    const api = this.contentWindow.wrappedJSObject.bashkittenDraft;
    if (name === "CaptureDraft") return api ? Cu.cloneInto(await api.capture(), {}, { wrapReflectors: true }) : null;
    if (name === "RestoreDraft") {
      if (this.draftChanged) return false;
      if (!api) throw new Error("The Agent document is not ready to restore its draft.");
      await api.restore(Cu.cloneInto(data, this.contentWindow, { wrapReflectors: true }));
      return { ok: true };
    }
    if (name === "Authenticated") this.contentWindow.dispatchEvent(new this.contentWindow.Event("BashKittenAuthenticated"));
    return null;
  }

  async call(command, data, entry) {
    if (command === "cancel-file-view") return this.sendQuery("CancelFileView");
    if (!this.document.hasValidTransientUserGestureActivation) throw new Error("Use this action from the Agent view.");
    if (command === "sign-in") return this.sendQuery("SignIn");
    if (command === "provider-login-open" && entry.providerLogin === true && typeof data.attemptId === "string" && typeof data.url === "string") return this.sendQuery("ProviderLogin", { attemptId: data.attemptId, url: data.url });
    if (command === "view-file" && typeof data.url === "string") {
      const url = new URL(data.url, this.document.location.href);
      const query = url.searchParams, path = query.get("path");
      const selected = query.size === 2 && query.getAll("path").length === 1 && path &&
        (query.getAll("root").length === 1 && query.get("root").startsWith("/") && !path.startsWith("/") ||
         query.getAll("session").length === 1 && /^[a-f0-9-]{36}$/.test(query.get("session")));
      if (url.origin !== entry.origin || url.username || url.password || url.hash ||
          url.pathname !== "/api/files/previews/content" || !selected) throw new Error("Invalid prepared document.");
      return this.sendQuery("ViewFile", { url: url.href });
    }
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
