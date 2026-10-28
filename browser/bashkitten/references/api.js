/* SPDX-License-Identifier: AGPL-3.0-only */
/* global ExtensionAPI */
this.bashkittenReferences = class extends ExtensionAPI {
  getAPI(context) {
    if (context.extension.id !== "references-host@bashkitten.org") {
      throw new Error("The fixed References host is required.");
    }
    const { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
    return { bashkittenReferences: {
      onResolverRequest: new ExtensionCommon.EventManager({ context, name: "bashkittenReferences.onResolverRequest", register(fire) {
        const observer = (_subject, _topic, data) => fire.async(JSON.parse(data));
        Services.obs.addObserver(observer, "bashkitten-references-resolve");
        return () => Services.obs.removeObserver(observer, "bashkitten-references-resolve");
      } }).api(),
      request(envelope) {
      const win = Services.wm.getMostRecentWindow("navigator:browser");
      if (!win?.BashKittenAgent) throw new Error("Open the owning backend first.");
      return win.BashKittenAgent.referencesRequest(envelope);
    } } };
  }
};
