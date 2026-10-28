import { setTimeout as delay } from 'node:timers/promises';
import { normalizeId, zoteroUri, validateSnapshot } from './references.mjs';

export class ZoteroError extends Error {}

function baseUrl(localUrl) {
  const url = new URL(localUrl ?? 'http://127.0.0.1:23119/api/');
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/api/') {
    throw new ZoteroError('The Zotero local API URL must be loopback HTTP with path /api/');
  }
  return url;
}

async function jsonResponse(response, maxBytes = 10 * 1024 * 1024) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new ZoteroError('Zotero response exceeds 10 MiB; use a smaller page');
  }
  const parts = [];
  let bytes = 0;
  if (!response.body) throw new ZoteroError('Empty Zotero response');
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new ZoteroError('Zotero response exceeds 10 MiB; use a smaller page');
    parts.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); }
  catch { throw new ZoteroError('Zotero returned invalid UTF-8 JSON'); }
}

function canonicalItem(raw, expected) {
  if (!raw || !/^[A-Z0-9]{8}$/.test(raw.key)) throw new ZoteroError('Zotero returned an invalid item key');
  let csl = raw.csljson;
  if (typeof csl === 'string') {
    try { csl = JSON.parse(csl); } catch { throw new ZoteroError(`Invalid CSL-JSON for ${raw.key}`); }
  }
  if (Array.isArray(csl)) {
    if (csl.length !== 1) throw new ZoteroError(`Item ${raw.key} is not a citable bibliographic item`);
    csl = csl[0];
  }
  if (!csl?.type) throw new ZoteroError(`Missing CSL-JSON for ${raw.key}; use a recent Zotero version and a bibliographic item, not an attachment/note`);
  let id;
  try { id = normalizeId(csl.id); } catch { /* Export translators can emit a citation key instead of a URI. */ }
  if (!id && raw.library && /^[1-9]\d*$/.test(String(raw.library.id))) {
    const scope = raw.library.type === 'user' ? 'users' : raw.library.type === 'group' ? 'groups' : null;
    if (scope) id = `${scope}/${raw.library.id}/items/${raw.key}`;
  }
  if (!id && expected) id = normalizeId(expected);
  if (!id) throw new ZoteroError(`Cannot establish the canonical Zotero URI for ${raw.key}. Supply its verified library-qualified ID; users/0 is only an API routing alias.`);
  if (!id.endsWith(`/items/${raw.key}`) || (expected && id !== normalizeId(expected))) {
    throw new ZoteroError(`Zotero identity mismatch for ${raw.key}; do not substitute a different library's item`);
  }
  return { id, itemData: { ...csl, id: zoteroUri(id) }, provenance: { itemVersion: raw.version ?? null } };
}

/** Read-only local API client. Never starts Zotero, modifies its database or sends writes. */
export class ZoteroClient {
  constructor({ mode = 'local', localUrl, fetch: fetcher = globalThis.fetch, timeoutMs = 30000, sleep = delay } = {}) {
    if (mode !== 'local') throw new ZoteroError('Only the running local Zotero application is supported; use local mode.');
    this.base = baseUrl(localUrl);
    this.fetch = fetcher;
    this.timeoutMs = timeoutMs;
    this.sleep = sleep;
    this.serverId = undefined;
  }

