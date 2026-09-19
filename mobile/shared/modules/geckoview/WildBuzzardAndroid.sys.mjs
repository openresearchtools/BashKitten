// SPDX-License-Identifier: AGPL-3.0-or-later
import { WildBuzzardBlockerStartup } from "resource:///modules/WildBuzzardBlockerStartup.sys.mjs";
import { WildBuzzardBlockerService } from "resource:///modules/WildBuzzardBlockerService.sys.mjs";

const proxy = Cc["@mozilla.org/network/protocol-proxy-service;1"].getService(Ci.nsIProtocolProxyService);
const certificates = Cc["@mozilla.org/security/certoverride;1"].getService(Ci.nsICertOverrideService);
const routes = new Map();
let ready;

export const WildBuzzardAndroid = {
  init() {
    if (!ready) {
      proxy.registerChannelFilter(this, 0);
      WildBuzzardBlockerStartup.init();
      ready = WildBuzzardBlockerService.whenEngineReady().then(() => {
        if (!WildBuzzardBlockerService._engine) throw new Error("Native blocker could not initialize");
      });
    }
    return ready;
  },
  configure(context, { tor = false, port = 0, identities = [], adblock = true, proxySecret = "" }) {
    if (!context) throw new Error("Missing isolated session context");
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid Tor port");
    if (tor && port && !/^[A-Za-z0-9_-]{43}$/.test(proxySecret)) throw new Error("Missing Tor proxy authentication");
    if (identities.length > 64 || identities.some(h => !/^[a-z2-7]{56}\.onion$/.test(h))) {
      throw new Error("Invalid authenticated onion identity");
    }
    // Revoke before changing routes. Never convert a Tor context into a direct context.
    WildBuzzardBlockerService.setSessionBlocking(context, adblock);
    const previous = routes.get(context);
    if (previous?.tor && !tor) throw new Error("Tor route is immutable for this tab");
    const nextIdentities = tor && port ? identities : [];
    for (const host of previous?.identities ?? []) {
      if (!nextIdentities.includes(host)) certificates.setAuthenticatedOnion(context, host, false);
    }
    routes.set(context, { tor, port, proxySecret, identities: nextIdentities });
    for (const host of nextIdentities) {
      if (!previous?.identities.includes(host)) certificates.setAuthenticatedOnion(context, host, true);
    }
  },
  close(context) {
    WildBuzzardBlockerService.setSessionBlocking(context, true);
    const previous = routes.get(context);
    for (const host of previous?.identities ?? []) certificates.setAuthenticatedOnion(context, host, false);
    // Keep a dead route for residual workers/requests until process termination.
    if (previous?.tor) routes.set(context, { tor: true, port: 0, identities: [] });
    else routes.delete(context);
  },
  applyFilter(channel, original, callback) {
    const context = channel.loadInfo?.originAttributes?.geckoViewSessionContextId;
    const route = routes.get(context);
    let host = "";
    try { host = channel.URI.asciiHost; } catch (_) {}
    // Onion DNS must never escape even from a direct tab's subresources.
    if ((context && !route) || route?.tor || host.endsWith(".onion")) {
      callback.onProxyFilterResult(proxy.newProxyInfoWithAuth(
        "socks", "127.0.0.1", route?.tor && route.port ? route.port : 1,
        context || "blocked", route?.proxySecret || "blocked", "", context || "blocked",
        Ci.nsIProxyInfo.TRANSPARENT_PROXY_RESOLVES_HOST, 1, null
      ));
    } else {
      callback.onProxyFilterResult(original);
    }
  },
};
