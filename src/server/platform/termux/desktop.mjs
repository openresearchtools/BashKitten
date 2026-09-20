import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dataDir, readJson, writeJson, privateDir, digest } from '../../common.mjs';
import { requireTermux, apt, packageState } from './packages.mjs';

const exec = promisify(execFile), sleep = ms => new Promise(r => setTimeout(r, ms));
const file = path.join(dataDir, 'desktop.json'), processFile = path.join(dataDir, 'run/desktop.json');
const runner = fileURLToPath(new URL('./desktop-runner.mjs', import.meta.url));
const base = { mesa: '26.2.3', 'mesa-demos': '9.0.0' };
export const profiles = [
  { id: 'software', name: 'Software / llvmpipe', packages: base, env: { GALLIUM_DRIVER: 'llvmpipe', LIBGL_ALWAYS_SOFTWARE: '1' }, renderer: 'llvmpipe|softpipe' },
  { id: 'turnip', name: 'Adreno · Turnip + Zink', packages: { ...base, 'mesa-vulkan-icd-freedreno': '26.2.3', 'vulkan-loader-generic': '1.4.363', 'vulkan-tools': '1.4.363' }, conflicts: ['vulkan-loader-android'], env: { GALLIUM_DRIVER: 'zink', MESA_LOADER_DRIVER_OVERRIDE: 'zink' }, renderer: 'zink.*(turnip|adreno)|adreno' },
  { id: 'virgl', name: 'VirGL · Android GLES', packages: { ...base, 'virglrenderer-android': '1.3.0-1' }, helper: [], env: { GALLIUM_DRIVER: 'virpipe' }, renderer: 'virgl|virpipe' },
  { id: 'angle-gl', name: 'VirGL · ANGLE/GLES', packages: { ...base, 'virglrenderer-android': '1.3.0-1' }, helper: ['--angle-gl'], env: { GALLIUM_DRIVER: 'virpipe' }, renderer: 'virgl|virpipe' },
  { id: 'angle-vulkan', name: 'VirGL · ANGLE/Vulkan', packages: { ...base, 'virglrenderer-android': '1.3.0-1', 'vulkan-loader-android': '29' }, conflicts: ['vulkan-loader-generic', 'mesa-vulkan-icd-freedreno'], helper: ['--angle-vulkan'], env: { GALLIUM_DRIVER: 'virpipe' }, renderer: 'virgl|virpipe' },
];
export const methods = ['xstartup', 'separator', 'separate', 'environment', 'no-dbus', 'custom'];
export async function settings() { return readJson(file, { requested: 'software', confirmed: null, method: 'xstartup', display: 1, dpi: 160, legacyDrawing: false, forceBgra: false, customCommand: '', probes: {} }); }
async function alive(info) {
  if (!Number.isInteger(info?.pid) || info.pid < 2) return false;
  try { return (await fs.readFile(`/proc/${info.pid}/cmdline`, 'utf8')).split('\0').includes(runner); } catch { return false; }
}
export async function desktopRunning() { return alive(await readJson(processFile, null)); }
async function installed(profile) {
  const versions = await packageState(Object.keys(profile.packages));
  const missing = [];
  for (const [name, minimum] of Object.entries(profile.packages)) {
    if (!versions[name] || !await exec('dpkg', ['--compare-versions', versions[name], 'ge', minimum]).then(() => true, () => false)) missing.push(name);
  }
  return { versions, missing, fingerprint: digest(JSON.stringify(versions)) };
}
export async function desktopStatus() {
  requireTermux(); const config = await settings(), current = profiles.find(p => p.id === config.requested);
  const info = await readJson(processFile, null), running = await alive(info);
  const state = current ? await installed(current) : null;
  const ready = current && !state.missing.length && config.confirmed === current.id && config.probes?.[current.id]?.fingerprint === state.fingerprint;
  return { ...config, profiles: profiles.map(p => ({ id: p.id, name: p.name })), methods, ready: Boolean(ready), running, runningProfile: running ? info.profile : null, error: info?.error, renderer: config.probes?.[config.requested]?.renderer };
}
export async function saveDesktop(value) {
  requireTermux(); const config = await settings();
  if (value.method !== undefined) { if (!methods.includes(value.method)) throw Error('Unknown startup method'); config.method = value.method; }
  for (const [name, min, max] of [['display', 1, 89], ['dpi', 72, 480]]) if (value[name] !== undefined) {
    if (!Number.isInteger(value[name]) || value[name] < min || value[name] > max) throw Error(`Invalid ${name}`); config[name] = value[name];
  }
  for (const name of ['legacyDrawing', 'forceBgra']) if (value[name] !== undefined) config[name] = Boolean(value[name]);
  if (value.customCommand !== undefined) { if (typeof value.customCommand !== 'string' || value.customCommand.length > 8192) throw Error('Custom command is too long'); config.customCommand = value.customCommand; }
  await writeJson(file, config); return desktopStatus();
}
export function allowedRemovals(output, profile) {
  const removed = [...output.matchAll(/^Remv ([^ :]+)(?::[^ ]+)? /gm)].map(m => m[1]);
  const unexpected = removed.filter(name => !(profile.conflicts || []).includes(name));
  if (unexpected.length) throw Error('APT would also remove ' + unexpected.join(', ') + '. Keep the current profile or resolve those dependencies first.');
  return removed;
}
async function environment(profile) {
  const env = { ...profile.env };
  if (profile.id === 'turnip') {
    await fs.access('/dev/kgsl-3d0', fs.constants.R_OK | fs.constants.W_OK);
    const { stdout } = await exec('dpkg-query', ['-L', 'mesa-vulkan-icd-freedreno']);
    const icd = stdout.split('\n').find(name => /freedreno.*\.json$/.test(name));
    if (!icd) throw Error('The installed Turnip ICD could not be found'); env.VK_ICD_FILENAMES = icd;
  }
  if (profile.helper) env.VTEST_SOCKET_NAME = path.join(dataDir, 'run/virgl.sock');
  return env;
}
async function start(config, profile, probe = false) {
  const env = await environment(profile);
  if (profile.helper) {
    const { stdout, stderr } = await exec('virgl_test_server_android', ['--help'], { timeout: 10000 }).catch(error => ({ stdout: error.stdout || '', stderr: error.stderr || '' }));
    for (const flag of ['--socket-path', ...profile.helper]) if (!(stdout + stderr).includes(flag)) throw Error(`Installed VirGL does not support ${flag}`);
  }
  const spec = { ...config, profile: profile.id, helper: profile.helper, env, probe, display: probe ? 91 : config.display };
  await privateDir(path.join(dataDir, 'run'));
  await writeJson(path.join(dataDir, 'run/desktop-launch.json'), spec);
  const log = openSync(path.join(dataDir, 'desktop.log'), 'a', 0o600);
  const child = spawn(process.execPath, [runner], { detached: true, stdio: ['ignore', log, log], env: process.env });
  closeSync(log); child.unref();
  let failure; child.on('error', error => { failure = error; });
  await writeJson(processFile, { pid: child.pid, profile: profile.id, probe });
  for (let attempt = 0; attempt < 40; attempt++) {
    if (failure) throw failure;
    if (!await alive({ pid: child.pid })) throw Error('Desktop process exited; see desktop output');
    try {
      const result = await exec('glxinfo', ['-B'], { timeout: 3000, env: { ...process.env, ...env, DISPLAY: ':' + spec.display } });
      return { renderer: result.stdout, pid: child.pid };
    } catch { await sleep(250); }
  }
  throw Error('X11 did not become ready; see desktop output');
}
export async function stopDesktop() {
  requireTermux(); const info = await readJson(processFile, null);
  if (await alive(info)) {
    process.kill(-info.pid, 'SIGTERM');
    for (let i = 0; i < 50 && await alive(info); i++) await sleep(100);
    if (await alive(info)) process.kill(-info.pid, 'SIGKILL');
  }
  await fs.rm(processFile, { force: true });
}
export async function selectProfile(job, { profile: id }) {
  requireTermux(); const profile = profiles.find(p => p.id === id); if (!profile) throw Error('Unknown graphics profile');
  let config = await settings(); config.requested = id; await writeJson(file, config);
  let state = await installed(profile);
  if (!state.missing.length && config.probes?.[id]?.fingerprint === state.fingerprint) {
    config.confirmed = id; await writeJson(file, config); return;
  }
  while (await desktopRunning()) { await job.phase('Waiting for desktop stop', 'waiting'); await sleep(2000); }
  if (state.missing.length) {
    await job.phase('Checking graphics package changes');
    const choices = [];
    for (const name of state.missing) {
      const policy = await job.exec('apt-cache', ['policy', name]);
      const candidate = policy.match(/Candidate:\s+(\S+)/)?.[1];
      if (!candidate || candidate === '(none)') throw Error(`${name} is unavailable; refresh the Termux package lists`);
      await job.exec('dpkg', ['--compare-versions', candidate, 'ge', profile.packages[name]]);
      choices.push(name + '=' + candidate);
    }
    const simulation = await apt(job, ['-s', 'install', ...choices]); allowedRemovals(simulation, profile);
    // Clear readiness before replacement; failed transactions must not leave a tick.
    config.confirmed = null; await writeJson(file, config);
    await job.phase('Downloading graphics packages'); await apt(job, ['--download-only', '-y', 'install', ...choices]);
    await job.phase('Installing / configuring graphics packages'); await apt(job, ['-y', 'install', ...choices]);
  }
  state = await installed(profile); if (state.missing.length) throw Error('Graphics packages did not finish configuration');
  await job.phase('Checking the renderer');
  try {
    const result = await start(config, profile, true);
    if (!new RegExp(profile.renderer, 'i').test(result.renderer)) throw Error('The requested renderer is unavailable on this device');
    await job.log(result.renderer);
    // A real GL application must create a context and render on the prepared X server.
    const env = await environment(profile);
    await job.exec('timeout', ['3', 'glxgears', '-info'], { env: { ...env, DISPLAY: ':91' } }).catch(error => { if (!error.message.includes('(124)')) throw error; });
    config = await settings(); config.confirmed = id; config.probes ||= {};
    config.probes[id] = { fingerprint: state.fingerprint, renderer: result.renderer, verifiedAt: Date.now() };
    await writeJson(file, config);
  } finally { await stopDesktop(); }
}
export async function startDesktop() {
  requireTermux(); if (await desktopRunning()) return desktopStatus();
  const config = await settings(), status = await desktopStatus();
  if (!status.ready) throw Error('Select and prepare a graphics profile first');
  if (config.method === 'custom' && !config.customCommand.trim()) throw Error('Save a custom startup command first');
  try { await start(config, profiles.find(p => p.id === config.requested)); }
  catch (error) { await stopDesktop(); await writeJson(processFile, { error: error.message }); throw error; }
  return desktopStatus();
}
