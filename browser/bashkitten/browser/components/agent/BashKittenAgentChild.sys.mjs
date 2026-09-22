/* SPDX-License-Identifier: GPL-3.0-only */

const MAX_FILE_BYTES = 100 * 1024 * 1024;

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
    if (command === "open-folder" || command === "open-file" && typeof data.folder === "string") {
      return this.sendQuery("OpenFolder", { path: data.path || data.folder });
    }
    if (command !== "open-file" || typeof data.url !== "string") throw new Error("Unsupported native action.");
    const url = new URL(data.url, this.document.location.href);
    const image = /^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(url.href);
    if (!image && (url.origin !== entry.origin || !/^\/api\/(files\/content(?:$|\/)|sessions\/[^/]+\/attachments\/)/.test(url.pathname))) throw new Error("Only local Agent files can be opened.");
    const response = await this.contentWindow.fetch(url.href, { credentials: "same-origin", redirect: "error" });
    if (!response.ok) throw new Error(`Could not read the file (${response.status}).`);
    if (Number(response.headers.get("content-length") || 0) > MAX_FILE_BYTES) throw new Error("The file is too large to open here.");
    const reader = response.body.getReader();
    const chunks = []; let length = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_FILE_BYTES) { await reader.cancel(); throw new Error("The file is too large to open here."); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let name = image ? `image.${url.href.match(/^data:image\/([^;]+)/i)[1]}` : decodeURIComponent(url.pathname.split("/").at(-1));
    const disposition = response.headers.get("content-disposition") || "";
    const filename = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="([^"]+)"/i);
    if (filename) { try { name = decodeURIComponent(filename[1]); } catch {} }
    return this.sendQuery("OpenFile", { name, bytes });
  }
}
