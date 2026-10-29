// SPDX-License-Identifier: AGPL-3.0-or-later
import { MetadataError, requestText } from './metadata-http.mjs';
import { normalizeIdentifier } from './identifiers.mjs';
import { workIdentifierKind, assertCompatibleWorkIdentifiers } from './work-identity.mjs';
const normalizeId = value => { if (!/^bkref:[^/]+\/[^/]+\/[A-Z0-9]+$/.test(value)) throw new Error('Invalid References identity'); return value; };

const ENDPOINT = 'https://api.openalex.org/works';
const fail = message => new MetadataError(message);
const singleLine = (value, max = 4096) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);

/** Decode the source's word positions; reject gaps/collisions instead of inventing text. */
export function reconstructAbstract(index) {
  if (index === null || index === undefined) return '';
  if (typeof index !== 'object' || Array.isArray(index)) throw fail('OpenAlex abstract index must be an object.');
  const tokens = new Map();
  let size = 0;
  for (const [word, positions] of Object.entries(index)) {
    if (!word.trim() || !Array.isArray(positions) || !positions.length) throw fail('OpenAlex abstract index has an invalid token or position list.');
    for (const position of positions) {
      if (!Number.isSafeInteger(position) || position < 0 || position >= 100000 || tokens.has(position)) {
        throw fail('OpenAlex abstract index has an invalid, repeated, or oversized position.');
      }
      size += word.length + 1;
      if (size > 1024 * 1024) throw fail('OpenAlex abstract exceeds 1 MiB of text.');
      tokens.set(position, word);
    }
  }
  const words = [];
  for (let i = 0; i < tokens.size; i++) {
    if (!tokens.has(i)) throw fail('OpenAlex abstract index has missing positions; no incomplete abstract was reconstructed.');
    words.push(tokens.get(i));
  }
  // Match the native plugin's punctuation and split-hyphen normalization.
  return words.join(' ').replace(/\s+([,.;:!?])/g, '$1').replace(/-\s+/g, '-').trim();
}

export function extractAbstract(record) {
  const text = typeof record.abstract === 'string' && record.abstract.trim()
    ? record.abstract.trim()
    : reconstructAbstract(record.abstract_inverted_index ?? (typeof record.abstract === 'object' ? record.abstract : null));
  if (text.length > 1024 * 1024 || !text.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))
    throw fail('OpenAlex abstract contains invalid text or exceeds 1 MiB.');
  return text;
}

/** Native-plugin metadata precedence, not a scientific completeness judgement. */
export function selectAbstract(openalexAbstract = '', zoteroAbstract = '') {
  const openalex = openalexAbstract.trim();
  const zotero = zoteroAbstract.trim();
  const useOpenAlex = openalex && zotero.length < 100 && openalex.length > zotero.length;
  return useOpenAlex ? { text: openalex, source: 'OpenAlex' }
    : { text: zotero, source: zotero ? 'Zotero' : null };
}

export function openAlexRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw fail('OpenAlex returned a work without a valid OpenAlex identity.');
  }
  // Main reviewer harvest.extractIdentifiers accepts root and ids aliases.
  // Reuse that source selection, with the shared strict owner checking every
  // supplied alias instead of silently accepting the first conflicting value.
  const sources = [{ OpenAlex: raw.id }, { OpenAlex: raw.openalex_id }];
  for (const object of [raw, raw.ids]) {
    if (!object || typeof object !== 'object') continue;
    for (const [name, value] of Object.entries(object)) {
      const kind = workIdentifierKind(name === 'arxiv_id' ? 'arXiv' : name);
      if (kind) for (const identifier of Array.isArray(value) ? value : [value])
        sources.push({ itemType: raw.type === 'book' ? 'book' : undefined, [kind]: identifier });
    }
  }
  const identifiers = assertCompatibleWorkIdentifiers(...sources);
  if (!identifiers.OpenAlex) throw fail('OpenAlex returned a work without a valid OpenAlex identity.');
  const id = `https://openalex.org/${identifiers.OpenAlex}`;
  let abstract = '', abstractIssue;
  try { abstract = extractAbstract(raw); }
  catch (error) {
    if (!(error instanceof MetadataError)) throw error;
    abstractIssue = { source: 'OpenAlex', status: 'unavailable', reason: error.message };
  }
  return {
    id,
    identifiers,
    doi: identifiers.DOI ?? null,
    pmid: identifiers.PMID ?? null,
    pmcid: identifiers.PMCID ?? null,
    arxiv: identifiers.arXiv ?? null,
    abstract,
    abstractSource: abstract ? 'OpenAlex' : null,
    ...(abstractIssue ? { abstractIssue } : {}),
    sourceUrl: `${ENDPOINT}/${identifiers.OpenAlex}`,
    raw,
  };
}

