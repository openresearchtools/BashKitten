// SPDX-License-Identifier: AGPL-3.0-or-later
import { setTimeout as delay } from 'node:timers/promises';

const ENDPOINT = 'https://api.crossref.org/works';
const PAGE_SIZE = 100;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_RETRY_DELAY_MS = 30_000;

export class HarvestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HarvestError';
    this.code = code;
  }
}

function fail(code, message) {
  return new HarvestError(code, message);
}

function checkAbort(signal) {
  if (signal?.aborted) throw fail('ABORTED', 'Harvest cancelled; no partial result returned.');
}

// Bound even injected transports/streams that do not themselves honor aborts.
function abortable(run, signal) {
  if (!signal) return Promise.resolve().then(run);
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return run();
    }).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

function clock(now) {
  const value = now();
  if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) {
    throw fail('INPUT', 'The injected clock must return epoch milliseconds.');
  }
  return value;
}

function retryDelay(header, attempt, now) {
  if (header === null) return 1000 * 2 ** attempt;
  const text = header.trim();
  let ms;
  if (/^\d+$/.test(text)) {
    ms = Number(text) * 1000;
  } else if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) {
    ms = Math.max(0, Date.parse(text) - clock(now));
  }
  // Do not retry *earlier* than a server's longer requested delay.
  if (!Number.isFinite(ms) || ms > MAX_RETRY_DELAY_MS) {
    throw fail('RETRY_AFTER', 'Crossref Retry-After is invalid or exceeds 30 seconds; try again later.');
  }
  return ms;
}

function discard(response) {
  // Never wait for an error response's potentially unbounded body.
  void response.body?.cancel().catch(() => {});
}

async function readJson(response, signal) {
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json' && !/^application\/[\w.+-]+\+json$/.test(type ?? '')) {
    discard(response);
    throw fail('RESPONSE', 'Crossref did not return JSON.');
  }
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) {
    discard(response);
    throw fail('RESPONSE', 'Crossref response size is invalid or exceeds 8 MiB.');
  }
  if (!response.body) throw fail('RESPONSE', 'Crossref returned an empty response body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await abortable(() => reader.read(), signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw fail('RESPONSE', 'Crossref response exceeds 8 MiB.');
      try {
        text += decoder.decode(value, { stream: true });
      } catch {
        throw fail('RESPONSE', 'Crossref response is not valid UTF-8.');
      }
    }
    try {
      text += decoder.decode();
      return JSON.parse(text);
    } catch {
      throw fail('RESPONSE', 'Crossref response is not valid UTF-8 JSON.');
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function requestPage(url, options, dependencies) {
  const { signal, timeoutMs, maxRetries } = options;
  const { fetch: fetchImpl, now, sleep } = dependencies;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    checkAbort(signal);
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    const activeSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
    let wait;
    try {
      const response = await abortable(() => fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Systematic-Reviewer-V3 (standalone Crossref metadata harvest)',
        },
        signal: activeSignal,
      }), activeSignal);
      if (response.status === 429 || response.status === 503) {
        discard(response);
        if (attempt === maxRetries) {
          throw fail('HTTP', `Crossref HTTP ${response.status}; retry budget exhausted.`);
        }
        wait = retryDelay(response.headers.get('retry-after'), attempt, now);
      } else if (response.status !== 200) {
        discard(response);
        throw fail('HTTP', `Crossref HTTP ${response.status}; no partial result returned.`);
      } else {
        const body = await readJson(response, activeSignal);
        activeSignal.throwIfAborted();
        return { body, attempts: attempt + 1, fetchedAt: new Date(clock(now)).toISOString() };
      }
    } catch (error) {
      checkAbort(signal);
      if (deadline.signal.aborted) throw fail('TIMEOUT', 'Crossref request timed out; no partial result returned.');
      if (error instanceof HarvestError) throw error;
      // Fetch errors can contain the URL, contact address or upstream body.
      throw fail('NETWORK', 'Crossref transport failed; no partial result returned.');
    } finally {
      clearTimeout(timer);
    }
    try {
      await abortable(() => sleep(wait, signal), signal);
    } catch {
      checkAbort(signal);
      throw fail('RETRY_WAIT', 'Crossref retry wait failed; no partial result returned.');
    }
  }
}

function validatePage(body, rows) {
  const message = body?.message;
  if (body?.status !== 'ok' || body['message-type'] !== 'work-list' ||
      !message || !Array.isArray(message.items) || message.items.length > rows ||
      !Number.isSafeInteger(message['total-results']) || message['total-results'] < message.items.length) {
    throw fail('RESPONSE', 'Crossref returned a malformed works page; no partial result returned.');
  }
  return message;
}

