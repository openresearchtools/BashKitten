/* SPDX-License-Identifier: GPL-3.0-only */

import { NetUtil } from "resource://gre/modules/NetUtil.sys.mjs";
import { AsyncShutdown } from "resource://gre/modules/AsyncShutdown.sys.mjs";
import { TorRouting } from "resource:///modules/TorRouting.sys.mjs";
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";

const HOP_HEADERS = new Set([
  "connection", "proxy-connection", "keep-alive", "transfer-encoding", "te",
  "trailer", "upgrade", "proxy-authenticate", "proxy-authorization",
]);
const PRIVATE_HEADERS = new Set([
  "authorization", "cookie", "host", "origin", "referer", "forwarded",
]);

function readBytes(stream, count) {
  const input = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(Ci.nsIScriptableInputStream);
  input.init(stream);
  return input.read(count);
}

/** A bounded write: the producer remains suspended until the socket drains. */
function writeBytes(stream, data) {
  return new Promise((resolve, reject) => {
    let position = 0;
    const callback = {
      onOutputStreamReady(output) {
        try {
          while (position < data.length) {
            const written = output.write(data.slice(position), data.length - position);
            if (!written) {
              break;
            }
            position += written;
          }
          if (position == data.length) {
            resolve();
            return;
          }
        } catch (error) {
          if (error.result != Cr.NS_BASE_STREAM_WOULD_BLOCK) {
            reject(error);
            return;
          }
        }
        output.asyncWait(callback, 0, 0, Services.tm.currentThread);
      },
    };
    stream.asyncWait(callback, 0, 0, Services.tm.currentThread);
  });
}

