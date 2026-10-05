// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir, digest, readJson, writeJson, writePrivate, allMeta, socketPath, socketRequest } from '../common.mjs';
import { accessDir } from '../access/paths.mjs';
import { loadPi } from './runtime.mjs';
import { providersChanged } from './services.mjs';

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let pending = Promise.resolve();

/** Caller owns opt-in/readiness. Never change Pi credentials, defaults or sessions. */
export function syncManagedProvider({ id, name, baseUrl, apiKey, apiKeyFile, models }) {
  const work = pending.then(async () => {
    if (!/^bashkitten-(?:llama|remote-[a-f0-9]{48}-[a-z0-9_-]{1,64})$/.test(id)) throw Error('Invalid managed provider identity');
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/v1' || url.search || url.hash || url.username || url.password) throw Error('Pi import needs the actual client-local /v1 endpoint');
    if (!Array.isArray(models) || !models.length || models.some(model => typeof model.id !== 'string' || !model.id)) throw Error('No routable models are available');
    if (apiKeyFile && (!path.isAbsolute(apiKeyFile) || apiKey !== undefined)) throw Error('Choose a key or its absolute file path');
    if (apiKey !== undefined && (typeof apiKey !== 'string' || /[\r\n\0]/.test(apiKey))) throw Error('Invalid application API key');
    const { pi: { getAgentDir } } = await loadPi();
    const file = path.join(getAgentDir(), 'models.json');
    const before = await fs.readFile(file, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    const value = before === null ? {} : JSON.parse(before);
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.providers && (typeof value.providers !== 'object' || Array.isArray(value.providers))) throw Error('Pi models.json contains invalid provider configuration');
    value.providers ||= {};
    const ownerFile = path.join(accessDir, 'managed-providers', id + '.json');
    let previous = await readJson(ownerFile, null);
    if (!previous && id === 'bashkitten-llama') previous = await readJson(path.join(dataDir, 'llama/pi-provider.json'), null);
    const existing = value.providers[id];
    if (existing && !same(existing, previous?.provider) && !same(existing, previous?.pending)) throw Error(`Pi provider ${id} was edited independently; preserve or rename it before importing`);
    const keyPath = apiKeyFile || (apiKey ? path.join(accessDir, 'managed-providers', id + '.key') : null);
    const provider = { name, baseUrl, api: 'openai-completions', authHeader: Boolean(keyPath),
      // Stock Pi's llama provider uses this sentinel for a token-free server.
      // Application requests still pass through the tunnel unchanged.
      apiKey: keyPath ? '!cat ' + quote(keyPath) : 'local', models };
    const keyChanged = Boolean(apiKey && await fs.readFile(keyPath, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null; }) !== apiKey);
    const keyDigest = keyPath ? digest(apiKeyFile ? (await fs.readFile(apiKeyFile, 'utf8')).trim() : apiKey) : null;
    const changed = !same(existing, provider) || keyChanged || previous?.keyDigest !== keyDigest || Boolean(previous?.pending);
    if (changed) {
      if (await fs.readFile(file, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null; }) !== before) throw Error('Pi model configuration changed; save again');
      await writeJson(ownerFile, { provider: previous?.provider || null, pending: provider });
      if (apiKey) await writePrivate(keyPath, apiKey);
      value.providers[id] = provider; await writeJson(file, value);
      await providersChanged();
      await writeJson(ownerFile, { provider, keyDigest });
    }
    let waiting = false;
    await Promise.all((await allMeta()).map(async meta => {
      try {
        const result = await socketRequest(socketPath(meta.id), '/context', {}, 20000);
        waiting ||= Boolean(result.data?.pendingContext || result.data?.busy || result.data?.compacting);
      } catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; }
    }));
    return { provider: id, baseUrl, pending: waiting, state: waiting ? 'pending' : 'imported',
      message: waiting ? 'Saved; active chats will refresh at their next idle boundary.' : 'Imported into local Pi.' };
  });
  pending = work.catch(() => {}); return work;
}

/** Called only by native local control for an already authenticated mapping. */
export async function importRemoteProvider({ enabled, bundle, service, name, baseUrl, apiKey = '' }) {
  if (enabled === false) return { state: 'disabled', message: 'Automatic Pi import is off; existing providers are kept.' };
  if (enabled !== true || !/^[a-f0-9]{48}$/.test(bundle) || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(service)) throw Error('Invalid remote Pi import');
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/v1' || url.search || url.hash || url.username || url.password) throw Error('Choose this device’s mapped /v1 endpoint');
  if (typeof apiKey !== 'string' || /[\r\n\0]/.test(apiKey)) throw Error('Invalid application API key');
  const models = await discoverManagedModels(baseUrl, apiKey, name);
  return syncManagedProvider({ id: `bashkitten-remote-${bundle}-${service}`, name, baseUrl, apiKey, models });
}

/** Read the upstream router catalogue without loading or waking models. */
export async function discoverManagedModels(baseUrl, apiKey = '', name = 'llama.cpp') {
  const endpoint = new URL(baseUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.pathname !== '/v1' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw Error('Model discovery needs the actual local /v1 endpoint');
  const read = async route => {
    const response = await fetch(endpoint.origin + route, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: apiKey ? { Authorization: 'Bearer ' + apiKey } : {} });
    if (!response.ok) { await response.body?.cancel(); throw Error(`Model discovery returned HTTP ${response.status}. Check the service key and host state.`); }
    return response.json();
  };
  const catalogue = await read('/models');
  if (!Array.isArray(catalogue.data) || catalogue.data.some(model => typeof model.id !== 'string' || !model.id)) throw Error('The service returned an invalid model catalogue');
  const needsAutoload = catalogue.data.some(model => model.status?.value === 'unloaded' && model.source === 'preset');
  const autoload = needsAutoload && (await read('/props')).models_autoload === true;
  const models = await Promise.all(catalogue.data.filter(model => !model.status || ['loaded', 'sleeping'].includes(model.status.value) || autoload && model.status.value === 'unloaded' && !model.status.failed && model.source === 'preset').map(async model => {
    const props = model.status?.value === 'loaded' ? await read('/props?' + new URLSearchParams({ model: model.id, autoload: 'false' })) : {};
    const args = model.status?.args || [], index = args.findIndex(arg => ['--ctx-size', '-c', '-ctx'].includes(arg));
    const context = [model.meta?.n_ctx, index >= 0 ? Number(args[index + 1]) : null, model.meta?.n_ctx_train].find(value => Number.isSafeInteger(value) && value > 0);
    const reasoning = props.chat_template?.includes('enable_thinking') === true;
    return { id: model.id, name: `${model.id} (${name})`, reasoning, input: model.architecture?.input_modalities?.includes('image') ? ['text', 'image'] : ['text'],
      ...(context ? { contextWindow: context, maxTokens: context } : {}),
      ...(reasoning ? { thinkingLevelMap: { off: 'off', minimal: null, low: null, medium: 'medium', high: null, xhigh: null } } : {}),
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: true, supportsStrictMode: false, maxTokensField: 'max_tokens', ...(reasoning ? { thinkingFormat: 'qwen-chat-template' } : {}) } };
  }));
  if (!models.length) throw Error('No routable models are available yet');
  return models;
}
