// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EmbeddingError, embeddingEndpoint, rankPapers } from '../lib/embeddings.mjs';
import { main } from '../scripts/embeddings.mjs';

const model = 'synthetic-embeddings-v1';
const options = { query: 'review screening methods', baseUrl: 'http://127.0.0.1:8080/v1', model };
const corpus = () => ({ source: { name: 'synthetic' }, provenance: { untouched: true }, records: [
  { id: 'https://openalex.org/W1', raw: { title: ' Review methods ', extra: 'preserved' }, abstract: ' Title and abstract\r\nscreening. ', zotero: { id: 'users/123/items/ABCD2345' } },
  { id: 'https://openalex.org/W2', title: 'Diagnostic screening', abstract: '' },
] });
const now = () => Date.UTC(2026, 9, 24);
const response = (vectors, { responseModel = model, indices } = {}) => Response.json({ model: responseModel, data: vectors.map((embedding, i) => ({ index: indices?.[i] ?? i, embedding })) });
const transport = () => {
  const calls = [];
  return { calls, now, fetch: async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), init, body });
    return response(body.input.map(text => text.includes('Diagnostic') ? [0, 3] : [4, 0]));
  } };
};
const noRequest = () => assert.fail('No embedding request was expected');

test('explicit endpoint normalization never discovers providers or accepts URL credentials', () => {
  assert.equal(embeddingEndpoint('http://127.0.0.1:8080'), 'http://127.0.0.1:8080/v1/embeddings');
  assert.equal(embeddingEndpoint('https://example.org/proxy/v1/'), 'https://example.org/proxy/v1/embeddings');
  assert.equal(embeddingEndpoint('https://example.org/v1/embeddings'), 'https://example.org/v1/embeddings');
  for (const url of ['bad', 'file:///tmp/a', 'https://user:secret@example.org/v1', 'http://localhost/v1?key=secret', 'http://localhost/v1#secret']) {
    assert.throws(() => embeddingEndpoint(url), error => error instanceof EmbeddingError && !error.message.includes('secret'));
  }
});

test('ranking combines complete title and abstract with explicit prefixes and preserves source identities', async () => {
  const input = corpus(), deps = transport();
  const before = structuredClone(input);
  const result = await rankPapers(input, { ...options, documentPrefix: 'search_document: ', queryPrefix: 'search_query: ', apiKey: 'SYNTHETIC-SECRET' }, deps);
  assert.deepEqual(deps.calls[0].body.input, ['search_document: Review methods\n\nTitle and abstract\nscreening.', 'search_document: Diagnostic screening', 'search_query: review screening methods']);
  assert.equal(deps.calls[0].body.encoding_format, 'float');
  assert.equal(deps.calls[0].init.redirect, 'error');
  assert.equal(deps.calls[0].init.headers.Authorization, 'Bearer SYNTHETIC-SECRET');
  assert.ok(deps.calls[0].init.signal instanceof AbortSignal);
  assert.deepEqual(input, before);
  assert.equal(result.source, input);
  assert.deepEqual(result.ranking.map(item => [item.id, item.cosineSimilarity, item.missingAbstract]), [
    ['https://openalex.org/W1', 1, false], ['https://openalex.org/W2', 0, true],
  ]);
  assert.equal(result.provenance.clientTruncation, false);
  assert.equal(result.provenance.tokenLimitVerified, false);
  assert.equal(result.provenance.exclusions, 0);
  assert.equal(result.provenance.embeddedCount, 3);
  assert.equal(result.provenance.dimension, 2);
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC-SECRET'));
});

test('response indices determine correspondence, equal scores keep input order, and extreme values normalize safely', async () => {
  const result = await rankPapers(corpus().records, options, { now, fetch: async () => response([[1e300, 1e300], [1e-300, 1e-300], [3, 3]], { indices: [2, 0, 1] }) });
  assert.deepEqual(result.ranking.map(item => item.inputIndex), [0, 1]);
  for (const entry of result.cache.entries) assert.ok(Math.abs(Math.hypot(...entry.vector) - 1) < 1e-12);
  assert.ok(result.ranking.every(item => item.cosineSimilarity >= -1 && item.cosineSimilarity <= 1));
});

