// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reconstructAbstract, extractAbstract, selectAbstract, openAlexRecord, harvestOpenAlex, enrichOpenAlexRecord, createZoteroAbstractLookup } from '../lib/openalex.mjs';
import { main } from '../scripts/openalex.mjs';

const work = (n = 1, extras = {}) => ({ id: `https://openalex.org/W${n}`, doi: `https://doi.org/10.1234/test${n}`, abstract_inverted_index: { Example: [0], abstract: [1] }, ...extras });
const response = (results, count = results.length, cursor = null) => Response.json({ meta: { count, next_cursor: cursor }, results });
const fixedClock = () => Date.UTC(2026, 9, 24);
const zoteroItem = (key, data) => ({ id: `users/123/items/${key}`, itemData: { type: 'article-journal' }, zoteroData: data, provenance: { mode: 'local', itemVersion: 7 } });
const page = (items, nextStart = null) => ({ items, page: { nextStart } });

test('OpenAlex reconstructs repeated words by position and native punctuation/hyphen normalization', () => {
  assert.equal(reconstructAbstract({ '.': [7], to: [2, 4], day: [1], a: [5], 'Day-': [0], leads: [3], result: [6] }), 'Day-day to leads to a result.');
  assert.equal(reconstructAbstract(null), '');
  assert.equal(reconstructAbstract({}), '');
  assert.equal(extractAbstract({ abstract: '' }), '');
  assert.equal(extractAbstract({ abstract: '  ' }), '');
  assert.equal(extractAbstract({ abstract: ' Plain text ', abstract_inverted_index: {} }), 'Plain text');
  assert.equal(extractAbstract({ abstract: { Older: [0], format: [1] } }), 'Older format');
});

test('OpenAlex rejects malformed/sparse indices instead of silently losing tokens or huge allocation', () => {
  for (const index of [[], 'text', { x: '0' }, { x: [] }, { x: [-1] }, { x: [0.5] }, { x: ['0'] }, { x: [0, 0] }, { x: [0], y: [0] }, { x: [1] }, { x: [0, 1000000000] }, { '': [0] }]) {
    assert.throws(() => reconstructAbstract(index), /index/);
  }
});

test('native abstract precedence uses trimmed 100-character boundary and retains complete Zotero text', () => {
  assert.deepEqual(selectAbstract('OpenAlex text', ''), { text: 'OpenAlex text', source: 'OpenAlex' });
  assert.deepEqual(selectAbstract('', ' Zotero '), { text: 'Zotero', source: 'Zotero' });
  assert.equal(selectAbstract('A'.repeat(101), 'Z'.repeat(99)).source, 'OpenAlex');
  assert.equal(selectAbstract('A'.repeat(1000), ` ${'Z'.repeat(100)} `).source, 'Zotero');
  assert.equal(selectAbstract('equal', 'other').source, 'Zotero');
  assert.deepEqual(selectAbstract('', ''), { text: '', source: null });
});

test('record preserves source metadata, including DOI-less works and raw inverted index', () => {
  const raw = work(1, { doi: null, ids: { pmid: 'https://pubmed.ncbi.nlm.nih.gov/100/' } });
  const record = openAlexRecord(raw);
  assert.equal(record.doi, null);
  assert.equal(record.pmid, '100');
  assert.equal(record.raw, raw);
  assert.equal(record.abstract, 'Example abstract');
  assert.throws(() => openAlexRecord(work(1, { id: 'W1' })), /identity/);
});

test('harvest keeps malformed abstracts as explicit issues alongside complete valid records', async () => {
  const raw = [
    work(1, { abstract_inverted_index: { Missing: [1] } }),
    work(2, { abstract_inverted_index: { Same: [0], position: [0] } }),
    work(3),
    work(4, { abstract_inverted_index: null }),
  ];
  const result = await harvestOpenAlex({ query: 'x' }, { fetch: async () => response(raw) });
  assert.equal(result.count, 4);
  assert.equal(result.stopReason, 'exhausted');
  assert.deepEqual(result.records.map(record => record.raw), raw);
  assert.deepEqual(result.warnings, { malformedAbstracts: 2 });
  for (const record of result.records.slice(0, 2)) {
    assert.equal(record.abstract, '');
    assert.equal(record.abstractSource, null);
    assert.equal(record.abstractIssue.source, 'OpenAlex');
    assert.equal(record.abstractIssue.status, 'unavailable');
  }
  assert.match(result.records[0].abstractIssue.reason, /missing positions/);
  assert.match(result.records[1].abstractIssue.reason, /repeated/);
  assert.equal(result.records[2].abstract, 'Example abstract');
  assert.equal(result.records[2].abstractSource, 'OpenAlex');
  assert.equal(result.records[2].abstractIssue, undefined);
  assert.equal(result.records[3].abstract, '');
  assert.equal(result.records[3].abstractIssue, undefined);
  for (const extras of [{ id: 'W1' }, { doi: 'not-a-doi' }, { pmid: 'PMID:0' }]) {
    await assert.rejects(harvestOpenAlex({ query: 'x' }, {
      fetch: async () => response([work(1, { abstract_inverted_index: { Missing: [1] }, ...extras })]),
    }));
  }
});

