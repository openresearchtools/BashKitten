/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { BrowserControl } from "chrome://remote/content/bashkitten/BrowserControl.sys.mjs";
import { handleBashKittenCommand } from "resource:///modules/BashKittenCommand.sys.mjs";
import { NetUtil } from "resource://gre/modules/NetUtil.sys.mjs";
import { Subprocess } from "resource://gre/modules/Subprocess.sys.mjs";
import { clearTimeout, setTimeout } from "resource://gre/modules/Timer.sys.mjs";

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const CONTROL_SOCKET_ENV = "BASHKITTEN_CONTROL_SOCKET";
const LocalFile = Components.Constructor(
  "@mozilla.org/file/local;1",
  "nsIFile",
  "initWithPath"
);
const UnixServerSocket = Components.Constructor(
  "@mozilla.org/network/server-socket;1",
  "nsIServerSocket",
  "initWithFilename"
);

function bytesFromBinaryString(source) {
  return Uint8Array.from(source, character => character.charCodeAt(0));
}

function writeResponse(output, value) {
  const input = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(
    Ci.nsIStringInputStream
  );
  input.setUTF8Data(`${JSON.stringify(value)}\n`);
  return new Promise((resolve, reject) => {
    NetUtil.asyncCopy(input, output, status => {
      if (Components.isSuccessCode(status)) {
        resolve();
      } else {
        reject(Components.Exception("BashKitten response failed", status));
      }
    });
  });
}

