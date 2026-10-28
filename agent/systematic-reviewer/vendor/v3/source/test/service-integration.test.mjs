// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveServiceKey } from '../lib/services.mjs';
import { ZoteroClient } from '../lib/zotero.mjs';
import { main as harvest } from '../scripts/openalex.mjs';
import { main as zotero } from '../scripts/zotero.mjs';
import { main as citations } from '../scripts/citations.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sr-service-integration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = name => join(directory, name);
  const env = { SYSTEMATIC_REVIEW_CONFIG: path('private/credentials.json') };
  const output = { out: '', err: '' };
  return { path, env, output, stdout: { write: text => { output.out += text; } }, stderr: { write: text => { output.err += text; } } };
}

test('harvesting reuses the OpenAlex key while Zotero and citations use only credential-free local requests', async t => {
  const f = await fixture(t);
  await saveServiceKey('openalex', 'synthetic-openalex-token', f);
  f.env.ZOTERO_API_KEY = 'synthetic-obsolete-token';
  assert.equal(await harvest(['--query', 'chosen query', '--enrich-zotero', 'local', '--library', 'users/0', '--output', f.path('works.json')], {
    ...f, harvest: async options => {
      assert.equal(options.apiKey, 'synthetic-openalex-token');
      assert.equal(typeof options.lookupZotero, 'function');
      return { count: 0, stopReason: 'exhausted', records: [] };
    },
  }), 0, f.output.err);

  const reference = JSON.parse(await readFile(new URL('../examples/references.json', import.meta.url), 'utf8')).items[0];
  const createClient = options => new ZoteroClient({ ...options, fetch: async (url, init) => {
    assert.equal(url.origin, 'http://127.0.0.1:23119');
    assert.equal(init.headers['Zotero-API-Key'], undefined);
    return Response.json({ key: 'ABCD2345', library: { type: 'user', id: 123 }, csljson: reference.itemData });
  } });
  assert.equal(await zotero(['snapshot', '--id', reference.id, '--output', f.path('references.json')], { ...f, createClient }), 0, f.output.err);
  await writeFile(f.path('paper.md'), `[](sr-cite:${reference.id})`);
  assert.equal(await citations(['render', '--input', f.path('paper.md'), '--zotero', 'local', '--in-place'], { ...f, createClient }), 0, f.output.err);
  assert.match(await readFile(f.path('paper.md'), 'utf8'), /Smith, 2024/);
  for (const name of ['works.json', 'references.json', 'paper.md']) {
    assert.doesNotMatch(await readFile(f.path(name), 'utf8'), /synthetic-.*-token/);
  }
  assert.doesNotMatch(f.output.out + f.output.err, /synthetic-.*-token/);
});

test('malformed credential files produce safe setup errors while local Zotero remains usable', async t => {
  const f = await fixture(t);
  await saveServiceKey('openalex', 'synthetic-secret', f);
  await writeFile(f.env.SYSTEMATIC_REVIEW_CONFIG, '{synthetic-secret');
  assert.equal(await harvest(['--query', 'x', '--output', f.path('works.json')], {
    ...f, harvest: () => assert.fail('Do not retrieve with malformed configuration'),
  }), 1);
  assert.match(f.output.err, /credential file is malformed/);
  assert.doesNotMatch(f.output.err, /synthetic-secret/);
  assert.equal(await zotero(['search'], {
    ...f, createClient: options => {
      assert.equal(options.apiKey, undefined);
      return { search: async () => ({ items: [] }) };
    },
  }), 0, f.output.err);
  await assert.rejects(readFile(f.path('works.json')), { code: 'ENOENT' });
});
