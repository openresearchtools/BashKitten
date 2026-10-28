// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, stat, readdir, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, PassThrough } from 'node:stream';
import { ConfigError, SERVICES, serviceKey, serviceStatus, saveServiceKey, removeServiceKey } from '../lib/services.mjs';
import { main } from '../scripts/setup.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sr-services-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'private', 'credentials.json');
  return { root, path, env: { SYSTEMATIC_REVIEW_CONFIG: path } };
}
function output() {
  let text = '';
  return { write: chunk => { text += chunk; }, text: () => text };
}
async function privateFile(path, contents) {
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  await writeFile(path, contents, { mode: 0o600 });
}

test('missing credential reads/status/removal have no filesystem side effects', async t => {
  const { root, path, env } = await fixture(t);
  assert.equal(await serviceKey('openalex', { env }), undefined);
  const status = await serviceStatus({ env });
  assert.equal(status.configPath, path);
  assert.deepEqual(Object.keys(status.services), ['openalex']);
  assert.equal(status.services.openalex.configured, false);
  assert.equal(status.services.openalex.source, null);
  assert.equal(status.services.openalex.accountUrl, SERVICES.openalex.accountUrl);
  await removeServiceKey('openalex', { env });
  assert.deepEqual(await readdir(root), []);
});

test('private atomic saves replace the OpenAlex key and return no key data', async t => {
  const { root, path, env } = await fixture(t);
  const original = 'synthetic-openalex-original';
  const replacement = 'synthetic-openalex-replaced';
  await saveServiceKey('openalex', original, { env });
  const status = await saveServiceKey('openalex', replacement, { env });
  assert.equal(await serviceKey('openalex', { env }), replacement);
  assert.equal(status.services.openalex.source, 'config');
  assert.ok(!JSON.stringify(status).includes('synthetic'));
  assert.deepEqual(await readdir(join(root, 'private')), ['credentials.json']);
  if (process.platform !== 'win32') {
    assert.equal((await stat(join(root, 'private'))).mode & 0o777, 0o700);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
  await removeServiceKey('openalex', { env });
  assert.equal(await serviceKey('openalex', { env }), undefined);
  assert.ok(!(await readFile(path, 'utf8')).includes(replacement));
});

test('concurrent OpenAlex saves publish the last successful update or reject the competing update', async t => {
  const { root, env } = await fixture(t);
  const completed = [];
  const results = await Promise.allSettled(['synthetic-first', 'synthetic-second'].map(async key => {
    await saveServiceKey('openalex', key, { env });
    completed.push(key);
  }));
  assert.ok(results.some(result => result.status === 'fulfilled'));
  for (const result of results) {
    if (result.status === 'rejected') {
      assert.ok(result.reason instanceof ConfigError);
      assert.match(result.reason.message, /update is locked/);
    }
  }
  assert.equal(await serviceKey('openalex', { env }), completed.at(-1));
  await saveServiceKey('openalex', 'synthetic-retry', { env });
  assert.equal(await serviceKey('openalex', { env }), 'synthetic-retry');
  assert.deepEqual(await readdir(join(root, 'private')), ['credentials.json']);
});

test('concurrent OpenAlex removals never restore the removed key', async t => {
  const { env } = await fixture(t);
  await saveServiceKey('openalex', 'synthetic-original', { env });
  const results = await Promise.allSettled([removeServiceKey('openalex', { env }), removeServiceKey('openalex', { env })]);
  assert.ok(results.some(result => result.status === 'fulfilled'));
  for (const result of results) if (result.status === 'rejected') assert.match(result.reason.message, /update is locked/);
  assert.equal(await serviceKey('openalex', { env }), undefined);
});

test('concurrent OpenAlex save and removal follow the last successful operation', async t => {
  const { env } = await fixture(t);
  await saveServiceKey('openalex', 'synthetic-original', { env });
  const completed = [];
  const results = await Promise.allSettled([
    saveServiceKey('openalex', 'synthetic-replaced', { env }).then(() => completed.push('save')),
    removeServiceKey('openalex', { env }).then(() => completed.push('remove')),
  ]);
  assert.ok(results.some(result => result.status === 'fulfilled'));
  assert.equal(await serviceKey('openalex', { env }), completed.at(-1) === 'save' ? 'synthetic-replaced' : undefined);
  for (const result of results) if (result.status === 'rejected') assert.match(result.reason.message, /update is locked/);
});

test('existing lock prevents mutation, survives rejected competitors, and has safe recovery guidance', async t => {
  const { path, env } = await fixture(t);
  await saveServiceKey('openalex', 'synthetic-original', { env });
  const original = await readFile(path, 'utf8');
  const lockPath = `${path}.lock`;
  await writeFile(lockPath, '', { mode: 0o600 });
  for (const update of [() => saveServiceKey('openalex', 'synthetic-new', { env }), () => removeServiceKey('openalex', { env })]) {
    await assert.rejects(update(), error => error instanceof ConfigError && /no setup is running/.test(error.message) && !error.message.includes('synthetic'));
    assert.equal(await readFile(path, 'utf8'), original);
    assert.equal(await readFile(lockPath, 'utf8'), '');
  }
  assert.equal((await serviceStatus({ env })).services.openalex.configured, true);
  await rm(lockPath);
  await saveServiceKey('openalex', 'synthetic-new', { env });
  assert.equal(await serviceKey('openalex', { env }), 'synthetic-new');
});

test('legacy Zotero data is ignored and preserved without exposing or resolving it', async t => {
  const { path, env } = await fixture(t);
  const legacy = 'synthetic-legacy-zotero-secret\nignored';
  await privateFile(path, JSON.stringify({ version: 1, keys: { zotero: legacy } }));
  const legacyEnv = { ...env, ZOTERO_API_KEY: 'synthetic-invalid-legacy\nignored' };
  assert.equal(await serviceKey('openalex', { env: legacyEnv }), undefined);
  const before = await readFile(path, 'utf8');
  for (const operation of [() => serviceKey('zotero', { env: legacyEnv }), () => saveServiceKey('zotero', 'replacement', { env }), () => removeServiceKey('zotero', { env })]) {
    await assert.rejects(operation(), /Only openalex/);
  }
  assert.equal(await readFile(path, 'utf8'), before);
  const saved = await saveServiceKey('openalex', 'synthetic-new', { env: legacyEnv });
  assert.deepEqual(Object.keys(saved.services), ['openalex']);
  assert.ok(!JSON.stringify(saved).includes('zotero'));
  assert.ok(!JSON.stringify(await serviceStatus({ env: legacyEnv })).includes('synthetic'));
  assert.equal(JSON.parse(await readFile(path, 'utf8')).keys.zotero, legacy);
  await removeServiceKey('openalex', { env: legacyEnv });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).keys, { zotero: legacy });
});

