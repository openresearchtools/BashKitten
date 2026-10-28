// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectorTarget, importDois } from '../lib/zotero-import.mjs';
import { ZoteroError } from '../lib/zotero.mjs';
import { main } from '../scripts/zotero.mjs';

const DOI = '10.1234/example';
const selection = { libraryID: 1, libraryName: 'Synthetic library', libraryEditable: true, editable: true, id: null, name: 'Synthetic library' };
const ris = `TY  - JOUR\nDO  - ${DOI}\nTI  - Synthetic paper\nER  - \n`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function fixture({ selected = selection, metadata = ris, saved = [{ key: 'ABCD2345', DOI }], write } = {}) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.pathname.endsWith('/getSelectedCollection')) return json(typeof selected === 'function' ? selected(calls) : selected);
    if (url.hostname === 'api.crossref.org') return new Response(metadata);
    if (url.pathname.endsWith('/import')) return write ? write(url, options) : json(saved, 201);
    assert.fail('Unexpected endpoint');
  };
  return { calls, fetch };
}
function io() {
  const output = { out: '', err: '' };
  return { output, stdout: { write: value => { output.out += value; } }, stderr: { write: value => { output.err += value; } } };
}

test('target is read-only, loopback-only, and distinguishes internal targets from citation identities', async () => {
  const mock = fixture({ selected: { ...selection, id: 23, name: 'Synthetic collection' } });
  assert.deepEqual(await connectorTarget({}, mock), { target: 'C23', libraryName: selection.libraryName, collectionName: 'Synthetic collection', editable: true });
  assert.equal(mock.calls[0].options.body, '{}');
  assert.equal(mock.calls[0].options.headers['Zotero-API-Key'], undefined);
  assert.equal(mock.calls[0].options.redirect, 'error');
  await assert.rejects(connectorTarget({ localUrl: 'http://example.org/api/' }, mock), /loopback/);
});

test('DOI import delegates RIS translation, deduplicates a batch, verifies keys, and makes one write', async () => {
  const mock = fixture();
  const result = await importDois({ dois: [DOI, DOI.toUpperCase()], expectedTarget: 'L1' }, mock);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].itemKey, 'ABCD2345');
  assert.equal(result.items[0].id, undefined);
  assert.equal(mock.calls.length, 4);
  assert.equal(mock.calls[1].url.hostname, 'api.crossref.org');
  assert.ok(mock.calls[1].url.pathname.includes('10.1234%2Fexample'));
  assert.equal(mock.calls[3].options.body, ris.trimEnd() + '\n');
  assert.match(mock.calls[3].url.searchParams.get('session'), /^[a-f0-9-]{36}$/);
  assert.match(result.note, /canonical|qualified/);
});

test('selected destination guard rejects mismatch, read-only target, and a selection changed during retrieval', async () => {
  for (const selected of [{ ...selection, libraryID: 2 }, { ...selection, editable: false },
    calls => calls.length < 3 ? selection : { ...selection, id: 23 }]) {
    const mock = fixture({ selected });
    await assert.rejects(importDois({ dois: [DOI], expectedTarget: 'L1' }, mock), /destination/);
    assert.equal(mock.calls.filter(call => call.url.pathname.endsWith('/import')).length, 0);
  }
});

test('no import follows invalid DOI, wrong metadata DOI, multiple RIS records, or attachment links', async () => {
  const invalid = fixture();
  await assert.rejects(importDois({ dois: ['10.1234/no\n'], expectedTarget: 'L1' }, invalid), /DOIs/);
  assert.equal(invalid.calls.length, 0);
  for (const metadata of [ris.replace(DOI, '10.1234/wrong'), `${ris}\n${ris}`, `${ris}\n${ris.replaceAll('  -', ' -')}`, ris.replace('ER  -', 'L1  - https://example.org/private.pdf\nER  -'), ris.replace('ER  -', 'L1 - https://example.org/private.pdf\nER  -')]) {
    const mock = fixture({ metadata });
    await assert.rejects(importDois({ dois: [DOI], expectedTarget: 'L1' }, mock), /RIS/);
    assert.equal(mock.calls.filter(call => call.url.pathname.endsWith('/import')).length, 0);
  }
});