function validatedOverridePath() {
  const value = Services.env.get(CONTROL_SOCKET_ENV);
  if (!value) {
    return null;
  }
  const hasControlCharacter = [...value].some(character => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (
    !PathUtils.isAbsolute(value) ||
    value.includes("//") ||
    value.split("/").some(part => part === "." || part === "..") ||
    value.endsWith("/") ||
    !PathUtils.filename(value) ||
    hasControlCharacter
  ) {
    throw new Error(`${CONTROL_SOCKET_ENV} must be a normalized absolute path`);
  }
  return value;
}

function defaultSocketDirectory() {
  const runtimeDirectory = Services.env.get("XDG_RUNTIME_DIR");
  if (runtimeDirectory && PathUtils.isAbsolute(runtimeDirectory)) {
    return PathUtils.join(runtimeDirectory, "bashkitten", "control");
  }
  const homeDirectory = Services.dirsvc.get("Home", Ci.nsIFile).path;
  const stateDirectory = Services.env.get("XDG_STATE_HOME");
  const base =
    stateDirectory && PathUtils.isAbsolute(stateDirectory)
      ? stateDirectory
      : PathUtils.join(homeDirectory, ".local", "state");
  return PathUtils.join(base, "bashkitten", "run", "control");
}

export function bashKittenControlSocketPath({
  instanceId = ChromeUtils.base64URLEncode(
    crypto.getRandomValues(new Uint8Array(9)),
    { pad: false }
  ),
} = {}) {
  const override = validatedOverridePath();
  if (override) {
    return override;
  }
  if (!/^[A-Za-z0-9_-]{12}$/.test(instanceId)) {
    throw new Error("Invalid BashKitten control socket instance ID");
  }
  return PathUtils.join(
    defaultSocketDirectory(),
    `control-${instanceId}.sock`
  );
}

async function prepareDirectory(path, create) {
  if (create) {
    await IOUtils.makeDirectory(path, {
      createAncestors: true,
      ignoreExisting: true,
      permissions: 0o700,
    });
  }
  let mode = await fileMode(path);
  if ((mode & 0o170000) !== 0o040000) {
    throw new Error("Unsafe BashKitten runtime directory");
  }
  if (create) {
    await IOUtils.setPermissions(path, 0o700, false);
    mode = await fileMode(path);
  }
  if ((mode & 0o077) !== 0) {
    throw new Error("Insecure BashKitten runtime directory permissions");
  }
}

async function fileMode(path) {
  // IOUtils.stat follows links. Keep the socket boundary's no-follow checks,
  // with filesystem access in a subprocess instead of the browser UI thread.
  const process = await Subprocess.call({
    command: "/usr/bin/stat", arguments: ["--format=%f", "--", path], stderr: "stdout",
  });
  let output = "";
  for (let chunk; (chunk = await process.stdout.readString());) output += chunk;
  const { exitCode } = await process.wait();
  if (exitCode || !/^[a-f0-9]+\n$/.test(output)) throw new Error("Could not inspect the BashKitten control path");
  return parseInt(output, 16);
}

// Inspect and probe in the bundled runtime, keeping filesystem/socket work off
// the UI thread. A refused connection is the only evidence that permits reclaim.
const SOCKET_FILE_SCRIPT = String.raw`
const fs = require("node:fs"), net = require("node:net"), path = require("node:path");
const [action, file, expected] = process.argv.slice(1);
const identity = stat => [stat.dev, stat.ino, stat.uid, stat.mode, stat.ctimeNs].join(":");
function inspect(file, directory = false) {
  let stat;
  try { stat = fs.lstatSync(file, {bigint: true}); }
  catch (error) { if (!directory && error.code === "ENOENT") return null; throw error; }
  if (stat.uid !== BigInt(process.getuid()) ||
      (directory ? !stat.isDirectory() : !stat.isSocket()) ||
      (stat.mode & 0o777n) !== (directory ? 0o700n : 0o600n)) {
    throw Error("Unsafe BashKitten control path ownership, type or permissions");
  }
  return identity(stat);
}
async function main() {
  const parent = path.dirname(file), directory = inspect(parent, true);
  const current = inspect(file);
  if (action === "identify") {
    if (!current) throw Error("BashKitten control socket disappeared");
    return current;
  }
  if (!current) return null;
  if (action === "prepare") {
    await new Promise((resolve, reject) => {
      const socket = net.createConnection(file);
      const finish = error => { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(); };
      const timer = setTimeout(() => finish(Error("BashKitten control socket probe timed out")), 1000);
      socket.once("connect", () => finish(Error("BashKitten control socket is already in use")));
      socket.once("error", error => finish(error.code === "ECONNREFUSED" ? null : error));
    });
  } else if (action !== "remove" || current !== expected) {
    throw Error("BashKitten control socket ownership changed");
  }
  // No asynchronous work between the final identity check and unlink. A new
  // listener winning the subsequent bind race still fails through normal bind.
  if (inspect(parent, true) !== directory || inspect(file) !== current) {
    throw Error("BashKitten control socket ownership changed");
  }
  fs.unlinkSync(file);
  return null;
}
main().then(value => console.log(JSON.stringify({value})), error => {
  console.log(JSON.stringify({error: error.message})); process.exitCode = 1;
});
`;

async function socketFileOperation(action, path, identity = "") {
  const process = await Subprocess.call({
    command: "/usr/lib/bashkitten/node/bin/node",
    arguments: ["-e", SOCKET_FILE_SCRIPT, action, path, identity], stderr: "stdout",
  });
  const timeout = setTimeout(() => { void process.kill(0).catch(console.error); }, 5000);
  try {
    let output = "";
    for (let chunk; (chunk = await process.stdout.readString());) output += chunk;
    const { exitCode } = await process.wait();
    let result;
    try { result = JSON.parse(output); } catch {}
    if (exitCode || !result || result.error) throw Error(result?.error || "Could not inspect the BashKitten control socket");
    return result.value;
  } finally { clearTimeout(timeout); }
}

/** Handles one native command connection. */
class CommandConnection {
  constructor(transport, socketPath, onClose) {
    this.transport = transport;
    this.socketPath = socketPath;
    this.onClose = onClose;
    this.controller = new AbortController();
    this.decoder = new TextDecoder();
    this.source = "";
    this.received = 0;
    this.handled = false;
  }

  start() {
    this.input = this.transport.openInputStream(0, 0, 0);
    this.output = this.transport
      .openOutputStream(0, 0, 0)
      .QueryInterface(Ci.nsIAsyncOutputStream);
    this.pump = Cc["@mozilla.org/network/input-stream-pump;1"].createInstance(
      Ci.nsIInputStreamPump
    );
    this.pump.init(this.input, 0, 0, false);
    this.pump.asyncRead(this);
  }

  onStartRequest() {}

  onDataAvailable(request, stream, _offset, count) {
    if (this.handled) {
      request.cancel(Cr.NS_ERROR_UNEXPECTED);
      return;
    }
    const reader = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(
      Ci.nsIScriptableInputStream
    );
    reader.init(stream);
    const chunk = reader.readBytes(count);
    this.received += chunk.length;
    if (this.received > MAX_REQUEST_BYTES) {
      request.cancel(Cr.NS_ERROR_FILE_TOO_BIG);
      this.fail(new Error("BashKitten command request is too large"));
      return;
    }
    this.source += this.decoder.decode(bytesFromBinaryString(chunk), {
      stream: true,
    });
    const newline = this.source.indexOf("\n");
    if (newline < 0) {
      return;
    }
    if (this.source.slice(newline + 1).trim()) {
      request.cancel(Cr.NS_ERROR_UNEXPECTED);
      this.fail(new Error("BashKitten accepts one command per connection"));
      return;
    }
    let command;
    try {
      command = JSON.parse(this.source.slice(0, newline));
    } catch {
      this.fail(new Error("Invalid BashKitten command JSON"));
      return;
    }
    this.handled = true;
    handleBashKittenCommand(
      { ...command, socketPath: this.socketPath },
      this.controller.signal
    ).then(
      response => this.respond(response),
      error =>
        this.respond({
          exitCode: 1,
          stdout: "",
          stderr: `bashkitten: ${error?.message || String(error)}\n`,
        })
    );
  }

  onStopRequest(_request, status) {
    if (this.handled) {
      if (!this.responded) {
        this.controller.abort();
      }
      this.close();
      return;
    }
    if (!this.handled && Components.isSuccessCode(status)) {
      this.fail(new Error("Incomplete BashKitten command request"));
    } else if (!Components.isSuccessCode(status) && !this.handled) {
      this.close();
    }
  }

  async respond(value) {
    try {
      await writeResponse(this.output, value);
      this.responded = true;
      this.output = null;
      this.closeTimer = setTimeout(() => this.close(), 1000);
      return;
    } catch (error) {
      console.error("BashKitten command response failed", error);
    }
    this.close();
  }

  fail(error) {
    if (this.handled) {
      return;
    }
    this.handled = true;
    this.respond({
      exitCode: 1,
      stdout: "",
      stderr: `bashkitten: ${error.message}\n`,
    });
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    clearTimeout(this.closeTimer);
    this.controller.abort();
    try {
      this.input?.close();
    } catch {}
    try {
      this.output?.close();
    } catch {}
    try {
      this.transport.close(Cr.NS_OK);
    } catch {}
    this.onClose(this);
  }
}

export const BashKittenControlStartup = {
  init() {
    if (this.task) {
      return this.task;
    }
    this.connections = new Set();
    try {
      this.customPath = Boolean(validatedOverridePath());
      this.path = bashKittenControlSocketPath();
    } catch (error) {
      console.error("BashKitten control startup failed", error);
      this.task = Promise.resolve(null);
      return this.task;
    }
    this.ownsSocket = false;
    BrowserControl.start();
    this.task = this.listen().catch(async error => {
      await this.closeSocket();
      BrowserControl.stop();
      console.error("BashKitten control startup failed", error);
      return null;
    });
    return this.task;
  },

  async listen() {
    await prepareDirectory(PathUtils.parent(this.path), !this.customPath);
    await socketFileOperation("prepare", this.path);
    const socketFile = new LocalFile(this.path);
    this.server = new UnixServerSocket(socketFile, 0o600, 16);
    this.ownsSocket = true;
    this.server.asyncListen({
      onSocketAccepted: (_server, transport) => {
        const connection = new CommandConnection(transport, this.path, value =>
          this.connections.delete(value)
        );
        this.connections.add(connection);
        connection.start();
      },
      onStopListening() {},
    });
    await IOUtils.setPermissions(this.path, 0o600, false);
    this.socketIdentity = await socketFileOperation("identify", this.path);
    return { socketPath: this.path, browserPid: Services.appinfo.processID };
  },

  async closeSocket() {
    try {
      this.server?.close();
    } catch {}
    if (this.path && this.ownsSocket && this.socketIdentity) {
      try { await socketFileOperation("remove", this.path, this.socketIdentity); } catch {}
    }
    this.server = null;
    this.ownsSocket = false;
    this.socketIdentity = null;
  },

  async uninit() {
    await this.task?.catch(() => {});
    await this.closeSocket();
    for (const connection of this.connections ?? []) {
      connection.close();
    }
    this.connections?.clear();
    BrowserControl.stop();
    this.task = null;
    this.path = null;
    this.server = null;
    this.customPath = false;
    this.ownsSocket = false;
  },
};