test('environment overrides saved keys, removal retains the override, empty env falls back', async t => {
  const { env } = await fixture(t);
  await saveServiceKey('openalex', 'saved-synthetic', { env });
  const override = { ...env, OPENALEX_API_KEY: 'environment-synthetic' };
  assert.equal(await serviceKey('openalex', { env: override }), 'environment-synthetic');
  assert.equal((await serviceStatus({ env: override })).services.openalex.source, 'environment');
  assert.equal(await serviceKey('openalex', { env: { ...env, OPENALEX_API_KEY: '' } }), 'saved-synthetic');
  assert.equal((await removeServiceKey('openalex', { env: override })).services.openalex.source, 'environment');
  assert.equal(await serviceKey('openalex', { env }), undefined);
});

test('a valid env key works independently of malformed saved configuration', async t => {
  const { path, env } = await fixture(t);
  await privateFile(path, 'invalid synthetic-secret-json');
  assert.equal(await serviceKey('openalex', { env: { ...env, OPENALEX_API_KEY: 'synthetic-env' } }), 'synthetic-env');
  await assert.rejects(serviceStatus({ env }), error => error instanceof ConfigError && !error.message.includes('synthetic-secret'));
});

test('XDG location is outside working directory and override must be absolute', async t => {
  const { root } = await fixture(t);
  const status = await serviceStatus({ env: { XDG_CONFIG_HOME: root } });
  assert.equal(status.configPath, join(root, 'pi-systematic-reviewer', 'credentials.json'));
  await assert.rejects(serviceStatus({ env: { SYSTEMATIC_REVIEW_CONFIG: 'relative.json' } }), /absolute path/);
  assert.deepEqual(await readdir(root), []);
});

test('malformed, unsupported and oversized config errors are redacted and never overwrite', async t => {
  const { path, env } = await fixture(t);
  for (const contents of [
    '{"synthetic-secret":',
    '{"version":2,"keys":{"openalex":"synthetic-secret"}}',
    '{"version":1,"keys":{"unrecognized":"synthetic-secret"}}',
    '{"version":1,"keys":{"openalex":"synthetic-secret\\ninvalid"}}',
    'synthetic-secret'.repeat(5000),
  ]) {
    await privateFile(path, contents);
    for (const operation of [() => serviceStatus({ env }), () => saveServiceKey('openalex', 'new-synthetic-key', { env }), () => removeServiceKey('openalex', { env })]) {
      await assert.rejects(operation(), error => error instanceof ConfigError && !error.message.includes('synthetic-secret'));
    }
    assert.equal(await readFile(path, 'utf8'), contents);
  }
});

test('unsafe file permissions and symlinks are refused without reading or replacing targets', async t => {
  const { root, path, env } = await fixture(t);
  const original = '{"version":1,"keys":{"openalex":"synthetic-secret"}}';
  await privateFile(path, original);
  if (process.platform !== 'win32') {
    await chmod(path, 0o644);
    await assert.rejects(serviceKey('openalex', { env }), /permissions/);
    await assert.rejects(saveServiceKey('openalex', 'replacement', { env }), /permissions/);
    await chmod(path, 0o600);
  }
  const linked = join(root, 'linked.json');
  await symlink(path, linked);
  await assert.rejects(serviceStatus({ env: { SYSTEMATIC_REVIEW_CONFIG: linked } }), ConfigError);
  await assert.rejects(saveServiceKey('openalex', 'replacement', { env: { SYSTEMATIC_REVIEW_CONFIG: linked } }), ConfigError);
  assert.equal(await readFile(path, 'utf8'), original);
});

