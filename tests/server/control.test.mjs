import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
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
});
