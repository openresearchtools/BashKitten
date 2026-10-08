// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { launchInference } from './launch.mjs';

const active = state => ['loading', 'checking'].includes(state);
const ownerId = owner => { if (!/^[a-f0-9-]{36}$/i.test(owner || '')) throw Error('A model check needs its native view identifier'); return owner; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** One temporary guarded router. A visible-view lease bounds abandoned checks. */
export class RouterModelTest {
  constructor() { this.current = null; }
  get busy() { return Boolean(this.current && active(this.current.state)); }
  status({ owner }) {
    ownerId(owner);
    const item = this.current;
    if (!item || item.owner !== owner) return { state: 'idle' };
    if (active(item.state) && !item.abort.signal.aborted) this.renew(item);
    return { id: item.id, state: item.state, model: item.model, ...(item.error ? { error: item.error } : {}) };
  }
  renew(item) {
    clearTimeout(item.lease);
    item.lease = setTimeout(() => item.abort.abort(Error('Model check closed or paused')), 30000);
    item.lease.unref();
  }
  async start({ owner, model, prepare, request }) {
    ownerId(owner);
    if (this.busy) throw Error('Another model load check is still running or unloading');
    const item = { owner, id: randomUUID(), model, state: 'loading', abort: new AbortController() };
    this.current = item; this.renew(item);
    item.done = this.run(item, prepare, request);
    return this.status({ owner });
  }
  async run(item, prepare, request) {
    let directory, child, ended, failure, passed = false, diagnostics = '';
    const signal = item.abort.signal;
    try {
      const prepared = await prepare(signal);
      directory = prepared.directory;
      signal.throwIfAborted();
      child = launchInference(prepared.command, { diagnostics: true });
      child.stdin?.end(); child.stdout?.resume();
      // Ephemeral engine diagnostics only. Never create a transcript or log file.
      child.stderr?.on('data', bytes => { diagnostics = (diagnostics + bytes.toString()).slice(-16384); });
      let exited = false, exitError;
      ended = new Promise(resolve => {
        child.once('error', error => { exitError = error; });
        child.once('close', code => { exited = true; resolve(code); });
      });
      const check = () => { signal.throwIfAborted(); if (exited) throw exitError || Error('The temporary router exited before loading the model' + (diagnostics.trim() ? '\n' + diagnostics.trim() : '')); };
      let catalog;
      for (;;) {
        check();
        try { catalog = await request(prepared, '/models', { signal }); break; }
        catch (error) { check(); if (!error.loading && !['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET'].includes(error.cause?.code)) throw error; }
        await pause(250);
      }
      const models = catalog.data || catalog.models || [];
      if (!models.some(model => model.id === prepared.model)) throw Error('The selected INI model was not offered by the temporary router');
      check();
      await request(prepared, '/models/load', { signal, data: { model: prepared.model } });
      item.state = 'checking';
      for (;;) {
        check();
        const result = await request(prepared, '/models', { signal });
        const model = (result.data || result.models || []).find(entry => entry.id === prepared.model);
        if (!model || model.status?.failed) throw Error('The selected model failed to load' + (diagnostics.trim() ? '\n' + diagnostics.trim() : ''));
        if (model.status?.value === 'loaded') { passed = true; break; }
        await pause(250);
      }
    } catch (error) { failure = error; }
    finally {
      // Keep the state active while unloading. runtime-guard exits only after
      // reaping all of its children, including a router's model subprocesses.
      if (child) { child.kill('SIGTERM'); await ended; }
      if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(error => { failure ||= error; });
      clearTimeout(item.lease);
      item.state = signal.aborted ? 'cancelled' : passed && !failure ? 'passed' : 'failed';
      if (failure && !signal.aborted) item.error = failure.message;
    }
  }
  async cancel({ owner } = {}) {
    const item = this.current;
    if (owner !== undefined) ownerId(owner);
    if (item && (owner === undefined || item.owner === owner) && active(item.state)) { item.abort.abort(Error('Model check cancelled')); await item.done; }
    return owner ? this.status({ owner }) : { state: item?.state || 'idle' };
  }
}