test('invalid corpus/options fail before requests, and missing text is explicit rather than invented', async () => {
  const badInputs = [[], { records: [] }, [{ title: 'No identity' }], [{ id: 'x' }], [{ id: 'x', title: 12 }],
    [{ id: 'x', title: 'A' }, { id: 'x', abstract: 'B' }], [{ id: 'bad\nkey', title: 'A' }], [{ id: 'x', title: 'x'.repeat(65537) }]];
  for (const input of badInputs) await assert.rejects(rankPapers(input, options, { fetch: noRequest }), EmbeddingError);
  for (const change of [{ query: '' }, { model: 'bad\nmodel' }, { documentPrefix: 7 }, { batchSize: 0 }, { batchSize: 65 }, { timeoutMs: 0 }, { apiKey: 'bad\nSECRET' }]) {
    await assert.rejects(rankPapers(corpus(), { ...options, ...change }, { fetch: noRequest }), EmbeddingError);
  }
  const result = await rankPapers([{ id: 'abstract-only', abstract: 'Supplied abstract' }], options, transport());
  assert.equal(result.ranking[0].missingTitle, true);
  assert.equal(result.ranking[0].missingAbstract, false);
});

test('compatible cache avoids every request and keeps recipe matching independent of JSON key order', async () => {
  const first = await rankPapers(corpus(), options, transport());
  first.cache.recipe = Object.fromEntries(Object.entries(first.cache.recipe).reverse());
  const next = await rankPapers(corpus(), { ...options, cache: first }, { now, fetch: noRequest });
  assert.deepEqual(next.ranking, first.ranking);
  assert.equal(next.provenance.requestCount, 0);
  assert.equal(next.provenance.reusedCount, 3);
  assert.equal(next.provenance.embeddedCount, 0);
});

test('changed query or paper text only embeds changed entries and never mutates supplied cache', async () => {
  const first = await rankPapers(corpus(), options, transport());
  const preserved = structuredClone(first.cache);
  const changed = corpus(); changed.records[0].abstract = 'Different abstract.';
  const deps = transport();
  const result = await rankPapers(changed, { ...options, query: 'new question', cache: first.cache }, deps);
  assert.deepEqual(first.cache, preserved);
  assert.deepEqual(deps.calls[0].body.input, ['Review methods\n\nDifferent abstract.', 'new question']);
  assert.equal(result.provenance.reusedCount, 1);
  assert.equal(result.provenance.embeddedCount, 2);
});

test('cache endpoint/model/recipe/dimension and vector provenance mismatches fail before network', async () => {
  const first = await rankPapers(corpus(), options, transport());
  const mutations = [
    cache => { cache.endpoint = 'http://127.0.0.1:8081/v1/embeddings'; }, cache => { cache.model = 'other'; },
    cache => { cache.recipe.documentPrefix = 'different: '; }, cache => { cache.dimension = 3; },
    cache => { cache.entries[0].vector = [0, 0]; }, cache => { cache.entries[0].vector = [2, 0]; },
    cache => { cache.entries.push(cache.entries[0]); }, cache => { cache.entries[0].textHash = 'bad'; },
    cache => { cache.version = 99; },
  ];
  for (const mutate of mutations) {
    const cache = structuredClone(first.cache); mutate(cache);
    await assert.rejects(rankPapers(corpus(), { ...options, cache }, { fetch: noRequest }), EmbeddingError);
  }
});