test('CLI resolve accepts multiple identifiers while generic import accepts exactly one', async () => {
  const streams = io();
  let seen;
  const dependencies = { ...streams, resolveIds: async options => { seen = options; return {}; }, importOne: async options => { seen = options; return {}; } };
  assert.equal(await main(['resolve', '--identifier', 'PMC123', '--identifier', 'PMID:100'], dependencies), 0);
  assert.deepEqual(seen.identifiers, ['PMC123', 'PMID:100']);
  assert.equal(await main(['import', '--identifier', 'PMID:100', '--expect-target', 'C1'], dependencies), 0);
  assert.equal(seen.identifier, 'PMID:100');
  assert.equal(seen.expectedTarget, 'C1');
  assert.equal(await main(['import', '--identifier', 'PMID:100', '--identifier', 'PMID:101'], dependencies), 1);
});

test('ambiguous write outcomes and malformed receipts never retry or invent IDs', async () => {
  for (const options of [
    { write: () => { throw new Error('SECRET transport detail'); } },
    { saved: [{ key: 'ABCD2345', DOI: '10.1234/wrong' }] },
    { saved: [{ DOI }] },
    { saved: [] },
  ]) {
    const mock = fixture(options);
    await assert.rejects(importDois({ dois: [DOI], expectedTarget: 'L1' }, mock), error =>
      /may have saved/.test(error.message) && !error.message.includes('SECRET'));
    assert.equal(mock.calls.filter(call => call.url.pathname.endsWith('/import')).length, 1);
  }
});

test('responses are bounded by both declared and streamed bytes, and stalled streams time out', async () => {
  const oversized = () => new Response('{}', { headers: { 'content-length': String(5 * 1024 * 1024) } });
  const streamed = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1)); controller.close(); } }));
  for (const fetch of [oversized, streamed]) await assert.rejects(connectorTarget({}, { fetch }), /4 MiB/);
  await assert.rejects(connectorTarget({ timeoutMs: 10 }, { fetch: async () => new Response(new ReadableStream()) }), /timed out/);
  await assert.rejects(connectorTarget({ timeoutMs: 10 }, { fetch: () => new Promise(() => {}) }), /timed out/);
});

test('cancellation propagates and upstream error bodies are not disclosed', async () => {
  let calls = 0;
  await assert.rejects(connectorTarget({ signal: AbortSignal.abort() }, { fetch: () => { calls++; } }), /cancelled/);
  assert.equal(calls, 0);
  await assert.rejects(connectorTarget({}, { fetch: async () => json({ key: 'SECRET' }, 403) }), error => /403/.test(error.message) && !error.message.includes('SECRET'));
});

test('CLI help and invalid arguments perform no network operations', async () => {
  const streams = io();
  const dependencies = { ...streams, createClient: () => assert.fail('No client'), target: () => assert.fail('No connector') };
  assert.equal(await main(['--help'], dependencies), 0);
  assert.match(streams.output.out, /WRITES/);
  for (const args of [[], ['target', '--mode', 'web'], ['search', '--limit', '101'], ['search', '--mode', 'web'], ['search', '--mode', 'local'], ['search', '--overwrite'], ['snapshot', '--id']]) {
    assert.equal(await main(args, dependencies), 1);
  }
});

