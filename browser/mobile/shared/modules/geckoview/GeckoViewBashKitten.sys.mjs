// SPDX-License-Identifier: AGPL-3.0-or-later
import { GeckoViewModule } from "resource://gre/modules/GeckoViewModule.sys.mjs";
import { BashKittenHost } from "resource://gre/modules/BashKittenHost.sys.mjs";
import { BashKittenAndroid } from "resource://gre/modules/BashKittenAndroid.sys.mjs";

const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");

const certificates = Cc["@mozilla.org/security/certoverride;1"].getService(Ci.nsICertOverrideService);
const certDB = Cc["@mozilla.org/security/x509certdb;1"].getService(Ci.nsIX509CertDB);
const contextPrefix = value => "gvctx" + Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2, "0")).join("");
const protectedContext = value => String(value).startsWith(contextPrefix("bashkitten-agent-ui-"));
const OAUTH_CALLBACK = "http://127.0.0.1/oauth/callback";

const commands = new Set(["snapshot", "act", "read", "evaluate", "wait", "console", "clearConsole", "viewport", "diagnostics"]);

export class GeckoViewBashKitten extends GeckoViewModule {
  onInit() {
    BashKittenHost.register();
    this.references = new Map();
    this.agentRequests = new Set();
    this.context = this.settings.sessionContextId;
    this.browserId = this.browser.browsingContext.browserId;
    if (protectedContext(this.context)) Services.obs.addObserver(this, "http-on-opening-request");
    BashKittenAndroid.register(this.context, this.browserId);
    this.registerListener(["BashKitten:Request"]);
    this.ready = BashKittenAndroid.init();
  }
  onDestroy() {
    this.destroyed = true;
    this.cancelLoginResponse();
    if (protectedContext(this.context)) Services.obs.removeObserver(this, "http-on-opening-request");
    BashKittenHost.close(this.browser);
    for (const channel of this.agentRequests) channel.cancel(Cr.NS_BINDING_ABORTED);
    this.agentRequests.clear();
    if (this.agentHost) certificates.clearAgentCA(this.agentHost, { geckoViewSessionContextId: this.context });
    BashKittenAndroid.close(this.context, this.browserId);
  }
  async onEvent(event, data, callback) {
    try {
      const request = JSON.parse(data.request);
      await this.ready;
      const result = await this.request(request);
      const json = JSON.stringify({ result });
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
        this.agentLogin = false;
        this.cancelLoginResponse();
        for (const channel of this.agentRequests) channel.cancel(Cr.NS_BINDING_ABORTED);
        this.agentRequests.clear();
        return true;
      }
      if (method === "agent.captureDraft") return BashKittenHost.captureDraft(this.browser);
      if (method === "agent.restoreDraft") return BashKittenHost.restoreDraft(this.browser);
      if (method === "agent.configure") return this.configureAgent(params);
      if (method === "agent.disconnect") {
        this.agentLogin = false;
        this.cancelLoginResponse();
        if (this.agentHost?.endsWith(".onion")) {
          certificates.clearAgentCA(this.agentHost, { geckoViewSessionContextId: this.context });
          this.agentUsesClientCertificate = false;
          this.agentIdentity = null;
          this.agentOrigin = "";
          BashKittenAndroid.configure(this.context, this.browserId, { tor: true, port: 0 });
          BashKittenHost.suspend(this.browser);
        }
        return true;
      }
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
    const documentURI = windowGlobal?.documentURI;
    const ordinaryDocument = ["http", "https", "file", "blob", "data"].includes(documentURI?.scheme) ||
      documentURI?.spec === "about:blank";
    if (!principal || principal.isSystemPrincipal || !ordinaryDocument) {
      throw new Error("Browser chrome cannot be controlled as an ordinary page");
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
      args.maxNodes ??= 200;
      args.maxBytes ??= 60000;
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
      args.timeout = Math.max(0, Number(args.timeout) || 10000);
      if (method === "wait" && (!args.for || args.for === "time")) args.value = Math.max(0, Number(args.value) || 0);
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
    this.cancelLoginResponse();
    const endpoint = this.agentEndpoint(params.url);
    const identity = params.identity;
    const cert = this.agentCertificate(identity);
    const onion = endpoint.hostname.endsWith(".onion");
    if (onion !== Boolean(params.tor)) throw new Error("Agent route does not match its enrolled endpoint");
    // The native credential stays in the protected cookie jar; it is never
    // passed to page script or to the ordinary-tab routing configuration.
    const { localSession, clientCertificate, ...routing } = params;
    if (clientCertificate && (!onion || endpoint.port || localSession)) {
      throw new Error("Client credentials require the enrolled onion origin");
    }
    if (this.agentUsesClientCertificate && !clientCertificate) {
      throw new Error("The remote client credential is required");
    }
    if (localSession) {
      const expectedName = "__Host-bashkitten_local_" + String(identity.instanceId).replaceAll("-", "");
      if (this.context !== contextPrefix("bashkitten-agent-ui-local") || onion ||
          localSession.url !== endpoint.origin || localSession.identity?.instanceId !== identity.instanceId ||
          localSession.identity?.caSha256 !== identity.caSha256 ||
          localSession.cookie?.name !== expectedName || !/^[a-f0-9]{64}$/.test(localSession.cookie?.value || "")) {
        throw new Error("Invalid native local Agent session");
      }
      Services.cookies.add("127.0.0.1", "/", expectedName, localSession.cookie.value, true, true, true,
        Date.now() + 400 * 86400000, { geckoViewSessionContextId: this.context },
        Ci.nsICookie.SAMESITE_STRICT, Ci.nsICookie.SCHEME_HTTPS);
    }
    BashKittenAndroid.configure(this.context, this.browserId, { ...routing, identities: [], agentHost: onion ? endpoint.hostname : "" });
    if (this.agentHost && this.agentHost !== endpoint.hostname) certificates.clearAgentCA(this.agentHost, { geckoViewSessionContextId: this.context });
    certificates.setAgentCA(endpoint.hostname, { geckoViewSessionContextId: this.context }, cert);
    if (clientCertificate) {
      let key;
      try {
        if (typeof clientCertificate.certificate !== "string" || typeof clientCertificate.pkcs8 !== "string") {
          throw new Error("Invalid native client credential");
        }
        const leaf = certDB.constructX509FromBase64(clientCertificate.certificate);
        key = Uint8Array.from(atob(clientCertificate.pkcs8), character => character.charCodeAt(0));
        certificates.setAgentClientCertificate(endpoint.hostname,
          { geckoViewSessionContextId: this.context }, leaf, key);
        this.agentUsesClientCertificate = true;
      } catch (_) {
        certificates.clearAgentCA(endpoint.hostname, { geckoViewSessionContextId: this.context });
        throw new Error("Could not enroll the remote client credential");
      } finally { key?.fill(0); }
    }
    this.agentHost = endpoint.hostname;
    this.agentOrigin = endpoint.origin;
    this.agentLogin = onion && this.agentUsesClientCertificate && params.login === true;
    this.agentIdentity = { caPem: identity.caPem, caSha256: identity.caSha256, instanceId: identity.instanceId };
    BashKittenHost.configure(this.browser, this.context, this.agentOrigin, this.agentIdentity.caSha256);
    return { ready: true };
  }
  observe(subject, topic) {
    if (topic !== "http-on-opening-request") return;
    const channel = subject.QueryInterface(Ci.nsIHttpChannel);
    const info = channel.loadInfo;
    if (info.originAttributes.geckoViewSessionContextId !== this.context ||
        channel.URI.scheme !== "http" || channel.URI.host !== "127.0.0.1" ||
        !channel.URI.pathQueryRef.startsWith("/oauth/callback")) return;
    // Consume before proxy resolution. Never open a loopback socket or commit a
    // callback document, even for a stale or invalid response.
    channel.cancel(Cr.NS_BINDING_ABORTED);
    const top = this.browser.browsingContext;
    const source = info.triggeringPrincipal;
    const document = top.currentWindowGlobal;
    const current = document?.documentPrincipal;
    if (this.destroyed || !this.agentLogin) return;
    const error = channel.URI.spec !== OAUTH_CALLBACK ? "Sign-in response used a different callback address."
      : info.externalContentPolicyType !== Ci.nsIContentPolicy.TYPE_DOCUMENT ? "Sign-in response is not a top-level document."
      : !info.browsingContext ? "Sign-in response has no browsing context."
      : info.browsingContext !== top ? "Sign-in response does not belong to the selected Agent view."
      : !source || source.isSystemPrincipal ? "Sign-in response has no verified source document."
      : source.originNoSuffix !== this.agentOrigin ? "Sign-in response came from a different server."
      : source.originAttributes.geckoViewSessionContextId !== this.context ? "Sign-in response used a different protected connection."
      : !current || current.isSystemPrincipal ? "Sign-in response has no current server document."
      : current.originNoSuffix !== this.agentOrigin ? "The server document changed before sign-in completed."
      : current.originAttributes.geckoViewSessionContextId !== this.context ? "The protected document connection changed before sign-in completed." : null;
    this.agentLogin = false;
    if (error) {
      this.eventDispatcher.sendRequest("BashKitten:OAuthCallback", { uri: OAUTH_CALLBACK, form: null, error });
      return;
    }
    const response = {};
    this.agentLoginResponse = response;
    this.readLoginResponse(channel, response, top, document);
  }
  cancelLoginResponse() {
    const response = this.agentLoginResponse;
    this.agentLoginResponse = null;
    response?.copy?.cancel(Cr.NS_BINDING_ABORTED);
  }
  async readLoginResponse(channel, response, top, document) {
    let form = null;
    try {
      if (channel.requestMethod !== "POST" ||
          channel.getRequestHeader("Content-Type").split(";", 1)[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
        throw new Error("Invalid sign-in response");
      }
      const upload = channel.QueryInterface(Ci.nsIUploadChannel2);
      if (upload.uploadStreamHasHeaders) throw new Error("Invalid sign-in response");
      const stream = channel.QueryInterface(Ci.nsIUploadChannel).uploadStream;
      const length = channel.getRequestHeader("Content-Length");
      if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) <= 0) {
        throw new Error("Incomplete sign-in response");
      }
      // Opening-request precedes upload consumption. Gecko's stream worker
      // reads any disk/IPC-backed body; main only reads the completed buffer.
      const buffer = Cc["@mozilla.org/storagestream;1"].createInstance(Ci.nsIStorageStream);
      buffer.init(4096, 0xffffffff);
      await new Promise((resolve, reject) => {
        response.copy = NetUtil.asyncCopy(stream, buffer.getOutputStream(0), status => {
          if (Components.isSuccessCode(status)) resolve();
          else reject(new Error("Could not read the sign-in response"));
        });
      });
      if (this.destroyed || this.agentLoginResponse !== response) return;
      if (this.browser.browsingContext !== top || top.currentWindowGlobal !== document) {
        throw new Error("The sign-in document changed");
      }
      if (buffer.length !== Number(length)) throw new Error("Incomplete sign-in response");
      const input = buffer.newInputStream(0);
      let body;
      try { body = NetUtil.readInputStreamToString(input, buffer.length); }
      finally { input.close(); }
      if (body.length !== Number(length) || /[^\x00-\x7f]/.test(body)) throw new Error("Invalid sign-in response");
      form = body;
    } catch (_) { /* Only a generic failure crosses the private native event. */ }
    if (this.destroyed || this.agentLoginResponse !== response) return;
    this.agentLoginResponse = null;
    this.eventDispatcher.sendRequest("BashKitten:OAuthCallback", { uri: OAUTH_CALLBACK, form });
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
      if (csrf) channel.setRequestHeader("X-Bashkitten-Csrf", csrf, false);
    }
    this.agentRequests.add(channel);
    try {
      return await new Promise((resolve, reject) => {
        let bytes = "", failure;
        const listener = {
          QueryInterface: ChromeUtils.generateQI(["nsIStreamListener", "nsIRequestObserver", "nsIInterfaceRequestor", "nsIChannelEventSink"]),
          getInterface(iid) { return this.QueryInterface(iid); },
          asyncOnChannelRedirect(oldChannel, newChannel, flags, callback) {
            if (path === "/api/hosting?refresh=1") failure = new Error("Sign in to Agent to open this website");
            callback.onRedirectVerifyCallback(Cr.NS_BINDING_ABORTED);
          },
          onStartRequest(request) {
            let status;
            // Network failures can reach this callback without HTTP headers.
            // onStopRequest reports the underlying channel error.
            try { status = channel.responseStatus; } catch { return; }
            if (status !== 200) {
              failure = new Error("Agent channel HTTP " + status);
              request.cancel(Cr.NS_BINDING_ABORTED);
            }
          },
          onDataAvailable(request, input, offset, count) {
            // nsIStreamListener guarantees this chunk can be read without blocking.
            bytes += NetUtil.readInputStreamToString(input, count);
          },
          onStopRequest(request, status) {
            if (failure || !Components.isSuccessCode(status)) {
              reject(failure || new Error("Agent channel disconnected (" + Components.Exception("", status).name + ")"));
              return;
            }
            try { resolve(JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes, c => c.charCodeAt(0))))); }
            catch (error) { reject(new Error("Invalid Agent channel response")); }
          },
        };
        channel.notificationCallbacks = listener;
        try { channel.asyncOpen(listener); }
        catch (error) { reject(error); }
      });
    } finally { this.agentRequests.delete(channel); }
  }

}