/** Optional enrichment boundary: lookup reads existing references; it must not import items. */
export async function enrichOpenAlexRecord(record, lookup, { signal } = {}) {
  signal?.throwIfAborted();
  const match = await lookup(record, { signal });
  signal?.throwIfAborted();
  if (!match) return { ...record, zotero: { status: 'not-found' } };
  const id = normalizeId(match.id);
  if (typeof match.abstract !== 'string') throw fail('Zotero enrichment returned an invalid abstract.');
  const selected = selectAbstract(record.abstract, match.abstract);
  return {
    ...record,
    abstract: selected.text,
    abstractSource: selected.source,
    zotero: { status: 'matched', ...match, id, abstract: match.abstract.trim() },
  };
}

/** Bounded, explicit OpenAlex GETs; no file writes, imports, or research decisions. */
export async function harvestOpenAlex({
  query = '', filter = '', sort = '', limit = 100, pageSize = 100,
  apiKey, timeoutMs = 30000, signal, lookupZotero,
} = {}, { fetch: fetcher = globalThis.fetch, now = Date.now } = {}) {
  if (![query, filter, sort].every(value => singleLine(value)) || (!query.trim() && !filter.trim())) {
    throw fail('Supply an OpenAlex query or filter, each a single line of at most 4096 characters.');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw fail('OpenAlex limit must be 1–1000 and page size must be 1–100.');
  }
  if (apiKey !== undefined && (!singleLine(apiKey, 4096) || !apiKey.trim())) throw fail('Invalid OpenAlex API key.');
  if (lookupZotero !== undefined && typeof lookupZotero !== 'function') throw fail('Zotero lookup must be a function.');
  const timestamp = () => new Date(now()).toISOString();
  const startedAt = timestamp();
  const records = [], pages = [], seen = new Set();
  let cursor = '*';
  let stopReason;
  while (!stopReason) {
    signal?.throwIfAborted();
    if (cursor !== '*' && !apiKey) throw fail('OpenAlex cursor paging past the first page requires an API key. Configure an OpenAlex key in References Settings; no partial result was saved.');
    const url = new URL(ENDPOINT);
    if (query.trim()) url.searchParams.set('search', query.trim());
    if (filter.trim()) url.searchParams.set('filter', filter.trim());
    if (sort.trim()) url.searchParams.set('sort', sort.trim());
    const rows = Math.min(pageSize, limit - records.length);
    url.searchParams.set('per_page', String(rows));
    url.searchParams.set('cursor', cursor);
    const headers = { Accept: 'application/json', 'User-Agent': 'BashKitten References/0.1' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const text = await requestText(url, { method: 'GET', headers }, { fetch: fetcher, signal, timeoutMs });
    let body;
    try { body = JSON.parse(text); } catch { throw fail('OpenAlex did not return valid JSON.'); }
    if (!Array.isArray(body?.results) || body.results.length > rows || !Number.isSafeInteger(body?.meta?.count) || body.meta.count < 0) {
      throw fail('OpenAlex returned a malformed works page.');
    }
    for (const raw of body.results) {
      let record = openAlexRecord(raw);
      if (seen.has(record.id)) throw fail('OpenAlex repeated a work during pagination; no partial result was saved.');
      seen.add(record.id);
      if (lookupZotero) record = await enrichOpenAlexRecord(record, lookupZotero, { signal });
      records.push(record);
    }
    pages.push({ url: url.href, retrievedAt: timestamp(), returned: body.results.length, totalResultsReported: body.meta.count });
    if (records.length === limit) stopReason = 'limit';
    else if (body.meta.next_cursor === null && records.length >= body.meta.count) stopReason = 'exhausted';
    else if (!body.results.length) throw fail('OpenAlex ended before its reported result count.');
    else if (!singleLine(body.meta.next_cursor, 16384) || !body.meta.next_cursor || body.meta.next_cursor === cursor) {
      throw fail('OpenAlex omitted or repeated its pagination cursor.');
    } else cursor = body.meta.next_cursor;
  }
  signal?.throwIfAborted();
  const malformedAbstracts = records.filter(record => record.abstractIssue).length;
  return {
    source: { name: 'OpenAlex', endpoint: ENDPOINT },
    query: query.trim(), filter: filter.trim(), sort: sort.trim() || null,
    startedAt, completedAt: timestamp(), limit, count: records.length, stopReason,
    totalResultsReported: pages[0].totalResultsReported,
    ...(malformedAbstracts ? { warnings: { malformedAbstracts } } : {}),
    provenance: { method: 'GET', pages, zoteroEnrichment: !!lookupZotero }, records,
  };
}

function zoteroIdentifiers(item) {
  const data = item.zoteroData;
  if (!data || typeof data !== 'object') throw fail('Zotero enrichment requires source item data.');
  const ids = new Map();
  const add = (value, type) => {
    if (!value) return;
    let result;
    try { result = normalizeIdentifier(value); }
    catch { return; /* Unusable metadata is not a matching identifier. */ }
    if (result.type !== type) return;
    const normalized = result.value.toLowerCase();
    if (ids.has(type) && ids.get(type) !== normalized) {
      throw fail('Zotero candidate has conflicting external identifiers; reconcile it before enrichment.');
    }
    ids.set(type, normalized);
  };
  add(data.DOI, 'DOI');
  add(item.itemData?.DOI, 'DOI');
  add(data.PMID ? `PMID:${data.PMID}` : '', 'PMID');
  for (const line of String(data.extra ?? '').split(/\r?\n/)) {
    if (/^\s*PMID\s*:/i.test(line)) add(line.trim(), 'PMID');
  }
  add(data.url, 'PMID');
  return ids;
}

/** Read one explicitly selected library; never choose among duplicate exact matches. */
export function createZoteroAbstractLookup(client, { library, maxPages = 5 } = {}) {
  if (!client || typeof client.search !== 'function' || !/^(users\/(0|[1-9]\d*)|groups\/[1-9]\d*)$/.test(library ?? '') ||
      !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10) throw fail('Specify a Zotero client, library, and a search budget of 1–10 pages.');
  return async (record, { signal } = {}) => {
    const expected = new Map([['DOI', record.doi], ['PMID', record.pmid]].filter(([, value]) => value).map(([type, value]) => [type, value.toLowerCase()]));
    const matched = new Map();
    for (const value of expected.values()) {
      let start = 0;
      for (let page = 0; ; page++) {
        signal?.throwIfAborted();
        const result = await client.search({ library, query: value, qmode: 'everything', includeData: true, limit: 100, start, signal });
        for (const item of result.items) {
          const actual = zoteroIdentifiers(item);
          const shared = [...expected].filter(([type, id]) => actual.get(type) === id);
          if (!shared.length) continue;
          if ([...expected].some(([type, id]) => actual.has(type) && actual.get(type) !== id)) {
            throw fail('Zotero candidate has conflicting external identifiers; reconcile it before enrichment.');
          }
          matched.set(item.id, {
            id: item.id, abstract: item.zoteroData.abstractNote ?? '',
            matchedBy: shared.map(([type]) => type), provenance: item.provenance,
          });
        }
        if (result.page.nextStart === null) break;
        if (page + 1 >= maxPages || !Number.isInteger(result.page.nextStart) || result.page.nextStart <= start) {
          throw fail('Zotero identifier search exceeds its page budget or cannot advance; narrow the library before enrichment.');
        }
        start = result.page.nextStart;
      }
    }
    if (matched.size > 1) throw fail('Multiple Zotero items match this work; resolve duplicates before enriching its abstract.');
    return matched.values().next().value ?? null;
  };
}
