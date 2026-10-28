import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../scripts/citations.mjs';
import { ZoteroClient, ZoteroError } from '../lib/zotero.mjs';
import { scanDocument } from '../lib/markdown.mjs';

const snapshot = JSON.parse(await readFile(new URL('../examples/references.json', import.meta.url), 'utf8'));
const [a, b] = snapshot.items.map(item => item.id);
const marker = id => `[cite](sr-cite:${id})`;

async function fixture(t, source = marker(a)) {
  const directory = await mkdtemp(join(tmpdir(), 'citation-cli-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = name => join(directory, name);
  await writeFile(path('paper.md'), source);
  const output = { out: '', err: '' };
  return { path, directory, source, output,
    stdout: { write: value => { output.out += value; } },
    stderr: { write: value => { output.err += value; } },
  };
}

test('refresh fills empty labels, replaces stale labels, and retains IDs, ordinary brackets and code in one file', async t => {
  const untouched = '[a user note] [a link](https://example.org) `[bad](sr-cite:BAD)`\n\n```md\n[cite](sr-cite:broken\n```';
  const source = `First [](sr-cite:${a}). Again [outdated text](sr-cite:${a}).\n\n${untouched}\n`;
  const f = await fixture(t, source);
  const calls = [];
  const dependencies = { ...f, createClient: options => new ZoteroClient({ ...options, fetch: async (url, request) => {
    calls.push({ url, request });
    return new Response(JSON.stringify({ key: 'ABCD2345', library: { type: 'user', id: 123 }, csljson: snapshot.items[0].itemData }));
  } }) };
  const args = ['render', '--input', f.path('paper.md'), '--zotero', 'local', '--in-place'];
  assert.equal(await main(args, dependencies), 0, f.output.err);
  const rendered = await readFile(f.path('paper.md'), 'utf8');
  assert.equal(rendered, `First [(Smith, 2024)](sr-cite:${a}). Again [(Smith, 2024)](sr-cite:${a}).\n\n${untouched}\n`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, `/api/${a}`);
  assert.deepEqual(await readdir(f.directory), ['paper.md']);
  assert.equal(await main(args, dependencies), 0);
  assert.equal(await readFile(f.path('paper.md'), 'utf8'), rendered);
});

test('offline refresh uses a custom style across the whole document, including first/subsequent citation rules', async t => {
  const f = await fixture(t, `[](sr-cite:${a}) and [stale](sr-cite:${a})`);
  const references = structuredClone(snapshot);
  references.items[0].itemData.author = ['Smith', 'Jones', 'Taylor'].map(family => ({ family }));
  const style = '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text"><info><title>First and subsequent</title><id>https://example.org/subsequent</id></info><citation et-al-min="3" et-al-use-first="2" et-al-subsequent-min="3" et-al-subsequent-use-first="1"><layout prefix="(" suffix=")"><names variable="author"><name and="text"/></names></layout></citation></style>';
  await writeFile(f.path('references.json'), JSON.stringify(references));
  await writeFile(f.path('style.csl'), style);
  assert.equal(await main(['render', '--input', f.path('paper.md'), '--references', f.path('references.json'), '--style', f.path('style.csl'), '--output', f.path('refreshed.md')], {
    ...f, createClient: () => assert.fail('Offline refresh must not connect to Zotero'),
  }), 0, f.output.err);
  const labels = scanDocument(await readFile(f.path('refreshed.md'), 'utf8')).citations.map(c => c.node.children.map(n => n.value).join(''));
  assert.deepEqual(labels, ['(Smith, Jones, et al.)', '(Smith et al.)']);
  assert.equal(await readFile(f.path('paper.md'), 'utf8'), f.source);
  assert.equal(await readFile(f.path('references.json'), 'utf8'), JSON.stringify(references));
  assert.equal(await readFile(f.path('style.csl'), 'utf8'), style);
});

test('document citation order drives numeric labels and generated bibliography on refresh', async t => {
  const source = `${marker(b)} then ${marker(a)} then ${marker(b)}\n\n<!-- sr-bibliography -->\n\nold entries\n\n<!-- /sr-bibliography -->\n`;
  const f = await fixture(t, source);
  const style = '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text"><info><title>Numeric</title><id>https://example.org/numeric</id></info><citation><layout><text variable="citation-number"/></layout></citation><bibliography><layout><text variable="citation-number" suffix=". "/><text variable="title"/></layout></bibliography></style>';
  await writeFile(f.path('style.csl'), style);
  const seen = [];
  assert.equal(await main(['render', '--input', f.path('paper.md'), '--zotero', 'local', '--style', f.path('style.csl'), '--in-place'], {
    ...f, createClient: () => ({ snapshot: async ids => { seen.push(ids); return snapshot; } }),
  }), 0, f.output.err);
  const rendered = await readFile(f.path('paper.md'), 'utf8');
  assert.ok(rendered.startsWith(`[1](sr-cite:${b}) then [2](sr-cite:${a}) then [1](sr-cite:${b})`));
  assert.match(rendered, /1\\\. Synthetic handbook/);
  assert.match(rendered, /2\\\. Synthetic study/);
  assert.doesNotMatch(rendered, /old entries/);
  assert.deepEqual(seen, [[b, a]]);
});

test('fetches every distinct citation in batches no larger than 100, without a required snapshot file', async t => {
  const items = Array.from({ length: 101 }, (_, index) => ({ ...snapshot.items[0], id: `users/123/items/${String(index).padStart(8, '0')}` }));
  const f = await fixture(t, items.map(item => marker(item.id)).join(' '));
  const batches = [];
  const controller = new AbortController();
  assert.equal(await main(['render', '--input', f.path('paper.md'), '--zotero', 'local', '--in-place'], {
    ...f, signal: controller.signal, createClient: () => ({ snapshot: async (ids, options) => {
      assert.equal(options.signal, controller.signal);
      batches.push(ids);
      return { version: 1, items: items.filter(item => ids.includes(item.id)) };
    } }),
  }), 0, f.output.err);
  assert.deepEqual(batches.map(batch => batch.length), [100, 1]);
  assert.deepEqual(batches.flat(), items.map(item => item.id));
  assert.equal(scanDocument(await readFile(f.path('paper.md'), 'utf8')).citations.length, 101);
  assert.deepEqual(await readdir(f.directory), ['paper.md']);
});

test('missing items and lookup failures never replace the manuscript or expose unknown errors', async t => {
  const f = await fixture(t);
  for (const fetch of [async () => ({ version: 1, items: [] }), async () => { throw new Error('SECRET transport details'); }, async () => { throw new ZoteroError('Zotero HTTP 403'); }]) {
    assert.equal(await main(['render', '--input', f.path('paper.md'), '--zotero', 'local', '--in-place'], {
      ...f, createClient: () => ({ snapshot: fetch }),
    }), 1);
    assert.equal(await readFile(f.path('paper.md'), 'utf8'), f.source);
  }
  assert.doesNotMatch(f.output.err, /SECRET/);
  assert.match(f.output.err, /403/);
  assert.deepEqual(await readdir(f.directory), ['paper.md']);
});

test('preserves user edits saved while Zotero metadata is being retrieved', async t => {
  const f = await fixture(t);
  const edited = `${f.source}\n\nUser edits during lookup.\n`;
  assert.equal(await main(['render', '--input', f.path('paper.md'), '--zotero', 'local', '--in-place'], {
    ...f, createClient: () => ({ snapshot: async () => { await writeFile(f.path('paper.md'), edited); return snapshot; } }),
  }), 1);
  assert.match(f.output.err, /changed during rendering/);
  assert.equal(await readFile(f.path('paper.md'), 'utf8'), edited);
});

test('cancellation before and during retrieval leaves source and destination unchanged', async t => {
  const f = await fixture(t);
  const args = ['render', '--input', f.path('paper.md'), '--zotero', 'local', '--in-place'];
  assert.equal(await main(args, { ...f, signal: AbortSignal.abort(), createClient: () => assert.fail('Already cancelled') }), 1);
  const controller = new AbortController();
  assert.equal(await main(args, { ...f, signal: controller.signal, createClient: () => ({ snapshot: async () => { controller.abort(); return snapshot; } }) }), 1);
  assert.equal(await readFile(f.path('paper.md'), 'utf8'), f.source);
  assert.deepEqual(await readdir(f.directory), ['paper.md']);
  assert.match(f.output.err, /cancelled/);
});

test('existing outputs and in-place reference/style aliases are rejected before network calls', async t => {
  const f = await fixture(t);
  const dependencies = { ...f, createClient: () => assert.fail('Unsafe write must be rejected before lookup') };
  for (const args of [
    ['--zotero', 'local', '--output', f.path('paper.md')],
    ['--references', f.path('paper.md'), '--in-place'],
    ['--zotero', 'local', '--style', f.path('paper.md'), '--in-place'],
  ]) assert.equal(await main(['render', '--input', f.path('paper.md'), ...args], dependencies), 1);
  assert.equal(await readFile(f.path('paper.md'), 'utf8'), f.source);
});

test('invalid live markup fails before fetching, whereas documents without citations need no API request', async t => {
  const f = await fixture(t, '[broken](sr-cite:ABCD2345)');
  const args = ['render', '--input', f.path('paper.md'), '--zotero', 'local', '--in-place'];
  const dependencies = { ...f, createClient: () => assert.fail('No Zotero request needed') };
  assert.equal(await main(args, dependencies), 1);
  assert.equal(await readFile(f.path('paper.md'), 'utf8'), f.source);
  await writeFile(f.path('paper.md'), '[A normal bracket] and `[cite](sr-cite:anything)`');
  assert.equal(await main(args, dependencies), 0);
  assert.equal(await readFile(f.path('paper.md'), 'utf8'), '[A normal bracket] and `[cite](sr-cite:anything)`');
});

test('local citing uses only its local URL and ignores legacy keys and invalid OpenAlex configuration', async t => {
  const f = await fixture(t);
  await writeFile(f.path('invalid-openalex.json'), 'not valid credential JSON');
  const configurations = [];
  let legacyKeyReads = 0;
  let configReads = 0;
  const env = {
    ZOTERO_LOCAL_URL: 'http://127.0.0.1:23120/api/',
    get ZOTERO_API_KEY() { legacyKeyReads++; return 'SECRET'; },
    get SYSTEMATIC_REVIEW_CONFIG() { configReads++; return f.path('invalid-openalex.json'); },
  };
  const dependencies = { ...f, env,
    createClient: options => { configurations.push(options); return { snapshot: async () => snapshot }; },
  };
  assert.equal(await main(['render', '--input', f.path('paper.md'), '--zotero', 'local', '--in-place'], dependencies), 0);
  assert.equal(await main(['render', '--input', f.path('paper.md'), '--zotero', 'local', '--local-url', 'http://127.0.0.1:23121/api/', '--in-place'], dependencies), 0);
  assert.deepEqual(configurations, [{ localUrl: env.ZOTERO_LOCAL_URL }, { localUrl: 'http://127.0.0.1:23121/api/' }]);
  assert.equal(legacyKeyReads, 0);
  assert.equal(configReads, 0);
  assert.doesNotMatch(f.output.out + f.output.err, /SECRET/);
});

test('non-local Zotero modes are rejected before accessing files or creating a client', async t => {
  const f = await fixture(t);
  const dependencies = { ...f, createClient: () => assert.fail('Unsupported modes must not create a client') };
  for (const mode of ['web', 'remote', 'other']) {
    assert.equal(await main(['render', '--input', f.path('missing.md'), '--zotero', mode, '--in-place'], dependencies), 1);
  }
  assert.match(f.output.err, /--zotero must be local/);
  assert.doesNotMatch(f.output.err, /Read failed/);
  assert.equal(await readFile(f.path('paper.md'), 'utf8'), f.source);
});

test('help and invalid options do not read files or connect to Zotero', async t => {
  const f = await fixture(t);
  const dependencies = { ...f, createClient: () => assert.fail('No client') };
  assert.equal(await main(['--help'], dependencies), 0);
  assert.match(f.output.out, /No separate snapshot file/);
  assert.doesNotMatch(f.output.out, /ZOTERO_API_KEY|Web mode|set zotero/);
  const base = ['render', '--input', 'missing.md'];
  for (const args of [[], [...base], [...base, '--zotero', 'other', '--in-place'], [...base, '--zotero', 'local', '--references', 'r.json', '--in-place'],
    [...base, '--zotero', 'web', '--local-url', 'http://localhost:23119/api/', '--in-place'], [...base, '--zotero', 'local', '--in-place', '--output', 'out.md']]) {
    assert.equal(await main(args, dependencies), 1);
  }
  assert.doesNotMatch(f.output.err, /Read failed/);
});
