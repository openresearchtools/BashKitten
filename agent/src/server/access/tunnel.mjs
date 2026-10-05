// SPDX-License-Identifier: AGPL-3.0-only
// Private child protocol only. The existing AccessStack owns process cleanup;
// no web request may forward arbitrary methods/parameters to this object.
import { createInterface } from 'node:readline';
import { binary } from './paths.mjs';

export class NativeTunnel {
  constructor(record) {
    this.child = record.child;
    this.pending = new Map(); this.next = 0;
    this.closed = false;
    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    const failed = () => {
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(Error('Native tunnel controller stopped'));
      this.pending.clear();
    };
    lines.on('line', text => {
      let response;
      try { response = JSON.parse(text); } catch { this.child.stdin.destroy(); failed(); return; }
      const pending = this.pending.get(response.id);
      if (!pending || (typeof response.error !== 'string' && !Object.hasOwn(response, 'result'))) {
        this.child.stdin.destroy(); failed(); return;
      }
      this.pending.delete(response.id);
      if (response.error) pending.reject(Error(response.error));
      else pending.resolve(response.result);
    });
    this.child.once('exit', failed);
    this.child.stdin.on('error', failed);
    this.child.stdout.on('error', failed);
    lines.once('close', failed);
  }
  static async launch(stack) {
    return new NativeTunnel(await stack.launch('remote', binary('bashkitten-remote'), [], process.env, { pipe: true }));
  }
  call(method, params = {}) {
    if (this.closed) return Promise.reject(Error('Native tunnel controller is stopped'));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
        if (error) { this.pending.delete(id); reject(Error('Native tunnel controller pipe closed')); }
      });
    });
  }
}
