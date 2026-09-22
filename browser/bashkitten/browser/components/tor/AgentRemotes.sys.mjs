/* SPDX-License-Identifier: GPL-3.0-only */

import { NetUtil } from "resource://gre/modules/NetUtil.sys.mjs";
import { TorRouting } from "resource:///modules/TorRouting.sys.mjs";
import { onionAddress, onionPrivateKey } from "resource:///modules/OnionAuthStore.sys.mjs";
import { LlamaRelay, remoteChannel } from "resource:///modules/LlamaRelay.sys.mjs";
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
  if (!match || pem.length > 65536) {
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

function readResponse(channel, { body, signal, limit = 2 * 1024 * 1024, timeout = 35000 } = {}) {
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
        if (!Components.isSuccessCode(status)) {
          reject(new Error(signal?.aborted ? "Connection cancelled." : "The enrolled server could not be reached securely."));
          return;
        }
        try {
          const text = new TextDecoder().decode(Uint8Array.from(data, char => char.charCodeAt(0)));
          resolve({ status: channel.responseStatus, data: text ? JSON.parse(text) : null });
        } catch {
          reject(new Error("The server returned an invalid response."));
        }
      },
    });
    if (signal?.aborted) cancel();
  });
}

class AgentRemoteStore {
  entries = null;
  activeId = null;
  queue = Promise.resolve();
  contexts = new Map();
  relays = new Map();
  relayHealth = new Map();

  get crypto() {
    return Cc["@mozilla.org/login-manager/crypto/SDR;1"].getService(Ci.nsILoginManagerCrypto);
  }

  get trust() {
    return Cc["@mozilla.org/security/certoverride;1"].getService(Ci.nsICertOverrideService);
  }

  async load() {
    if (this.entries) return this.entries;
    let entries = [];
    if (await IOUtils.exists(FILE)) {
      const saved = await IOUtils.readJSON(FILE);
      if (saved.version != 1 || typeof saved.encrypted != "string" || saved.encrypted.length > 4 * 1024 * 1024) {
        throw new Error("The saved remote connections could not be read.");
      }
      entries = JSON.parse(this.crypto.decrypt(saved.encrypted));
      if (!Array.isArray(entries) || entries.length > 256) throw new Error("Invalid remote connections.");
    }
    const ids = new Set();
    for (const entry of entries) {
      if (!Number.isInteger(entry.userContextId) || entry.userContextId < CONTEXT_MIN ||
          entry.userContextId > CONTEXT_MAX || ids.has(entry.userContextId)) {
        throw new Error("Invalid isolated remote context.");
      }
      entry.url = validateURL(entry.url, entry.id == "local");
      certificate(entry.caPem, entry.caSha256);
      ids.add(entry.userContextId);
    }
    this.entries = new Map(entries.map(entry => [entry.id, entry]));
    Services.obs.addObserver(this, "http-on-modify-request");
    return this.entries;
  }

  async save() {
    const encrypted = this.crypto.encrypt(JSON.stringify([...this.entries.values()]));
    await IOUtils.writeJSON(FILE, { version: 1, encrypted }, { tmpPath: FILE + ".tmp", permissions: 0o600 });
    await IOUtils.setPermissions(FILE, 0o600);
  }

  serialized(operation) {
    const task = this.queue.then(operation);
    this.queue = task.catch(() => {});
    return task;
  }

  allocateContext() {
    const ids = new Set([...this.entries.values()].map(entry => entry.userContextId));
    for (let id = CONTEXT_MIN; id <= CONTEXT_MAX; id++) {
      if (!ids.has(id)) return id;
    }
    throw new Error("Too many saved connections.");
  }

  info(entry) {
    return {
      id: entry.id, name: entry.name, kind: entry.kind, url: entry.url,
      userContextId: entry.userContextId, identity: entry.caSha256,
      active: entry.id == this.activeId,
      port: this.relays.get(entry.id)?.port || entry.port || 0,
      running: this.relays.has(entry.id), health: this.relayHealth.get(entry.id) || "stopped",
    };
  }

  async list() { return [...(await this.load()).values()].filter(entry => entry.id != "local").map(entry => this.info(entry)); }

  async connection(id) {
    const entry = (await this.load()).get(id);
    if (!entry) throw new Error("The connection no longer exists.");
    return this.info(entry);
  }

  trustLocal({ url, caPem, caSha256, instanceId }) {
    return this.serialized(async () => {
      await this.load();
      url = validateURL(url, true);
      if (typeof instanceId != "string" || !instanceId || instanceId.length > 256) throw new Error("Missing local server identity.");
      const { identity } = certificate(caPem, caSha256);
      const previous = this.entries.get("local");
      if (previous && (previous.instanceId != instanceId || previous.caSha256 != identity)) {
        throw new Error("The local server identity changed. Re-enroll it from Agent settings.");
      }
      const entry = { id: "local", kind: "agent", name: "Local", url, caPem, caSha256: identity, instanceId,
        userContextId: previous?.userContextId ?? this.allocateContext() };
      this.entries.set("local", entry);
      await this.save();
      await this.prepare(entry);
      return this.info(entry);
    });
  }

