// SPDX-License-Identifier: AGPL-3.0-or-later
import { Worker } from "node:worker_threads";
export class Store {
  constructor() {
    this.pending = new Map();
    this.next = 0;
    this.worker = new Worker(new URL("./worker.mjs", import.meta.url));
    this.worker.on("message", ({ id, result, error }) => {
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      p.cleanup();
      if (!p.cancelled)
        error
          ? p.reject(Object.assign(Error(error.message), error))
          : p.resolve(result);
    });
    this.worker.on("error", (error) => {
      for (const p of this.pending.values()) {
        p.cleanup();
        p.reject(error);
      }
      this.pending.clear();
    });
  }
  call(file, operation, args = {}, signal) {
    signal?.throwIfAborted();
    if (this.pending.size >= 64)
      throw Object.assign(
        Error("References is busy; retry after pending work finishes"),
        { status: 429 },
      );
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const abort = () => {
        p.cancelled = true;
        reject(signal.reason || new DOMException("Cancelled", "AbortError"));
      };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const p = { resolve, reject, cleanup, cancelled: false };
      this.pending.set(id, p);
      signal?.addEventListener("abort", abort, { once: true });
      this.worker.postMessage({ id, file, operation, args });
    });
  }
  async close() {
    for (const p of this.pending.values()) {
      p.cleanup();
      p.reject(Error("References stopped"));
    }
    this.pending.clear();
    await this.worker.terminate();
  }
}
