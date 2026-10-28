// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { main } from '../scripts/setup.mjs';
import { startSetupServer } from '../lib/setup-web.mjs';

const streams = () => {
  const text = { out: '', err: '' };
  return { text, stdout: { write: value => { text.out += value; } }, stderr: { write: value => { text.err += value; } } };
};

test('web setup selects OpenAlex, forwarding only explicit port and configuration', async () => {
  for (const [args, service, port] of [
    [['set', 'openalex', '--web'], 'openalex', 0],
    [['set', 'openalex', '--web', '--port', '23125'], 'openalex', 23125],
    [['serve'], undefined, 0],
    [['serve', '--port', '0'], undefined, 0],
  ]) {
    const io = streams();
    const env = { SYSTEMATIC_REVIEW_CONFIG: '/unused/synthetic-config.json' };
    const signal = new AbortController().signal;
    let closed = false;
    assert.equal(await main(args, { ...io, env, signal, startServer: async options => {
      assert.deepEqual(options, { service, port, env, signal });
      return { url: 'http://127.0.0.1:23125/session/', closed: Promise.resolve(), close: async () => { closed = true; } };
    } }), 0, io.text.err);
    assert.equal(closed, true);
    assert.match(io.text.out, /http:\/\/127\.0\.0\.1:23125\/session\//);
    assert.match(io.text.out, /Enter the key in the page yourself/);
  }
});

test('web setup refuses invalid flags and port values before starting any server', async () => {
  const io = streams();
  const startServer = () => assert.fail('Invalid input must not start a listener');
  for (const args of [
    ['set', 'other', '--web'], ['set', 'zotero', '--web'], ['serve', '--host', '0.0.0.0'],
    ['serve', '--port', '65536'], ['serve', '--port', '-1'], ['serve', '--port', '1.2'],
    ['serve', '--port'], ['set', 'openalex', '--web', 'SYNTHETIC-SECRET'],
    ['set', 'openalex', '--stdin', '--web'],
  ]) assert.equal(await main(args, { ...io, startServer }), 1);
  assert.doesNotMatch(io.text.err, /SYNTHETIC-SECRET/);
});

test('CLI web mode publishes a usable URL and finishes when the browser selects Done', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'setup-cli-web-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const io = streams();
  let server;
  let ready;
  const listening = new Promise(resolve => { ready = resolve; });
  const running = main(['set', 'openalex', '--web'], { ...io,
    env: { SYSTEMATIC_REVIEW_CONFIG: join(directory, 'credentials.json') },
    startServer: async options => { server = await startSetupServer(options); ready(); return server; },
  });
  t.after(() => server?.close());
  await listening;
  const page = await fetch(server.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /OpenAlex/);
  const result = await fetch(new URL('api/done', server.url), {
    method: 'POST', headers: { Origin: new URL(server.url).origin, 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(result.status, 200);
  assert.equal(await running, 0, io.text.err);
  assert.match(io.text.out, /Setup server stopped/);
});