  enroll(record) {
    return this.serialized(async () => {
      await this.load();
      if (typeof record == "string") record = JSON.parse(record);
      if (record?.version != 1 || !["agent", "llama"].includes(record.kind)) throw new Error("Unsupported connection file.");
      const url = validateURL(record.url);
      const name = String(record.name || new URL(url).hostname).trim().slice(0, 120);
      const key = onionPrivateKey(record.clientAuthorization);
      const previous = [...this.entries.values()].find(entry => entry.kind == record.kind && entry.url == url);
      const entry = {
        id: previous?.id || Services.uuid.generateUUID().toString().slice(1, -1),
        kind: record.kind, name, url, clientAuthorization: key,
        userContextId: previous?.userContextId ?? this.allocateContext(),
        caPem: record.caPem, caSha256: record.caSha256,
        bearerToken: record.kind == "llama" ? String(record.bearerToken || "") : undefined,
        port: previous?.port || 0,
      };
      if (entry.kind == "llama" && (!entry.bearerToken || /[\x00-\x20\x7f]/.test(entry.bearerToken) || entry.bearerToken.length > 8192)) {
        throw new Error("Enter the llama.cpp bearer token.");
      }
      if (!entry.caPem) await this.enrollCertificate(entry);
      const { identity } = certificate(entry.caPem, entry.caSha256);
      if (previous && previous.caSha256 != identity) {
        throw new Error("This server's certificate identity changed. Remove its previous enrollment before adding the replacement.");
      }
      entry.caSha256 = identity;
      this.entries.set(entry.id, entry);
      await this.save();
      this.notify();
      return this.info(entry);
    });
  }

  async prepare(entry) {
    const { cert } = certificate(entry.caPem, entry.caSha256);
    const host = new URL(entry.url).hostname;
    this.contexts.set(entry.userContextId, entry.url);
    if (entry.id != "local") {
      await TorRouting.registerAgentContext(entry.userContextId, host, entry.clientAuthorization);
    }
    this.trust.setAgentCA(host, { userContextId: entry.userContextId }, cert);
  }

  async activate(id) {
    const entry = (await this.load()).get(id);
    if (!entry || entry.kind != "agent") throw new Error("Select an Agent server.");
    if (this.activeId != id) await this.deactivate(false);
    await this.prepare(entry);
    this.activeId = id;
    this.notify();
    return this.info(entry);
  }

  async deactivate(stopRelays = true) {
    const previous = this.activeId;
    this.activeId = null;
    if (previous) Services.obs.notifyObservers(null, "bashkitten-agent-control-revoke", previous);
    if (stopRelays) {
      for (const id of [...this.relays.keys()]) this.stopRelay(id);
    }
    this.notify();
  }

  async remove(id) {
    return this.serialized(async () => {
      const entry = (await this.load()).get(id);
      if (!entry) return;
      if (this.activeId == id) await this.deactivate();
      this.stopRelay(id);
      this.contexts.set(entry.userContextId, null);
      this.trust.clearAgentCA(new URL(entry.url).hostname, { userContextId: entry.userContextId });
      await TorRouting.unregisterAgentContext(entry.userContextId);
      await new Promise(resolve => Services.clearData.deleteDataFromOriginAttributesPattern(
        { userContextId: entry.userContextId }, { onDataDeleted: resolve }
      ));
      this.entries.delete(id);
      await this.save();
      this.notify();
    });
  }

  async exportConnection(id) {
    const entry = (await this.load()).get(id);
    if (!entry || id == "local") throw new Error("Select a remote to export.");
    return JSON.stringify({ version: 1, kind: entry.kind, name: entry.name, url: entry.url,
      clientAuthorization: entry.clientAuthorization, caPem: entry.caPem, caSha256: entry.caSha256,
      ...(entry.kind == "llama" ? { bearerToken: entry.bearerToken } : {}) });
  }

