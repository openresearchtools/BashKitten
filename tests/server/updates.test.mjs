import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Jobs } from '../../src/server/updates/jobs.mjs';
import { selectedRuntime, loadPi } from '../../src/server/rpc/runtime.mjs';

test('Package jobs keep real output, deduplicate taps and resume only unfinished steps', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-jobs-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let installs = 0, retries = 0, release;
  const blocked = new Promise(r => { release = r; });
  const jobs = new Jobs({ install: async job => {
    await job.step('download', 'Downloading', async () => { installs++; await job.exec(process.execPath, ['-e', 'process.stdout.write("Downloaded 42 bytes\\n")']); await blocked; });
    await job.step('configure', 'Configuring', async () => { if (++retries === 1) throw Error('Interrupted fixture'); });
  } }, directory);
  await jobs.init();
  const first = await jobs.start('install');
  assert.equal((await jobs.start('install')).id, first.id);
  await assert.rejects(jobs.start('install', { other: true }), /Another package/);
  release();
  while (jobs.busy) await new Promise(r => setTimeout(r, 10));
  assert.equal((await jobs.status()).status, 'failed');
  assert.match((await jobs.status()).log, /Downloaded 42 bytes/);
  const resumed = new Jobs(jobs.handlers, directory); await resumed.init();
  await resumed.start('install', {}, true);
  while (resumed.busy) await new Promise(r => setTimeout(r, 10));
  assert.equal((await resumed.status()).status, 'complete'); assert.equal(installs, 1); assert.equal(retries, 2);
  const saved = JSON.parse(await fs.readFile(jobs.file, 'utf8')); saved.status = 'running'; await fs.writeFile(jobs.file, JSON.stringify(saved));
  const crashed = new Jobs(jobs.handlers, directory); await crashed.init();
  assert.equal((await crashed.status()).status, 'interrupted');
});

test('RPC, public Pi services and pi-ai resolve the same actual runtime', async () => {
  const selected = selectedRuntime(), loaded = await loadPi();
  assert.equal(selected.version, loaded.version); assert.equal(selected.root, loaded.root);
  assert.equal(typeof loaded.pi.ModelRuntime.create, 'function'); assert.equal(typeof loaded.ai.getSupportedThinkingLevels, 'function');
  assert.equal(JSON.parse(await fs.readFile(path.join(selected.root, 'node_modules/@earendil-works/pi-coding-agent/package.json'))).version, selected.version);
});

test('Native package progress survives split status lines and keeps Unicode output', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-progress-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const jobs = new Jobs({ install: async job => {
    await job.exec(process.execPath, ['-e', `const fs=require('fs'); fs.writeSync(3,'dlstatus:1:25.5:Downloading package\\n'); fs.writeSync(3,'pmstatus:nodejs-lts:80:Con'); setTimeout(()=>{fs.writeSync(3,'figuring nodejs-lts\\n'); process.stdout.write('Saved café 🍓\\n');},30);`]);
    assert.deepEqual((await job.status()).progress, { kind: 'pmstatus', package: 'nodejs-lts', percent: 80, message: 'Configuring nodejs-lts' });
  } }, directory);
  await jobs.init(); await jobs.start('install');
  while (jobs.busy) await new Promise(r => setTimeout(r, 10));
  const status = await jobs.status(); assert.equal(status.status, 'complete'); assert.match(status.log, /Saved café 🍓/);
});

test('Runtime activation waits for login, switches all resolvers and retains rollback', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-runtime-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const script = `
    import fs from 'node:fs/promises'; import path from 'node:path'; import assert from 'node:assert/strict';
    import {selectedRuntime,maintenanceFile,allowRuntimeWork,loadPi} from './src/server/rpc/runtime.mjs';
    import {activateRuntime,rollbackPi} from './src/server/updates/runtime.mjs';
    import {dataDir,writeJson} from './src/server/common.mjs';
    const original=selectedRuntime(), root=path.join(dataDir,'new-runtime');
    await fs.mkdir(root,{recursive:true}); await fs.symlink(path.join(original.root,'node_modules'),path.join(root,'node_modules'));
    const login=path.join(dataDir,'run/login.json'); await writeJson(login,{pid:process.pid});
    const phases=[], job={job:{id:'activation-test'},phase:async name=>{phases.push(name); if(name.startsWith('Waiting')) { assert.throws(allowRuntimeWork,/maintenance/); await fs.rm(login); }}};
    await activateRuntime(job,{root,version:original.version});
    assert(phases.some(name=>name.startsWith('Waiting'))); assert.equal(selectedRuntime().root,root);
    assert.equal((await loadPi()).root,root); assert.equal(selectedRuntime().previous.root,original.root);
    allowRuntimeWork(); await rollbackPi(job); assert.equal(selectedRuntime().root,original.root);
    assert.equal(await fs.stat(maintenanceFile).catch(()=>null),null);
  `;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { cwd: path.resolve(import.meta.dirname, '../..'), env: { ...process.env, BASHKITTEN_DATA_DIR: directory }, timeout: 20000 });
});

test('Cancellation finishes the current transaction and resumes at the next step', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-cancel-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let release, entered, transactions = 0, next = 0;
  const running = new Promise(r => { entered = r; }), finish = new Promise(r => { release = r; });
  const jobs = new Jobs({ update: async job => {
    await job.step('apt', 'Configuring', async () => { transactions++; entered(); await finish; });
    await job.step('pi', 'Updating Pi', async () => { next++; });
  } }, directory);
  await jobs.init(); await jobs.start('update'); await running; await jobs.cancel();
  assert.equal(jobs.busy, true); assert.equal((await jobs.status()).status, 'running');
  release(); while (jobs.busy) await new Promise(r => setTimeout(r, 10));
  assert.equal((await jobs.status()).status, 'cancelled'); assert.equal(next, 0);
  await jobs.start('update', {}, true); while (jobs.busy) await new Promise(r => setTimeout(r, 10));
  assert.equal(transactions, 1); assert.equal(next, 1); assert.equal((await jobs.status()).status, 'complete');
});

test('Update checks report registry Pi releases and global npm updates without a custom release manifest', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-npm-check-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin'); await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, 'npm'), `#!/bin/sh
case "$1" in
 view) printf '%s' '{"version":"9.0.0","engines":{"node":">=22"}}';;
 outdated) printf '%s' '{"example-cli":{"current":"1.0.0","latest":"1.1.0"}}'; exit 1;;
 *) exit 2;;
esac
`, { mode: 0o700 });
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const script = `
    import assert from 'node:assert/strict';
    import {checkPi,updateStatus} from './src/server/updates/runtime.mjs';
    import {checkNpm} from './src/server/updates/npm.mjs';
    const pi=await checkPi(); assert.equal(pi.updateAvailable,true); assert.equal(pi.latest,'9.0.0'); assert.equal(pi.reason,null);
    const npm=await checkNpm(); assert.equal(npm.available,1); assert.deepEqual(npm.packages,[{name:'example-cli',current:'1.0.0',latest:'1.1.0'}]);
    const status=await updateStatus(); assert.equal(status.sources.pi.latest,'9.0.0'); assert.equal(status.sources.npm.available,1);
  `;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { cwd: path.resolve(import.meta.dirname, '../..'), env: { ...process.env, PATH: bin + ':' + process.env.PATH, BASHKITTEN_DATA_DIR: directory }, timeout: 15000 });
});
