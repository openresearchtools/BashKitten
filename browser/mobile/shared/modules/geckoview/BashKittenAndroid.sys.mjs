// SPDX-License-Identifier: AGPL-3.0-or-later
import { BashKittenBlockerStartup } from "resource:///modules/BashKittenBlockerStartup.sys.mjs";
import { BashKittenBlockerService } from "resource:///modules/BashKittenBlockerService.sys.mjs";

const proxy = Cc["@mozilla.org/network/protocol-proxy-service;1"].getService(Ci.nsIProtocolProxyService);
const certificates = Cc["@mozilla.org/security/certoverride;1"].getService(Ci.nsICertOverrideService);
const routes = new Map();
const contexts = new Map();
let ready;
const contextPrefix = value => "gvctx" + Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2, "0")).join("");
const serviceContext = value => String(value).startsWith(contextPrefix("bashkitten-service-"));
const torContext = value => String(value).startsWith(contextPrefix("bashkitten-tor-"));
const localHost = host => host === "localhost" || host.endsWith(".localhost") ||
  host.endsWith(".local") || /^(?:127|10|0)\./.test(host) || /^169\.254\./.test(host) ||
  /^192\.168\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) ||
  /^\[?(?:::|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(host);

export const BashKittenAndroid = {
  init() {
    if (!ready) {
      for (const name of ["devtools.debugger.remote-enabled", "marionette.enabled", "remote.enabled"]) {
        Services.prefs.getDefaultBranch("").setBoolPref(name, false);
        Services.prefs.lockPref(name);
      }
      // Isolated agent chats must not inherit another chat's site-wide click cooldown.
      Services.prefs.getDefaultBranch("").setIntPref("cookiebanners.bannerClicking.maxTriesPerSiteAndSession", 0);
      Services.prefs.lockPref("cookiebanners.bannerClicking.maxTriesPerSiteAndSession");
      proxy.registerChannelFilter(this, 0);
      BashKittenBlockerStartup.init();
      ready = BashKittenBlockerService.whenEngineReady().then(() => {
        if (!BashKittenBlockerService._engine) throw new Error("Native blocker could not initialize");
      });
    }
    return ready;
  },
  register(context, browserId) {
    if (!contexts.has(context)) contexts.set(context, new Set());
    contexts.get(context).add(browserId);
  },
  configure(context, browserId, { tor = false, port = 0, identities = [], adblock = true, proxySecret = "", serviceRoute = null, agentHost = "" }) {
    if (!context) throw new Error("Missing isolated session context");
    const service = serviceContext(context);
    if (agentHost && (!String(context).startsWith(contextPrefix("bashkitten-agent-ui-")) ||
        !/^[a-z2-7]{56}\.onion$/.test(agentHost))) throw new Error("Invalid protected Agent route");
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid Tor port");
    if (tor && port && !/^[A-Za-z0-9_-]{43}$/.test(proxySecret)) throw new Error("Missing Tor proxy authentication");
    if (!Array.isArray(identities) || identities.some(h => !/^[a-z2-7]{56}\.onion$/.test(h))) {
      throw new Error("Invalid authenticated onion identity");
    }
    if (service && (tor || identities.length) || !service && serviceRoute) {
      throw new Error("Mapped services require their own ordinary storage context");
    }
    if (serviceRoute && (!Number.isInteger(serviceRoute.mappedPort) ||
        serviceRoute.mappedPort < 1 || serviceRoute.mappedPort > 65535)) {
      throw new Error("Invalid native service mapping");
    }
    // Only the native session dispatcher calls configure, outside the public
    // page/control command allowlist. The storage identity survives restoration.
    const previous = routes.get(context);
    if ((previous?.tor || torContext(context)) && !tor) throw new Error("Tor route is immutable for this tab");
    BashKittenBlockerService.setAndroidTabBlocking(browserId, adblock);
    const nextIdentities = tor && port ? identities : [];
    for (const host of previous?.identities ?? []) {
      if (!nextIdentities.includes(host)) certificates.setAuthenticatedOnion(context, host, false);
    }
    const next = { tor, port, proxySecret, identities: nextIdentities, serviceRoute, agentHost: agentHost || previous?.agentHost || "" };
    routes.set(context, next);
    for (const host of nextIdentities) {
      if (!previous?.identities.includes(host)) certificates.setAuthenticatedOnion(context, host, true);
    }
    if (previous && JSON.stringify(previous) !== JSON.stringify(next)) {
      Services.obs.notifyObservers(null, "net:prune-all-connections");
    }
  },
  close(context, browserId) {
    BashKittenBlockerService.setAndroidTabBlocking(browserId, true);
    const members = contexts.get(context);
    members?.delete(browserId);
    if (members?.size) return;
    contexts.delete(context);
    const previous = routes.get(context);
    for (const host of previous?.identities ?? []) certificates.setAuthenticatedOnion(context, host, false);
    // Keep a dead route for residual workers/requests until process termination.
    if (serviceContext(context)) routes.set(context, { tor: false, serviceRoute: null });
    else if (previous?.tor || torContext(context)) routes.set(context, { tor: true, port: 0, identities: [], agentHost: previous?.agentHost });
    else routes.delete(context);
  },
  applyFilter(channel, original, callback) {
    const context = channel.loadInfo?.originAttributes?.geckoViewSessionContextId;
    const route = routes.get(context);
    let host = "";
    try { host = channel.URI.asciiHost.toLowerCase().replace(/\.$/, ""); } catch (_) {}
    const mapped = serviceContext(context);
    if (mapped && !route?.serviceRoute) {
      channel.cancel(Cr.NS_ERROR_CONNECTION_REFUSED);
      callback.onProxyFilterResult(original);
      return;
    }
    if ((context && !route) || route?.tor || torContext(context) || host.endsWith(".onion")) {
      const protectedHost = !route?.agentHost && [...routes.values()].some(item => item.agentHost &&
        (host === item.agentHost || host.endsWith(`.${item.agentHost}`)));
      const blocked = protectedHost || localHost(host);
      const port = !blocked && route?.tor ? route?.port : 0;
      callback.onProxyFilterResult(proxy.newProxyInfoWithAuth(
        "socks", "127.0.0.1", port || 9,
        context || "blocked", route?.proxySecret || "blocked", "", context || "blocked",
        Ci.nsIProxyInfo.TRANSPARENT_PROXY_RESOLVES_HOST, 10, null
      ));
    } else {
      callback.onProxyFilterResult(original);
    }
  },
};