test('Zotero can fill a malformed OpenAlex abstract without hiding the source issue', async () => {
  const raw = work(1, { abstract_inverted_index: { Missing: [1] } });
  const result = await harvestOpenAlex({ query: 'x', lookupZotero: async () => ({
    id: 'users/123/items/ABCDEFGH', abstract: 'Complete Zotero abstract',
  }) }, { fetch: async () => response([raw]) });
  const record = result.records[0];
  assert.equal(record.abstract, 'Complete Zotero abstract');
  assert.equal(record.abstractSource, 'Zotero');
  assert.equal(record.abstractIssue.source, 'OpenAlex');
  assert.match(record.abstractIssue.reason, /missing positions/);
  assert.deepEqual(record.raw, raw);
  assert.deepEqual(result.warnings, { malformedAbstracts: 1 });
});

test('OpenAlex passes researcher search/filter/sort, follows bounded cursors, preserves provenance, hides key', async () => {
  const calls = [];
  const result = await harvestOpenAlex({ query: 'chosen query', filter: 'publication_year:2024', sort: 'publication_date:asc', limit: 3, pageSize: 2, apiKey: 'secret-key' }, {
    now: fixedClock,
    fetch: async (url, init) => {
      calls.push({ url: new URL(url), init });
      return calls.length === 1 ? response([work(1), work(2)], 9, 'next-token') : response([work(3)], 9, 'third-token');
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get('search'), 'chosen query');
  assert.equal(calls[0].url.searchParams.get('filter'), 'publication_year:2024');
  assert.equal(calls[0].url.searchParams.get('sort'), 'publication_date:asc');
  assert.equal(calls[1].url.searchParams.get('cursor'), 'next-token');
  assert.equal(calls[1].url.searchParams.get('per_page'), '1');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-key');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(result.stopReason, 'limit');
  assert.equal(result.records.length, 3);
  assert.equal(result.totalResultsReported, 9);
  assert.equal(result.provenance.pages.length, 2);
  assert.equal(result.warnings, undefined);
  assert.ok(!JSON.stringify(result).includes('secret-key'));
});

test('OpenAlex works without key for one page and reports exhausted empty search', async () => {
  const result = await harvestOpenAlex({ query: 'zero' }, { fetch: async () => response([]) });
  assert.equal(result.stopReason, 'exhausted');
  assert.equal(result.count, 0);
  let calls = 0;
  await assert.rejects(harvestOpenAlex({ query: 'more', limit: 2, pageSize: 1 }, {
    fetch: async () => { calls++; return response([work(1)], 2, 'next'); },
  }), /requires an API key.*setup/);
  assert.equal(calls, 1);
});

test('OpenAlex fails on malformed pages, duplicate works, missing cursor, or premature exhaustion', async () => {
  const bodies = [Response.json({ results: [], meta: {} }), response([], 10), response([work(1)], 2), response([work(1), work(1)], 2)];
  for (const body of bodies) await assert.rejects(harvestOpenAlex({ query: 'x', limit: 5 }, { fetch: async () => body }), /OpenAlex/);
  let calls = 0;
  await assert.rejects(harvestOpenAlex({ query: 'x', limit: 3, pageSize: 1, apiKey: 'key' }, {
    fetch: async () => response([work(++calls === 1 ? 1 : 1)], 10, String(calls)),
  }), /repeated a work/);
});

test('OpenAlex validates options before network and never exposes upstream errors or key', async () => {
  let calls = 0;
  const fetch = async () => { calls++; throw new Error('private secret-key url'); };
  for (const options of [{}, { query: '\n' }, { query: 'x', limit: 0 }, { query: 'x', pageSize: 101 }, { query: 'x', apiKey: '\nkey' }]) {
    await assert.rejects(harvestOpenAlex(options, { fetch }));
  }
  assert.equal(calls, 0);
  await assert.rejects(harvestOpenAlex({ query: 'x', apiKey: 'secret-key' }, { fetch }), error => !error.message.includes('secret-key'));
});

test('OpenAlex response is bounded and cancellation reaches fetch and stalled stream', async () => {
  await assert.rejects(harvestOpenAlex({ query: 'x' }, {
    fetch: async () => new Response('{}', { headers: { 'content-length': String(5 * 1024 * 1024) } }),
  }), /4 MiB/);
  const controller = new AbortController();
  let active;
  const pending = harvestOpenAlex({ query: 'x', signal: controller.signal }, {
    fetch: async (_url, init) => { active = init.signal; return new Response(new ReadableStream({ pull() { return new Promise(() => {}); } })); },
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, /cancelled/);
  assert.ok(active.aborted);
  await assert.rejects(harvestOpenAlex({ query: 'x', timeoutMs: 10 }, { fetch: () => new Promise(() => {}) }), /timed out/);
});

test('enrichment is opt-in and preserves both abstracts plus verified Zotero identity', async () => {
  let calls = 0;
  const raw = work(1, { abstract_inverted_index: null });
  const result = await harvestOpenAlex({ query: 'x', lookupZotero: async () => {
    calls++; return { id: 'users/123/items/ABCDEFGH', abstract: ' Found in Zotero ', provenance: { itemVersion: 7 } };
  } }, { fetch: async () => response([raw]) });
  assert.equal(calls, 1);
  assert.equal(result.records[0].abstract, 'Found in Zotero');
  assert.equal(result.records[0].abstractSource, 'Zotero');
  assert.equal(result.records[0].raw.abstract_inverted_index, null);
  assert.equal(result.records[0].zotero.id, 'users/123/items/ABCDEFGH');
  assert.equal((await enrichOpenAlexRecord(openAlexRecord(raw), async () => null)).zotero.status, 'not-found');
  await assert.rejects(enrichOpenAlexRecord(openAlexRecord(raw), async () => ({ id: 'ABCDEFGH', abstract: 'x' })), /identity|qualified|Zotero/i);
});

test('Zotero lookup checks exact DOI rather than accepting search hits; full source data and qmode requested', async () => {
  const client = { search: async args => {
    assert.equal(args.library, 'users/123'); assert.equal(args.includeData, true); assert.equal(args.qmode, 'everything');
    return page([
      zoteroItem('ABCDEFGH', { DOI: '10.1234/test10', abstractNote: 'wrong work' }),
      zoteroItem('BCDEFGHI', { DOI: 'https://doi.org/10.1234/TEST1', abstractNote: 'correct abstract' }),
    ]);
  } };
  const match = await createZoteroAbstractLookup(client, { library: 'users/123' })(openAlexRecord(work(1)));
  assert.equal(match.id, 'users/123/items/BCDEFGHI');
  assert.equal(match.abstract, 'correct abstract');
  assert.deepEqual(match.matchedBy, ['DOI']);
});

test('Zotero lookup supports PMID Extra and verified PubMed URL; rejects ambiguous and conflicting matches', async () => {
  const record = openAlexRecord(work(1, { doi: null, ids: { pmid: 'https://pubmed.ncbi.nlm.nih.gov/100/' } }));
  for (const data of [{ extra: 'PMID: 100' }, { url: 'https://pubmed.ncbi.nlm.nih.gov/100/' }]) {
    const match = await createZoteroAbstractLookup({ search: async () => page([zoteroItem('ABCDEFGH', data)]) }, { library: 'users/0' })(record);
    assert.deepEqual(match.matchedBy, ['PMID']);
  }
  const duplicateClient = { search: async () => page([zoteroItem('ABCDEFGH', { extra: 'PMID: 100' }), zoteroItem('BCDEFGHI', { extra: 'PMID: 100' })]) };
  await assert.rejects(createZoteroAbstractLookup(duplicateClient, { library: 'users/0' })(record), /Multiple Zotero items/);
  const conflicting = { search: async () => page([zoteroItem('ABCDEFGH', { DOI: '10.1234/test1', extra: 'PMID: 200' })]) };
  await assert.rejects(createZoteroAbstractLookup(conflicting, { library: 'users/0' })({ ...record, doi: '10.1234/test1' }), /conflicting/);
});

test('Zotero lookup follows bounded pages and does not declare truncated results complete', async () => {
  let calls = 0;
  const client = { search: async () => { calls++; return page([], calls * 100); } };
  await assert.rejects(createZoteroAbstractLookup(client, { library: 'users/0', maxPages: 2 })(openAlexRecord(work())), /page budget/);
  assert.equal(calls, 2);
});

test('Zotero lookup rejects inconsistent identifier fields without rejecting repeated equivalent IDs', async () => {
  const record = openAlexRecord(work(1, { ids: { pmid: 'https://pubmed.ncbi.nlm.nih.gov/100/' } }));
  const lookup = item => createZoteroAbstractLookup({ search: async () => page([item]) }, { library: 'users/0' })(record);
  await assert.rejects(lookup(zoteroItem('ABCDEFGH', {
    DOI: '10.1234/test1', extra: 'PMID:200\nPMID:300', url: 'https://pubmed.ncbi.nlm.nih.gov/100/',
  })), /conflicting external identifiers/);
  await assert.rejects(lookup({
    ...zoteroItem('ABCDEFGH', { DOI: '10.1234/test1', extra: 'PMID:100' }),
    itemData: { type: 'article-journal', DOI: '10.1234/different' },
  }), /conflicting external identifiers/);
  const match = await lookup({
    ...zoteroItem('ABCDEFGH', {
      DOI: '10.1234/test1', PMID: '100', extra: 'PMID:100\nPMID: 100', url: 'https://pubmed.ncbi.nlm.nih.gov/100/',
    }),
    itemData: { type: 'article-journal', DOI: 'https://doi.org/10.1234/TEST1' },
  });
  assert.equal(match.id, 'users/123/items/ABCDEFGH');
  assert.deepEqual(match.matchedBy, ['DOI', 'PMID']);
});

test('OpenAlex CLI is no-clobber, help/invalid arguments have no network, failed enrichment publishes nothing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sr-openalex-'));
  const output = join(directory, 'results.json');
  const env = { SYSTEMATIC_REVIEW_CONFIG: join(directory, 'missing-credentials.json') };
  let calls = 0, out = '', err = '';
  const stdout = { write: value => { out += value; } }, stderr = { write: value => { err += value; } };
  const harvest = async () => { calls++; return { count: 1, stopReason: 'limit', records: [] }; };
  try {
    assert.equal(await main(['--help'], { env, harvest, stdout, stderr }), 0);
    assert.equal(await main(['--query', 'x', '--output', output, '--limit', '1.5'], { env, harvest, stdout, stderr }), 1);
    assert.equal(await main(['--query', 'x', '--output', output, '--enrich-zotero', 'web', '--library', 'users/123'], { env, harvest, stdout, stderr }), 1);
    await writeFile(output, 'original');
    assert.equal(await main(['--query', 'x', '--output', output], { env, harvest, stdout, stderr }), 1);
    assert.equal(await readFile(output, 'utf8'), 'original');
    assert.equal(calls, 0);
    assert.equal(await main(['--filter', 'doi:10.1234/test1', '--output', output, '--overwrite'], { env, harvest, stdout, stderr }), 0);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).count, 1);
    assert.equal(calls, 1);
    const missing = join(directory, 'missing.json');
    assert.equal(await main(['--query', 'x', '--output', missing], { env, harvest: async () => { throw new Error('secret'); }, stdout, stderr }), 1);
    await assert.rejects(readFile(missing), { code: 'ENOENT' });
    assert.ok(!err.includes('secret'));
    assert.match(out, /Saved 1/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI publishes retained records and warns about malformed abstracts without reporting failure', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sr-openalex-issue-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'results.json');
  const env = { SYSTEMATIC_REVIEW_CONFIG: join(directory, 'missing-credentials.json') };
  let out = '', err = '';
  const raw = work(1, { abstract_inverted_index: { Missing: [1] } });
  const status = await main(['--query', 'x', '--output', output], {
    env, stdout: { write: value => { out += value; } }, stderr: { write: value => { err += value; } },
    harvest: options => harvestOpenAlex(options, { fetch: async () => response([raw, work(2)]) }),
  });
  assert.equal(status, 0);
  const saved = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(saved.count, 2);
  assert.deepEqual(saved.records[0].raw, raw);
  assert.match(saved.records[0].abstractIssue.reason, /missing positions/);
  assert.equal(saved.records[1].abstract, 'Example abstract');
  assert.match(out, /Saved 2 OpenAlex records/);
  assert.match(err, /Warning: 1 OpenAlex abstract could not be reconstructed; raw metadata and reasons were preserved/);
});
