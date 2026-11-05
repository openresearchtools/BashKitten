/* SPDX-License-Identifier: AGPL-3.0-only */
/* global ExtensionAPI */
this.taskarianReferences = class extends ExtensionAPI {
  getAPI(context) {
    if (context.extension.id !== "references-host@taskarian.org") {
      throw new Error("The fixed References host is required.");
    }
    const { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
    return { taskarianReferences: {
      onResolverRequest: new ExtensionCommon.EventManager({ context, name: "taskarianReferences.onResolverRequest", register(fire) {
        const observer = (_subject, _topic, data) => fire.async(JSON.parse(data));
        Services.obs.addObserver(observer, "taskarian-references-resolve");
        return () => Services.obs.removeObserver(observer, "taskarian-references-resolve");
      } }).api(),
      request(envelope) {
      const { BrowserControlChannel } = ChromeUtils.importESModule("resource:///modules/BrowserControlChannel.sys.mjs");
      if (BrowserControlChannel.guestRequested) return BrowserControlChannel.guestReferencesRequest(envelope);
      const win = Services.wm.getMostRecentWindow("navigator:browser");
      if (!win?.TaskarianAgent) throw new Error("Open the owning backend first.");
      return win.TaskarianAgent.referencesRequest(envelope);
    } } };
  }
};
