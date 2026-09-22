// SPDX-License-Identifier: GPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir, readJson, writeJson } from '../../common.mjs';
import { loadPi } from '../../rpc/runtime.mjs';

export const managedLlamaProviderId = 'bashkitten-llama';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
let pending = Promise.resolve();

/** Use stock Pi's documented custom-model file, never its auth/session files. */
export function syncManagedLlamaProvider(status) {
  const work = pending.then(async () => {
    const { pi: { getAgentDir } } = await loadPi();
    const file = path.join(getAgentDir(), 'models.json');
    const before = await fs.readFile(file, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    const value = before === null ? {} : JSON.parse(before);
    if (!value || typeof value !== 'object' || Array.isArray(value) || (value.providers && (typeof value.providers !== 'object' || Array.isArray(value.providers)))) throw Error('Pi models.json contains invalid provider configuration');
    value.providers ||= {};
    const ownerFile = path.join(dataDir, 'llama/pi-provider.json');
    const previous = await readJson(ownerFile, null);
    const existing = value.providers[managedLlamaProviderId];
    // Never overwrite a manually created or subsequently edited provider.
    if (existing && JSON.stringify(existing) !== JSON.stringify(previous?.provider)) throw Error('Pi provider bashkitten-llama was edited independently; keep that configuration or rename it before using managed llama.cpp');
    const ready = status.state === 'ready' || (status.desired && status.pid && status.models?.some(model => ['loaded', 'sleeping'].includes(model.state)));
    if (!ready) {
      if (!existing) return;
      delete value.providers[managedLlamaProviderId];
    } else {
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(status.url)) throw Error('Managed llama.cpp endpoint is not loopback');
      const context = status.config.contextSize;
      const models = status.models?.length ? status.models.map(model => model.id) : [status.model || status.config.alias];
      value.providers[managedLlamaProviderId] = {
        baseUrl: status.url + '/v1', api: 'openai-completions', authHeader: true,
        apiKey: '!cat ' + quote(path.join(dataDir, 'llama/api-key')),
        models: models.map(id => ({ id, name: `${id} (Local llama.cpp)`, contextWindow: context, maxTokens: context,
          compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, supportsStrictMode: false, maxTokensField: 'max_tokens' } })),
      };
    }
    if (JSON.stringify(existing) === JSON.stringify(value.providers[managedLlamaProviderId])) return;
    // An editor may save while Pi is being loaded; preserve that concurrent edit.
    const latest = await fs.readFile(file, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (latest !== before) throw Error('Pi model configuration changed; retry the managed provider update');
    await writeJson(file, value);
    await writeJson(ownerFile, { provider: value.providers[managedLlamaProviderId] || null });
  });
  pending = work.catch(() => {}); return work;
}
