import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dataDir, readJson, writeJson, privateDir, digest, allMeta, socketRequest, socketPath } from '../../common.mjs';
import { loadPi, bundledRoot } from '../../rpc/runtime.mjs';
import { atIdle, sourceResult } from '../../updates/runtime.mjs';
import { platform } from '../index.mjs';

const exec = promisify(execFile);
const template = new URL('./wildbuzzard/', import.meta.url);
const directory = path.join(dataDir, 'integrations/wildbuzzard');
const stateFile = path.join(dataDir, 'integrations/wildbuzzard.json');
const appId = 'org.openresearchtools.wildbuzzard';
const upstream = () => readJson(new URL('upstream.json', template));
export async function wildbuzzardStatus() {
  const pin = await upstream(), installed = await readJson(stateFile, {});
  const present = await fs.access(path.join(directory, 'upstream/extension.mjs')).then(() => true, () => false);
  return { ...installed, ready: present && installed.revision === pin.revision, latest: pin.version, latestRevision: pin.revision };
}
async function apkPath() {
  if (platform !== 'termux') throw Error('WildBuzzard Android controls require Termux');
  const { stdout } = await exec('pm', ['path', appId], { timeout: 10000 });
  const apk = stdout.trim().split('\n').map(line => line.replace(/^package:/, '')).find(file => file.endsWith('/base.apk'));
  if (!apk?.startsWith('/data/app/')) throw Error('Install WildBuzzard Android first');
  return apk;
}
export async function checkWildbuzzard() {
  return sourceResult('wildbuzzard', async () => {
    const status = await wildbuzzardStatus();
    return { installed: status.version, latest: status.latest, updateAvailable: Boolean(status.revision && !status.ready), managed: !status.external };
  });
}
export async function setupWildbuzzard(job) {
  await apkPath();
  const previous = await wildbuzzardStatus();
  if (previous.ready) { await job.log('WildBuzzard Pi controls are installed.\n'); return; }
  const pin = await upstream(), runtime = await loadPi();
  const settings = runtime.pi.SettingsManager.create(os.homedir(), runtime.pi.getAgentDir(), { projectTrusted: false });
  const packages = settings.getPackages().map(item => typeof item === 'string' ? item : item.source);
  let external = false;
  for (const source of packages.filter(source => source !== directory)) {
    const local = source.startsWith('~/') ? path.join(os.homedir(), source.slice(2)) : source;
    if (source.startsWith('npm:@openresearchtools/pi-wildbuzzard') || (path.isAbsolute(local) && (await readJson(path.join(local, 'package.json'), {})).name === '@openresearchtools/pi-wildbuzzard')) external = true;
  }
  await privateDir(path.dirname(directory));
  const stage = await fs.mkdtemp(directory + '.install-'), backup = directory + '.previous';
  try {
    await privateDir(path.join(stage, 'upstream'));
    await job.phase('Downloading WildBuzzard Pi controls');
    for (const [name, expected] of Object.entries(pin.files)) {
      const response = await fetch(`https://raw.githubusercontent.com/${pin.repository}/${pin.revision}/wildbuzzard/android/pi/${name}`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw Error(`WildBuzzard ${name}: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (digest(bytes) !== expected) throw Error(`WildBuzzard ${name} checksum mismatch`);
      await fs.writeFile(path.join(stage, 'upstream', name), bytes, { mode: 0o600 });
      await job.log(`Verified ${name}\n`);
    }
    await job.phase('Installing WildBuzzard npm dependencies');
    await job.exec('npm', ['ci', '--prefix', path.join(stage, 'upstream'), '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=http']);
    const wrapper = await readJson(new URL('package.json', template));
    if (external) wrapper.pi.extensions = []; // Keep an independently installed native Pi package in charge.
    await writeJson(path.join(stage, 'package.json'), wrapper);
    await fs.copyFile(path.join(bundledRoot, 'LICENSE'), path.join(stage, 'LICENSE'));
    await fs.cp(new URL('skills/', template), path.join(stage, 'skills'), { recursive: true });
    await atIdle(job, async () => {
      await job.phase('Registering WildBuzzard with native Pi');
      // Recover a swap interrupted before the new package was put in place.
      if (!await fs.stat(directory).catch(() => null)) await fs.rename(backup, directory).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await fs.rm(backup, { recursive: true, force: true });
      const existed = await fs.stat(directory).then(() => true, () => false);
      if (existed) await fs.rename(directory, backup);
      try {
        await fs.rename(stage, directory);
        await job.exec(process.execPath, [runtime.cli, 'install', directory, '--offline']);
        await writeJson(stateFile, { revision: pin.revision, version: pin.version, external });
      } catch (error) {
        await fs.rm(directory, { recursive: true, force: true });
        if (existed) await fs.rename(backup, directory);
        throw error;
      }
      for (const meta of await allMeta()) await socketRequest(socketPath(meta.id), '/context', { reload: true }, 20000).catch(error => { if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; });
      await fs.rm(backup, { recursive: true, force: true });
    });
    await checkWildbuzzard();
    await job.log(external ? 'Kept your existing WildBuzzard extension; installed its Android skill.\n' : 'WildBuzzard extension and skill are ready in native Pi.\n');
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
export async function updateWildbuzzard(job) {
  if (!(await readJson(stateFile, {})).revision) return;
  if (!await apkPath().catch(() => null)) { await job.log('WildBuzzard is not installed; skipping its controls.\n'); return; }
  await setupWildbuzzard(job);
}
export async function authorizeWildbuzzard(job) {
  const apk = await apkPath();
  await job.phase('Connecting WildBuzzard · allow Termux in the browser if asked');
  const env = { ...process.env, CLASSPATH: apk }; delete env.LD_PRELOAD; delete env.LD_LIBRARY_PATH;
  const { stdout } = await exec('/system/bin/app_process', ['/', 'org.openresearchtools.wildbuzzard.BrowserCommand', '--authorize'], { env, timeout: 240000, maxBuffer: 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (result.error) throw Error(result.error.message || String(result.error));
  await job.log('WildBuzzard accepted the Termux connection.\n');
}