test('malformed response counts, models, indices, vectors and dimensions fail closed', async () => {
  const fixtures = [
    () => response([[1, 0]]), () => response([[1, 0], [1, 0], [1, 0]], { responseModel: 'wrong-model' }),
    () => response([[1, 0], [1, 0], [1, 0]], { indices: [0, 0, 2] }),
    () => response([[1, 0], [1, 0], [1, 0]], { indices: [0, 1, 3] }),
    () => response([[1, 0], [1], [1, 0]]), () => response([[0, 0], [1, 0], [1, 0]]),
    () => response([[null, 1], [1, 0], [1, 0]]), () => response([[[1], [0]], [1, 0], [1, 0]]),
    () => response([Array(8193).fill(1), [1, 0], [1, 0]]), () => new Response('not JSON'),
  ];
  for (const fetch of fixtures) await assert.rejects(rankPapers(corpus(), options, { fetch }), EmbeddingError);
});

test('cached dimensions also constrain new query embeddings', async () => {
  const first = await rankPapers(corpus(), options, transport());
  await assert.rejects(rankPapers(corpus(), { ...options, cache: first, query: 'new query' }, { fetch: async () => response([[1, 0, 0]]) }), /dimension/);
});

test('large texts form smaller bounded batches without clipping any text', async () => {
  const input = Array.from({ length: 5 }, (_, i) => ({ id: `id:${i}`, title: 'a'.repeat(60000) }));
  const deps = transport();
  const result = await rankPapers(input, { ...options, batchSize: 64 }, deps);
  assert.equal(deps.calls.length, 2);
  assert.ok(deps.calls.every(call => Buffer.byteLength(call.init.body) <= 256 * 1024));
  assert.deepEqual(deps.calls.flatMap(call => call.body.input), [...input.map(item => item.title), options.query]);
  assert.equal(result.ranking.length, 5);
});

test('requests and response streams are bounded, cancellable, and redact transport/provider text', async () => {
  await assert.rejects(rankPapers(corpus(), options, { fetch: async () => { throw new Error('SYNTHETIC-SECRET'); } }), error => !error.message.includes('SYNTHETIC-SECRET'));
  await assert.rejects(rankPapers(corpus(), options, { fetch: async () => new Response('SYNTHETIC-SECRET', { status: 500 }) }), error => /HTTP 500/.test(error.message) && !error.message.includes('SYNTHETIC-SECRET'));
  await assert.rejects(rankPapers(corpus(), options, { fetch: async () => new Response('{}', { headers: { 'content-length': String(5 * 1024 * 1024) } }) }), /4 MiB/);
  await assert.rejects(rankPapers(corpus(), options, { fetch: async () => new Response(new Uint8Array(4 * 1024 * 1024 + 1)) }), /4 MiB/);
  await assert.rejects(rankPapers(corpus(), { ...options, timeoutMs: 10 }, { fetch: () => new Promise(() => {}) }), /timed out/);
  await assert.rejects(rankPapers(corpus(), { ...options, timeoutMs: 10 }, { fetch: async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); } })) }), /timed out/);
  const controller = new AbortController();
  let requestSignal;
  const pending = rankPapers(corpus(), { ...options, signal: controller.signal }, { fetch: async (_url, init) => {
    requestSignal = init.signal; return new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }));
  } });
  setTimeout(() => controller.abort('SYNTHETIC-SECRET'), 10);
  await assert.rejects(pending, error => /cancelled/.test(error.message) && !error.message.includes('SYNTHETIC-SECRET'));
  assert.ok(requestSignal.aborted);
});

test('pre-cancelled cached ranking still stops without requests', async () => {
  const first = await rankPapers(corpus(), options, transport());
  await assert.rejects(rankPapers(corpus(), { ...options, cache: first, signal: AbortSignal.abort('SYNTHETIC-SECRET') }, { fetch: noRequest }), /cancelled/);
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sr-embeddings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'input.json'), output = join(directory, 'ranked.json');
  await writeFile(input, JSON.stringify(corpus()));
  const text = { out: '', err: '' };
  return { directory, input, output, text,
    args: ['rank', '--input', input, '--query', options.query, '--base-url', options.baseUrl, '--model', model, '--output', output],
    stdout: { write: value => { text.out += value; } }, stderr: { write: value => { text.err += value; } } };
}