export function remoteChannel(connection, path = "/") {
  if (!/^https:\/\/[a-z2-7]{56}\.onion(?::\d+)?\/$/.test(connection.url)) {
    throw new Error("The relay requires an enrolled HTTPS onion endpoint.");
  }
  if (!path.startsWith("/") || path.startsWith("//") || /[\x00-\x20\x7f#\\]/.test(path)) {
    throw new Error("Invalid API path.");
  }
  const uri = Services.io.newURI(connection.url.slice(0, -1) + path);
  const principal = Services.scriptSecurityManager.createContentPrincipal(uri, {
    userContextId: connection.userContextId,
  });
  const channel = NetUtil.newChannel({
    uri,
    loadingPrincipal: principal,
    securityFlags: Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
    contentPolicyType: Ci.nsIContentPolicy.TYPE_OTHER,
  }).QueryInterface(Ci.nsIHttpChannel);
  // TorRouting owns this context and has no direct fallback. Neither the local
  // caller nor the remote endpoint can reuse Agent browser authentication.
  channel.loadFlags |= Ci.nsIRequest.LOAD_ANONYMOUS | Ci.nsIRequest.LOAD_BYPASS_CACHE;
  channel.QueryInterface(Ci.nsIEncodedChannel).applyConversion = false;
  channel.setRequestHeader("Authorization", `Bearer ${connection.bearerToken}`, false);
  channel.setRequestHeader("Accept-Encoding", "identity", false);
  channel.redirectionLimit = 0;
  return channel;
}

class RelayRequest {
  constructor(relay, transport) {
    this.relay = relay;
    this.transport = transport;
    this.output = transport.openOutputStream(0, 0, 0).QueryInterface(Ci.nsIAsyncOutputStream);
    this.pump = Cc["@mozilla.org/network/input-stream-pump;1"].createInstance(Ci.nsIInputStreamPump);
    this.pump.init(transport.openInputStream(0, 0, 0), 65536, 2, true);
    this.buffer = "";
    this.pendingOutput = Promise.resolve();
    this.timer = setTimeout(() => this.fail(408, "Request timed out"), 30000);
    this.pump.asyncRead(this);
  }

  QueryInterface = ChromeUtils.generateQI(["nsIStreamListener", "nsIRequestObserver"]);

  onStartRequest() {}

  onDataAvailable(request, stream, _offset, count) {
    const bytes = readBytes(stream, count);
    request.suspend();
    this.consume(bytes).catch(() => this.fail(400, "Invalid request")).finally(() => {
      try { request.resume(); } catch {}
    });
  }

  onStopRequest() {
    if (!this.closed) {
      this.close();
    }
  }

  async consume(bytes) {
    if (this.closed) {
      return;
    }
    if (!this.upstream) {
      this.buffer += bytes;
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end < 0) {
        return;
      }
      const head = this.buffer.slice(0, end);
      bytes = this.buffer.slice(end + 4);
      this.buffer = "";
      await this.open(head);
      if (this.started || this.closed) return;
    }
    if (!this.upload) {
      if (bytes.length) {
        throw new Error("Pipelined requests are not supported.");
      }
      return;
    }
    if (!this.chunked) {
      if (bytes.length > this.remaining) {
        throw new Error("Invalid request length.");
      }
      await writeBytes(this.upload, bytes);
      this.remaining -= bytes.length;
      if (!this.remaining) {
        this.upload = null;
      }
      return;
    }
    this.buffer += bytes;
    while (this.buffer.length) {
      if (this.chunkRemaining == null) {
        const end = this.buffer.indexOf("\r\n");
        if (end < 0) {
          return;
        }
        const length = this.buffer.slice(0, end);
        if (!/^[0-9a-fA-F]+$/.test(length) || !Number.isSafeInteger(Number.parseInt(length, 16))) {
          throw new Error("Invalid chunk length.");
        }
        this.chunkRemaining = Number.parseInt(length, 16);
        this.buffer = this.buffer.slice(end + 2);
      }
      if (this.chunkRemaining) {
        const count = Math.min(this.chunkRemaining, this.buffer.length);
        await writeBytes(this.upload, count.toString(16) + "\r\n" + this.buffer.slice(0, count) + "\r\n");
        this.buffer = this.buffer.slice(count);
        this.chunkRemaining -= count;
        if (this.chunkRemaining) {
          return;
        }
        this.chunkTerminator = true;
      }
      if (this.buffer.length < 2) {
        return;
      }
      if (!this.buffer.startsWith("\r\n")) {
        throw new Error("Chunk trailers are not supported.");
      }
      this.buffer = this.buffer.slice(2);
      if (!this.chunkTerminator) {
        if (this.buffer.length) {
          throw new Error("Pipelined requests are not supported.");
        }
        await writeBytes(this.upload, "0\r\n\r\n");
        this.upload = null;
        return;
      }
      this.chunkTerminator = false;
      this.chunkRemaining = null;
    }
  }

  async open(head) {
    const lines = head.split("\r\n");
    const request = /^([A-Z]+) (\/[^\x00-\x20\x7f]*) HTTP\/1\.[01]$/.exec(lines.shift());
    if (!request || ["CONNECT", "TRACE"].includes(request[1]) ||
        request[2].startsWith("//") || /[\\#]/.test(request[2])) {
      throw new Error("Unsupported request.");
    }
    const headers = new Map();
    for (const line of lines) {
      const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([^\x00-\x08\x0a-\x1f\x7f]*)$/.exec(line);
      if (!match || headers.has(match[1].toLowerCase())) {
        throw new Error("Invalid or duplicate request header.");
      }
      headers.set(match[1].toLowerCase(), match[2].trim());
    }
    // DNS rebinding and cross-origin pages cannot spend the stored token. This
    // endpoint is deliberately available to trusted native local clients only.
    if (headers.get("host") != `127.0.0.1:${this.relay.port}` ||
        headers.has("origin") || headers.has("sec-fetch-site") ||
        headers.has("upgrade") || headers.has("trailer")) {
      this.fail(403, "Only native loopback clients may use this endpoint");
      return;
    }
    const length = headers.get("content-length");
    const encoding = headers.get("transfer-encoding");
    if ((length !== undefined && encoding !== undefined) ||
        (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) ||
        (encoding !== undefined && encoding.toLowerCase() != "chunked")) {
      throw new Error("Invalid request framing.");
    }
    this.remaining = Number(length || 0);
    this.chunked = !!encoding;
    const endpoint = new URL(this.relay.connection.url);
    if (endpoint.protocol != "https:" || !/^[a-z2-7]{56}\.onion$/.test(endpoint.hostname)) {
      throw new Error("An enrolled HTTPS onion endpoint is required.");
    }
    // Raw HTTP over Gecko's verified TLS transport avoids Necko's normal
    // seekable-upload normalization, which buffers an entire streaming upload.
    const socksPort = await TorRouting.ensureProxy();
    if (this.closed) return;
    const isolation = `bashkitten-relay-${this.relay.connection.userContextId}`;
    const proxy = Cc["@mozilla.org/network/protocol-proxy-service;1"].getService(Ci.nsIProtocolProxyService)
      .newProxyInfoWithAuth("socks", "127.0.0.1", socksPort, isolation, isolation, "", isolation,
        Ci.nsIProxyInfo.TRANSPARENT_PROXY_RESOLVES_HOST, 10, null);
    this.upstream = Cc["@mozilla.org/network/socket-transport-service;1"].getService(Ci.nsISocketTransportService)
      .createTransport(["ssl"], endpoint.hostname, Number(endpoint.port || 443), proxy, null);
    this.upstream.originAttributes = { userContextId: this.relay.connection.userContextId };
    this.upstream.connectionFlags |= Ci.nsISocketTransport.ANONYMOUS_CONNECT;
    this.upstreamOutput = this.upstream.openOutputStream(0, 0, 0).QueryInterface(Ci.nsIAsyncOutputStream);
    let outgoing = `${request[1]} ${request[2]} HTTP/1.1\r\nHost: ${endpoint.host}\r\nConnection: close\r\nAuthorization: Bearer ${this.relay.connection.bearerToken}\r\n`;
    const nominated = new Set((headers.get("connection") || "").toLowerCase().split(/\s*,\s*/));
    for (const [name, value] of headers) {
      if (HOP_HEADERS.has(name) || PRIVATE_HEADERS.has(name) || nominated.has(name) ||
          name.startsWith("x-forwarded-") || name == "content-length" || name == "expect" ||
          name == "accept-encoding") {
        continue;
      }
      outgoing += `${name}: ${value}\r\n`;
    }
    outgoing += this.chunked ? "Transfer-Encoding: chunked\r\n" : `Content-Length: ${this.remaining}\r\n`;
    if (this.remaining || this.chunked) {
      this.upload = this.upstreamOutput;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fail(504, "The endpoint did not respond"), 120000);
    if (headers.get("expect")) {
      if (headers.get("expect").toLowerCase() != "100-continue") {
        throw new Error("Unsupported expectation.");
      }
      this.pendingOutput = writeBytes(this.output, "HTTP/1.1 100 Continue\r\n\r\n");
    }
    this.responseHead = "";
    this.responsePump = Cc["@mozilla.org/network/input-stream-pump;1"].createInstance(Ci.nsIInputStreamPump);
    this.responsePump.init(this.upstream.openInputStream(0, 0, 0), 65536, 2, true);
    this.responsePump.asyncRead({
      onStartRequest() {},
      onDataAvailable: (request, stream, _offset, count) => {
        const bytes = readBytes(stream, count);
        request.suspend();
        this.pendingOutput = this.pendingOutput.then(() => this.consumeResponse(bytes));
        this.pendingOutput.catch(() => this.close()).finally(() => {
          try { request.resume(); } catch {}
        });
      },
      onStopRequest: (_request, status) => {
        if (!this.started) {
          this.fail(502, "The enrolled endpoint is unavailable");
        } else {
          this.pendingOutput.catch(() => {}).finally(() => this.close());
        }
      },
    });
    await writeBytes(this.upstreamOutput, outgoing + "\r\n");
  }

  async consumeResponse(bytes) {
    if (this.started) {
      await writeBytes(this.output, bytes);
      return;
    }
    this.responseHead += bytes;
    const end = this.responseHead.indexOf("\r\n\r\n");
    if (end < 0) {
      return;
    }
    const lines = this.responseHead.slice(0, end).split("\r\n");
    const status = /^HTTP\/1\.[01] ([1-5]\d\d) ([^\x00-\x1f\x7f]*)$/.exec(lines.shift());
    if (!status || status[1] == "101") throw new Error("Invalid API response.");
    bytes = this.responseHead.slice(end + 4);
    this.responseHead = "";
    if (Number(status[1]) < 200) {
      if (bytes) await this.consumeResponse(bytes);
      return;
    }
    this.started = true;
    clearTimeout(this.timer);
    const headers = [];
    for (const line of lines) {
      const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([^\x00-\x08\x0a-\x1f\x7f]*)$/.exec(line);
      if (!match) throw new Error("Invalid response header.");
      headers.push([match[1].toLowerCase(), match[2].trim()]);
    }
    const nominated = new Set((headers.find(([name]) => name == "connection")?.[1] || "").toLowerCase().split(/\s*,\s*/));
    let head = `HTTP/1.1 ${status[1]} ${status[2]}\r\nConnection: close\r\n`;
    for (const [name, value] of headers) {
      if ((HOP_HEADERS.has(name) && name != "transfer-encoding") || nominated.has(name) || name == "set-cookie" ||
          name.startsWith("access-control-") || /[\r\n]/.test(value)) {
        continue;
      }
      // Never turn a remote redirect into a browser-local credentialed proxy.
      if (name == "location") {
        const target = new URL(value, this.relay.connection.url);
        if (target.origin != new URL(this.relay.connection.url).origin) {
          continue;
        }
      }
      head += `${name}: ${value}\r\n`;
    }
    await writeBytes(this.output, head + "\r\n" + bytes);
  }

  fail(status, message) {
    if (this.closed) {
      return;
    }
    if (this.started) {
      this.close();
      return;
    }
    this.started = true;
    this.responsePump?.cancel(Cr.NS_BINDING_ABORTED);
    writeBytes(this.output, `HTTP/1.1 ${status} Error\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${message.length}\r\n\r\n${message}`)
      .catch(() => {}).finally(() => this.close());
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    clearTimeout(this.timer);
    try { this.responsePump?.cancel(Cr.NS_BINDING_ABORTED); } catch {}
    try { this.pump.cancel(Cr.NS_BINDING_ABORTED); } catch {}
    try { this.upload?.close(); } catch {}
    try { this.upstreamOutput?.close(); } catch {}
    try { this.upstream?.close(Cr.NS_OK); } catch {}
    try { this.output.close(); } catch {}
    try { this.transport.close(Cr.NS_OK); } catch {}
    this.relay.requests.delete(this);
  }
}

export class LlamaRelay {
  constructor(connection) {
    this.connection = connection;
    this.requests = new Set();
    this.port = 0;
  }

  start(port = 0) {
    if (this.socket) {
      return this.port;
    }
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error("Choose a valid local TCP port.");
    }
    const socket = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
    socket.init(port || -1, true, 32);
    this.socket = socket;
    this.port = socket.port;
    socket.asyncListen({
      onSocketAccepted: (_socket, transport) => {
        this.requests.add(new RelayRequest(this, transport));
      },
      onStopListening: () => this.stop(),
    });
    this.shutdown = () => this.stop();
    AsyncShutdown.profileBeforeChange.addBlocker("BashKitten: close llama relay", this.shutdown);
    return this.port;
  }

  stop() {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    for (const request of this.requests) {
      request.close();
    }
    this.port = 0;
    if (this.shutdown) {
      AsyncShutdown.profileBeforeChange.removeBlocker(this.shutdown);
      this.shutdown = null;
    }
  }
}
