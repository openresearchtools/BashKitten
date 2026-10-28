// SPDX-License-Identifier: AGPL-3.0-or-later
// Node equivalent of the native per-operation canceller; no global request target.
const { AsyncLocalStorage } = require("node:async_hooks");
const scope = new AsyncLocalStorage();
module.exports = {
  run: (context, work) => scope.run(context, work),
  current: () => scope.getStore(),
  delay(milliseconds) {
    const signal = scope.getStore()?.signal;
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, milliseconds);
      const abort = () => {
        clearTimeout(timer);
        cleanup();
        reject(signal.reason);
      };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
    });
  },
};
