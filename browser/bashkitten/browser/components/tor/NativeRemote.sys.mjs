/* SPDX-License-Identifier: AGPL-3.0-only */
import { Subprocess } from "resource://gre/modules/Subprocess.sys.mjs";
import { AsyncShutdown } from "resource://gre/modules/AsyncShutdown.sys.mjs";

/** Browser-private pipes to the shared native client, with acknowledged NSS persistence. */
export class NativeRemote {
  next = 0;
  pending = new Map();
  queue = Promise.resolve();
  closed = false;

  static async open(saveToken, failed = () => {}) {
    const client = new NativeRemote();
    client.saveToken = saveToken; client.failed = failed;
    client.process = await Subprocess.call({
      command: "/usr/lib/bashkitten/auth/bin/bashkitten-remote", arguments: ["--client"], stderr: "pipe",
    });
    client.shutdown = () => client.close();
    AsyncShutdown.profileBeforeChange.addBlocker("BashKitten: close native remote", client.shutdown);
    client.read().catch(() => client.fail("Native remote connection stopped."));
    // Diagnostics never contain private protocol messages or enter browser logs.
    (async () => { while (await client.process.stderr.readString()) {} })().catch(() => {});
    client.process.wait().then(() => client.fail("Native remote connection stopped."), () => client.fail("Native remote connection stopped."));
    return client;
  }

  async read() {
    let buffered = "";
    for (let chunk; (chunk = await this.process.stdout.readString());) {
      buffered += chunk;
      let newline;
      while ((newline = buffered.indexOf("\n")) >= 0) {
        const response = JSON.parse(buffered.slice(0, newline)); buffered = buffered.slice(newline + 1);
        if (response.event === "save-token") {
          let saved = false;
          try { if (!this.closed) { await this.saveToken(response.token); saved = true; } }
          catch { saved = false; }
          finally { delete response.token; }
          await this.process.stdin.write(JSON.stringify({ method: "token-saved", params: saved }) + "\n");
          if (!saved) throw new Error("Encrypted token persistence failed.");
          continue;
        }
        const pending = this.pending.get(response.id);
        if (!pending) throw new Error("Invalid native remote response.");
        this.pending.delete(response.id);
        if (response.error) pending.reject(new Error(response.error));
        else if (Object.hasOwn(response, "result")) pending.resolve(response.result);
        else pending.reject(new Error("Invalid native remote response."));
      }
    }
    this.fail("Native remote connection stopped.");
  }

  call(method, params = {}) {
    const operation = this.queue.then(async () => {
      if (this.closed) throw new Error("Remote connection is closed.");
      const id = ++this.next;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.process.stdin.write(JSON.stringify({ id, method, params }) + "\n")
          .catch(() => this.fail("Native remote pipe closed."));
      });
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  fail(message) {
    if (this.closed) return;
    this.close().catch(() => {});
    this.failed(message);
  }

  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(new Error("Remote connection closed."));
    this.pending.clear();
    AsyncShutdown.profileBeforeChange.removeBlocker(this.shutdown);
    this.closing = (async () => {
      await this.process.stdin.close().catch(() => {});
      await this.process.kill(1000);
      await this.process.wait();
    })();
    return this.closing;
  }
}
