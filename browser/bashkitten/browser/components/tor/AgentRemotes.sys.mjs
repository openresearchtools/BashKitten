/* SPDX-License-Identifier: AGPL-3.0-only */

import { NetUtil } from "resource://gre/modules/NetUtil.sys.mjs";
import { TorRouting } from "resource:///modules/TorRouting.sys.mjs";
import { onionPrivateKey } from "resource:///modules/OnionAuthStore.sys.mjs";
import { NativeRemote } from "resource:///modules/NativeRemote.sys.mjs";
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";

const CONTEXT_MIN = 0xB4500000;
const CONTEXT_MAX = 0xB450FFFF;
const FILE = PathUtils.join(PathUtils.profileDir, "bashkitten-remotes.json");
const TOPIC = "bashkitten-agent-remote-changed";

function validateURL(value, local = false) {
  const url = new URL(value);
  if (url.protocol != "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname != "/" || (local ? url.hostname != "127.0.0.1" : !/^[a-z2-7]{56}\.onion$/.test(url.hostname))) {
    throw new Error(local ? "The local controller must supply a loopback HTTPS URL." : "Enter an HTTPS v3 onion address without a path.");
  }
  return url.href;
}

function certificate(pem, expected = "") {
  const match = /^\s*-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+)\s*-----END CERTIFICATE-----\s*$/.exec(String(pem));
  if (!match) {
    throw new Error("The server CA certificate is missing or invalid.");
  }
  const cert = Cc["@mozilla.org/security/x509certdb;1"].getService(Ci.nsIX509CertDB)
    .constructX509FromBase64(match[1].replace(/\s/g, ""));
  const identity = cert.sha256Fingerprint.replace(/:/g, "").toLowerCase();
  if (expected && String(expected).replace(/:/g, "").toLowerCase() != identity) {
    throw new Error("The server certificate identity does not match the connection file.");
  }
  return { cert, identity };
}

function readResponse(channel, { body, signal, limit = Infinity, timeout = 35000 } = {}) {
  return new Promise((resolve, reject) => {
    let data = "";
    const cancel = () => channel.cancel(Cr.NS_BINDING_ABORTED);
    const timer = setTimeout(cancel, timeout);
    signal?.addEventListener("abort", cancel, { once: true });
    if (body !== undefined) {
      const stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
      stream.setUTF8Data(JSON.stringify(body));
      channel.QueryInterface(Ci.nsIUploadChannel2).explicitSetUploadStream(
        stream, "application/json", stream.available(), channel.requestMethod, false
      );
    }
    channel.redirectionLimit = 0;
    channel.notificationCallbacks = {
      QueryInterface: ChromeUtils.generateQI(["nsIInterfaceRequestor", "nsIChannelEventSink"]),
      getInterface(iid) { return this.QueryInterface(iid); },
      asyncOnChannelRedirect(_old, _next, _flags, callback) { callback.onRedirectVerifyCallback(Cr.NS_ERROR_ABORT); },
    };
    channel.asyncOpen({
      onStartRequest() {},
      onDataAvailable(request, stream, _offset, count) {
        if (data.length + count > limit) {
          request.cancel(Cr.NS_ERROR_FILE_TOO_BIG);
          return;
        }
        const input = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(Ci.nsIScriptableInputStream);
        input.init(stream);
        data += input.read(count);
      },
      onStopRequest(_request, status) {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        let httpStatus = 0;
        try { httpStatus = channel.responseStatus; } catch {}
        // Authelia may return plain text or HTML here. Preserve denial before
        // JSON parsing, including redirects which this channel never follows.
        if (!signal?.aborted && (httpStatus == 401 || httpStatus == 403 ||
            (httpStatus >= 300 && httpStatus < 400))) {
          resolve({ status: httpStatus, data: null });
          return;
        }
        if (!Components.isSuccessCode(status)) {
          reject(new Error(signal?.aborted ? "Connection cancelled." : "The enrolled server could not be reached securely."));
          return;
        }
        try {
          const text = new TextDecoder().decode(Uint8Array.from(data, char => char.charCodeAt(0)));
          resolve({ status: httpStatus, data: text ? JSON.parse(text) : null });
        } catch {
          reject(new Error(`The server returned an invalid response (HTTP ${httpStatus}).`));
        }
      },
    });
    if (signal?.aborted) cancel();
  });
}

