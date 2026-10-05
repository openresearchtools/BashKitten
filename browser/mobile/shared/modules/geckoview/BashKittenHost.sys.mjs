// SPDX-License-Identifier: AGPL-3.0-only
import { BashKittenDrafts } from "resource://gre/modules/BashKittenDrafts.sys.mjs";
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
            // The page dispatches this non-bubbling event on its window.
            // Actor listeners live above it on the chrome event target.
            BashKittenDraftReady: { capture: true, wantUntrusted: true },
            BashKittenDraftChanged: { capture: true, wantUntrusted: true },
          },
        },
        allFrames: false,
        matches: ["https://*/*"],
        messageManagerGroups: ["browsers"],
      },
    });
  },

  configure(browser, context, origin, identity) {
    if (!origin) {
      views.delete(browser);
      return;
    }
    const endpoint = new URL(origin);
    if (!String(context).startsWith(contextPrefix) ||
        endpoint.protocol !== "https:" || endpoint.origin !== origin || !/^[a-f0-9]{64}$/.test(identity)) {
      throw new Error("An enrolled protected Agent origin is required");
    }
    const previous = views.get(browser);
    // Status refreshes can reapply the same enrollment while a draft query is
    // in flight. Keep its identity and pending restore operation intact.
    if (previous?.context === context && previous.origin === origin && previous.identity === identity) {
      previous.suspended = false;
      return;
    }
    views.set(browser, {
      context, origin, identity,
      draft: previous?.context === context && previous.identity === identity ? previous.draft : null,
    });
  },

  close(browser) { views.delete(browser); },

  suspend(browser) {
    const view = views.get(browser);
    if (view) view.suspended = true;
  },

  require(windowGlobal) {
    const context = windowGlobal?.browsingContext;
    const browser = context?.top.embedderElement;
    const view = browser && views.get(browser);
    const principal = windowGlobal?.documentPrincipal;
    if (!view || view.suspended || context !== context.top || context.currentWindowGlobal !== windowGlobal ||
        !principal || principal.isSystemPrincipal || !principal.isContentPrincipal ||
        principal.originAttributes.geckoViewSessionContextId !== view.context ||
        principal.URI?.prePath !== view.origin ||
        new URL(windowGlobal.documentURI.spec).pathname !== "/") {
      throw new Error("The selected protected Agent document is required");
    }
    return view;
  },

  enrollment(global, view) {
    if (this.require(global) !== view) throw new Error("The selected Agent changed");
    return { identity: view.identity, attributes: { geckoViewSessionContextId: view.context } };
  },

  captureDraft(browser) {
    const global = browser.browsingContext.currentWindowGlobal;
    const view = this.require(global);
    const actor = global.getActor("BashKittenHost");
    actor.draftDirty = true;
    if (!actor.saving) actor.saving = Promise.resolve().then(async () => {
      try {
        do {
          actor.draftDirty = false;
          this.enrollment(global, view);
          const draft = await actor.sendQuery("CaptureDraft");
          if (!draft) return { saved: false };
          await BashKittenDrafts.save(() => this.enrollment(global, view), draft);
          view.draft = draft;
        } while (actor.draftDirty);
        return { saved: true };
      } finally { actor.saving = null; }
    });
    return actor.saving;
  },

  async restoreDraft(browser) {
    const global = browser.browsingContext.currentWindowGlobal;
    const view = this.require(global);
    if (view.restoredGlobal === global) return { restored: false };
    if (view.restoring) return view.restoring;
    view.restoring = (async () => {
      const draft = view.draft || await BashKittenDrafts.load(() => this.enrollment(global, view));
      this.enrollment(global, view);
      const restored = draft && await global.getActor("BashKittenHost").sendQuery("RestoreDraft", draft);
      if (this.require(global) !== view) throw new Error("The selected Agent changed");
      view.restoredGlobal = global;
      if (restored) view.draft = null;
      return { restored: Boolean(restored) };
    })();
    try { return await view.restoring; }
    finally { view.restoring = null; }
  },
};
