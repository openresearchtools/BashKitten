// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startSetupServer } from '../lib/setup-web.mjs';
import { serviceKey, saveServiceKey, ConfigError } from '../lib/services.mjs';

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sr-setup-web-'));
  const env = { SYSTEMATIC_REVIEW_CONFIG: join(root, 'private', 'credentials.json'), ...options.env };
  const app = await startSetupServer({ ...options, env });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  return { ...app, env, root };
}

function http(app, path = 'api/status', { method = 'GET', headers = {}, body } = {}) {
  const url = new URL(path, app.url);
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}
const post = (app, path, body, headers = {}) => http(app, path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(app.url).origin, ...headers }, body: JSON.stringify(body),
});

test('setup page binds loopback, has a fresh capability, safe headers and accessible secret-free forms', async t => {
  const app = await fixture(t, { service: 'openalex' });
  const second = await fixture(t);
  const url = new URL(app.url);
  assert.equal(url.hostname, '127.0.0.1');
  assert.match(url.pathname, /^\/[A-Za-z0-9_-]{43}\/$/);
  assert.notEqual(url.pathname, new URL(second.url).pathname);
  await saveServiceKey('openalex', 'synthetic-never-prefilled', { env: app.env });
  await writeFile(app.env.SYSTEMATIC_REVIEW_CONFIG, JSON.stringify({ version: 1, keys: { openalex: 'synthetic-never-prefilled', zotero: 'synthetic-legacy-secret' } }));
  const page = await http(app, '');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /^text\/html/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.equal(page.headers['x-frame-options'], 'DENY');
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.equal(page.headers['cross-origin-resource-policy'], 'same-origin');
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);
  assert.match(page.headers['content-security-policy'], /form-action 'none'/);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  const nonce = page.headers['content-security-policy'].match(/script-src 'nonce-([^']+)'/)[1];
  assert.ok(page.text.includes(`<script nonce="${nonce}">`));
  assert.match(page.text, /type="password"/);
  assert.match(page.text, /label for="openalex-key"/);
  assert.match(page.text, /role="status"/);
  assert.match(page.text, /https:\/\/openalex.org\/settings\/api-key/);
  assert.match(page.text, /Local Zotero needs no API key/);
  assert.doesNotMatch(page.text, /zotero-key|zotero.org\/settings\/keys|ZOTERO_API_KEY/);
  assert.match(page.text, /rel="noopener noreferrer"/);
  assert.ok(!page.text.includes('synthetic-never-prefilled'));
  assert.ok(!page.text.includes('synthetic-legacy-secret'));
  const state = await http(app);
  assert.deepEqual(Object.keys(JSON.parse(state.text).services), ['openalex']);
  assert.ok(!state.text.includes('synthetic'));
  assert.ok(!page.text.includes('<script src='));
});

test('HTTP saves, replaces and removes the OpenAlex key without returning it', async t => {
  const app = await fixture(t);
  const keys = ['synthetic-openalex-key', 'synthetic-replacement'];
  let response = await post(app, 'api/save', { service: 'openalex', key: keys[0] });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.text).services.openalex.source, 'config');
  assert.equal(await serviceKey('openalex', { env: app.env }), keys[0]);
  response = await post(app, 'api/save', { service: 'openalex', key: keys[1] });
  assert.equal(response.status, 200);
  assert.equal(await serviceKey('openalex', { env: app.env }), keys[1]);
  const status = await http(app);
  assert.equal(status.status, 200);
  assert.equal(JSON.parse(status.text).services.openalex.configured, true);
  response = await post(app, 'api/remove', { service: 'openalex' });
  assert.equal(response.status, 200);
  assert.equal(await serviceKey('openalex', { env: app.env }), undefined);
  const html = await http(app, '');
  for (const result of [response, status, html]) for (const key of keys) assert.ok(!result.text.includes(key));
});

test('HTTP rejects retired Zotero credential writes and removals', async t => {
  const app = await fixture(t);
  assert.equal((await post(app, 'api/save', { service: 'zotero', key: 'synthetic-secret' })).status, 400);
  assert.equal((await post(app, 'api/remove', { service: 'zotero' })).status, 400);
  assert.deepEqual(await readdir(app.root), []);
});

test('environment override is visible without its value or remote validation', async t => {
  const app = await fixture(t, { env: { OPENALEX_API_KEY: 'synthetic-env-secret' } });
  await post(app, 'api/save', { service: 'openalex', key: 'synthetic-saved-secret' });
  const status = await http(app);
  const state = JSON.parse(status.text).services.openalex;
  assert.equal(state.source, 'environment');
  assert.equal(state.environmentVariable, 'OPENALEX_API_KEY');
  assert.ok(!status.text.includes('synthetic'));
  const removed = await post(app, 'api/remove', { service: 'openalex' });
  assert.equal(JSON.parse(removed.text).services.openalex.source, 'environment');
  assert.equal(await serviceKey('openalex', { env: app.env }), 'synthetic-env-secret');
});

test('unknown capability, unexpected paths, query strings, methods and Host are rejected without writes', async t => {
  const app = await fixture(t);
  for (const path of ['/', '/wrong-capability/api/status', 'api/status?key=synthetic-query-secret', '?key=synthetic-query-secret']) {
    const response = await http(app, path);
    assert.equal(response.status, 404);
    assert.ok(!response.text.includes('synthetic-query-secret'));
  }
  for (const host of ['localhost', 'example.test', `${new URL(app.url).host}.example.test`]) {
    assert.equal((await http(app, 'api/status', { headers: { Host: host } })).status, 403);
  }
  assert.equal((await http(app, 'api/save')).status, 405);
  assert.equal((await http(app, 'api/status', { method: 'OPTIONS' })).status, 405);
  assert.equal((await post(app, 'api/status', {})).status, 405);
  assert.deepEqual(await readdir(app.root), []);
});

