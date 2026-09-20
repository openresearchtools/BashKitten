import fs from 'node:fs/promises';
import { selectPlatformPackages } from './platform-packages.mjs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import semver from 'semver';
import { dataDir, readJson, writeJson, privateDir, digest, allMeta, socketRequest, socketPath } from '../common.mjs';
import { selectedRuntime, bundledRoot, runtimeFile, maintenanceFile } from '../rpc/runtime.mjs';

const exec = promisify(execFile);
const stateFile = path.join(dataDir, 'updates/sources.json');
export async function sourceResult(source, operation) {
  let value;
  try { value = { checkedAt: Date.now(), ...await operation() }; }
  catch (error) { value = { checkedAt: Date.now(), error: error.message }; }
  // Sources run sequentially so each result survives a later source's error.
  const saved = await readJson(stateFile, {}); saved[source] = value; await writeJson(stateFile, saved);
  return value;
}
export async function checkPi() {
  return sourceResult('pi', async () => {
    const runtime = selectedRuntime();
    const { stdout } = await exec('npm', ['view', '@earendil-works/pi-coding-agent@latest', 'version', 'engines', 'dist.integrity', '--json'], { timeout: 45000, maxBuffer: 1024 * 1024 });
    const latest = JSON.parse(stdout);
    if (!semver.valid(latest.version)) throw Error('npm returned an invalid Pi version');
    const compatible = !latest.engines?.node || semver.satisfies(process.version, latest.engines.node);
    return { installed: runtime.version, latest: latest.version, compatible: compatible ? latest.version : runtime.version,
      updateAvailable: compatible && semver.gt(latest.version, runtime.version), upstreamAvailable: semver.gt(latest.version, runtime.version),
      reason: compatible ? null : `Pi ${latest.version} needs Node ${latest.engines.node}. Update system packages first.` };
  });
}
export async function updateStatus() {
  const runtime = selectedRuntime();
  return { sources: await readJson(stateFile, {}), runtime: { version: runtime.version, previous: runtime.previous?.version }, maintenance: await readJson(maintenanceFile, null) };
}
const delay = ms => new Promise(r => setTimeout(r, ms));
export async function atIdle(job, fn, { desktop = false } = {}) {
  if (desktop && process.platform === 'android') {
    const { desktopRunning } = await import('../platform/termux/desktop.mjs');
    while (await desktopRunning()) { await job.phase('Waiting for desktop stop', 'waiting'); await delay(2000); }
  }
  await writeJson(maintenanceFile, { pid: process.pid, job: job.job.id });
  try {
    while (true) {
      let waiting = false;
      const login = await readJson(path.join(dataDir, 'run/login.json'), null);
      if (login) { try { process.kill(login.pid, 0); waiting = true; } catch {} }
      for (const meta of await allMeta()) {
        try { const state = await socketRequest(socketPath(meta.id), '/barrier', {}, 10000); if (!state.idle) waiting = true; }
        catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) waiting = true; }
      }
      if (!waiting) break;
      await job.phase('Waiting for Pi turns and provider login to finish', 'waiting'); await delay(2000);
    }
    await job.phase('Applying at idle boundary'); return await fn();
  } finally { await fs.rm(maintenanceFile, { force: true }); }
}
export async function activateRuntime(job, next) {
  await atIdle(job, async () => {
    const current = selectedRuntime();
    const previousSelection = await readJson(runtimeFile, null);
    async function reload() {
      for (const meta of await allMeta()) await socketRequest(socketPath(meta.id), '/context', {}, 20000).catch(error => { if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; });
    }
    try {
      await writeJson(runtimeFile, { root: next.root, version: next.version, previous: { root: current.root, version: current.version } });
      selectedRuntime(); await reload();
    } catch (error) {
      if (previousSelection) await writeJson(runtimeFile, previousSelection); else await fs.rm(runtimeFile, { force: true });
      await reload().catch(() => {}); throw error;
    }
  });
}
export async function installPi(job) {
  await job.phase('Checking Pi on npm');
  const available = await checkPi();
  if (available.error) throw Error(available.error);
  if (available.reason && available.upstreamAvailable) throw Error(available.reason);
  if (!available.updateAvailable) { await job.log(`Pi ${available.installed} is up to date on npm.\n`); return; }
  const packaged = await readJson(path.join(bundledRoot, 'runtime-default.json'), null);
  if (packaged?.version === available.latest) {
    await fs.access(path.join(packaged.root, 'ready'));
    await job.phase(`Activating packaged Pi ${available.latest}`);
    await activateRuntime(job, packaged);
    await checkPi();
    await job.log(`Pi ${available.latest} activated from the installed BashKitten package.\n`);
    return;
  }
  const parent = process.platform === 'android' ? path.join(process.env.PREFIX, 'var/lib/bashkitten/runtimes') : path.join(dataDir, 'runtimes');
  await privateDir(parent);
  const temporary = await fs.mkdtemp(path.join(parent, '.install-'));
  let root;
  try {
    await job.phase(`Downloading Pi ${available.latest} and npm dependencies`);
    await writeJson(path.join(temporary, 'package.json'), { name: 'bashkitten-pi-runtime', private: true, type: 'module',
      dependencies: { '@earendil-works/pi-coding-agent': available.latest, '@earendil-works/pi-ai': available.latest } });
    // npm records exact resolved versions and integrity in the new lock. The
    // running installation stays untouched until the native API check passes.
    await job.exec('npm', ['install', '--prefix', temporary, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=http']);
    await selectPlatformPackages(temporary);
    await job.phase(`Checking Pi ${available.latest}`);
    const agent = 'file://' + path.join(temporary, 'node_modules/@earendil-works/pi-coding-agent/dist/');
    const check = `import {ModelRuntime,SessionManager,parseSessionEntries} from ${JSON.stringify(agent + 'index.js')}; import {createLlamaProvider} from ${JSON.stringify(agent + 'extensions/llama/provider.js')}; const r=await ModelRuntime.create({allowModelNetwork:false}); r.registerNativeProvider(createLlamaProvider().provider); await r.refresh({providers:['llama.cpp'],allowNetwork:false}); if(!r.getProvider('llama.cpp')?.auth.apiKey?.login||!SessionManager.inMemory||!parseSessionEntries)process.exit(1);`;
    await job.exec(process.execPath, ['--input-type=module', '-e', check], { timeout: 60000 });
    const hash = digest(await fs.readFile(path.join(temporary, 'package-lock.json')));
    root = path.join(parent, available.latest + '-' + hash.slice(0, 12));
    await writeJson(path.join(temporary, 'managed.json'), { owner: 'bashkitten', version: available.latest, lockSha256: hash });
    try { await fs.rename(temporary, root); }
    catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
    await job.phase(`Activating Pi ${available.latest}`);
    await activateRuntime(job, { root, version: available.latest });
    await checkPi();
    await job.log(`Pi ${available.latest} installed.\n`);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
export async function rollbackPi(job) {
  const previous = selectedRuntime().previous;
  if (!previous) throw Error('No previous managed runtime is available');
  await fs.access(path.join(previous.root, 'node_modules/@earendil-works/pi-coding-agent/package.json'));
  await activateRuntime(job, previous);
}
