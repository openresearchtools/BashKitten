// SPDX-License-Identifier: AGPL-3.0-or-later
import { GeckoViewModule } from "resource://gre/modules/GeckoViewModule.sys.mjs";
import { BashKittenHost } from "resource://gre/modules/BashKittenHost.sys.mjs";
import { BashKittenAndroid } from "resource://gre/modules/BashKittenAndroid.sys.mjs";

const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
const { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");

const certificates = Cc["@mozilla.org/security/certoverride;1"].getService(Ci.nsICertOverrideService);
const certDB = Cc["@mozilla.org/security/x509certdb;1"].getService(Ci.nsIX509CertDB);
const contextPrefix = value => "gvctx" + Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2, "0")).join("");
const protectedContext = value => String(value).startsWith(contextPrefix("bashkitten-agent-ui-"));

const commands = new Set(["snapshot", "act", "read", "evaluate", "wait", "console", "clearConsole", "viewport", "diagnostics"]);

export class GeckoViewBashKitten extends GeckoViewModule {
  onInit() {
    BashKittenHost.register();
    this.references = new Map();
    this.agentRequests = new Set();
    this.context = this.settings.sessionContextId;
    this.browserId = this.browser.browsingContext.browserId;
    BashKittenAndroid.register(this.context, this.browserId);
    this.registerListener(["BashKitten:Request"]);
    this.ready = BashKittenAndroid.init();
  }
  onDestroy() {
    BashKittenHost.close(this.browser);
    for (const channel of this.agentRequests) channel.cancel(Cr.NS_BINDING_ABORTED);
    this.agentRequests.clear();
    if (this.agentHost) certificates.clearAgentCA(this.agentHost, { geckoViewSessionContextId: this.context });
    BashKittenAndroid.close(this.context, this.browserId);
  }
  async onEvent(event, data, callback) {
    try {
      if (data.request.length > 33 * 1024 * 1024) throw new Error("Request too large");
      const request = JSON.parse(data.request);
      if (data.request.length > 200000 && !(protectedContext(this.context) && request.method === "agent.request" &&
          request.params?.path === "/api/browser-channel/result")) throw new Error("Request too large");
      await this.ready;
      const result = await this.request(request);
      const json = JSON.stringify({ result });
      if (json.length > 2000000) throw new Error("Result too large; narrow the page query");
      callback.onSuccess(json);
    } catch (error) {
      callback.onSuccess(JSON.stringify({ error: String(error.message).slice(0, 500) }));
    }
  }
  async request({ method, params = {} }) {
    if (method === "configure") {
      BashKittenAndroid.configure(this.context, this.browserId, params);
      return { ready: true };
    }
    if (method.startsWith("agent.")) {
      if (!protectedContext(this.context)) throw new Error("Protected Agent context required");
      if (method === "agent.cancel") {
        for (const channel of this.agentRequests) channel.cancel(Cr.NS_BINDING_ABORTED);
        this.agentRequests.clear();
        return true;
      }
      if (method === "agent.captureDraft") return BashKittenHost.captureDraft(this.browser);
      if (method === "agent.restoreDraft") return BashKittenHost.restoreDraft(this.browser);
      if (method === "agent.configure") return this.configureAgent(params);
      if (method === "agent.enroll") return this.enrollAgent(params);
      if (method !== "agent.request") throw new Error("Unsupported Agent method");
      return this.agentRequest(params);
    }
    if (protectedContext(this.context)) throw new Error("Agent views cannot be controlled");
    if (!commands.has(method)) throw new Error("Unsupported page method");
    const top = this.browser.browsingContext;
    let context = top;
    if (params.frameId) {
      context = BrowsingContext.get(Number(params.frameId));
      if (!context || context.top !== top) throw new Error("Frame is outside this tab");
    }
    const windowGlobal = context.currentWindowGlobal;
    const principal = windowGlobal?.documentPrincipal;
    const webDocument = /^https?$/.test(principal?.URI?.scheme);
    const webPdf = principal?.spec === "resource://pdf.js/web/viewer.html" &&
      /^https?$/.test(windowGlobal.documentURI?.scheme);
    if (!principal || principal.isSystemPrincipal || (!webDocument && !webPdf)) {
      throw new Error("Agent page controls are restricted to HTTP and HTTPS documents and their PDF viewer");
    }
    if (method === "diagnostics") {
      const evaluated = await context.currentWindowGlobal.getActor("BashKittenBrowserControl").sendQuery("evaluate", {
        code: "return navigator.webdriver;", timeout: 10000,
      });
      return {
        transport: "browser-native", devtoolsRemoteEnabled: Services.prefs.getBoolPref("devtools.debugger.remote-enabled", false),
        marionetteEnabled: Services.prefs.getBoolPref("marionette.enabled", false),
        remoteAgentEnabled: Services.prefs.getBoolPref("remote.enabled", false),
        engineAccessibilityEnabled: Services.appinfo.accessibilityEnabled,
        snapshotBackend: "dom", webdriver: evaluated.value,
      };
    }
    const args = structuredClone(params);
    if (method === "snapshot") {
      args.domOnly = true;
      args.maxNodes = Math.min(200, Math.max(1, Number(args.maxNodes) || 200));
      args.maxBytes = 60000;
    }
    delete args.frameId;
    if (method === "act" || method === "snapshot") {
      const decode = value => {
        if (typeof value !== "string" || !this.references.has(value)) throw new Error("Unknown or stale element reference");
        const ref = this.references.get(value);
        const target = BrowsingContext.get(ref.browsingContextId);
        if (!target || target.top !== top || target.currentWindowGlobal.innerWindowId !== ref.innerWindowId) {
          throw new Error("Stale element reference; take another snapshot");
        }
        if (context !== top && target !== context) throw new Error("Element is in another frame");
        context = target;
        return ref.reference;
      };
      if (args.target) args.target = decode(args.target);
      if (method === "act" && args.fields) args.fields = args.fields.map(f => ({ ...f, target: decode(f.target) }));
      // The content actor must not accept caller-supplied raw Gecko node references.
      if (method === "act" && !new Set(["click", "click_at", "hover", "focus", "fill", "type", "type_at", "press", "check", "uncheck", "select", "scroll"]).has(args.kind)) {
        throw new Error("Unsupported action");
      }
    }
    if (method === "wait" || method === "evaluate") {
      args.timeout = Math.min(30000, Math.max(0, Number(args.timeout) || 10000));
      if (method === "wait" && (!args.for || args.for === "time")) args.value = Math.min(30000, Math.max(0, Number(args.value) || 0));
    }
    const result = await context.currentWindowGlobal.getActor("BashKittenBrowserControl").sendQuery(method, args);
    if (method === "snapshot") {
      this.references.clear();
      const replace = node => {
        if (!node || typeof node !== "object") return;
        if (node.reference) {
          const ref = node.reference;
          const target = BrowsingContext.get(ref.browsingContextId);
          if (target?.top === top) {
            const id = Services.uuid.generateUUID().toString();
            this.references.set(id, { reference: ref, browsingContextId: target.id, innerWindowId: target.currentWindowGlobal.innerWindowId });
            node.reference = id;
          } else {
            delete node.reference;
          }
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach(replace);
          else if (value && typeof value === "object") replace(value);
        }
      };
      replace(result);
    }
    return result;
  }
  agentEndpoint(value) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password ||
        !(url.hostname === "127.0.0.1" || /^[a-z2-7]{56}\.onion$/.test(url.hostname))) {
      throw new Error("Use an enrolled loopback or onion Agent endpoint");
    }
    return url;
  }
  agentCertificate(identity) {
    const pem = identity?.caPem;
    const expected = String(identity?.caSha256 || "").toLowerCase();
    if (typeof pem !== "string" || pem.length > 32768 || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("Missing Agent certificate identity");
    const cert = certDB.constructX509FromBase64(pem.replace(/-----[^-]+-----|\s/g, ""));
    if (cert.sha256Fingerprint.replace(/:/g, "").toLowerCase() !== expected) throw new Error("Agent certificate identity mismatch");
    return cert;
  }
  configureAgent(params) {
    const endpoint = this.agentEndpoint(params.url);
    const identity = params.identity;
    const cert = this.agentCertificate(identity);
    const onion = endpoint.hostname.endsWith(".onion");
    if (onion !== Boolean(params.tor)) throw new Error("Agent route does not match its enrolled endpoint");
    BashKittenAndroid.configure(this.context, this.browserId, { ...params, identities: [] });
    if (this.agentHost && this.agentHost !== endpoint.hostname) certificates.clearAgentCA(this.agentHost, { geckoViewSessionContextId: this.context });
    certificates.setAgentCA(endpoint.hostname, { geckoViewSessionContextId: this.context }, cert);
    this.agentHost = endpoint.hostname;
    this.agentOrigin = endpoint.origin;
    BashKittenHost.configure(this.browser, this.context, this.agentOrigin);
    return { ready: true };
  }
  async enrollAgent(params) {
    if (!String(this.context).startsWith(contextPrefix("bashkitten-agent-ui-enroll-"))) throw new Error("A fresh enrollment context is required");
    const endpoint = this.agentEndpoint(params.url);
    if (!endpoint.hostname.endsWith(".onion") || !params.tor || !params.port) throw new Error("Authenticated onion route required");
    const attrs = { geckoViewSessionContextId: this.context };
    BashKittenAndroid.configure(this.context, this.browserId, { ...params, identities: [] });
    certificates.setAgentOnionEnrollment(endpoint.hostname, attrs, true);
    try {
      const principal = Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI(endpoint.origin), attrs);
      const identity = await this.agentFetch(endpoint.origin, "/.well-known/bashkitten-ca", principal, null, null, null, false);
      const cert = certDB.constructX509FromBase64(String(identity.caPem || "").replace(/-----[^-]+-----|\s/g, ""));
      const hash = cert.sha256Fingerprint.replace(/:/g, "").toLowerCase();
      if (params.caSha256 && String(params.caSha256).toLowerCase() !== hash) throw new Error("Imported Agent certificate identity does not match");
      if (identity.caSha256 && String(identity.caSha256).toLowerCase() !== hash) throw new Error("Invalid Agent identity response");
      return { caPem: identity.caPem, caSha256: hash, instanceId: identity.instanceId || "" };
    } finally { certificates.setAgentOnionEnrollment(endpoint.hostname, attrs, false); }
  }
  async agentRequest({ origin, path, body, csrf }) {
    const endpoint = this.agentEndpoint(origin);
    const current = this.browser.browsingContext.currentWindowGlobal;
    const principal = current?.documentPrincipal;
    if (endpoint.origin !== origin || origin !== this.agentOrigin ||
        principal?.isSystemPrincipal || principal?.URI?.prePath !== origin) {
      throw new Error("Selected authenticated Agent origin required");
    }
    const bootstrap = path === "/api/bootstrap";
    if (!bootstrap && !/^\/api\/browser-channel\/(open|poll|result|close|bind)$/.test(path)) throw new Error("Unsupported Agent channel endpoint");
    if (!bootstrap && (typeof csrf !== "string" || !csrf || /[\r\n]/.test(csrf))) throw new Error("Missing Agent CSRF token");
    const payload = bootstrap ? null : JSON.stringify(body ?? {});
    if (payload?.length > (path === "/api/browser-channel/result" ? 32 * 1024 * 1024 : 200000)) throw new Error("Agent channel request too large");
    return this.agentFetch(origin, path, principal, current.cookieJarSettings, payload, csrf, true);
  }
  async agentFetch(origin, path, principal, cookies, payload, csrf, authenticated) {
    const channel = NetUtil.newChannel({
      uri: origin + path,
      loadingPrincipal: principal,
      securityFlags: Ci.nsILoadInfo.SEC_REQUIRE_SAME_ORIGIN_DATA_IS_BLOCKED |
        (authenticated ? Ci.nsILoadInfo.SEC_COOKIES_INCLUDE : Ci.nsILoadInfo.SEC_COOKIES_OMIT),
      contentPolicyType: Ci.nsIContentPolicy.TYPE_FETCH,
    }).QueryInterface(Ci.nsIHttpChannel);
    if (cookies) channel.loadInfo.cookieJarSettings = cookies;
    channel.loadFlags |= Ci.nsIRequest.LOAD_BYPASS_CACHE | Ci.nsIRequest.INHIBIT_CACHING;
    channel.setRequestHeader("Origin", origin, false);
    channel.setRequestHeader("Accept", "application/json", false);
    if (payload !== null) {
      const stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
      stream.setUTF8Data(payload);
      channel.QueryInterface(Ci.nsIUploadChannel2).explicitSetUploadStream(
        stream, "application/json", -1, "POST", false
      );
      channel.setRequestHeader("X-Bashkitten-Csrf", csrf, false);
    }
    this.agentRequests.add(channel);
    try {
      return await new Promise((resolve, reject) => {
        let bytes = "", failure;
        const timer = setTimeout(() => {
          failure = new Error("Agent channel timed out"); channel.cancel(Cr.NS_ERROR_NET_TIMEOUT);
        }, path.endsWith("/poll") ? 40000 : 120000);
        const listener = {
          QueryInterface: ChromeUtils.generateQI(["nsIStreamListener", "nsIRequestObserver", "nsIInterfaceRequestor", "nsIChannelEventSink"]),
          getInterface(iid) { return this.QueryInterface(iid); },
          asyncOnChannelRedirect(oldChannel, newChannel, flags, callback) {
            callback.onRedirectVerifyCallback(Cr.NS_BINDING_ABORTED);
          },
          onStartRequest(request) {
            if (channel.responseStatus !== 200) {
              failure = new Error("Agent channel HTTP " + channel.responseStatus);
              request.cancel(Cr.NS_BINDING_ABORTED);
            }
          },
          onDataAvailable(request, input, offset, count) {
            if (bytes.length + count > 2000000) {
              failure = new Error("Agent channel response too large"); request.cancel(Cr.NS_BINDING_ABORTED); return;
            }
            bytes += NetUtil.readInputStreamToString(input, count);
          },
          onStopRequest(request, status) {
            clearTimeout(timer);
            if (failure || !Components.isSuccessCode(status)) { reject(failure || new Error("Agent channel disconnected")); return; }
            try { resolve(JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes, c => c.charCodeAt(0))))); }
            catch (error) { reject(new Error("Invalid Agent channel response")); }
          },
        };
        channel.notificationCallbacks = listener;
        try { channel.asyncOpen(listener); }
        catch (error) { clearTimeout(timer); reject(error); }
      });
    } finally { this.agentRequests.delete(channel); }
  }

}
