// SPDX-License-Identifier: AGPL-3.0-only
/** Static unprivileged document. Authority comes only from its native owner. */
export class AboutSettings {
  QueryInterface = ChromeUtils.generateQI([Ci.nsIAboutModule]);
  getURIFlags() {
    return Ci.nsIAboutModule.URI_SAFE_FOR_UNTRUSTED_CONTENT |
      Ci.nsIAboutModule.URI_MUST_LOAD_IN_CHILD | Ci.nsIAboutModule.ALLOW_SCRIPT |
      Ci.nsIAboutModule.HIDE_FROM_ABOUTABOUT;
  }
  newChannel(uri, loadInfo) {
    // Like about:reader, a non-linkable about content principal loads packaged
    // ES modules through Gecko's chrome-content path, without network CORS.
    const source = Services.io.newURI("chrome://bashkitten-settings/content/index.html");
    const channel = Services.io.newChannelFromURIWithLoadInfo(source, loadInfo);
    channel.originalURI = uri;
    channel.owner = Services.scriptSecurityManager.createContentPrincipal(uri, loadInfo.originAttributes);
    channel.QueryInterface(Ci.nsIWritablePropertyBag2).setPropertyAsInterface("baseURI", source);
    return channel;
  }
}
