/* SPDX-License-Identifier: AGPL-3.0-only */
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";

/** One ordinary login tab, one live guest Pi attempt, one declared callback. */
export async function openProviderLogin({ host, current, request, attemptId, url }) {
  const descriptor = await request("provider-login-describe", { attemptId, url });
  const cancel = () => request("provider-login-cancel", { attemptId, registrationId: descriptor.registrationId }).catch(() => {});
  if (!current()) { await cancel(); throw new Error("The selected Agent changed."); }
  let authorization, redirect;
  try {
    authorization = new URL(descriptor.authorizationUrl); redirect = new URL(descriptor.redirectUri);
    if (descriptor.attemptId !== attemptId || descriptor.method !== "GET" || !descriptor.registrationId ||
        authorization.href !== new URL(url).href || !["http:", "https:"].includes(authorization.protocol) || authorization.username || authorization.password ||
        redirect.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname) ||
        redirect.username || redirect.password || redirect.hash ||
        !Number.isFinite(descriptor.expiresAt) || descriptor.expiresAt <= Date.now() ||
        descriptor.state !== null && typeof descriptor.state !== "string") throw new Error("Invalid provider login callback.");
  } catch { await cancel(); throw new Error("The provider did not supply a supported login callback."); }
  const win = host.win, tabs = win.gBrowser;
  const tab = tabs.addTab("about:blank", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(), userContextId: 0 });
  const browser = tab.linkedBrowser;
  let closed = false, used = false, released = false, settled = false, revoked = false, deadline;
  const show = message => {
    if (!tab.isConnected || win.closed) return;
    // No provider HTML, token, code, callback URL or registration enters a page.
    const text = message.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    browser.loadURI(Services.io.newURI("data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>Provider login</title><main><h1>Provider login</h1><p>${text}</p><p>Return to BashKitten’s Providers settings.</p></main>`)), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  };
  const release = () => {
    if (released) return; released = true; clearTimeout(deadline);
    Services.obs.removeObserver(observer, "http-on-opening-request");
    tab.removeEventListener("TabClose", onClose);
    win.removeEventListener("unload", onUnload);
    host.providerLogins.delete(owner);
  };
  const finish = (message, abort = false) => {
    // Receiving the callback is not completing Pi's asynchronous token exchange.
    // Closing/changing owner must still revoke a pending exchange after the
    // confirmation page appeared; completed attempts are backend no-ops.
    if (abort && !settled && !revoked) { revoked = true; void cancel(); }
    if (closed) return; closed = true; clearTimeout(deadline);
    // Keep the exact one-use callback blocked until this ordinary tab closes.
    // A late redirect must not leak through to a host loopback listener.
    if (message) show(message);
  };
  const owner = { cancel: () => finish("Sign-in was cancelled because its Agent context changed.", true) };
  const onClose = () => { finish(null, true); release(); };
  const onUnload = () => { finish(null, true); release(); };
  const observer = {
    observe(subject) {
      const channel = subject.QueryInterface(Ci.nsIHttpChannel), info = channel.loadInfo;
      const browsing = info.browsingContext || BrowsingContext.get(info.browsingContextID || 0);
      // COOP can replace a tab's top BrowsingContext during provider navigation.
      // The enrolled tab/browser stays the owner; use its current top context.
      if (tab.linkedBrowser !== browser || !tab.isConnected || !browsing ||
          browsing !== browser.browsingContext || browsing !== browsing.top ||
          info.externalContentPolicyType !== Ci.nsIContentPolicy.TYPE_DOCUMENT) return;
      let callback;
      try { callback = new URL(channel.URI.spec); } catch { return; }
      if (callback.origin !== redirect.origin || callback.pathname !== redirect.pathname) return;
      // Intercept before any host loopback request, including invalid/repeated
      // callbacks. Only the fixed, live guest attempt can receive the URL.
      channel.cancel(Cr.NS_BINDING_ABORTED);
      if (used || closed) return;
      used = true;
      const fixedQuery = [...redirect.searchParams.keys()].every(key => JSON.stringify(callback.searchParams.getAll(key)) === JSON.stringify(redirect.searchParams.getAll(key)));
      const validState = descriptor.state === null || callback.searchParams.getAll("state").length === 1 && callback.searchParams.get("state") === descriptor.state;
      if (!current() || Date.now() >= descriptor.expiresAt || channel.requestMethod !== "GET" || callback.username || callback.password || callback.hash || !fixedQuery || !validState) {
        finish("This sign-in response no longer matches its Agent login attempt.", true); return;
      }
      void request("provider-login-callback", { attemptId, registrationId: descriptor.registrationId, url: callback.href }).then(result => {
        if (!current()) { finish("The Agent context changed before sign-in finished.", true); return; }
        settled = ["complete", "failed", "cancelled"].includes(result.status);
        finish(result.ok && result.status !== "failed" ? "The provider response was accepted by this container’s Pi. Check Providers for the final sign-in result." : "The provider sign-in failed. Check Providers for details.");
      }, () => finish("The provider response could not be delivered to its live Agent login. Check Providers and try again.", true));
    },
  };
  host.providerLogins.add(owner);
  Services.obs.addObserver(observer, "http-on-opening-request");
  tab.addEventListener("TabClose", onClose, { once: true });
  win.addEventListener("unload", onUnload, { once: true });
  deadline = setTimeout(() => finish("This sign-in attempt expired. Start again in Providers.", true), descriptor.expiresAt - Date.now());
  try {
    browser.loadURI(Services.io.newURI(authorization.href), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    tabs.selectedTab = tab; host.browse();
  } catch (error) { finish(null, true); release(); tabs.removeTab(tab); throw error; }
  return { ok: true };
}
