// SPDX-License-Identifier: AGPL-3.0-only
import { GeckoViewActorManager } from "resource://gre/modules/GeckoViewActorManager.sys.mjs";

const views = new WeakMap();
const prefix = "gvctx" + Array.from(new TextEncoder().encode("bashkitten-settings-"), byte => byte.toString(16).padStart(2, "0")).join("");
export const SETTINGS_URI = "about:bashkitten-settings";
const names = value => new Set(value.split(" "));
const sections = {
  licenses: names("localai-status localai-open-record native-models-catalogue"),
  autostart: names("autostart.get autostart.set autostart.commands.save"),
  updates: names("updates.snapshot updates.check updates.channel updates.download updates.packages updates.cancel updates.inventory"),
  localai: names("localai-setup localai-status localai-save localai-model-use localai-synthesize localai-synthesis-cancel localai-quantize localai-ini localai-browse localai-router-models localai-router-model-save localai-router-model-test localai-router-model-test-status localai-router-model-test-cancel localai-check localai-install localai-cancel localai-action native-models-status native-models-catalogue native-models-preset native-models-settings native-models-search native-models-repository native-models-download native-models-action clipboard-copy"),
  notifications: names("turn-notification-settings snapshot configure notification-permission android-auto android-auto-settings"),
  telephone: names("snapshot configure setup-account readiness call contact divert clear-voicemail microphone-permission open-voice-settings"),
  "phone-use": names("snapshot set-master set-feature accessibility-settings notification-settings location-permission add-location set-location remove-location"),
  remotes: names("remotes.list remotes.connect remotes.disconnect remotes.remove remotes.rename remotes.enroll remotes.services remotes.save-mapping remotes.service-key remotes.service-action remotes.open-service remotes.copy-service remotes.share-local"),
  performance: names("performance-sample performance-close"),
  display: names("display-status display-start display-stop display-save display-open display-copy display-setup"),
  "share-local": names("share-status share-setup share-reissue share-confirm share-cancel share-publish share-startup share-files service-status service-save service-remove service-action localai-share share-save-qr share-open-authenticator share-open-localai share-local-setup"),
};

export const BashKittenSettings = {
  isContext(context) { return String(context).startsWith(prefix); },
  register() {
    GeckoViewActorManager.addJSWindowActors({ BashKittenSettings: {
      parent: { esModuleURI: "resource://gre/modules/BashKittenSettingsParent.sys.mjs" },
      child: { esModuleURI: "resource://gre/modules/BashKittenSettingsChild.sys.mjs", events: { DOMContentLoaded: {}, pageshow: {} } },
      allFrames: false, matches: [SETTINGS_URI], messageManagerGroups: ["browsers"],
    } });
  },
  configure(browser, context, { section, info }) {
    if (!this.isContext(context) || !Object.hasOwn(sections, section) || !info || info.section !== section) throw new Error("Native settings section required");
    if (views.has(browser)) throw new Error("Settings section is immutable");
    views.set(browser, { context, section, info: structuredClone(info), visible: true });
    return true;
  },
  visible(browser, visible) { const view = views.get(browser); if (view) view.visible = visible === true; return true; },
  close(browser) { views.delete(browser); },
  require(global, responseTo = null) {
    const context = global?.browsingContext, browser = context?.top.embedderElement;
    const view = browser && views.get(browser), principal = global?.documentPrincipal;
    // A native action may open Android Settings. Its response still belongs to
    // this exact document, but only new actions require foreground visibility.
    if (!view || (responseTo ? view !== responseTo : !view.visible) || context !== context.top || context.currentWindowGlobal !== global ||
        !principal?.isContentPrincipal || principal.isSystemPrincipal ||
        principal.originAttributes.geckoViewSessionContextId !== view.context ||
        global.documentURI?.spec !== SETTINGS_URI || principal.URI?.spec !== SETTINGS_URI) {
      throw new Error("The active native settings document is required");
    }
    return view;
  },
  allows(view, command) { return command === "settings-close" || sections[view.section].has(command); },
  event(browser, data) {
    const global = browser.browsingContext.currentWindowGlobal;
    this.require(global);
    global.getActor("BashKittenSettings").sendAsyncMessage("Event", data);
    return true;
  },
};