test('CLI help/invalid flags and no-clobber checks do not make requests', async t => {
  const f = await fixture(t);
  const deps = { ...f, rank: noRequest };
  assert.equal(await main(['--help'], deps), 0);
  for (const args of [[], ['rank'], [...f.args, '--unknown'], [...f.args, '--batch-size', '0'], [...f.args, '--model', 'repeat']]) assert.equal(await main(args, deps), 1);
  await writeFile(f.output, 'unchanged');
  assert.equal(await main(f.args, deps), 1);
  assert.equal(await readFile(f.output, 'utf8'), 'unchanged');
  const same = [...f.args]; same[same.indexOf('--output') + 1] = f.input;
  assert.equal(await main([...same, '--overwrite'], deps), 1);
  assert.ok(f.text.out.includes('token budget'));
});

test('CLI publishes complete ranking/cache, preserves source input, and passes auth only as configuration', async t => {
  const f = await fixture(t), deps = transport();
  const original = await readFile(f.input, 'utf8');
  assert.equal(await main([...f.args, '--document-prefix', 'paper: ', '--query-prefix', 'query: '], {
    ...f, env: { EMBEDDINGS_API_KEY: 'SYNTHETIC-SECRET' }, rank: (input, opts) => rankPapers(input, opts, deps),
  }), 0, f.text.err);
  assert.equal(deps.calls[0].init.headers.Authorization, 'Bearer SYNTHETIC-SECRET');
  const written = await readFile(f.output, 'utf8');
  assert.ok(!written.includes('SYNTHETIC-SECRET'));
  assert.equal((JSON.parse(written)).ranking.length, 2);
  assert.equal(await readFile(f.input, 'utf8'), original);
  assert.deepEqual((await readdir(f.directory)).sort(), ['input.json', 'ranked.json']);
  const second = [...f.args]; second[second.indexOf('--output') + 1] = join(f.directory, 'reranked.json');
  assert.equal(await main([...second, '--cache', f.output, '--document-prefix', 'paper: ', '--query-prefix', 'query: '], {
    ...f, rank: (input, opts) => rankPapers(input, opts, { fetch: noRequest, now }),
  }), 0, f.text.err);
});

test('CLI failures preserve files and redact unknown errors', async t => {
  const f = await fixture(t);
  assert.equal(await main(f.args, { ...f, rank: async () => { throw new Error('SYNTHETIC-SECRET'); } }), 1);
  assert.ok(!f.text.err.includes('SYNTHETIC-SECRET'));
  assert.deepEqual(await readdir(f.directory), ['input.json']);
  await writeFile(f.input, 'malformed');
  assert.equal(await main(f.args, { ...f, rank: noRequest }), 1);
});

test('CLI refuses input and cache aliases through symlinked directories before ranking', async t => {
  const f = await fixture(t);
  const alias = join(f.directory, 'alias');
  await symlink(f.directory, alias, 'dir');
  const original = await readFile(f.input, 'utf8');
  const inputAlias = [...f.args]; inputAlias[inputAlias.indexOf('--output') + 1] = join(alias, 'input.json');
  assert.equal(await main([...inputAlias, '--overwrite'], { ...f, rank: noRequest }), 1);
  assert.equal(await readFile(f.input, 'utf8'), original);
  await writeFile(f.output, 'original cache');
  const cacheAlias = [...f.args]; cacheAlias[cacheAlias.indexOf('--output') + 1] = join(alias, 'ranked.json');
  assert.equal(await main([...cacheAlias, '--cache', f.output, '--overwrite'], { ...f, rank: noRequest }), 1);
  assert.equal(await readFile(f.output, 'utf8'), 'original cache');
});
