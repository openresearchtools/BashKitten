// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, stat, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { captureScreenshot, saveDownload, sessionLocation, prepareSession } from '../client.mjs';
import extension from '../extension.mjs';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR4nGP4TyJgGNUwqmH4agAAr639H708R/EAAAAASUVORK5CYII=', 'base64');
const manager = (root, id) => ({ getSessionId: () => id, getSessionDir: () => root });

test('two Pi chats get separate private screenshots, native image results and session scopes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bashkitten-pi-'));
  try {
    const calls = [];
    const call = async (method, params, options) => {
      calls.push({ method, params, options });
      if (method === 'screenshot') { await writeFile(options.output, png, { flag: 'wx', mode: 0o600 }); return { width: 1, height: 1 }; }
      return true;
    };
    const a = await captureScreenshot(manager(root, 'chat-a'), 'tab-a', undefined, call);
    const b = await captureScreenshot(manager(root, 'chat-b'), 'tab-b', undefined, call);
    assert.notEqual(dirname(a.details.path), dirname(b.details.path));
    assert.notEqual(calls[0].options.scope, calls[2].options.scope);
    assert.equal(a.content[1].type, 'image'); assert.equal(a.content[1].mimeType, 'image/png');
    assert.deepEqual(Buffer.from(a.content[1].data, 'base64'), png);
    assert.equal((await stat(dirname(a.details.path))).mode & 0o777, 0o700);
    assert.equal((await stat(a.details.path)).mode & 0o777, 0o600);
    assert.equal(calls[0].method, 'tabs.show'); assert.equal(calls[1].method, 'screenshot');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('download filenames cannot escape a chat and bearer grants stay out of model results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bashkitten-pi-'));
  try {
    const sm = manager(root, 'chat');
    const result = await saveDownload(sm, 'file', undefined, async (method, params, options) => {
      if (method === 'downloads.list') return [{ id: 'file', name: '../../other/chat/secret.txt' }];
      assert.equal(params.downloadId, 'file');
      assert.equal(dirname(options.output), sessionLocation(sm).directory);
      await writeFile(options.output, 'download', { flag: 'wx', mode: 0o600 });
      return { id: 'file', path: options.output, size: 8 };
    });
    assert.equal(dirname(result.details.path), sessionLocation(sm).directory);
    assert(!JSON.stringify(result).includes('Bearer'));
    await assert.rejects(saveDownload(sm, 'another', undefined, async () => []), /not in this browser session/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('screenshot waits for Android foreground launch to attach the tab view', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bashkitten-pi-launch-'));
  let attempts = 0;
  try {
    const result = await captureScreenshot(manager(root, 'chat'), 'tab', undefined, async (method, params, options) => {
      if (method !== 'screenshot') return true;
      if (++attempts === 1) throw new Error('Show this tab before capturing a screenshot');
      await writeFile(options.output, png, { flag: 'wx', mode: 0o600 });
      return { width: 16, height: 16 };
    });
    assert.equal(attempts, 2);
    assert.equal(result.content[1].type, 'image');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('session storage refuses symlink substitution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bashkitten-pi-'));
  try {
    const sm = manager(root, 'chat'); await prepareSession(sm);
    const path = sessionLocation(sm).directory;
    await rm(path, { recursive: true }); await symlink(root, path);
    await assert.rejects(prepareSession(sm), /private directory/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('extension registers browser, native-image screenshot, download and one-time authorization tools', () => {
  const tools = [], commands = [];
  extension({ registerTool: tool => tools.push(tool), registerCommand: (name, tool) => commands.push({ name, tool }) });
  assert.deepEqual(tools.map(t => t.name), ['bashkitten_browser', 'bashkitten_screenshot', 'bashkitten_downloads']);
  assert.equal(commands[0].name, 'bashkitten-authorize');
});

test('saved screenshot is readable by the actual Pi read tool', { skip: !process.env.PI_TEST_RUNTIME }, async () => {
  const { createReadTool } = await import(process.env.PI_TEST_RUNTIME);
  const root = await mkdtemp(join(tmpdir(), 'bashkitten-pi-read-'));
  try {
    const file = join(root, 'screenshot.png'); await writeFile(file, png, { mode: 0o600 });
    const result = await createReadTool(root).execute('read-image', { path: file });
    assert(result.content.some(item => item.type === 'image' && item.mimeType === 'image/png' && item.data));
  } finally { await rm(root, { recursive: true, force: true }); }
});
