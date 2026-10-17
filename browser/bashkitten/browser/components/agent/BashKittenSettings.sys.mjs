/* SPDX-License-Identifier: AGPL-3.0-only */
export const SETTINGS_URI = "about:bashkitten-settings";
const views = new WeakMap();
let registered = false;
const allowed = {
  licenses: new Set(["localai-status", "localai-open-record", "native-models-catalogue"]),
  localai: new Set(["clipboard-copy", "project-root", "localai-status", "localai-save", "localai-model-use", "localai-synthesize", "localai-synthesis-cancel", "localai-quantize", "localai-ini", "localai-browse", "localai-router-models", "localai-router-model-save", "localai-router-model-test", "localai-router-model-test-status", "localai-router-model-test-cancel", "localai-check", "localai-install", "localai-cancel", "localai-action", "localai-refresh", "native-models-status", "native-models-catalogue", "native-models-preset", "native-models-settings", "native-models-search", "native-models-repository", "native-models-download", "native-models-action"]),
  notifications: new Set(["phone-status", "phone-share"]),
  telephone: new Set(["phone-status", "phone-share"]),
  performance: new Set(["performance-sample", "performance-close"]),
  autostart: new Set(["autostart.get", "autostart.set", "autostart.commands.save"]),
  remotes: new Set(["remotes.list", "remotes.connect", "remotes.disconnect", "remotes.remove", "remotes.rename", "remotes.enroll", "remotes.services", "remotes.save-mapping", "remotes.service-key", "remotes.service-action", "remotes.open-service", "remotes.copy-service", "remotes.allow-browser", "remotes.revoke-browser", "remotes.share-local", "remotes.local-autostart", "remotes.autostart"]),
  "share-local": new Set(["share-status", "share-setup", "share-reissue", "share-confirm", "share-cancel", "share-publish", "share-startup", "share-files", "service-status", "service-save", "service-remove", "service-action", "localai-share", "share-save-qr", "share-open-authenticator", "share-open-localai"]),
  machine: new Set(["machines.get", "machines.save", "machines.start", "machines.stop", "machines.restart", "machines.retry", "machines.delete", "machines.operation", "machines.cancel", "machines.media-devices", "machines.display-capabilities", "machines.connect-phone", "machines.share-local"]),
};

/** Authority belongs to the native view enrollment, never to a URL alone. */
export const BashKittenSettings = {
  enroll(browser, record) {
    if (!allowed[record.info.section]) throw new Error("Unknown settings section.");
    if (!registered) {
      ChromeUtils.registerWindowActor("BashKittenSettings", {
        parent: { esModuleURI: "resource:///modules/BashKittenSettingsParent.sys.mjs" },
        child: { esModuleURI: "resource:///modules/BashKittenSettingsChild.sys.mjs", events: { DOMDocElementInserted: {}, pagehide: {} } },
        allFrames: false, matches: [SETTINGS_URI], messageManagerGroups: ["bashkitten-settings"],
      });
      registered = true;
    }
    views.set(browser, record);
    return () => this.revoke(browser, record);
  },
  revoke(browser, record = views.get(browser)) {
    if (!record || views.get(browser) !== record) return;
    views.delete(browser);
    try { record.actor?.sendAsyncMessage("Closed"); } catch {}
    record.cleanup?.();
  },
  record(actor) {
    const context = actor.browsingContext, browser = context?.embedderElement;
    const record = browser && views.get(browser), principal = actor.manager.documentPrincipal;
    if (!record || context !== context.top || actor.manager !== context.currentWindowGlobal ||
        !actor.manager.isCurrentGlobal || actor.manager.documentURI.spec !== SETTINGS_URI ||
        !principal?.isContentPrincipal || principal.originNoSuffix !== SETTINGS_URI ||
        !browser.isConnected || !record.current()) throw new Error("This settings view is no longer active.");
    return record;
  },
  async receive(actor, name, data) {
    const record = this.record(actor);
    if (name === "Info") {
      if (record.actor && record.actor !== actor) throw new Error("Settings document changed.");
      record.actor = actor;
      return record.info;
    }
    if (record.actor !== actor) throw new Error("Open settings from the BashKitten gear.");
    if (name === "Pause") { record.pause?.(); return { ok: true }; }
    if (name !== "Call" || typeof data?.name !== "string" || !data.args || typeof data.args !== "object" || Array.isArray(data.args)) throw new Error("Invalid settings request.");
    if (data.name === "settings-close") { record.close(); return { ok: true }; }
    if (!allowed[record.info.section].has(data.name)) throw new Error("This operation is unavailable in this settings section.");
    const result = await record.call(data.name, data.args);
    // Closing or changing the owning backend invalidates late responses too.
    if (this.record(actor) !== record) throw new Error("The settings owner changed.");
    return result;
  },
  notify(browser, name, value) {
    const record = views.get(browser);
    if (record?.current()) { try { record.actor?.sendAsyncMessage("Update", { name, value }); } catch {} }
  },
  actorDestroyed(actor) {
    const browser = actor.browsingContext?.embedderElement, record = browser && views.get(browser);
    if (record?.actor === actor) this.revoke(browser, record);
  },
};
