import { loadPi, allowRuntimeWork } from './runtime.mjs';
import { dataDir, writeJson } from '../common.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** The same ModelRuntime and auth.json used by Pi's CLI, with no catalog network refresh. */
export class Services {
  attempt = null;
  async runtime() { const { pi: { ModelRuntime } } = await loadPi(); return ModelRuntime.create({ allowModelNetwork: false }); }
  async list() {
    const runtime = await this.runtime();
    const credentials = await runtime.listCredentials();
    return runtime.getProviders().map(provider => ({
      id: provider.id, name: provider.name || provider.id,
      connected: runtime.hasConfiguredAuth(provider.id),
      credentialType: credentials.find(c => c.providerId === provider.id)?.type,
      methods: [
        ...(provider.auth.oauth ? [{ type: 'oauth', name: provider.auth.oauth.loginLabel || provider.auth.oauth.name }] : []),
        ...(provider.auth.apiKey?.login ? [{ type: 'api_key', name: provider.auth.apiKey.name }] : [])
      ]
    }));
  }
  async models() {
    const { ai: { getSupportedThinkingLevels } } = await loadPi();
    const runtime = await this.runtime();
    const available = new Set(runtime.getAvailableSnapshot().map(m => `${m.provider}/${m.id}`));
    return runtime.getAvailableSnapshot().map(m => ({ id: m.id, provider: m.provider, name: `${m.name || m.id} · ${m.provider}`,
      contextWindow: m.contextWindow, input: m.input,
      available: available.has(`${m.provider}/${m.id}`), thinking_levels: getSupportedThinkingLevels(m),
      default_thinking: getSupportedThinkingLevels(m).includes('medium') ? 'medium' : 'off' }));
  }
  state() {
    if (!this.attempt) return null;
    const { id, provider, status, events, prompt, error } = this.attempt;
    return { id, provider, status, events, prompt, error };
  }
  async start(provider, type) {
    allowRuntimeWork();
    if (this.attempt?.status === 'pending') throw Error('Finish or cancel the current login first');
    const runtime = await this.runtime();
    if (this.attempt?.status === 'pending') throw Error('Finish or cancel the current login first');
    if (!runtime.getProvider(provider)) throw Error('Unknown Pi provider');
    if (!['api_key', 'oauth'].includes(type)) throw Error('Unknown login method');
    const attempt = { id: randomUUID(), provider, status: 'pending', events: [], prompt: null, controller: new AbortController() };
    allowRuntimeWork();
    this.attempt = attempt;
    const lease = path.join(dataDir, 'run/login.json');
    await writeJson(lease, { pid: process.pid, id: attempt.id });
    try { allowRuntimeWork(); } catch (error) { this.attempt = null; await fs.rm(lease, { force: true }); throw error; }
    const timer = setTimeout(() => attempt.controller.abort(), 15 * 60 * 1000);
    attempt.finished = runtime.login(provider, type, {
      signal: attempt.controller.signal,
      notify: event => { attempt.events.push(event); if (attempt.events.length > 30) attempt.events.shift(); },
      prompt: prompt => new Promise((resolve, reject) => {
        const promptId = randomUUID();
        attempt.prompt = { ...prompt, signal: undefined, id: promptId };
        const cancel = () => { cleanup(); if (attempt.prompt?.id === promptId) attempt.prompt = null; reject(Error('Login cancelled')); };
        const cleanup = () => { prompt.signal?.removeEventListener('abort', cancel); attempt.controller.signal.removeEventListener('abort', cancel); };
        attempt.answer = input => { cleanup(); attempt.prompt = null; attempt.answer = null; resolve(input); };
        prompt.signal?.addEventListener('abort', cancel, { once: true });
        attempt.controller.signal.addEventListener('abort', cancel, { once: true });
        if (prompt.signal?.aborted || attempt.controller.signal.aborted) cancel();
      })
    }).then(() => { attempt.status = 'complete'; }).catch(() => {
      attempt.status = attempt.controller.signal.aborted ? 'cancelled' : 'failed';
      // Do not expose provider response bodies, which may contain credentials.
      attempt.error = attempt.status === 'failed' ? 'Pi could not complete login. Check the selected method and try again.' : undefined;
    }).finally(async () => { clearTimeout(timer); attempt.prompt = null; attempt.answer = null; await fs.rm(lease, { force: true }); });
    return this.state();
  }
  answer(id, promptId, input) {
    if (this.attempt?.id !== id || this.attempt?.prompt?.id !== promptId || !this.attempt.answer) throw Error('Login prompt expired');
    this.attempt.answer(String(input));
  }
  async cancel(id) {
    if (id && this.attempt?.id !== id) throw Error('This login is no longer active');
    if (this.attempt?.status === 'pending') { this.attempt.controller.abort(); await this.attempt.finished; }
  }
  async logout(provider) { allowRuntimeWork(); if (this.attempt?.provider === provider) await this.cancel(); await (await this.runtime()).logout(provider); }
}
