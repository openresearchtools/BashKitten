import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reviewSetup } from '../lib/review-setup.mjs';
import { saveServiceKey, serviceKey, serviceStatus } from '../lib/services.mjs';

async function fixture(t, { choices = [], key, env = {} } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'review-setup-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const events = [];
  return {
    env: { SYSTEMATIC_REVIEW_CONFIG: join(directory, 'credentials.json'), ...env }, events,
    ctx: { hasUI: true, mode: 'tui', ui: {
      select: async (title, options) => { events.push({ title, options }); return choices.shift(); },
      input: async title => { events.push({ title }); return key; },
      notify: (message, type) => { events.push({ message, type }); },
    } },
  };
}

test('Pi setup saves the selected service through a local dialog and shows no credential in UI messages', async t => {
  const key = 'SYNTHETIC-OPENALEX-SECRET';
  const f = await fixture(t, { choices: ['OpenAlex', 'Enter or replace saved key'], key });
  await reviewSetup('', f.ctx, f);
  assert.equal(await serviceKey('openalex', f), key);
  assert.deepEqual((await serviceStatus(f)).services.openalex.configured, true);
  assert.deepEqual(f.events[0].options, ['OpenAlex']);
  const text = JSON.stringify(f.events);
  assert.match(text, /https:\/\/openalex.org\/settings\/api-key/);
  assert.match(text, /visible as you type/);
  assert.match(text, /key saved locally/);
  assert.doesNotMatch(text, /SYNTHETIC-OPENALEX-SECRET/);
});

test('replace/remove actions explain OpenAlex environment precedence without exposing keys', async t => {
  const f = await fixture(t, { choices: ['Enter or replace saved key', 'Remove saved key'], key: 'NEW-SYNTHETIC-KEY', env: { OPENALEX_API_KEY: 'ENV-SYNTHETIC-KEY' } });
  await saveServiceKey('openalex', 'OLD-SYNTHETIC-KEY', f);
  await reviewSetup('openalex', f.ctx, f);
  assert.equal(await serviceKey('openalex', { env: { SYSTEMATIC_REVIEW_CONFIG: f.env.SYSTEMATIC_REVIEW_CONFIG } }), 'NEW-SYNTHETIC-KEY');
  assert.equal(await serviceKey('openalex', f), 'ENV-SYNTHETIC-KEY');
  await reviewSetup('openalex', f.ctx, f);
  assert.equal(await serviceKey('openalex', { env: { SYSTEMATIC_REVIEW_CONFIG: f.env.SYSTEMATIC_REVIEW_CONFIG } }), undefined);
  assert.match(JSON.stringify(f.events), /saved key removed; using OPENALEX_API_KEY/);
  assert.doesNotMatch(JSON.stringify(f.events), /SYNTHETIC-KEY/);
});

test('cancellation at every dialog and empty input leave saved credentials unchanged', async t => {
  for (const options of [
    { choices: [] }, { choices: ['OpenAlex'] },
    { choices: ['OpenAlex', 'Enter or replace saved key'] },
    { choices: ['OpenAlex', 'Enter or replace saved key'], key: '' },
  ]) {
    const f = await fixture(t, options);
    await saveServiceKey('openalex', 'EXISTING-SYNTHETIC-KEY', f);
    const before = await readFile(f.env.SYSTEMATIC_REVIEW_CONFIG, 'utf8');
    await reviewSetup('', f.ctx, f);
    assert.equal(await readFile(f.env.SYSTEMATIC_REVIEW_CONFIG, 'utf8'), before);
  }
});

