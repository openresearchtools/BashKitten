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
    this.worker.on("error", (error) =>
      this.fail("Native References worker is unavailable", error),
    );
    this.worker.on("exit", (code) => {
      if (!this.closed)
        this.fail("Native References worker exited (" + code + ")");
    });
  }
  fail(message, cause) {
    this.failure ||= Object.assign(new Error(message, { cause }), {
      status: 503,
    });
    for (const p of this.pending.values()) {
      p.cleanup();
      p.reject(this.failure);
    }
    this.pending.clear();
  }
  call(
    method,
    args = [],
    signal,
    onProgress,
    { waitForCancellation = false, syncCancellation = false } = {},
  ) {
    signal?.throwIfAborted();
    if (this.failure) throw this.failure;
    if (this.pending.size >= 32)
      throw Object.assign(Error("Native reference work is busy"), {
        status: 429,
      });
    return new Promise((resolve, reject) => {
      const cancelBuffer = syncCancellation
        ? new SharedArrayBuffer(4)
        : undefined;
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
        if (cancelBuffer) Atomics.store(new Int32Array(cancelBuffer), 0, 1);
        p.abortReason = signal.reason;
        try {
          this.worker.postMessage({ id, cancel: true });
        } catch (error) {
          this.fail("Native References worker is unavailable", error);
        }
        if (!waitForCancellation) reject(signal.reason);
      };
      p.cleanup = () => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, p);
      try {
        this.worker.postMessage({ id, method, args, cancelBuffer });
      } catch (error) {
        this.pending.delete(id);
        p.cleanup();
        reject(Object.assign(error, { status: 400 }));
      }
    });
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.fail("Native References stopped");
    this.closePromise = this.worker.terminate().then(() => undefined);
    return this.closePromise;
  }
}
