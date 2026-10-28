import test from 'node:test';
import assert from 'node:assert/strict';
import { ZoteroClient } from '../lib/zotero.mjs';
const id = 'users/123/items/ABCD2345';
const item = { key: 'ABCD2345', version: 9, library: { type: 'user', id: 123 }, csljson: { id: `http://zotero.org/${id}`, type: 'book', title: 'Example' } };
const response = (data, headers = {}, status = 200) => new Response(JSON.stringify(data), { status, headers });

test('local API uses existing Zotero endpoint, CSL include and no API key', async () => {
  const calls = [];
  const client = new ZoteroClient({ apiKey: 'secret', fetch: async (url, options) => { calls.push({ url, options }); return response(item, { 'Zotero-Server-ID': 'instance1' }); } });
  const snapshot = await client.snapshot([id, id]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, 'http://127.0.0.1:23119');
  assert.equal(calls[0].url.pathname, `/api/${id}`);
  assert.equal(calls[0].url.searchParams.get('include'), 'csljson');
  assert.equal(calls[0].options.headers['Zotero-API-Key'], undefined);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(snapshot.items[0].id, id);
  assert.equal(snapshot.items[0].provenance.serverId, 'instance1');
  assert.equal(snapshot.items[0].provenance.mode, 'local');
  await client.snapshot([id]);
  assert.equal(calls[1].options.headers['Zotero-Server-ID'], 'instance1');
  assert.equal(calls[1].options.headers['Zotero-API-Key'], undefined);
});

test('legacy remote mode and nonlocal URLs fail before any request', async () => {
  const fetch = () => assert.fail('Must not contact a remote API or silently fall back');
  for (const mode of ['web', 'remote', null]) assert.throws(() => new ZoteroClient({ mode, fetch }), /local Zotero/);
  for (const localUrl of ['https://api.zotero.org/', 'http://example.org/api/']) assert.throws(() => new ZoteroClient({ localUrl, fetch }), /loopback/);
  const client = new ZoteroClient({ mode: 'local', fetch });
  await assert.rejects(() => client.get(`https://api.zotero.org/${id}`, {}), /origin/);
  await assert.rejects(() => client.get(`http://user:password@127.0.0.1:23119/api/${id}`, {}), /credentials/);
});

test('local group library identities and a custom loopback port are preserved', async () => {
  const groupId = 'groups/456/items/ABCD2345';
  const client = new ZoteroClient({ localUrl: 'http://127.0.0.1:23120/api/', fetch: async (url, options) => {
    assert.equal(url.origin, 'http://127.0.0.1:23120');
    assert.equal(url.pathname, '/api/groups/456/items/top');
    assert.equal(options.headers['Zotero-API-Key'], undefined);
    return response([{ ...item, library: { type: 'group', id: 456 }, csljson: { ...item.csljson, id: 'replaceable-label' } }]);
  } });
  const result = await client.search({ library: 'groups/456' });
  assert.equal(result.items[0].id, groupId);
  assert.equal(result.items[0].itemData.id, `http://zotero.org/${groupId}`);
  assert.equal(result.items[0].provenance.mode, 'local');
});

test('local translator string arrays and citation-key exports use verified scoped identities', async () => {
  const raw = { ...item, csljson: JSON.stringify([{ ...item.csljson, id: 'Smith2024' }]) };
  const client = new ZoteroClient({ fetch: async () => response(raw) });
  assert.equal((await client.snapshot([id])).items[0].id, id);
  const localId = 'users/local/abc123/items/ABCD2345';
  const local = new ZoteroClient({ fetch: async url => {
    assert.equal(url.pathname, '/api/users/0/items/ABCD2345');
    return response({ ...item, library: { type: 'user', id: 0 }, csljson: { ...item.csljson, id: `http://zotero.org/${localId}` } });
  } });
  assert.equal((await local.snapshot([localId])).items[0].id, localId);
});

test('library mismatch, missing metadata and unresolved users/0 fail closed', async () => {
  const client = new ZoteroClient({ fetch: async () => response(item) });
  await assert.rejects(() => client.snapshot(['users/456/items/ABCD2345']), /mismatch/);
  const missing = new ZoteroClient({ fetch: async () => response({ ...item, csljson: undefined }) });
  await assert.rejects(() => missing.snapshot([id]), /Missing CSL/);
  const ambiguous = new ZoteroClient({ fetch: async () => response([{ ...item, library: { type: 'user', id: 0 }, csljson: { ...item.csljson, id: 'Smith2024' } }]) });
  await assert.rejects(() => ambiguous.search(), /canonical/);
});

