// SPDX-License-Identifier: AGPL-3.0-or-later
const MAX_BYTES = 4 * 1024 * 1024;
export class MetadataError extends Error {}
const fail = message => new MetadataError(message);

// Retain a deadline even for a transport or stream that ignores AbortSignal.
function abortable(run, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return run(); })
      .then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export async function requestText(url, init, { fetch: fetcher = globalThis.fetch, signal, timeoutMs = 30000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw fail('Timeout must be 1–120000 milliseconds.');
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const active = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  let reader;
  try {
    const response = await abortable(() => fetcher(url, { ...init, signal: active, redirect: 'error' }), active);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw fail(`HTTP ${response.status} from ${url.hostname}; check the service and configured access.`);
    }
    if (Number(response.headers.get('content-length')) > MAX_BYTES || !response.body) {
      void response.body?.cancel().catch(() => {});
      throw fail('Empty response or response larger than 4 MiB.');
    }
    reader = response.body.getReader();
    const parts = [];
    let size = 0;
    while (true) {
      const { done, value } = await abortable(() => reader.read(), active);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw fail('Response exceeds 4 MiB.');
      parts.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts));
  } catch (error) {
    if (signal?.aborted) throw fail('Operation cancelled.');
    if (deadline.signal.aborted) throw fail('Request timed out.');
    if (error instanceof MetadataError) throw error;
    throw fail('Request failed or returned invalid UTF-8; check API availability and network access.');
  } finally {
    clearTimeout(timer);
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}