test('status and hidden-prompt guidance are read-only and never ask for a key in chat or command arguments', async t => {
  const f = await fixture(t, { choices: ['Use hidden terminal prompt'], env: { OPENALEX_API_KEY: 'SYNTHETIC-ENV-KEY' } });
  f.ctx.ui.input = () => assert.fail('These actions must not request a key');
  await reviewSetup('status', f.ctx, f);
  await reviewSetup('openalex', f.ctx, f);
  const text = JSON.stringify(f.events);
  assert.match(text, /using OPENALEX_API_KEY/);
  assert.match(text, /Local Zotero needs no API key/);
  assert.match(text, /https:\/\/openalex.org\/settings\/api-key/);
  assert.match(text, /setup.mjs' set openalex/);
  assert.doesNotMatch(text, /ZOTERO_API_KEY|zotero.org\/settings\/keys|set zotero/);
  assert.match(text, /prompt hides your input/);
  assert.doesNotMatch(text, /SYNTHETIC-ENV-KEY/);
  await assert.rejects(readFile(f.env.SYSTEMATIC_REVIEW_CONFIG), { code: 'ENOENT' });
});

test('Pi rejects retired Zotero credential setup without opening an input dialog', async t => {
  const f = await fixture(t);
  f.ctx.ui.input = () => assert.fail('Local Zotero has no credential input');
  f.ctx.ui.select = () => assert.fail('Local Zotero has no credential menu');
  await reviewSetup('zotero', f.ctx, f);
  assert.match(JSON.stringify(f.events), /Local Zotero needs no key/);
  assert.doesNotMatch(JSON.stringify(f.events), /status\|openalex\|zotero/);
  await assert.rejects(readFile(f.env.SYSTEMATIC_REVIEW_CONFIG), { code: 'ENOENT' });
});

test('noninteractive Pi gets an actionable error rather than an invisible UI notification', async t => {
  const f = await fixture(t);
  f.ctx.hasUI = false;
  f.ctx.mode = 'print';
  f.ctx.ui.notify = () => assert.fail('Notifications are no-ops in print/JSON mode');
  await assert.rejects(reviewSetup('', f.ctx, f), /setup.mjs' status.*setup.mjs' set openalex/);
  assert.deepEqual(f.events, []);
});

test('Pi browser setup guidance delegates to the standalone server without requesting a key', async t => {
  const f = await fixture(t, { choices: ['Use browser setup'] });
  f.ctx.ui.input = () => assert.fail('The user enters the key in their browser');
  await reviewSetup('openalex', f.ctx, f);
  assert.match(JSON.stringify(f.events), /setup.mjs' set openalex --web/);
  assert.match(JSON.stringify(f.events), /Enter the key yourself in the page/);
  await assert.rejects(readFile(f.env.SYSTEMATIC_REVIEW_CONFIG), { code: 'ENOENT' });
});

test('invalid command arguments, invalid keys, and unknown UI errors never echo sensitive input', async t => {
  const f = await fixture(t, { choices: ['Enter or replace saved key'], key: 'SYNTHETIC PRIVATE KEY' });
  await reviewSetup('SYNTHETIC-ARGUMENT-SECRET', f.ctx, f);
  await reviewSetup('openalex', f.ctx, f);
  f.ctx.ui.select = () => { throw new Error('SYNTHETIC-UNKNOWN-SECRET'); };
  await reviewSetup('openalex', f.ctx, f);
  const text = JSON.stringify(f.events);
  assert.match(text, /never as command arguments/);
  assert.match(text, /nonempty token/);
  assert.match(text, /Setup failed/);
  assert.doesNotMatch(text, /SYNTHETIC/);
  assert.equal((await serviceStatus(f)).services.openalex.configured, false);
});

test('an aborted command does not save an input returned while its dialog is being dismissed', async t => {
  const f = await fixture(t, { choices: ['Enter or replace saved key'] });
  const controller = new AbortController();
  f.ctx.signal = controller.signal;
  f.ctx.ui.input = async () => { controller.abort(); return 'SYNTHETIC-KEY'; };
  await reviewSetup('openalex', f.ctx, f);
  assert.equal((await serviceStatus(f)).services.openalex.configured, false);
});