test('search is bounded and returns explicit pagination; excludes nonbibliographic types with AND', async () => {
  const client = new ZoteroClient({ fetch: async url => {
    assert.equal(url.searchParams.get('limit'), '1');
    assert.equal(url.searchParams.get('q'), 'evidence & review');
    assert.deepEqual(url.searchParams.getAll('itemType'), ['-attachment', '-note', '-annotation']);
    return response([item], { 'Total-Results': '3' });
  } });
  const result = await client.search({ query: 'evidence & review', limit: 1 });
  assert.equal(result.page.nextStart, 1);
  assert.equal(result.page.total, 3);
  await assert.rejects(() => client.search({ limit: 101 }), /limit/);
});

test('optional source data supports abstract/identifier enrichment without changing citation-only searches', async () => {
  const data = { itemType: 'journalArticle', abstractNote: 'Verified abstract', extra: 'PMID: 12345678' };
  const client = new ZoteroClient({ fetch: async url => {
    const withData = url.searchParams.get('include') === 'data,csljson';
    return response([{ ...item, ...(withData ? { data } : {}) }]);
  } });
  const enriched = await client.search({ includeData: true });
  assert.equal(enriched.items[0].id, id);
  assert.deepEqual(enriched.items[0].zoteroData, data);
  assert.equal((await client.search()).items[0].zoteroData, undefined);
  const missing = new ZoteroClient({ fetch: async () => response([item]) });
  await assert.rejects(() => missing.search({ includeData: true }), /requested item data/);
  await assert.rejects(() => client.search({ includeData: 'yes' }), /boolean/);
});

test('identifier searches can explicitly include all metadata fields', async () => {
  const client = new ZoteroClient({ fetch: async url => {
    assert.equal(url.searchParams.get('qmode'), 'everything');
    assert.equal(url.searchParams.get('q'), '10.1234/example');
    return response([item]);
  } });
  assert.equal((await client.search({ query: '10.1234/example', qmode: 'everything' })).items[0].id, id);
  await assert.rejects(() => client.search({ qmode: 'unknown' }), /qmode/);
});

test('rate limits retry with a bound and long Retry-After fails immediately', async () => {
  let calls = 0;
  const sleeps = [];
  const client = new ZoteroClient({ fetch: async () => ++calls === 1 ? response({}, { 'Retry-After': '2' }, 429) : response(item), sleep: async ms => sleeps.push(ms) });
  await client.snapshot([id]);
  assert.deepEqual(sleeps, [2000]);
  const long = new ZoteroClient({ fetch: async () => response({}, { 'Retry-After': '120' }, 503), sleep: async () => assert.fail('Should not wait 120s') });
  await assert.rejects(() => long.snapshot([id]), /503/);
});

test('transport details and response body are not leaked in local API errors', async () => {
  const client = new ZoteroClient({ fetch: async () => { throw new Error('SECRET'); } });
  await assert.rejects(() => client.snapshot([id]), error => !error.message.includes('SECRET'));
  const denied = new ZoteroClient({ fetch: async () => response({ secret: 'DO_NOT_PRINT' }, {}, 403) });
  await assert.rejects(() => denied.snapshot([id]), error => /403/.test(error.message) && !error.message.includes('DO_NOT_PRINT'));
});

test('cancellation, response limits and local origin restriction', async () => {
  assert.throws(() => new ZoteroClient({ localUrl: 'http://example.org/api/' }), /loopback/);
  const signal = AbortSignal.abort(new Error('cancelled'));
  const client = new ZoteroClient({ fetch: async () => assert.fail('No request after abort') });
  await assert.rejects(() => client.snapshot([id], { signal }), /cancelled/);
  const large = new ZoteroClient({ fetch: async () => response({}, { 'content-length': String(11 * 1024 * 1024) }) });
  await assert.rejects(() => large.snapshot([id]), /10 MiB/);
});

test('server identity change stops a multi-item snapshot', async () => {
  let calls = 0;
  const client = new ZoteroClient({ fetch: async () => response(item, { 'Zotero-Server-ID': ++calls === 1 ? 'one' : 'two' }) });
  await assert.rejects(() => client.snapshot([id, 'users/123/items/EFGH6789']), /instance changed/);
});

test('invalid UTF-8, duplicate search results and prematurely empty pages fail closed', async () => {
  const invalid = new ZoteroClient({ fetch: async () => new Response(Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x30, 0x7d])) });
  await assert.rejects(() => invalid.snapshot([id]), /UTF-8/);
  const empty = new ZoteroClient({ fetch: async () => response([], { 'Total-Results': '3' }) });
  await assert.rejects(() => empty.search(), /empty page/);
  const duplicate = new ZoteroClient({ fetch: async () => response([item, item]) });
  await assert.rejects(() => duplicate.search(), /Duplicate reference/);
});