function record(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      typeof raw.DOI !== 'string' || raw.DOI.length > 2048 ||
      !/^10\.\d{4,9}\/\S+$/u.test(raw.DOI) || /[\u0000-\u001f\u007f]/u.test(raw.DOI)) {
    throw fail('RESPONSE', 'Crossref returned a work without a usable DOI; no partial result returned.');
  }
  try {
    return {
      doi: raw.DOI,
      doiUrl: `https://doi.org/${raw.DOI.split('/').map(encodeURIComponent).join('/')}`,
      sourceUrl: `${ENDPOINT}/${encodeURIComponent(raw.DOI)}`,
      raw,
    };
  } catch {
    throw fail('RESPONSE', 'Crossref returned an invalid DOI; no partial result returned.');
  }
}

/**
 * Optional, read-only Crossref search. No network or filesystem work on import.
 * Dependencies: fetch(url, init), now() -> epoch ms, sleep(ms, signal) -> Promise.
 * A successful result contains raw Crossref metadata, NOT CSL or Zotero identities.
 */
export async function harvestCrossref({
  query,
  limit = 100,
  mailto,
  timeoutMs = 30_000,
  maxRetries = 3,
  signal,
} = {}, {
  fetch: fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (ms, abortSignal) => delay(ms, undefined, { signal: abortSignal }),
} = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 4096 || /[\u0000-\u001f\u007f]/u.test(query)) {
    throw fail('INPUT', 'Supply a nonempty, single-line query of at most 4096 characters.');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw fail('INPUT', 'Limit must be an integer from 1 to 1000.');
  }
  if (mailto !== undefined && (typeof mailto !== 'string' || mailto.length > 254 || !/^[^@\s<>]+@[^@\s<>]+$/.test(mailto))) {
    throw fail('INPUT', 'Mailto must be a single email address.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000 ||
      !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3 ||
      (signal !== undefined && !(signal instanceof AbortSignal)) ||
      [fetchImpl, now, sleep].some(value => typeof value !== 'function')) {
    throw fail('INPUT', 'Invalid timeout, retry budget, signal or injected dependency.');
  }
  checkAbort(signal);
  const startedAt = new Date(clock(now)).toISOString();
  const rows = Math.min(PAGE_SIZE, limit);
  const records = [];
  const pages = [];
  const seen = new Set();
  let cursor = '*';
  let fetchedCount = 0;
  let stopReason;
  while (!stopReason) {
    checkAbort(signal);
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({ query: query.trim(), sort: 'relevance', order: 'desc', rows: String(rows), cursor });
    const provenanceUrl = url.href;
    if (mailto !== undefined) url.searchParams.set('mailto', mailto);
    const { body, attempts, fetchedAt } = await requestPage(url.href, { signal, timeoutMs, maxRetries }, { fetch: fetchImpl, now, sleep });
    const message = validatePage(body, rows);
    for (const item of message.items) {
      const entry = record(item);
      const identity = entry.doi.toLowerCase();
      if (seen.has(identity)) throw fail('RESPONSE', 'Crossref repeated a DOI during pagination; no partial result returned.');
      seen.add(identity);
      if (records.length < limit) records.push(entry);
    }
    fetchedCount += message.items.length;
    pages.push({ url: provenanceUrl, fetchedAt, attempts, returned: message.items.length, totalResultsReported: message['total-results'] });
    if (records.length === limit) {
      stopReason = 'limit';
    } else if (message.items.length < rows) {
      if (fetchedCount < message['total-results']) {
        throw fail('RESPONSE', 'Crossref ended before its reported result count; no partial result returned.');
      }
      stopReason = 'exhausted';
    } else {
      const next = message['next-cursor'];
      if (typeof next !== 'string' || !next || next.length > 16_384 || /[\u0000-\u001f\u007f]/u.test(next)) {
        throw fail('RESPONSE', 'Crossref omitted a usable pagination cursor; no partial result returned.');
      }
      // Some scroll APIs reuse opaque cursors. Detect repeated works, not tokens.
      cursor = next;
    }
  }
  checkAbort(signal);
  return {
    source: { name: 'Crossref', endpoint: ENDPOINT },
    query: query.trim(),
    startedAt,
    completedAt: new Date(clock(now)).toISOString(),
    limit,
    count: records.length,
    stopReason,
    totalResultsReported: pages[0].totalResultsReported,
    fetchedCount,
    omittedByLimit: fetchedCount - records.length,
    provenance: { method: 'GET', order: 'relevance descending', pageSize: rows, pages },
    records,
  };
}
