// SPDX-License-Identifier: GPL-3.0-only
import { GeckoViewActorManager } from "resource://gre/modules/GeckoViewActorManager.sys.mjs";

const views = new WeakMap();
const contextPrefix = "gvctx" + Array.from(new TextEncoder().encode("bashkitten-agent-ui-"),
  byte => byte.toString(16).padStart(2, "0")).join("");

/** Enrollment is supplied by the native host, never by a content document. */
export const BashKittenHost = {
  register() {
    GeckoViewActorManager.addJSWindowActors({
      BashKittenHost: {
        parent: { esModuleURI: "resource://gre/modules/BashKittenHostParent.sys.mjs" },
        child: {
          esModuleURI: "resource://gre/modules/BashKittenHostChild.sys.mjs",
          events: {
            DOMDocElementInserted: {},
            DOMContentLoaded: {},
            pageshow: {},
            BashKittenDraftReady: { wantUntrusted: true },
          },
        },
        allFrames: false,
        matches: ["https://*/*"],
        messageManagerGroups: ["browsers"],
      },
    });
  },

  configure(browser, context, origin) {
    if (!origin) {
      views.delete(browser);
      return;
    }
    const endpoint = new URL(origin);
    if (!String(context).startsWith(contextPrefix) ||
        endpoint.protocol !== "https:" || endpoint.origin !== origin) {
      throw new Error("An enrolled protected Agent origin is required");
    }
    const previous = views.get(browser);
    views.set(browser, {
      context, origin,
      draft: previous?.context === context ? previous.draft : null,
    });
  },

  close(browser) { views.delete(browser); },

  require(windowGlobal) {
    const context = windowGlobal?.browsingContext;
    const browser = context?.top.embedderElement;
    const view = browser && views.get(browser);
    const principal = windowGlobal?.documentPrincipal;
    if (!view || context !== context.top || context.currentWindowGlobal !== windowGlobal ||
        !principal || principal.isSystemPrincipal || !principal.isContentPrincipal ||
        principal.originAttributes.geckoViewSessionContextId !== view.context ||
        principal.URI?.prePath !== view.origin ||
        new URL(windowGlobal.documentURI.spec).pathname !== "/") {
      throw new Error("The selected protected Agent document is required");
    }
    return view;
  },

  async captureDraft(browser) {
    const global = browser.browsingContext.currentWindowGlobal;
    const view = this.require(global);
    const draft = await global.getActor("BashKittenHost").sendQuery("CaptureDraft");
    if (this.require(global) !== view) throw new Error("The selected Agent changed");
    if (draft && typeof draft.text === "string") view.draft = draft;
    return { saved: Boolean(view.draft) };
  },

  async restoreDraft(browser) {
    const global = browser.browsingContext.currentWindowGlobal;
    const view = this.require(global);
    if (!view.draft) return { restored: false };
    if (view.restoring) return view.restoring;
    view.restoring = (async () => {
      const restored = await global.getActor("BashKittenHost").sendQuery("RestoreDraft", view.draft);
      if (this.require(global) !== view) throw new Error("The selected Agent changed");
      if (restored) view.draft = null;
      return { restored: Boolean(restored) };
    })();
    try { return await view.restoring; }
    finally { view.restoring = null; }
  },
};
