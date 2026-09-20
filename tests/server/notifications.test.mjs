import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test('Termux notifications deduplicate, retain failed delivery and respect preview/visibility', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-notify-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  process.env.BASHKITTEN_DATA_DIR = dir;
  const { notifyTurn, deliverNotifications, visibleSession } = await import('../../src/server/platform/termux/notifications.mjs');
  const { writeJson } = await import('../../src/server/common.mjs');
  const settings = { notifications: { enabled: true, preview: true, onlyWhenHidden: true } };
  await writeJson(path.join(dir, 'settings.json'), settings);
  const meta = { id: randomUUID(), title: 'Literal $(command) `text`' }, calls = [];
  let fail = false;
  const options = { platform: 'termux', execute: async (command, args) => { if (fail) throw Object.assign(Error('offline'), { code: 'ETIMEDOUT' }); calls.push({ command, args }); return { stdout: '' }; } };
  const entries = [{ type: 'message', id: 'turn1', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: '🌸'.repeat(300) }] } }];
  await Promise.all([notifyTurn(meta, entries, options), notifyTurn(meta, entries, options)]);
  await deliverNotifications(options); assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'termux-notification');
  assert.equal(calls[0].args[calls[0].args.indexOf('--title') + 1], meta.title);
  assert.equal([...calls[0].args[calls[0].args.indexOf('--content') + 1]].length, 240);
  assert.match(calls[0].args.at(-1), /^am start /); // TermuxAm supplies the app identity; Android's shell-only am does not.
  assert.ok(!calls[0].args.at(-1).includes(meta.title));
  const client = randomUUID(); await visibleSession(client, meta.id, true);
  entries[0].id = 'visible'; await notifyTurn(meta, entries, options); assert.equal(calls.length, 1);
  await visibleSession(client, meta.id, false);
  await notifyTurn(meta, entries, options); assert.equal(calls.length, 1, 'previously visible turn stays suppressed');
  fail = true; entries[0].id = 'retry'; await notifyTurn(meta, entries, options);
  assert.equal(calls.length, 1);
  settings.notifications.preview = false; await writeJson(path.join(dir, 'settings.json'), settings);
  fail = false; await deliverNotifications(options); assert.equal(calls.length, 2);
  assert.equal(calls[1].args[calls[1].args.indexOf('--content') + 1], 'Turn finished');
  entries[0].id = 'linux'; await notifyTurn(meta, entries, { ...options, platform: 'linux' }); assert.equal(calls.length, 2);
});
