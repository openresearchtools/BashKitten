// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { MetadataError, requestText } from './metadata-http.mjs';

export class EmbeddingError extends Error {}
const fail = message => new EmbeddingError(message);
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_DIMENSIONS = 8192;
const hash = text => createHash('sha256').update(text).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalizeText = value => value.replace(/\r\n?/g, '\n').trim();

function checkedText(value, label, { empty = false, maximum = MAX_TEXT_BYTES } = {}) {
  if (typeof value !== 'string' || value.includes('\0') || (!empty && !value.trim()) || Buffer.byteLength(value, 'utf8') > maximum) {
    throw fail(`${label} must be ${empty ? 'text' : 'nonempty text'} no larger than ${maximum} UTF-8 bytes; text is never clipped.`);
  }
  return value;
}

/** Explicit OpenAI-compatible base or embeddings URL; never discover providers. */
export function embeddingEndpoint(baseUrl) {
  let url;
  try { url = new URL(baseUrl); } catch { throw fail('Supply an absolute HTTP(S) embeddings base URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw fail('The embeddings URL must use HTTP(S) without credentials, a query, or a fragment.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/embeddings') ? path : `${path || '/v1'}/embeddings`;
  return url.href;
}

function unitVector(vector, expectedDimension) {
  if (!Array.isArray(vector) || !vector.length || vector.length > MAX_DIMENSIONS ||
      (expectedDimension !== undefined && vector.length !== expectedDimension) || vector.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    throw fail('Embeddings must be finite numeric vectors with a consistent dimension of 1–8192.');
  }
  // Scaling first avoids overflow/underflow when a provider returns unnormalized vectors.
  let scale = 0;
  for (const value of vector) scale = Math.max(scale, Math.abs(value));
  if (!scale) throw fail('The embedding provider returned a zero vector.');
  const scaled = vector.map(value => value / scale);
  const length = Math.sqrt(scaled.reduce((sum, value) => sum + value * value, 0));
  return scaled.map(value => value / length);
}

function papersFrom(dataset, documentPrefix) {
  const records = Array.isArray(dataset) ? dataset : dataset?.records;
  if (!Array.isArray(records) || !records.length || records.length > 1000) throw fail('Supply 1–1000 paper records, as an array or an object with records.');
  const seen = new Set();
  return records.map((record, inputIndex) => {
    if (!plain(record)) throw fail('Every paper record must be an object.');
    const id = checkedText(record.id, 'Each stable paper ID', { maximum: 2048 });
    if (/[\u0000-\u001f\u007f]/u.test(id) || seen.has(id)) throw fail('Paper IDs must be unique and contain no control characters; supply verified stable IDs.');
    seen.add(id);
    const title = normalizeText(checkedText(record.raw?.title ?? record.title ?? '', 'Paper title', { empty: true }));
    const abstract = normalizeText(checkedText(record.abstract ?? '', 'Paper abstract', { empty: true }));
    if (!title && !abstract) throw fail('A paper has neither title nor abstract; supply text or explicitly choose a smaller corpus.');
    const text = checkedText(documentPrefix + [title, abstract].filter(Boolean).join('\n\n'), 'Combined paper text');
    return { kind: 'paper', id, inputIndex, text, textHash: hash(text),
      missingTitle: !title, missingAbstract: !abstract, textBytes: Buffer.byteLength(text, 'utf8') };
  });
}

function cacheEntries(cache, scope) {
  if (cache === undefined) return { entries: new Map(), dimension: undefined };
  cache = cache?.cache ?? cache;
  if (!plain(cache) || cache.version !== 1 || cache.endpoint !== scope.endpoint || cache.model !== scope.model ||
      !plain(cache.recipe) || Object.keys(cache.recipe).length !== Object.keys(scope.recipe).length ||
      Object.entries(scope.recipe).some(([key, value]) => JSON.stringify(cache.recipe[key]) !== JSON.stringify(value)) || cache.normalization !== 'l2' ||
      !Number.isInteger(cache.dimension) || cache.dimension < 1 || cache.dimension > MAX_DIMENSIONS ||
      !Array.isArray(cache.entries) || cache.entries.length > 1001) {
    throw fail('Embedding cache is incompatible with the endpoint, model, recipe, normalization, or vector dimensions.');
  }
  const entries = new Map();
  for (const entry of cache.entries) {
    if (!plain(entry) || !['paper', 'query'].includes(entry.kind) || typeof entry.id !== 'string' || !entry.id || Buffer.byteLength(entry.id) > 2048 ||
        !/^[a-f0-9]{64}$/.test(entry.textHash ?? '') || typeof entry.embeddedAt !== 'string' || !Number.isFinite(Date.parse(entry.embeddedAt))) {
      throw fail('Embedding cache contains invalid vector provenance.');
    }
    const key = JSON.stringify([entry.kind, entry.id]);
    if (entries.has(key)) throw fail('Embedding cache repeats an identity.');
    unitVector(entry.vector, cache.dimension);
    const norm = Math.sqrt(entry.vector.reduce((sum, value) => sum + value * value, 0));
    if (Math.abs(norm - 1) > 1e-6) throw fail('Cached vectors must already be L2 normalized.');
    // Preserve validated cached floats exactly; renormalizing can change score ties.
    entries.set(key, { kind: entry.kind, id: entry.id, textHash: entry.textHash, embeddedAt: entry.embeddedAt, vector: [...entry.vector] });
  }
  return { entries, dimension: cache.dimension };
}

/** Optional semantic ordering only: preserves the corpus and makes no exclusions. */
export async function rankPapers(dataset, {
  query, baseUrl, model, cache, documentPrefix = '', queryPrefix = '', batchSize = 8,
  timeoutMs = 30000, apiKey, signal,
} = {}, { fetch: fetcher = globalThis.fetch, now = Date.now } = {}) {
  try {
    const endpoint = embeddingEndpoint(baseUrl);
    checkedText(model, 'Model ID', { maximum: 1024 });
    if (/[\u0000-\u001f\u007f]/u.test(model)) throw fail('Model ID must contain no control characters.');
    checkedText(documentPrefix, 'Document prefix', { empty: true, maximum: 4096 });
    checkedText(queryPrefix, 'Query prefix', { empty: true, maximum: 4096 });
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 64) throw fail('Embedding batch size must be 1–64.');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw fail('Request timeout must be 1–120000 milliseconds.');
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw fail('Invalid cancellation signal.');
    if (typeof fetcher !== 'function' || typeof now !== 'function') throw fail('Invalid embedding request dependencies.');
    if (apiKey !== undefined && (typeof apiKey !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(apiKey))) throw fail('Invalid embeddings API key.');
    const topic = normalizeText(checkedText(query, 'Research query'));
    const text = checkedText(queryPrefix + topic, 'Prefixed research query');
    const recipe = { version: 1, paperFields: ['title', 'abstract'], separator: '\n\n',
      textNormalization: 'CRLF/CR to LF; trim outer whitespace; omit empty fields', documentPrefix, queryPrefix };
    const scope = { endpoint, model, recipe };
    const papers = papersFrom(dataset, documentPrefix);
    const queryEntry = { kind: 'query', id: 'query', text, textHash: hash(text) };
    const targets = [...papers, queryEntry];
    const previous = cacheEntries(cache, scope);
    let dimension = previous.dimension;
    const vectors = new Map();
    const pending = [];
    let reusedCount = 0;
    for (const target of targets) {
      const key = JSON.stringify([target.kind, target.id]);
      const existing = previous.entries.get(key);
      if (existing?.textHash === target.textHash) { vectors.set(key, existing); reusedCount++; }
      else pending.push(target);
    }
    const timestamp = () => {
      const value = now();
      if (!Number.isFinite(value)) throw fail('Invalid clock value.');
      return new Date(value).toISOString();
    };
    const startedAt = timestamp();
    signal?.throwIfAborted();
    let requestCount = 0;
    for (let offset = 0; offset < pending.length;) {
      signal?.throwIfAborted();
      let batch = pending.slice(offset, offset + batchSize);
      let body = JSON.stringify({ model, input: batch.map(entry => entry.text), encoding_format: 'float' });
      while (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES && batch.length > 1) {
        batch = batch.slice(0, -1);
        body = JSON.stringify({ model, input: batch.map(entry => entry.text), encoding_format: 'float' });
      }
      if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) throw fail('Embedding request exceeds 256 KiB; no text was clipped.');
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const result = await requestText(new URL(endpoint), { method: 'POST', headers, body }, { fetch: fetcher, signal, timeoutMs });
      requestCount++;
      let response;
      try { response = JSON.parse(result); } catch { throw fail('Embedding provider did not return JSON.'); }
      if (!plain(response) || response.model !== model || !Array.isArray(response.data) || response.data.length !== batch.length) {
        throw fail('Embedding response has a mismatched model or input count.');
      }
      const indices = new Set();
      const embeddedAt = timestamp();
      for (const item of response.data) {
        if (!plain(item) || !Number.isInteger(item.index) || item.index < 0 || item.index >= batch.length || indices.has(item.index)) {
          throw fail('Embedding response contains missing, repeated, or invalid input indices.');
        }
        indices.add(item.index);
        const vector = unitVector(item.embedding, dimension);
        dimension ??= vector.length;
        const target = batch[item.index];
        vectors.set(JSON.stringify([target.kind, target.id]), {
          kind: target.kind, id: target.id, textHash: target.textHash, vector, embeddedAt,
        });
      }
      offset += batch.length;
    }
    signal?.throwIfAborted();
    const queryVector = vectors.get(JSON.stringify(['query', 'query'])).vector;
    const ranking = papers.map(paper => {
      const vector = vectors.get(JSON.stringify(['paper', paper.id])).vector;
      const similarity = Math.max(-1, Math.min(1, vector.reduce((sum, value, i) => sum + value * queryVector[i], 0)));
      return { id: paper.id, inputIndex: paper.inputIndex, cosineSimilarity: similarity,
        missingTitle: paper.missingTitle, missingAbstract: paper.missingAbstract, textBytes: paper.textBytes, textHash: paper.textHash };
    }).sort((left, right) => right.cosineSimilarity - left.cosineSimilarity || left.inputIndex - right.inputIndex)
      .map((entry, index) => ({ rank: index + 1, ...entry }));
    return {
      version: 1, source: dataset, query: topic, ranking,
      provenance: { startedAt, completedAt: timestamp(), ...scope, dimension, normalization: 'l2',
        similarity: 'cosine', requestCount, embeddedCount: pending.length, reusedCount,
        clientTruncation: false, tokenLimitVerified: false, exclusions: 0 },
      cache: { version: 1, ...scope, dimension, normalization: 'l2',
        entries: targets.map(target => vectors.get(JSON.stringify([target.kind, target.id]))) },
    };
  } catch (error) {
    if (signal?.aborted) throw fail('Embedding ranking cancelled; no result was produced.');
    if (error instanceof EmbeddingError) throw error;
    if (error instanceof MetadataError) throw fail(error.message);
    throw fail('Embedding ranking failed; provider or transport details were not exposed.');
  }
}