test('unknown services and invalid keys fail before creating a config', async t => {
  const { root, env } = await fixture(t);
  for (const service of ['zotero', 'other', '__proto__', 'constructor']) {
    await assert.rejects(serviceKey(service, { env }), /Only openalex/);
    await assert.rejects(saveServiceKey(service, 'key', { env }), /Only openalex/);
  }
  for (const key of ['', ' ', 'token with space', 'line\nbreak', 'x'.repeat(4097), null]) await assert.rejects(saveServiceKey('openalex', key, { env }), ConfigError);
  await assert.rejects(serviceKey('openalex', { env: { ...env, OPENALEX_API_KEY: 'invalid\nsecret' } }), error => !error.message.includes('secret'));
  assert.deepEqual(await readdir(root), []);
});

test('CLI help/status have no writes; key command arguments are rejected without echo', async t => {
  const { root, env } = await fixture(t);
  const stdout = output(), stderr = output();
  const io = { env, stdout, stderr };
  assert.equal(await main(['help'], io), 0);
  assert.equal(await main(['status'], io), 0);
  assert.equal(await main(['set', 'openalex', '--key', 'synthetic-secret'], io), 1);
  assert.equal(await main(['set', 'openalex', 'synthetic-secret'], io), 1);
  assert.equal(await main(['set', 'zotero'], io), 1);
  assert.equal(await main(['remove', 'zotero'], io), 1);
  assert.match(stdout.text(), /https:\/\/openalex.org\/settings\/api-key/);
  assert.doesNotMatch(stdout.text(), /ZOTERO_API_KEY|zotero.org\/settings\/keys|set zotero|remove zotero/);
  assert.ok(!stderr.text().includes('synthetic-secret'));
  assert.deepEqual(await readdir(root), []);
});

test('CLI explicit stdin saves one line privately and removal never exposes values', async t => {
  const { env } = await fixture(t);
  const stdout = output(), stderr = output();
  const key = 'synthetic-piped-secret';
  assert.equal(await main(['set', 'openalex', '--stdin'], { env, stdout, stderr, stdin: Readable.from([`${key}\r\n`]) }), 0);
  assert.equal(await serviceKey('openalex', { env }), key);
  assert.equal(await main(['remove', 'openalex'], { env, stdout, stderr }), 0);
  assert.equal(await serviceKey('openalex', { env }), undefined);
  assert.ok(!stdout.text().includes(key));
  assert.ok(!stderr.text().includes(key));
});

test('CLI rejects implicit pipes, multiple lines and oversized stdin without partial saves', async t => {
  const { env, root } = await fixture(t);
  const stdout = output(), stderr = output();
  assert.equal(await main(['set', 'openalex'], { env, stdout, stderr, stdin: Readable.from(['synthetic-secret']) }), 1);
  for (const key of ['one\ntwo\n', 'x'.repeat(4099)]) {
    assert.equal(await main(['set', 'openalex', '--stdin'], { env, stdout, stderr, stdin: Readable.from([key]) }), 1);
  }
  assert.deepEqual(await readdir(root), []);
  assert.match(stderr.text(), /interactive terminal/);
});

test('hidden terminal entry supports backspace, restores raw mode and prints no key', async t => {
  const { env } = await fixture(t);
  const stdin = new PassThrough();
  const modes = [];
  stdin.isTTY = true;
  stdin.setRawMode = value => { modes.push(value); stdin.isRaw = value; };
  const stdout = output(), stderr = output();
  const pending = main(['set', 'openalex'], { env, stdin, stdout, stderr });
  const writing = setInterval(() => { if (stdin.isRaw) { clearInterval(writing); stdin.write('synthetic-secretX\u007f\r'); } }, 5);
  t.after(() => clearInterval(writing));
  assert.equal(await pending, 0);
  assert.equal(await serviceKey('openalex', { env }), 'synthetic-secret');
  assert.deepEqual(modes, [true, false]);
  assert.ok(!stdout.text().includes('synthetic-secret'));
  assert.ok(!stderr.text().includes('synthetic-secret'));
  stdin.destroy();
});

test('hidden terminal cancellation restores input and saves nothing', async t => {
  const { env, root } = await fixture(t);
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.setRawMode = value => { stdin.isRaw = value; };
  const stdout = output(), stderr = output();
  const pending = main(['set', 'openalex'], { env, stdin, stdout, stderr });
  const writing = setInterval(() => { if (stdin.isRaw) { clearInterval(writing); stdin.write('synthetic-secret\u0003'); } }, 5);
  t.after(() => clearInterval(writing));
  assert.equal(await pending, 1);
  assert.equal(stdin.isRaw, false);
  assert.deepEqual(await readdir(root), []);
  assert.match(stderr.text(), /cancelled/);
  assert.ok(!stderr.text().includes('synthetic-secret'));
  stdin.destroy();
});
