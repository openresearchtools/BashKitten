// SPDX-License-Identifier: AGPL-3.0-or-later
import { Worker } from "node:worker_threads";
export class NativeComponents {
  constructor() {
    this.worker = new Worker(new URL("./native-worker.mjs", import.meta.url));
    this.pending = new Map();
    this.next = 0;
    this.worker.on("message", ({ id, result, error, progress }) => {
      const p = this.pending.get(id);
      if (!p) return;
      if (progress) {
        if (!p.cancelled) p.onProgress?.(progress);
        return;
      }
      this.pending.delete(id);
      p.cleanup();
      if (p.cancelled && p.waitForCancellation) p.reject(p.abortReason);
      else if (!p.cancelled)
        error
          ? p.reject(Object.assign(Error(error.message), error))
          : p.resolve(result);
    });
    this.worker.on("error", (e) => {
      for (const p of this.pending.values()) {
        p.cleanup();
        p.reject(e);
      }
      this.pending.clear();
    });
  }
  call(
    method,
    args = [],
    signal,
    onProgress,
    { waitForCancellation = false } = {},
  ) {
    signal?.throwIfAborted();
    if (this.pending.size > 32)
      throw Object.assign(Error("Native reference work is busy"), {
        status: 429,
      });
    return new Promise((resolve, reject) => {
      const id = ++this.next,
        p = {
          resolve,
          reject,
          cancelled: false,
          onProgress,
          waitForCancellation,
        };
      const abort = () => {
        p.cancelled = true;
        p.abortReason = signal.reason;
        this.worker.postMessage({ id, cancel: true });
        if (!waitForCancellation) reject(signal.reason);
      };
      p.cleanup = () => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, p);
      this.worker.postMessage({ id, method, args });
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
