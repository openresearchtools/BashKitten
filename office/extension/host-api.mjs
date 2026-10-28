// SPDX-License-Identifier: AGPL-3.0-only
// Uses the normal WOPI host wrapper. Credentials stay in that authorized host.
export async function connectReferencesHost({ signal, timeoutMs = 15000 } = {}) {
  signal?.throwIfAborted();
  const nonce = crypto.randomUUID(), pending = new Map();
  if (window.top === window || window.top === window.parent) throw new Error('Open this document through its authorized Files host to use References');
  let origin, sequence = 0, disposed = false;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const timer = setTimeout(() => rejectReady(new Error('The document host did not provide a References context')), timeoutMs);
  function receive(event) {
    if (event.source !== window.top) return;
    let data; try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
    if (data?.nonce !== nonce || origin && event.origin !== origin) return;
    if (data.MessageId === 'BashKitten_ReferencesContext') {
      if (!/^https?:\/\//.test(event.origin) || !data.projectId || !data.documentId) return;
      origin = event.origin; clearTimeout(timer); resolveReady(data);
    } else if (data.MessageId === 'BashKitten_ReferencesResult') {
      const waiter = pending.get(data.requestId); if (!waiter) return; pending.delete(data.requestId); waiter.cleanup();
      if (data.error || data.status >= 400) waiter.reject(new Error(data.error?.message || data.error || data.body?.error || 'References request failed'));
      else waiter.resolve(data.body ?? data.result);
    }
  }
  window.addEventListener('message', receive);
  const dispose = () => { if (disposed) return; disposed = true; clearTimeout(timer); rejectReady(new Error('References context closed')); window.removeEventListener('message', receive); signal?.removeEventListener('abort', dispose); for (const waiter of pending.values()) { window.top.postMessage({ MessageId: 'BashKitten_ReferencesCancel', nonce, requestId: waiter.requestId }, origin); waiter.cleanup(); waiter.reject(new Error('References context closed')); } pending.clear(); };
  window.addEventListener('pagehide', dispose, { once: true });
  signal?.addEventListener('abort', dispose, { once: true });
  window.top.postMessage({ MessageId: 'BashKitten_ReferencesReady', nonce }, '*');
  let context; try { context = await ready; } catch (error) { dispose(); throw error; }
  function send(message, { signal } = {}) {
    if (disposed) return Promise.reject(new Error('References context closed'));
    const requestId = String(++sequence);
    return new Promise((resolve, reject) => {
      const abort = () => { pending.delete(requestId); cleanup(); window.top.postMessage({ MessageId: 'BashKitten_ReferencesCancel', nonce, requestId }, origin); reject(new DOMException('Cancelled', 'AbortError')); };
      const cleanup = () => signal?.removeEventListener('abort', abort);
      if (signal?.aborted) { abort(); return; }
      pending.set(requestId, { requestId, resolve, reject, cleanup }); signal?.addEventListener('abort', abort, { once: true });
      window.top.postMessage({ ...message, nonce, requestId }, origin);
    });
  }
  function request(path, { method = 'GET', body, signal } = {}) {
    if (!path.startsWith('/')) path = '/api/references/' + path;
    const prefix = '/api/references/projects/' + encodeURIComponent(context.projectId);
    if (!(path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?'))) return Promise.reject(new Error('The References request is outside this document’s project'));
    if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return Promise.reject(new Error('Invalid References method'));
    return send({ MessageId: 'BashKitten_ReferencesRequest', method, path, body }, { signal });
  }
  return { context, dispose, officeCopy: ({ name, format }, options) => send({ MessageId: 'BashKitten_OfficeCopy', name, format }, options), api: { request, project(projectId) { if (projectId !== context.projectId) throw new Error('References project mismatch'); return { request: (path, options) => request('/api/references/projects/' + encodeURIComponent(projectId) + '/' + path.replace(/^\//, ''), options) }; } } };
}
