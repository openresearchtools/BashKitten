import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

test('Local supervisor attaches once, preserves intentional stop and restarts a dead backend', { timeout: 45000 }, async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-control-'));
  const listener = http.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port; await new Promise(r => listener.close(r));
  const env = { ...process.env, BASHKITTEN_DATA_DIR: path.join(home, 'data'), PI_CODING_AGENT_DIR: path.join(home, 'pi'), PORT: String(port) };
  const root = path.resolve(import.meta.dirname, '../..'), application = path.join(home, 'application');
  for (const folder of ['src/server', 'src/web']) await fs.cp(path.join(root, folder), path.join(application, folder), { recursive: true });
  await fs.symlink(path.join(root, 'node_modules'), path.join(application, 'node_modules'));
  await fs.writeFile(path.join(application, 'package.json'), '{"type":"module"}');
  const stamp = path.join(application, 'build-platform.json');
  await fs.writeFile(stamp, JSON.stringify({ revision: 'before' }));
  const script = path.join(application, 'src/server/control.mjs');
  async function ctl(command, value) { return JSON.parse((await promisify(execFile)(process.execPath, [script, command, ...(value ? [JSON.stringify(value)] : [])], { env, timeout: 25000 })).stdout); }
  async function ready() { for (let i = 0; i < 60; i++) { const value = await ctl('status'); if (value.web.status === 'running') return value; await new Promise(r => setTimeout(r, 100)); } throw Error('Backend did not start'); }
  t.after(async () => { await ctl('stop').catch(() => {}); await ctl('shutdown').catch(() => {}); await new Promise(r => setTimeout(r, 200)); await fs.rm(home, { recursive: true, force: true }); });
  const first = await ready(); assert.equal(first.web.url, `http://127.0.0.1:${port}`);
  const pid = JSON.parse(await fs.readFile(path.join(home, 'data/server.json'), 'utf8')).pid;
  await Promise.all([ctl('status'), ctl('status')]);
  assert.equal(JSON.parse(await fs.readFile(path.join(home, 'data/server.json'), 'utf8')).pid, pid);
  assert.equal((await ctl('stop')).web.desired, false);
  await ctl('shutdown'); await new Promise(r => setTimeout(r, 200));
  assert.equal((await ctl('status')).web.status, 'stopped');
  await new Promise(r => setTimeout(r, 2200)); assert.equal((await ctl('status')).web.status, 'stopped');
  await ctl('start');
  const alive = JSON.parse(await fs.readFile(path.join(home, 'data/server.json'), 'utf8')).pid;
  process.kill(alive, 'SIGKILL'); await new Promise(r => setTimeout(r, 100)); await ready();
  assert.notEqual(JSON.parse(await fs.readFile(path.join(home, 'data/server.json'), 'utf8')).pid, alive);
  const project = path.join(home, 'project'); await fs.mkdir(project);
  if (process.platform !== 'android') assert.equal((await ctl('project-root', { path: project })).path, project);
  const oldManager = (await ctl('status')).manager.pid;
  await fs.writeFile(stamp, JSON.stringify({ revision: 'after' }));
  for (let i = 0; i < 80; i++) {
    const value = await ctl('status');
    if (value.manager.revision === 'after' && value.web.status === 'running') break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.notEqual((await ready()).manager.pid, oldManager);
  await ctl('stop'); await fs.writeFile(stamp, JSON.stringify({ revision: 'stopped-update' }));
  for (let i = 0; i < 80 && (await ctl('status')).manager.revision !== 'stopped-update'; i++) await new Promise(r => setTimeout(r, 100));
  const updated = await ctl('status'); assert.equal(updated.manager.revision, 'stopped-update');
  assert.equal(updated.web.desired, false); assert.equal(updated.web.status, 'stopped');
  const attached = spawn(process.execPath, [script, 'serve'], { env: { ...env, BASHKITTEN_ATTACHED_MANAGER: '1' }, stdio: 'ignore' });
  t.after(() => { if (attached.exitCode === null) attached.kill(); });
  for (let i = 0; i < 80 && !(await ctl('status')).manager.attached; i++) await new Promise(r => setTimeout(r, 100));
  const adopted = await ctl('status'); assert.equal(adopted.manager.attached, true);
  assert.notEqual(adopted.manager.pid, updated.manager.pid); assert.equal(adopted.web.desired, false);
  // APK installation waits for provider activity, keeps the UI available while
  // waiting, and survives the manager dying during Android package replacement.
  await ctl('start');
  const loginFile = path.join(home, 'data/run/login.json');
  await fs.writeFile(loginFile, JSON.stringify({ pid: process.pid }));
  await ctl('app-update-prepare', { packageId: 'com.termux.api' });
  await new Promise(r => setTimeout(r, 300));
  const waiting = await ctl('status'); assert.equal(waiting.web.status, 'running'); assert.equal(waiting.appUpdate, null);
  assert.equal(waiting.packages.job.status, 'waiting');
  await fs.rm(loginFile);
  for (let i = 0; i < 80 && !(await ctl('status')).appUpdate; i++) await new Promise(r => setTimeout(r, 100));
  const held = await ctl('status'); assert.equal(held.appUpdate.packageId, 'com.termux.api');
  assert.equal(held.web.status, 'stopped'); assert.equal(held.web.desired, true);
  await assert.rejects(ctl('start'), /Finish or cancel/);
  process.kill(held.manager.pid, 'SIGKILL'); await new Promise(r => setTimeout(r, 200));
  const recovered = await ctl('status'); assert.notEqual(recovered.manager.pid, held.manager.pid);
  assert.equal(recovered.web.status, 'stopped'); assert.equal(recovered.appUpdate.packageId, 'com.termux.api');
  await assert.rejects(ctl('app-update-finish', { packageId: 'com.termux' }), /Another Android installation/);
  await ctl('app-update-finish', { packageId: 'com.termux.api' }); await ready();
  await ctl('stop'); await ctl('app-update-prepare', { packageId: 'com.termux' });
  for (let i = 0; i < 80 && !(await ctl('status')).appUpdate; i++) await new Promise(r => setTimeout(r, 100));
  await ctl('app-update-finish', { packageId: 'com.termux' });
  assert.equal((await ctl('status')).web.desired, false);
});