  async get(path, params, signal) {
    const url = new URL(path, this.base);
    if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname) || url.username || url.password) throw new ZoteroError('Zotero requests must stay on the configured local API origin without credentials');
    for (const [key, value] of Object.entries(params)) {
      for (const part of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(part));
    }
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    for (let attempt = 0; attempt < 3; attempt++) {
      combined.throwIfAborted();
      const headers = { 'Zotero-API-Version': '3', Accept: 'application/json' };
      if (this.serverId) headers['Zotero-Server-ID'] = this.serverId;
      let response;
      try { response = await this.fetch(url, { headers, signal: combined, redirect: 'error' }); }
      catch {
        combined.throwIfAborted();
        throw new ZoteroError('Cannot reach the local Zotero API. Start Zotero and enable local API access in Settings → Advanced.');
      }
      const waitHeader = response.headers.get('Retry-After') ?? response.headers.get('Backoff');
      const seconds = waitHeader === null ? 1 : /^\d+$/.test(waitHeader) ? Number(waitHeader) : Math.max(0, (Date.parse(waitHeader) - Date.now()) / 1000);
      if ([429, 503].includes(response.status) && attempt < 2 && Number.isFinite(seconds) && seconds <= 10) {
        await response.body?.cancel();
        await this.sleep(Math.max(100, seconds * 1000), undefined, { signal: combined });
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ZoteroError(`Zotero HTTP ${response.status}${response.status === 403 ? ': enable local API access in Settings → Advanced' : ''}${response.status === 412 ? ': Zotero instance changed; retry with a fresh client/snapshot' : ''}${[429, 503].includes(response.status) ? ': rate limited/unavailable; retry later' : ''}`);
      }
      const serverId = response.headers.get('Zotero-Server-ID');
      if (this.serverId && serverId && this.serverId !== serverId) {
        await response.body?.cancel();
        throw new ZoteroError('Zotero instance changed during retrieval; snapshot was not saved');
      }
      if (serverId) this.serverId = serverId;
      const data = await jsonResponse(response);
      // Respect a successful response's Backoff before the next request too.
      const backoff = Number(response.headers.get('Backoff') ?? 0);
      if (!Number.isFinite(backoff) || backoff > 10) throw new ZoteroError('Zotero requested a long Backoff; retry retrieval later');
      if (backoff > 0) await this.sleep(backoff * 1000, undefined, { signal: combined });
      return { data, total: response.headers.get('Total-Results'), url: url.href, serverId: this.serverId };
    }
    throw new ZoteroError('Zotero retry limit reached');
  }

  async snapshot(ids, { signal } = {}) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw new ZoteroError('Fetch 1–100 Zotero identities at a time');
    const normalized = [...new Set(ids.map(normalizeId))];
    const items = [];
    for (const id of normalized) {
      const path = id.startsWith('users/local/') ? id.replace(/^users\/local\/[^/]+/, 'users/0') : id;
      const result = await this.get(path, { format: 'json', include: 'csljson' }, signal);
      const item = canonicalItem(result.data, id);
      item.provenance = { ...item.provenance, source: result.url, retrievedAt: new Date().toISOString(), serverId: result.serverId ?? null, mode: 'local' };
      items.push(item);
    }
    const snapshot = { version: 1, items };
    validateSnapshot(snapshot);
    return snapshot;
  }

  async search({ library = 'users/0', query = '', limit = 25, start = 0, qmode, includeData = false, signal } = {}) {
    if (!/^(users\/(0|[1-9]\d*)|groups\/[1-9]\d*)$/.test(library)) throw new ZoteroError('Use users/<numericID> or groups/<numericID>; users/0 addresses the local user library');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(start) || start < 0) throw new ZoteroError('Search limit must be 1–100 and start a nonnegative integer');
    if (typeof query !== 'string' || query.length > 2000) throw new ZoteroError('Search query must be a string of at most 2000 characters');
    if (typeof includeData !== 'boolean') throw new ZoteroError('includeData must be a boolean');
    if (qmode !== undefined && !['titleCreatorYear', 'everything'].includes(qmode)) throw new ZoteroError('qmode must be titleCreatorYear or everything');
    const result = await this.get(`${library}/items/top`, { format: 'json', include: includeData ? 'data,csljson' : 'csljson', itemType: ['-attachment', '-note', '-annotation'], q: query, limit, start, ...(qmode ? { qmode } : {}) }, signal);
    if (!Array.isArray(result.data) || result.data.length > limit) throw new ZoteroError('Zotero search returned an invalid or oversized page');
    const items = result.data.map(raw => {
      const item = canonicalItem(raw);
      if (includeData) {
        if (!raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) throw new ZoteroError('Zotero did not return requested item data');
        item.zoteroData = raw.data;
      }
      return item;
    });
    const total = result.total !== null && /^\d+$/.test(result.total) ? Number(result.total) : null;
    if (items.length === 0 && total !== null && start < total) throw new ZoteroError('Zotero returned an empty page before its reported end; retry rather than treating it as complete');
    validateSnapshot({ version: 1, items });
    return {
      version: 1, items: items.map(item => ({ ...item, provenance: { ...item.provenance, source: result.url, retrievedAt: new Date().toISOString(), serverId: result.serverId ?? null, mode: 'local' } })),
      page: { library, query, start, limit, total, nextStart: (total !== null ? start + items.length < total : items.length === limit) && items.length ? start + items.length : null },
    };
  }
}
