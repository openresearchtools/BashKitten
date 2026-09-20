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
