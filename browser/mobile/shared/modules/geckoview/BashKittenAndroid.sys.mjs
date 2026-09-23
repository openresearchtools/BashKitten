// SPDX-License-Identifier: AGPL-3.0-or-later
import { BashKittenBlockerStartup } from "resource:///modules/BashKittenBlockerStartup.sys.mjs";
import { BashKittenBlockerService } from "resource:///modules/BashKittenBlockerService.sys.mjs";

const proxy = Cc["@mozilla.org/network/protocol-proxy-service;1"].getService(Ci.nsIProtocolProxyService);
const certificates = Cc["@mozilla.org/security/certoverride;1"].getService(Ci.nsICertOverrideService);
const routes = new Map();
const contexts = new Map();
let ready;

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
      Services.obs.addObserver(this, "http-on-modify-request");
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
  configure(context, browserId, { tor = false, port = 0, identities = [], adblock = true, proxySecret = "", blockedParentHost = "" }) {
    if (!context) throw new Error("Missing isolated session context");
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid Tor port");
    if (tor && port && !/^[A-Za-z0-9_-]{43}$/.test(proxySecret)) throw new Error("Missing Tor proxy authentication");
    if (identities.length > 64 || identities.some(h => !/^[a-z2-7]{56}\.onion$/.test(h))) {
      throw new Error("Invalid authenticated onion identity");
    }
    if (blockedParentHost && (!tor || !/^[a-z2-7]{56}\.onion$/.test(blockedParentHost) || identities.length)) {
      throw new Error("Hosted websites require an exact enrolled onion route");
    }
    // Revoke before changing routes. Never convert a Tor context into a direct context.
    BashKittenBlockerService.setAndroidTabBlocking(browserId, adblock);
    const previous = routes.get(context);
    if (previous?.tor && !tor) throw new Error("Tor route is immutable for this tab");
    if (previous?.blockedParentHost && previous.blockedParentHost !== blockedParentHost) {
      throw new Error("The hosted Agent boundary is immutable for this tab");
    }
    const nextIdentities = tor && port ? identities : [];
    for (const host of previous?.identities ?? []) {
      if (!nextIdentities.includes(host)) certificates.setAuthenticatedOnion(context, host, false);
    }
    routes.set(context, { tor, port, proxySecret, identities: nextIdentities, blockedParentHost });
    for (const host of nextIdentities) {
      if (!previous?.identities.includes(host)) certificates.setAuthenticatedOnion(context, host, true);
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
    if (previous?.tor) routes.set(context, { tor: true, port: 0, identities: [], blockedParentHost: previous.blockedParentHost });
    else routes.delete(context);
  },
  observe(subject, topic) {
    if (topic !== "http-on-modify-request") return;
    const channel = subject.QueryInterface(Ci.nsIHttpChannel);
    const route = routes.get(channel.loadInfo.originAttributes.geckoViewSessionContextId);
    if (!route?.blockedParentHost) return;
    const host = channel.URI.asciiHost.toLowerCase().replace(/\.$/, "");
    // Gecko canonicalizes IPv4 aliases and IPv6 before this check. Also cover
    // localhost names and IPv4-mapped loopback without relying on proxy prefs.
    const loopback = host === "localhost" || host.endsWith(".localhost") ||
      /^127\./.test(host) || host === "::1" || host === "[::1]" ||
      /^\[?::ffff:(?:127\.|7f[0-9a-f]{2}:)/.test(host);
    if (route.blockedParentHost === host || loopback) {
      // Includes redirects, subframes, workers, fetch and WebSocket handshakes.
      // Native navigation sends top-level sign-in back to the protected view.
      channel.cancel(Cr.NS_BINDING_ABORTED);
    }
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
