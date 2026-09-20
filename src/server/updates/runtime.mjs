import fs from 'node:fs/promises';
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
export async function runtimeManifests() {
  return readJson(path.join(bundledRoot, 'runtime-manifests/index.json'), []);
}
export async function checkPi() {
  return sourceResult('pi', async () => {
    const runtime = selectedRuntime();
    const { stdout } = await exec('npm', ['view', '@earendil-works/pi-coding-agent@latest', 'version', 'engines', 'dependencies', 'dist.integrity', '--json'], { timeout: 45000, maxBuffer: 1024 * 1024 });
    const latest = JSON.parse(stdout);
    if (!semver.valid(latest.version)) throw Error('npm returned an invalid Pi version');
    const compatible = (await runtimeManifests()).filter(m => m.platforms.includes(process.platform) && semver.satisfies(process.version, m.node)).sort((a, b) => semver.rcompare(a.version, b.version))[0];
    return { installed: runtime.version, latest: latest.version, compatible: compatible?.version || runtime.version,
      updateAvailable: Boolean(compatible && semver.gt(compatible.version, runtime.version)),
      upstreamAvailable: semver.gt(latest.version, runtime.version),
      reason: !compatible || semver.gt(latest.version, compatible.version) ? 'A newer upstream release needs a tested BashKitten runtime manifest.' : null };
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
  const current = selectedRuntime();
  const manifests = (await runtimeManifests()).filter(m => m.platforms.includes(process.platform) && semver.satisfies(process.version, m.node));
  const manifest = manifests.sort((a, b) => semver.rcompare(a.version, b.version))[0];
  if (!manifest || !semver.gt(manifest.version, current.version)) { await job.log('The selected Pi runtime is already the latest compatible release.\n'); return; }
  const lockPath = path.join(bundledRoot, 'runtime-manifests', manifest.lock);
  const lockBytes = await fs.readFile(lockPath);
  if (digest(lockBytes) !== manifest.sha256) throw Error('The runtime lock does not match its tested manifest');
  const parent = process.platform === 'android' ? path.join(process.env.PREFIX, 'var/lib/bashkitten/runtimes') : path.join(dataDir, 'runtimes');
  await privateDir(parent);
  const root = path.join(parent, manifest.version + '-' + manifest.sha256.slice(0, 12));
  await job.step('stage-pi', 'Downloading Pi and its pinned dependencies', async () => {
    await privateDir(root);
    const lock = JSON.parse(lockBytes); await writeJson(path.join(root, 'package.json'), { ...lock.packages[''], private: true, type: 'module' });
    await fs.writeFile(path.join(root, 'package-lock.json'), lockBytes);
    // npm verifies every locked tarball's integrity; no dependency lifecycle scripts run.
    await job.exec('npm', ['ci', '--prefix', root, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
    const check = `import {ModelRuntime,SessionManager} from ${JSON.stringify('file://' + path.join(root, 'node_modules/@earendil-works/pi-coding-agent/dist/index.js'))}; const r=await ModelRuntime.create({allowModelNetwork:false}); if(!r.getProviders().length||!SessionManager)process.exit(1);`;
    await job.exec(process.execPath, ['--input-type=module', '-e', check], { timeout: 60000 });
    await writeJson(path.join(root, 'managed.json'), { owner: 'bashkitten', version: manifest.version, lockSha256: manifest.sha256 });
  });
  await job.step('activate-pi', 'Activating Pi', () => activateRuntime(job, { root, version: manifest.version }));
}
export async function rollbackPi(job) {
  const previous = selectedRuntime().previous;
  if (!previous) throw Error('No previous managed runtime is available');
  await fs.access(path.join(previous.root, 'node_modules/@earendil-works/pi-coding-agent/package.json'));
  await activateRuntime(job, previous);
}

export async function pruneRuntimes(parent, keep, commands) {
  for (const entry of await fs.readdir(parent, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    if (!entry.isDirectory() || !/^[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}$/.test(entry.name)) continue;
    const root = path.join(parent, entry.name), marker = await readJson(path.join(root, 'managed.json'), null);
    if (marker?.owner !== 'bashkitten' || entry.name !== marker.version + '-' + marker.lockSha256?.slice(0, 12)) continue;
    if (Date.now() - (await fs.stat(path.join(root, 'managed.json'))).mtimeMs < 7 * 86400000) continue;
    if (keep.has(root) || commands.some(command => command.some(argument => argument.startsWith(root + '/')))) continue;
    await fs.rm(root, { recursive: true });
  }
}
export async function collectRuntimes() {
  // Only called before starting services, with no surviving web/worker process.
  // Terminal Pi processes still keep their exact runtime through /proc ownership.
  const current = selectedRuntime(), bundled = await readJson(path.join(bundledRoot, 'runtime-default.json'), null);
  const keep = new Set([current.root, current.previous?.root, bundled?.root].filter(Boolean));
  const commands = [];
  for (const pid of (await fs.readdir('/proc')).filter(value => /^[0-9]+$/.test(value))) {
    try { commands.push((await fs.readFile('/proc/' + pid + '/cmdline', 'utf8')).split('\0')); }
    catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) throw error; }
  }
  if (commands.some(args => /^(apt|apt-get|dpkg|npm|pkg)$/.test(path.basename(args[0] || '')))) return;
  const parent = process.platform === 'android' ? path.join(process.env.PREFIX, 'var/lib/bashkitten/runtimes') : path.join(dataDir, 'runtimes');
  await pruneRuntimes(parent, keep, commands);
}
