// SPDX-License-Identifier: AGPL-3.0-or-later
import { applicationRequest } from '../../pi/apps-channel.mjs';
import { splitIdentity, validateSnapshot } from './references.mjs';

export function projectPath(projectId, path = '') {
  if (typeof projectId !== 'string' || !/^[A-Za-z0-9._~-]+$/.test(projectId) || ['.', '..'].includes(projectId)) throw Error('An explicit References project ID is required');
  return `/projects/${encodeURIComponent(projectId)}${path}`;
}
export class ReferencesClient {
  constructor({ projectId, request } = {}) { this.projectId = projectId; this.request = request; }
  async call(method, path, body, { signal } = {}) {
    return applicationRequest('references', method, projectPath(this.projectId, path), body, { signal, request: this.request });
  }
  async search({ query = '', limit = 50, start = 0, cursor, signal } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(start) || start < 0) throw Error('Search requires a page of 1–100 items and a nonnegative start');
    const params = new URLSearchParams({ q: query, limit: String(limit), start: String(start), format: 'csljson', count: '1', ...(cursor ? { cursor } : {}) });
    const reply = await this.call('GET', `/items?${params}`, undefined, { signal });
    const payload = reply.body;
    if (!payload || !Array.isArray(payload.items)) throw Error('References search did not return a bounded item page');
    const snapshot = { version: 1, projectId: this.projectId, items: payload.items };
    validateSnapshot(snapshot);
    if (snapshot.items.some(item => splitIdentity(item.id).projectId !== this.projectId)) throw Error('References search returned an item from another project');
    const rawTotal = payload.total ?? reply.headers?.['total-results'] ?? reply.headers?.['Total-Results'];
    const total = rawTotal === undefined || rawTotal === null ? null : Number(rawTotal);
    return { ...snapshot, page: { projectId: this.projectId, query, start, limit, total: Number.isFinite(total) ? total : null,
      nextCursor: payload.next ?? null, nextStart: payload.nextStart ?? (Number.isFinite(total) && start + payload.items.length < total ? start + payload.items.length : null) } };
  }
  async snapshot(ids, { signal } = {}) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw Error('Retrieve 1–100 distinct verified reference identities at a time');
    const entries = ids.map(splitIdentity);
    if (entries.some(item => item.projectId !== this.projectId)) throw Error('Snapshot identities must belong to the explicitly selected project');
    const items = [];
    // Sequential metadata reads avoid turning a small snapshot into a competing
    // network/import queue; References remains the shared resolver owner.
    for (const entry of entries) {
      signal?.throwIfAborted();
      const reply = await this.call('GET', `/items/${encodeURIComponent(entry.itemKey)}?format=csljson`, undefined, { signal });
      const item = reply.body.item ?? reply.body;
      if (item.id !== entry.id) throw Error('References returned a different backend/project/item identity');
      items.push(item);
    }
    const snapshot = { version: 1, projectId: this.projectId, items };
    validateSnapshot(snapshot);
    return snapshot;
  }
}

export function officeRequest(method, path, body, options) {
  return applicationRequest('office', method, path, body, options);
}