  async request(connection, path, { method = "GET", body, signal, csrf } = {}) {
    const entry = (await this.load()).get(connection.id);
    if (!entry || entry.id != this.activeId || entry.url != connection.url || entry.caSha256 != connection.identity) {
      throw new Error("The Agent connection changed.");
    }
    if (!path.startsWith("/") || path.startsWith("//") || /[\x00-\x20\x7f#\\]/.test(path)) throw new Error("Invalid Agent path.");
    const uri = Services.io.newURI(entry.url.slice(0, -1) + path);
    const principal = Services.scriptSecurityManager.createContentPrincipal(uri, { userContextId: entry.userContextId });
    const channel = NetUtil.newChannel({ uri, loadingPrincipal: principal,
      securityFlags: Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
      contentPolicyType: Ci.nsIContentPolicy.TYPE_OTHER,
    }).QueryInterface(Ci.nsIHttpChannel);
    channel.requestMethod = method;
    channel.setRequestHeader("Accept", "application/json", false);
    channel.setRequestHeader("Origin", new URL(entry.url).origin, false);
    if (csrf) channel.setRequestHeader("X-Bashkitten-Csrf", csrf, false);
    const response = await readResponse(channel, { body, signal });
    if (response.status == 401 || response.status == 403) {
      Services.obs.notifyObservers(null, "bashkitten-agent-control-revoke", entry.id);
    }
    return response;
  }

  async startRelay(id, { port } = {}) {
    const entry = (await this.load()).get(id);
    if (!entry || entry.kind != "llama") throw new Error("Select a llama.cpp connection.");
    if (this.relays.has(id)) return this.info(entry);
    await this.prepare(entry);
    const relay = new LlamaRelay(entry);
    // A remembered occupied port is an error, never an invitation to attach to
    // the process that happens to answer it. An explicit port:0 chooses a new one.
    entry.port = relay.start(port ?? entry.port ?? 0);
    this.relays.set(id, relay);
    this.relayHealth.set(id, "checking");
    await this.save();
    this.notify();
    this.checkRelay(id).catch(() => {});
    return this.info(entry);
  }

  stopRelay(id) {
    this.relays.get(id)?.stop();
    this.relays.delete(id);
    this.relayHealth.set(id, "stopped");
    this.notify();
  }

  async checkRelay(id) {
    const entry = (await this.load()).get(id);
    if (!entry || !this.relays.has(id)) throw new Error("The relay is stopped.");
    try {
      const health = await readResponse(remoteChannel(entry, "/health"), { timeout: 10000 });
      const models = await readResponse(remoteChannel(entry, "/v1/models"), { timeout: 10000 });
      if (health.status != 200 || models.status != 200 || !Array.isArray(models.data?.data)) throw new Error("Not ready");
      this.relayHealth.set(id, "ready");
    } catch {
      this.relayHealth.set(id, "unavailable");
    }
    this.notify();
    return this.info(entry);
  }

  async enrollCertificate(entry) {
    // No document or Agent cookies exist in this transient context. The exact
    // authenticated v3 onion proves the endpoint while we retrieve its public
    // CA. Once saved, all real requests require that CA through normal NSS.
    let userContextId = CONTEXT_MAX;
    const used = new Set([...this.entries.values()].map(item => item.userContextId));
    while (used.has(userContextId) || this.contexts.has(userContextId)) userContextId--;
    if (userContextId <= CONTEXT_MIN) throw new Error("No enrollment context is available.");
    const host = new URL(entry.url).hostname;
    const attributes = { userContextId };
    let temporaryTrust = false;
    this.contexts.set(userContextId, entry.url);
    try {
      await TorRouting.registerAgentContext(userContextId, host, entry.clientAuthorization);
      this.trust.setAgentOnionEnrollment(host, attributes, true);
      temporaryTrust = true;
      const uri = Services.io.newURI(entry.url + ".well-known/bashkitten-ca");
      const principal = Services.scriptSecurityManager.createContentPrincipal(uri, attributes);
      const channel = NetUtil.newChannel({ uri, loadingPrincipal: principal,
        securityFlags: Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
        contentPolicyType: Ci.nsIContentPolicy.TYPE_OTHER,
      }).QueryInterface(Ci.nsIHttpChannel);
      channel.loadFlags |= Ci.nsIRequest.LOAD_ANONYMOUS | Ci.nsIRequest.LOAD_BYPASS_CACHE;
      const response = await readResponse(channel, { limit: 65536, timeout: 60000 });
      if (response.status != 200) throw new Error("The server did not provide its CA certificate.");
      const { identity } = certificate(response.data?.caPem, entry.caSha256);
      if (response.data.caSha256 && response.data.caSha256.toLowerCase() != identity) {
        throw new Error("The server returned an inconsistent CA identity.");
      }
      entry.caPem = response.data.caPem;
      entry.caSha256 = identity;
      entry.instanceId = response.data.instanceId;
    } finally {
      if (temporaryTrust) this.trust.setAgentOnionEnrollment(host, attributes, false);
      this.contexts.set(userContextId, null);
      await TorRouting.unregisterAgentContext(userContextId);
      await new Promise(resolve => Services.clearData.deleteDataFromOriginAttributesPattern(
        attributes, { onDataDeleted: resolve }
      ));
      this.contexts.delete(userContextId);
    }
  }

  observe(subject, topic) {
    if (topic != "http-on-modify-request") return;
    const channel = subject.QueryInterface(Ci.nsIHttpChannel);
    const context = channel.loadInfo.originAttributes.userContextId;
    if (context < CONTEXT_MIN || context > CONTEXT_MAX) return;
    const allowed = this.contexts.get(context);
    if (!allowed || channel.URI.prePath != new URL(allowed).origin) channel.cancel(Cr.NS_BINDING_ABORTED);
  }

  notify() { Services.obs.notifyObservers(null, TOPIC, this.activeId || ""); }
}

export const AgentRemotes = new AgentRemoteStore();