test('CLI forwards read pagination and scoped IDs without reading or forwarding credentials', async () => {
  const streams = io();
  let configured;
  let search;
  let snapshot;
  const dependencies = { ...streams, env: { get ZOTERO_API_KEY() { assert.fail('Local Zotero must not read a legacy key'); } }, createClient: options => {
    configured = options;
    return { search: async options => { search = options; return { page: { nextStart: 9 } }; }, snapshot: async ids => { snapshot = ids; return { items: [] }; } };
  } };
  assert.equal(await main(['search', '--query', 'synthetic', '--library', 'users/123', '--limit', '3', '--start', '6'], dependencies), 0);
  assert.equal(Object.hasOwn(configured, 'apiKey'), false);
  assert.equal(Object.hasOwn(configured, 'mode'), false);
  assert.equal(search.start, 6);
  assert.equal(search.limit, 3);
  assert.equal(search.library, 'users/123');
  assert.ok(!streams.output.out.includes('SECRET'));
  const id = 'users/123/items/ABCD2345';
  assert.equal(await main(['snapshot', '--id', id], dependencies), 0);
  assert.equal(configured.apiKey, undefined);
  assert.deepEqual(snapshot, [id]);
});

test('CLI no-clobber preflight prevents imports, and overwrite uses shared output writer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zotero-cli-test-'));
  try {
    const path = join(directory, 'receipt.json');
    await writeFile(path, 'existing');
    const streams = io();
    let writes = 0;
    const args = ['import-doi', '--doi', DOI, '--expect-target', 'L1', '--output', path];
    const dependencies = { ...streams, importItems: async options => { writes++; assert.deepEqual(options.dois, [DOI]); return { items: ['synthetic'] }; } };
    assert.equal(await main(args, dependencies), 1);
    assert.equal(writes, 0);
    assert.equal(await readFile(path, 'utf8'), 'existing');
    assert.equal(await main([...args, '--overwrite'], dependencies), 0);
    assert.equal(writes, 1);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { items: ['synthetic'] });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI local URL flag overrides the shared environment default for local reads', async () => {
  const streams = io();
  let seen;
  const dependencies = { ...streams, env: { ZOTERO_LOCAL_URL: 'http://127.0.0.1:23120/api/' },
    target: async options => { seen = options.localUrl; return {}; },
    createClient: options => { seen = options.localUrl; return { search: async () => ({}) }; },
  };
  assert.equal(await main(['target'], dependencies), 0);
  assert.equal(seen, dependencies.env.ZOTERO_LOCAL_URL);
  assert.equal(await main(['target', '--local-url', 'http://127.0.0.1:23121/api/'], dependencies), 0);
  assert.equal(seen, 'http://127.0.0.1:23121/api/');
  assert.equal(await main(['search', '--library', 'users/123'], dependencies), 0);
  assert.equal(seen, dependencies.env.ZOTERO_LOCAL_URL);
  assert.equal(await main(['search', '--local-url', 'http://127.0.0.1:23121/api/'], dependencies), 0);
  assert.equal(seen, 'http://127.0.0.1:23121/api/');
});

test('CLI warns when receipt publication fails after import and never reveals unknown errors', async () => {
  const streams = io();
  const stdout = { write: () => { throw new Error('SECRET'); } };
  assert.equal(await main(['import-doi', '--doi', DOI, '--expect-target', 'L1'], { ...streams, stdout, importItems: async () => ({ items: [] }) }), 1);
  assert.match(streams.output.err, /Items may already be saved/);
  assert.ok(!streams.output.err.includes('SECRET'));
});

test('CLI reports sanitized read-client diagnostics while hiding unknown errors', async () => {
  const streams = io();
  const missing = 'Cannot establish the canonical Zotero URI; supply its verified library-qualified ID.';
  const createClient = () => ({ search: async () => { throw new ZoteroError(missing); } });
  assert.equal(await main(['search'], { ...streams, createClient }), 1);
  assert.ok(streams.output.err.includes(missing));
  assert.equal(await main(['search'], { ...streams, createClient: () => { throw new Error('SECRET'); } }), 1);
  assert.ok(!streams.output.err.includes('SECRET'));
});