class AgentRemoteStore {
  entries = null;
  activeId = null;
  selection = 0;
  queue = Promise.resolve();
  writes = Promise.resolve();
  contexts = new Map();
  clients = new Map();
  importToPi = null;

  get crypto() { return Cc["@mozilla.org/login-manager/crypto/SDR;1"].getService(Ci.nsILoginManagerCrypto); }
  get trust() { return Cc["@mozilla.org/security/certoverride;1"].getService(Ci.nsICertOverrideService); }

  load() {
    this.loading ??= this.read().catch(error => { this.loading = null; throw error; });
    return this.loading;
  }

  async read() {
    let entries = [];
    if (await IOUtils.exists(FILE)) {
      const saved = await IOUtils.readJSON(FILE);
      if (saved.version !== 1 || typeof saved.encrypted !== "string") throw new Error("The saved remote connections could not be read.");
      entries = JSON.parse(this.crypto.decrypt(saved.encrypted));
      if (!Array.isArray(entries)) throw new Error("Invalid remote connections.");
    }
    const ids = new Set();
    for (const entry of entries) {
      if (!Number.isInteger(entry.userContextId) || entry.userContextId < CONTEXT_MIN ||
          entry.userContextId > CONTEXT_MAX || ids.has(entry.userContextId)) throw new Error("Invalid isolated remote context.");
      entry.url = validateURL(entry.url, entry.id === "local");
      certificate(entry.caPem, entry.caSha256); ids.add(entry.userContextId);
      if (entry.mappings !== undefined && (!entry.mappings || typeof entry.mappings !== "object" || Array.isArray(entry.mappings))) {
        throw new Error("Invalid saved service mappings.");
      }
      for (const [id, choice] of Object.entries(entry.mappings || {})) {
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || id === "agent" || !choice ||
            typeof choice.enabled !== "boolean" || !Number.isInteger(choice.port) || choice.port < 0 || choice.port > 65535 ||
            choice.context !== undefined && (!TorRouting.isServiceContext(choice.context) || ids.has(choice.context)) ||
            choice.importToPi !== undefined && typeof choice.importToPi !== "boolean" ||
            choice.apiKey !== undefined && (typeof choice.apiKey !== "string" || /[\r\n\0]/.test(choice.apiKey))) {
          throw new Error("Invalid saved service mapping.");
        }
        if (choice.context !== undefined) ids.add(choice.context);
      }
    }
    this.entries = new Map(entries.map(entry => [entry.id, entry]));
    Services.obs.addObserver(this, "http-on-modify-request");
    return this.entries;
  }

  save() {
    const pending = this.writes.then(async () => {
      const encrypted = this.crypto.encrypt(JSON.stringify([...this.entries.values()]));
      await IOUtils.writeJSON(FILE, { version: 1, encrypted }, { tmpPath: FILE + ".tmp", permissions: 0o600 });
      await IOUtils.setPermissions(FILE, 0o600);
    });
    this.writes = pending.catch(() => {}); return pending;
  }

  serialized(operation) {
    const task = this.queue.then(operation); this.queue = task.catch(() => {}); return task;
  }
  allocateContext() {
    const ids = new Set([...this.entries.values()].map(entry => entry.userContextId));
    for (let id = CONTEXT_MIN; id <= CONTEXT_MAX; id++) if (!ids.has(id)) return id;
    throw new Error("No isolated remote context is available.");
  }
  info(entry) {
    const owner = this.clients.get(entry.id);
    return { id: entry.id, name: entry.name, kind: "agent", url: entry.url,
      userContextId: entry.userContextId, identity: entry.caSha256,
      active: entry.id === this.activeId, state: owner?.state || "disconnected",
      error: owner?.error || owner?.servicesError || "", migrationRequired: entry.id !== "local" && !entry.bundle };
  }
  async list() { return [...(await this.load()).values()].filter(entry => !["local", "local-hosting"].includes(entry.id)).map(entry => this.info(entry)); }
  async connection(id) {
    const entry = (await this.load()).get(id);
    if (!entry) throw new Error("The connection no longer exists.");
    return this.info(entry);
  }

  trustLocal({ url, caPem, caSha256, instanceId }) {
    return this.serialized(async () => {
      await this.load(); url = validateURL(url, true);
      if (typeof instanceId !== "string" || !instanceId) throw new Error("Missing local server identity.");
      const { identity } = certificate(caPem, caSha256), previous = this.entries.get("local");
      if (previous && (previous.instanceId !== instanceId || previous.caSha256 !== identity)) {
        throw Object.assign(new Error("The local server identity changed. Check the service before trusting its replacement."), { code: "local_identity_changed" });
      }
      const entry = { id: "local", kind: "agent", name: "Local", url, caPem, caSha256: identity, instanceId,
        userContextId: previous?.userContextId ?? this.allocateContext() };
      this.entries.set("local", entry); await this.save(); await this.prepare(entry); return this.info(entry);
    });
  }

  enroll(text, password) {
    return this.serialized(async () => {
      await this.load();
      const helper = await NativeRemote.open(async () => { throw new Error("Import cannot save a login token."); });
      try {
        const bundle = await helper.call("decrypt", { text, password });
        const browser = await helper.call("identity", { enrollment: bundle });
        const url = validateURL(browser.url), { identity } = certificate(browser.identity.caPem, browser.identity.caSha256);
        const previous = [...this.entries.values()].find(item => item.url === url && item.id !== "local-hosting");
        if (previous && (previous.caSha256 !== identity || previous.bundle && previous.bundle.id !== bundle.id)) {
          throw new Error("This server's identity changed. Remove its previous enrollment before adding the replacement.");
        }
        if (previous) await this.disconnect(previous.id);
        const entry = { id: previous?.id || Services.uuid.generateUUID().toString().slice(1, -1), kind: "agent",
          name: bundle.name, url, bundle, caPem: browser.identity.caPem, caSha256: identity, instanceId: bundle.id,
          clientAuthorization: onionPrivateKey(bundle.tor_private),
          userContextId: previous?.userContextId ?? this.allocateContext(), mappings: previous?.mappings || {}, token: previous?.token || null };
        this.entries.set(entry.id, entry); await this.save(); this.notify(); return this.info(entry);
      } finally { password = ""; await helper.close(); }
    });
  }

  async prepare(entry) {
    const { cert } = certificate(entry.caPem, entry.caSha256), host = new URL(entry.url).hostname;
    this.contexts.set(entry.userContextId, entry.url);
    if (entry.id !== "local" && !this.clients.has(entry.id)) await TorRouting.registerAgentContext(entry.userContextId, host, entry.clientAuthorization);
    this.trust.setAgentCA(host, { userContextId: entry.userContextId }, cert);
  }

  async activate(id) {
    const selection = ++this.selection;
    const entry = (await this.load()).get(id);
    if (!entry) throw new Error("Select an Agent server.");
    if (id !== "local" && !entry.bundle) throw new Error("Import a new encrypted Connection QR from this host's Share Local setup.");
    if (selection !== this.selection) throw new Error("The Agent selection changed.");
    this.activeId = id;
    await this.serialized(() => this.prepare(entry));
    if (selection !== this.selection) {
      if (id !== "local" && this.entries.get(id) === entry && !this.clients.has(id)) this.block(entry);
      throw new Error("The Agent selection changed.");
    }
    this.notify(); return this.info(entry);
  }

  current(entry, owner) {
    if (this.entries.get(entry.id) !== entry || this.clients.get(entry.id) !== owner || owner.abort.signal.aborted) {
      throw new Error("Remote connection closed.");
    }
  }

  async failed(entry, owner, error) {
    if (this.clients.get(entry.id) !== owner || owner.abort.signal.aborted) return;
    owner.abort.abort();
    owner.state = "failed"; owner.error = error.message;
    try {
      try { this.block(entry); } finally { await owner.helper?.close(); }
    }
    finally {
      this.notify();
      const callback = owner.callback; owner.callback = null;
      if (this.clients.get(entry.id) === owner) callback?.(error);
    }
  }

  async connect(id, password = "", forceLogin = false) {
    const entry = (await this.load()).get(id);
    if (!entry?.bundle || this.activeId !== id) throw new Error("Select an enrolled remote Agent.");
    let owner = this.clients.get(id);
    if (owner?.state === "ready" && !forceLogin) return { connection: this.info(entry) };
    if (owner) await this.disconnect(id);
    if (this.activeId !== id) throw new Error("The Agent selection changed.");
    owner = { state: "connecting", error: "", helper: null, callback: null, abort: new AbortController() };
    this.clients.set(id, owner);
    try {
      await this.serialized(async () => {
        this.current(entry, owner);
        await TorRouting.registerAgentContext(entry.userContextId, new URL(entry.url).hostname, entry.clientAuthorization);
        this.current(entry, owner);
        await this.prepare(entry);
      });
      this.current(entry, owner);
      const helper = await NativeRemote.open(async token => {
        this.current(entry, owner);
        entry.token = token; await this.save();
        this.current(entry, owner);
      }, message => this.failed(entry, owner, new Error(message)).catch(console.error));
      owner.helper = helper;
      try { this.current(entry, owner); } catch (error) { await helper.close(); throw error; }
      const browser = await helper.call("identity", { enrollment: entry.bundle });
      this.current(entry, owner);
      const cert = Cc["@mozilla.org/security/x509certdb;1"].getService(Ci.nsIX509CertDB)
        .constructX509FromBase64(browser.clientCertificate.certificate);
      const key = Uint8Array.from(atob(browser.clientCertificate.pkcs8), char => char.charCodeAt(0));
      try { this.trust.setAgentClientCertificate(new URL(entry.url).hostname, { userContextId: entry.userContextId }, cert, key); }
      finally { key.fill(0); delete browser.clientCertificate; }
      await helper.call("open", { enrollment: entry.bundle, token: entry.token,
        socksAddress: `127.0.0.1:${await TorRouting.ensureProxy()}` });
      this.current(entry, owner);
      if (!forceLogin && await helper.call("authorize")) { await this.ready(entry, owner); return { connection: this.info(entry) }; }
      const loginURL = await helper.call("begin-login");
      this.current(entry, owner);
      if (password) await this.firstFactor(entry, password, owner.abort.signal);
      this.current(entry, owner);
      owner.state = "login"; this.notify(); return { connection: this.info(entry), loginURL };
    } catch (error) {
      await this.failed(entry, owner, error); throw error;
    } finally { password = ""; }
  }

  async firstFactor(entry, password, signal) {
    const origin = new URL(entry.url).origin;
    const principal = Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI(origin), { userContextId: entry.userContextId });
    const channel = NetUtil.newChannel({ uri: origin + "/login/api/firstfactor", loadingPrincipal: principal,
      securityFlags: Ci.nsILoadInfo.SEC_REQUIRE_SAME_ORIGIN_DATA_IS_BLOCKED | Ci.nsILoadInfo.SEC_COOKIES_INCLUDE,
      contentPolicyType: Ci.nsIContentPolicy.TYPE_FETCH }).QueryInterface(Ci.nsIHttpChannel);
    channel.loadFlags |= Ci.nsIRequest.LOAD_BYPASS_CACHE | Ci.nsIRequest.INHIBIT_CACHING;
    channel.requestMethod = "POST"; channel.setRequestHeader("Origin", origin, false);
    const response = await readResponse(channel, { body: { username: entry.bundle.owner, password, keepMeLoggedIn: true }, signal, timeout: 120000 });
    if (response.status !== 200 || response.data?.status !== "OK") throw new Error("Authelia did not accept this sign-in.");
  }

  async ready(entry, owner) {
    this.current(entry, owner);
    const route = await owner.helper.call("agent-route");
    this.current(entry, owner);
    TorRouting.setAgentTunnel(entry.userContextId, route);
    owner.state = "ready"; this.notify();
    // A conflicting service port must not prevent the protected Agent opening.
    try { await this.services(entry.id); }
    catch (error) { owner.servicesError = error.message; }
    this.current(entry, owner);
  }

  serviceOwner(id) {
    const entry = this.entries?.get(id), owner = this.clients.get(id);
    if (!entry || owner?.state !== "ready") throw new Error("Connect and finish sign-in to view services.");
    this.current(entry, owner); return { entry, owner };
  }

  services(id) {
    return this.serialized(async () => {
      const { entry, owner } = this.serviceOwner(id);
      const result = await owner.helper.call("services"); this.current(entry, owner);
      if (!Array.isArray(result.services)) throw new Error("Invalid service catalogue.");
      const offered = new Set();
      for (const service of result.services) {
        if (!service || typeof service.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(service.id) || offered.has(service.id) ||
            typeof service.name !== "string" || typeof service.state !== "string" || typeof service.reachable !== "boolean" ||
            !["agent", "web", "llama"].includes(service.kind) || !["http", "https"].includes(service.scheme) ||
            typeof service.openPath !== "string" || !service.openPath.startsWith("/") || service.openPath.startsWith("//") || /[\x00-\x20\x7f\\]/.test(service.openPath) ||
            !Array.isArray(service.actions) || service.actions.some(action => !["start", "stop", "reload"].includes(action))) {
          throw new Error("Invalid service catalogue.");
        }
        offered.add(service.id);
      }
      owner.services = result.services; owner.servicesError = "";
      entry.mappings ||= {};
      for (const [id, choice] of Object.entries(entry.mappings)) {
        if (!offered.has(id) || !choice.enabled) TorRouting.setServiceRoute(choice.context, null);
      }
      const mappings = await owner.helper.call("mappings"); this.current(entry, owner);
      for (const mapped of mappings) if (mapped.id !== "agent" && (!offered.has(mapped.id) || !entry.mappings[mapped.id]?.enabled)) {
        this.current(entry, owner);
        TorRouting.setServiceRoute(entry.mappings[mapped.id]?.context, null);
        await owner.helper.call("unmap", { id: mapped.id });
      }
      for (const service of result.services) {
        this.current(entry, owner);
        if (service.id === "agent") continue;
        if (!Object.hasOwn(entry.mappings, service.id)) entry.mappings[service.id] = { enabled: true, port: 0 };
        const choice = entry.mappings[service.id];
        choice.context ??= TorRouting.allocateServiceContext();
        try {
          if (choice.enabled) {
            const mapped = await owner.helper.call("map", { id: service.id, port: choice.port });
            this.current(entry, owner); TorRouting.setServiceRoute(choice.context, mapped.port);
          }
          choice.error = "";
        } catch (error) { this.current(entry, owner); choice.error = error.message; }
      }
      this.current(entry, owner); await this.save();
      return this.serviceInfo(entry, owner, true);
    });
  }

  async serviceInfo(entry, owner, applyImport = false) {
    const mappings = await owner.helper.call("mappings"); this.current(entry, owner);
    const services = [];
    for (const service of owner.services || []) {
      const choice = entry.mappings?.[service.id];
      const mapped = (service.id === "agent" || choice?.enabled) ? mappings.find(item => item.id === service.id) : null;
      if (choice) {
        TorRouting.setServiceRoute(choice.context, mapped?.port || null);
      }
      if (applyImport && service.kind === "llama" && choice) {
        choice.importState = "";
        if (choice.importToPi) {
          if (!mapped || !choice.enabled || !service.reachable) choice.importState = "Pi import pending: enable local access and start the service on its host.";
          else try {
            this.current(entry, owner);
            const result = await this.importToPi({ enabled: true, bundle: entry.bundle.id, service: service.id,
              name: `${entry.name} · ${service.name}`, baseUrl: `${service.scheme}://127.0.0.1:${mapped.port}/v1`, apiKey: choice.apiKey || "" });
            this.current(entry, owner);
            choice.importState = `${result.message} ${result.provider || ""} ${result.baseUrl || ""}`.trim();
          } catch (error) { this.current(entry, owner); choice.importState = error.message; }
        }
      }
      services.push({ ...service, choice, mapping: mapped,
        url: service.id === "agent" ? entry.url : mapped ? `${service.scheme}://127.0.0.1:${mapped.port}${service.openPath}` : "" });
    }
    return { services };
  }

  saveMapping(id, serviceId, { enabled, port, importToPi = false, apiKey = "" }) {
    return this.serialized(async () => {
      const { entry, owner } = this.serviceOwner(id), previous = entry.mappings?.[serviceId];
      if (!previous || serviceId === "agent" || !owner.services?.some(service => service.id === serviceId)) throw new Error("Refresh the published services first.");
      if (typeof enabled !== "boolean" || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Choose Automatic or a port from 1 to 65535.");
      // Record the user's choice even when binding fails. The native client
      // retains the existing listener; status shows both choice and actual port.
      if (typeof importToPi !== "boolean" || typeof apiKey !== "string" || /[\r\n\0]/.test(apiKey)) throw new Error("Invalid coding-agent import settings.");
      if (importToPi && !owner.services.some(service => service.id === serviceId && service.kind === "llama")) throw new Error("Pi import needs an inference service.");
      const choice = { ...previous, enabled, port, importToPi, apiKey, error: "" };
      entry.mappings[serviceId] = choice;
      try { await this.save(); }
      catch (error) { entry.mappings[serviceId] = previous; throw error; }
      this.current(entry, owner);
      try {
        if (enabled) {
          const mapped = await owner.helper.call("map", { id: serviceId, port });
          this.current(entry, owner); TorRouting.setServiceRoute(choice.context, mapped.port);
        } else {
          TorRouting.setServiceRoute(choice.context, null);
          await owner.helper.call("unmap", { id: serviceId });
        }
      } catch (error) { this.current(entry, owner); choice.error = error.message; }
      return this.serviceInfo(entry, owner, true);
    });
  }

  async serviceAction(id, serviceId, action) {
    const { entry, owner } = this.serviceOwner(id);
    if (serviceId === "agent" || !owner.services?.find(service => service.id === serviceId)?.actions.includes(action)) {
      throw new Error("This service does not support that host action.");
    }
    await owner.helper.call("service-action", { id: serviceId, action }); this.current(entry, owner);
    return this.services(id);
  }

  async openService(id, serviceId, win) {
    const { entry, owner } = this.serviceOwner(id);
    const info = (await this.serviceInfo(entry, owner)).services.find(service => service.id === serviceId);
    this.current(entry, owner);
    if (!info?.mapping || !info.choice?.enabled || serviceId === "agent") throw new Error("Enable this service's local access first.");
    const tab = win.gBrowser.addTrustedTab(info.url, { userContextId: info.choice.context });
    win.gBrowser.selectedTab = tab;
    win.BashKittenAgent?.closeConnections();
    win.BashKittenAgent?.browse();
  }
  onLogin(id, callback) {
    const owner = this.clients.get(id);
    if (!owner || owner.state !== "login") throw new Error("Remote sign-in is no longer active.");
    owner.callback = callback;
  }
  async complete(entry, owner, url, form) {
    this.current(entry, owner);
    owner.state = "connecting";
    try {
      await owner.helper.call("complete-login", { callback: url, form }); await this.ready(entry, owner);
      this.current(entry, owner);
    } catch (error) {
      await this.failed(entry, owner, error);
      return;
    }
    const callback = owner.callback; owner.callback = null;
    callback?.(null, this.info(entry));
  }
  block(entry) {
    for (const choice of Object.values(entry.mappings || {})) TorRouting.setServiceRoute(choice.context, null);
    TorRouting.setAgentTunnel(entry.userContextId, null);
    this.trust.clearAgentClientCertificate(new URL(entry.url).hostname, { userContextId: entry.userContextId });
  }
  async disconnect(id) {
    const owner = this.clients.get(id), entry = this.entries?.get(id);
    if (!owner) { if (entry) this.block(entry); return; }
    owner.abort.abort(); owner.callback = null;
    try {
      try { this.block(entry); } finally { await owner.helper?.close(); }
      if (this.clients.get(id) === owner) this.clients.delete(id);
    } catch (error) { owner.state = "failed"; owner.error = error.message; throw error; }
    finally { this.notify(); }
  }
  async deactivate(closeClients = true) {
    ++this.selection;
    const previous = this.activeId; this.activeId = null;
    if (previous) Services.obs.notifyObservers(null, "bashkitten-agent-control-revoke", previous);
    if (closeClients) await Promise.all([...this.clients.keys()].map(id => this.disconnect(id)));
    else for (const [id, owner] of this.clients) if (owner.state !== "ready") await this.disconnect(id);
    this.notify();
  }
  async remove(id) {
    return this.serialized(async () => {
      const entry = (await this.load()).get(id);
      if (!entry) return;
      if (this.activeId === id) { ++this.selection; this.activeId = null; }
      await this.disconnect(id);
      this.contexts.set(entry.userContextId, null);
      this.trust.clearAgentCA(new URL(entry.url).hostname, { userContextId: entry.userContextId });
      if (id !== "local") await TorRouting.unregisterAgentContext(entry.userContextId);
      for (const userContextId of [entry.userContextId, ...Object.values(entry.mappings || {}).map(choice => choice.context).filter(context => TorRouting.isServiceContext(context))]) {
        await new Promise(resolve => Services.clearData.deleteDataFromOriginAttributesPattern({ userContextId }, { onDataDeleted: resolve }));
      }
      this.entries.delete(id); await this.save(); this.notify();
    });
  }

  async request(connection, path, { method = "GET", body, signal, csrf } = {}) {
    const entry = (await this.load()).get(connection.id);
    if (!entry || entry.id !== this.activeId || entry.url !== connection.url || entry.caSha256 !== connection.identity) throw new Error("The Agent connection changed.");
    if (!path.startsWith("/") || path.startsWith("//") || /[\x00-\x20\x7f#\\]/.test(path)) throw new Error("Invalid Agent path.");
    const context = connection.requestContext, global = context?.currentWindowGlobal, principal = global?.documentPrincipal;
    if (!context || context !== context.top || !principal?.isContentPrincipal || principal.originNoSuffix !== new URL(entry.url).origin ||
        principal.originAttributes.userContextId !== entry.userContextId || !global.cookieJarSettings) throw new Error("The protected Agent document is not ready.");
    const channel = NetUtil.newChannel({ uri: entry.url.slice(0, -1) + path, loadingPrincipal: principal,
      securityFlags: Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
      contentPolicyType: Ci.nsIContentPolicy.TYPE_OTHER }).QueryInterface(Ci.nsIHttpChannel);
    channel.loadInfo.cookieJarSettings = global.cookieJarSettings; channel.requestMethod = method;
    channel.setRequestHeader("Accept", "application/json", false); channel.setRequestHeader("Origin", new URL(entry.url).origin, false);
    if (csrf) channel.setRequestHeader("X-Bashkitten-Csrf", csrf, false);
    const response = await readResponse(channel, { body, signal });
    if ([401, 403].includes(response.status) || response.status >= 300 && response.status < 400) Services.obs.notifyObservers(null, "bashkitten-agent-control-revoke", entry.id);
    return response;
  }

  observe(subject, topic) {
    if (topic !== "http-on-modify-request") return;
    const channel = subject.QueryInterface(Ci.nsIHttpChannel), context = channel.loadInfo.originAttributes.userContextId;
    if (context < CONTEXT_MIN || context > CONTEXT_MAX) return;
    if (channel.URI.scheme === "http" && channel.URI.host === "127.0.0.1" && channel.URI.pathQueryRef.startsWith("/oauth/callback")) {
      const entry = this.entries?.get(this.activeId), owner = this.clients.get(this.activeId);
      try {
        if (entry?.userContextId !== context || owner?.state !== "login") return;
        const info = channel.loadInfo, browsing = info.browsingContext;
        const browser = browsing?.embedderElement, host = browser?.ownerGlobal?.BashKittenAgent;
        const principal = info.triggeringPrincipal;
        const current = browsing?.currentWindowGlobal?.documentPrincipal;
        if (info.externalContentPolicyType !== Ci.nsIContentPolicy.TYPE_DOCUMENT || !browsing || browsing !== browsing.top ||
            host?.activeBrowser !== browser || host.off || host.selection !== entry.id ||
            browser.getAttribute("bashkitten-protected") !== "true" || !principal?.isContentPrincipal ||
            principal.originNoSuffix !== new URL(entry.url).origin || principal.originAttributes.userContextId !== context ||
            !current?.isContentPrincipal || current.originNoSuffix !== principal.originNoSuffix ||
            current.originAttributes.userContextId !== context) return;
        if (channel.URI.spec !== "http://127.0.0.1/oauth/callback" || channel.requestMethod !== "POST" ||
            channel.getRequestHeader("Content-Type").split(";", 1)[0].trim().toLowerCase() !== "application/x-www-form-urlencoded" ||
            channel.QueryInterface(Ci.nsIUploadChannel2).uploadStreamHasHeaders) throw new Error("Invalid Authelia sign-in response.");
        const stream = channel.QueryInterface(Ci.nsIUploadChannel).uploadStream;
        stream.QueryInterface(Ci.nsISeekableStream).seek(0, 0);
        const form = NetUtil.readInputStreamToString(stream, stream.available());
        if (form.length !== Number(channel.getRequestHeader("Content-Length")) || /[^\x00-\x7f]/.test(form)) throw new Error("Incomplete Authelia sign-in response.");
        this.complete(entry, owner, channel.URI.spec, form).catch(() => {});
      } catch {
        this.failed(entry, owner, new Error("Could not read the Authelia sign-in response.")).catch(() => {});
      } finally {
        // Consume only the protected form; no localhost request or code URL.
        channel.cancel(Cr.NS_BINDING_ABORTED);
      }
      return;
    }
    const allowed = this.contexts.get(context);
    if (!allowed || channel.URI.prePath !== new URL(allowed).origin) channel.cancel(Cr.NS_BINDING_ABORTED);
  }
  notify() { Services.obs.notifyObservers(null, TOPIC, this.activeId || ""); }
}

export const AgentRemotes = new AgentRemoteStore();
