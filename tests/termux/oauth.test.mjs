import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

test('Native Pi browser callback validates state, completes login, stores credentials and cancels', { timeout: 20000 }, async t => {
  const agent = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-auth-'));
  process.env.PI_CODING_AGENT_DIR = agent;
  process.env.BASHKITTEN_TEST_OAUTH = '1';
  const { exchanges } = await import('./oauth-token-fixture.mjs');
  const { Services } = await import('../../termux/services.mjs');
  const services = new Services();
  t.after(async () => { await services.cancel(); await fs.rm(agent, { recursive: true, force: true }); });
  async function until(fn) {
    for (let i = 0; i < 150; i++) { const value = fn(); if (value) return value; await new Promise(r => setTimeout(r, 25)); }
    throw Error('Native login did not reach expected state');
  }
  async function browserLogin() {
    await services.start('openai-codex', 'oauth');
    const prompt = await until(() => services.state()?.prompt);
    assert.equal(prompt.type, 'select');
    services.answer(services.state().id, prompt.id, 'browser');
    const event = await until(() => services.state().events.find(e => e.type === 'auth_url'));
    return new URL(event.url);
  }
  const authorization = await browserLogin();
  assert.equal(authorization.hostname, 'auth.openai.com');
  const callback = new URL(authorization.searchParams.get('redirect_uri'));
  callback.searchParams.set('code', 'bashkitten-local-oauth-fixture');
  callback.searchParams.set('state', 'incorrect');
  // Pi binds IPv4, while localhost may resolve to IPv6 first in test hosts.
  callback.hostname = '127.0.0.1';
  assert.equal((await fetch(callback)).status, 400);
  assert.equal(services.state().status, 'pending');
  callback.searchParams.set('state', authorization.searchParams.get('state'));
  assert.equal((await fetch(callback)).status, 200);
  await until(() => services.state().status === 'complete');
  assert.equal(services.state().prompt, null, 'Pi callback must dismiss its manual fallback');
  assert.equal(exchanges.length, 1);
  assert.equal(createHash('sha256').update(exchanges[0].code_verifier).digest('base64url'), authorization.searchParams.get('code_challenge'));
  const stored = JSON.parse(await fs.readFile(path.join(agent, 'auth.json'), 'utf8'));
  assert.equal(stored['openai-codex'].accountId, 'test-only-account');
  assert.ok(!JSON.stringify(services.state()).includes('test-only-refresh'));
  assert.ok((await services.list()).some(p => p.id === 'openai-codex' && p.connected));
  await services.logout('openai-codex');
  assert.ok(!JSON.parse(await fs.readFile(path.join(agent, 'auth.json'), 'utf8'))['openai-codex']);
  await browserLogin();
  await services.cancel();
  assert.equal(services.state().status, 'cancelled');
});
