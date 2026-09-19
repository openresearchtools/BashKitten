// SPDX-License-Identifier: AGPL-3.0-or-later
import { GeckoViewModule } from "resource://gre/modules/GeckoViewModule.sys.mjs";
import { WildBuzzardAndroid } from "resource://gre/modules/WildBuzzardAndroid.sys.mjs";

const commands = new Set(["snapshot", "act", "read", "evaluate", "wait", "console", "clearConsole", "viewport"]);

export class GeckoViewWildBuzzard extends GeckoViewModule {
  onInit() {
    this.references = new Map();
    this.context = this.settings.sessionContextId;
    this.browserId = this.browser.browsingContext.browserId;
    WildBuzzardAndroid.register(this.context, this.browserId);
    this.registerListener(["WildBuzzard:Request"]);
    this.ready = WildBuzzardAndroid.init();
  }
  onDestroy() {
    WildBuzzardAndroid.close(this.context, this.browserId);
  }
  async onEvent(event, data, callback) {
    try {
      if (data.request.length > 200000) throw new Error("Request too large");
      const request = JSON.parse(data.request);
      await this.ready;
      const result = await this.request(request);
      const json = JSON.stringify({ result });
      if (json.length > 2000000) throw new Error("Result too large; narrow the page query");
      callback.onSuccess(json);
    } catch (error) {
      callback.onSuccess(JSON.stringify({ error: String(error.message).slice(0, 500) }));
    }
  }
  async request({ method, params = {} }) {
    if (method === "configure") {
      WildBuzzardAndroid.configure(this.context, this.browserId, params);
      return { ready: true };
    }
    if (!commands.has(method)) throw new Error("Unsupported page method");
    const top = this.browser.browsingContext;
    let context = top;
    if (params.frameId) {
      context = BrowsingContext.get(Number(params.frameId));
      if (!context || context.top !== top) throw new Error("Frame is outside this tab");
    }
    const principal = context.currentWindowGlobal?.documentPrincipal;
    if (!principal || principal.isSystemPrincipal || !/^https?:$/.test(principal.URI?.scheme + ":")) {
      throw new Error("Agent page controls are restricted to HTTP and HTTPS documents");
    }
    const args = structuredClone(params);
    delete args.frameId;
    if (method === "act") {
      const decode = value => {
        if (typeof value !== "string" || !this.references.has(value)) throw new Error("Unknown or stale element reference");
        const ref = this.references.get(value);
        const target = BrowsingContext.get(ref.browsingContextId);
        if (!target || target.top !== top || target.currentWindowGlobal.innerWindowId !== ref.innerWindowId) {
          throw new Error("Stale element reference; take another snapshot");
        }
        if (context !== top && target !== context) throw new Error("Element is in another frame");
        context = target;
        return ref.reference;
      };
      if (args.target) args.target = decode(args.target);
      if (args.fields) args.fields = args.fields.map(f => ({ ...f, target: decode(f.target) }));
      // The content actor must not accept caller-supplied raw Gecko node references.
      if (!new Set(["click", "click_at", "hover", "focus", "fill", "type", "type_at", "press", "check", "uncheck", "select", "scroll"]).has(args.kind)) {
        throw new Error("Unsupported action");
      }
    }
    if (method === "wait" || method === "evaluate") {
      args.timeout = Math.min(30000, Math.max(0, Number(args.timeout) || 10000));
      if (method === "wait" && (!args.for || args.for === "time")) args.value = Math.min(30000, Math.max(0, Number(args.value) || 0));
    }
    const result = await context.currentWindowGlobal.getActor("WildBuzzardBrowserControl").sendQuery(method, args);
    if (method === "snapshot") {
      this.references.clear();
      const replace = node => {
        if (!node || typeof node !== "object") return;
        if (node.reference) {
          const ref = node.reference;
          const target = BrowsingContext.get(ref.browsingContextId);
          if (target?.top === top) {
            const id = Services.uuid.generateUUID().toString();
            this.references.set(id, { reference: ref, browsingContextId: target.id, innerWindowId: target.currentWindowGlobal.innerWindowId });
            node.reference = id;
          } else {
            delete node.reference;
          }
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach(replace);
          else if (value && typeof value === "object") replace(value);
        }
      };
      replace(result);
    }
    return result;
  }
}