test('POST requires exact non-null Origin and provides no CORS permission', async t => {
  const app = await fixture(t);
  const origin = new URL(app.url).origin;
  for (const value of [undefined, 'null', 'https://example.test', origin.replace('127.0.0.1', 'localhost'), `${origin}.example.test`]) {
    const headers = { 'Content-Type': 'application/json' };
    if (value !== undefined) headers.Origin = value;
    const response = await http(app, 'api/save', { method: 'POST', headers, body: JSON.stringify({ service: 'openalex', key: 'synthetic-secret' }) });
    assert.equal(response.status, 403);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    assert.ok(!response.text.includes('synthetic-secret'));
  }
  assert.deepEqual(await readdir(app.root), []);
});

test('non-JSON, encoded, malformed, oversized and unexpected request fields fail without exposing contents', async t => {
  const app = await fixture(t);
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', '']) {
    assert.equal((await post(app, 'api/save', { service: 'openalex', key: 'synthetic-secret' }, { 'Content-Type': type })).status, 415);
  }
  assert.equal((await post(app, 'api/save', {}, { 'Content-Encoding': 'gzip' })).status, 415);
  for (const body of ['{"key":"synthetic-secret",', '[]', 'null', '"synthetic-secret"']) {
    const response = await http(app, 'api/save', { method: 'POST', headers: { Origin: new URL(app.url).origin, 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, 400);
    assert.ok(!response.text.includes('synthetic-secret'));
  }
  for (const body of [{ service: 'constructor', key: 'synthetic-secret' }, { service: 'openalex', key: 'synthetic\nsecret' }, { service: 'openalex', key: 'synthetic-secret', extra: true }, { service: 'openalex' }]) {
    const response = await post(app, 'api/save', body);
    assert.equal(response.status, 400);
    assert.ok(!response.text.includes('synthetic-secret'));
  }
  assert.equal((await post(app, 'api/done', { key: 'synthetic-secret' })).status, 400);
  assert.equal((await post(app, 'api/remove', { service: 'openalex', key: 'synthetic-secret' })).status, 400);
  const large = await post(app, 'api/save', { service: 'openalex', key: 'synthetic-secret'.repeat(1000) });
  assert.equal(large.status, 413);
  assert.ok(!large.text.includes('synthetic-secret'));
  const declaredLarge = await post(app, 'api/save', {}, { 'Content-Length': '9000' });
  assert.equal(declaredLarge.status, 413);
  assert.deepEqual(await readdir(app.root), []);
});

test('Done replies successfully, closes listener, and does not create configuration', async t => {
  const app = await fixture(t);
  const response = await post(app, 'api/done', {});
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.text), { closed: true });
  await app.closed;
  await assert.rejects(http(app));
  await app.close();
  assert.deepEqual(await readdir(app.root), []);
});

test('explicit close, expiry and abort close the server and are idempotent', async t => {
  const app = await fixture(t);
  await Promise.all([app.close(), app.close(), app.closed]);
  await assert.rejects(http(app));
  const expiring = await fixture(t, { timeoutMs: 25 });
  await expiring.closed;
  await assert.rejects(http(expiring));
  const controller = new AbortController();
  const aborted = await fixture(t, { signal: controller.signal });
  controller.abort();
  await aborted.closed;
  await assert.rejects(http(aborted));
  await assert.rejects(startSetupServer({ signal: AbortSignal.abort() }), /cancelled/);
});

test('abort during a partial request closes the connection without publishing a credential', async t => {
  const controller = new AbortController();
  const app = await fixture(t, { signal: controller.signal });
  const req = request(new URL('api/save', app.url), { method: 'POST', headers: { Origin: new URL(app.url).origin, 'Content-Type': 'application/json' } });
  const disconnected = new Promise(resolve => { req.once('error', resolve); req.once('close', resolve); });
  const connected = new Promise(resolve => req.once('socket', socket => socket.once('connect', resolve)));
  req.write('{"service":"openalex","key":"synthetic-partial');
  await connected;
  await new Promise(resolve => setTimeout(resolve, 10));
  controller.abort();
  await Promise.all([app.closed, disconnected]);
  assert.deepEqual(await readdir(app.root), []);
});

test('a stalled request body is terminated within a bounded time without a config write', { timeout: 10000 }, async t => {
  const app = await fixture(t);
  const result = await new Promise((resolve, reject) => {
    const req = request(new URL('api/save', app.url), { method: 'POST', headers: { Origin: new URL(app.url).origin, 'Content-Type': 'application/json' } }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
      response.once('error', reject);
    });
    req.once('error', error => error.code === 'ECONNRESET' ? resolve('closed') : reject(error));
    t.after(() => req.destroy());
    req.write('{"service":"openalex","key":"synthetic-partial');
  });
  assert.ok([408, 'closed'].includes(result));
  assert.deepEqual(await readdir(app.root), []);
});

test('invalid server options are rejected before opening a listener', async () => {
  for (const options of [{ service: 'zotero' }, { service: 'other' }, { port: -1 }, { port: 65536 }, { port: 1.5 }, { timeoutMs: 0 }, { timeoutMs: 600001 }]) await assert.rejects(startSetupServer(options), ConfigError);
});
