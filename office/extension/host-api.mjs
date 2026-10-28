// SPDX-License-Identifier: AGPL-3.0-only
// Uses the normal WOPI host wrapper. Credentials stay in that authorized host.
export async function connectReferencesHost({ signal, timeoutMs = 15000 } = {}) {
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
  const dispose = () => { if (disposed) return; disposed = true; clearTimeout(timer); window.removeEventListener('message', receive); for (const waiter of pending.values()) { waiter.cleanup(); waiter.reject(new Error('References context closed')); } pending.clear(); };
  window.addEventListener('pagehide', dispose, { once: true });
  signal?.addEventListener('abort', dispose, { once: true });
  window.top.postMessage({ MessageId: 'BashKitten_ReferencesReady', nonce }, '*');
  let context; try { context = await ready; } catch (error) { dispose(); throw error; }
  function request(path, { method = 'GET', body, signal } = {}) {
    if (disposed) return Promise.reject(new Error('References context closed'));
    if (!path.startsWith('/')) path = '/api/references/' + path;
    const prefix = '/api/references/projects/' + encodeURIComponent(context.projectId);
    if (!(path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?')) && !/^\/api\/references\/(styles|locales)(\?|$)/.test(path)) return Promise.reject(new Error('The References request is outside this document’s project'));
    if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return Promise.reject(new Error('Invalid References method'));
    const requestId = String(++sequence);
    return new Promise((resolve, reject) => {
      const abort = () => { pending.delete(requestId); window.top.postMessage({ MessageId: 'BashKitten_ReferencesCancel', nonce, requestId }, origin); reject(new DOMException('Cancelled', 'AbortError')); };
      const cleanup = () => signal?.removeEventListener('abort', abort);
      if (signal?.aborted) { abort(); return; }
      pending.set(requestId, { resolve, reject, cleanup }); signal?.addEventListener('abort', abort, { once: true });
      window.top.postMessage({ MessageId: 'BashKitten_ReferencesRequest', nonce, requestId, method, path, body }, origin);
    });
  }
  return { context, dispose, api: { request, project(projectId) { if (projectId !== context.projectId) throw new Error('References project mismatch'); return { request: (path, options) => request('/api/references/projects/' + encodeURIComponent(projectId) + '/' + path.replace(/^\//, ''), options) }; } } };
}
