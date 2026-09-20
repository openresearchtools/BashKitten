#!/usr/bin/env node
// One small local supervisor shared by the native hosts. Pi workers stay detached.
import http from 'node:http';
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { dataDir, sessionDir, privateDir, readJson, writeJson, json, jsonBody, socketRequest, workerRequest, socketPath, allMeta } from './common.mjs';
import { platform } from './platform/index.mjs';
import { nativeFile } from './platform/linux/files.mjs';
import { desktopStatus, saveDesktop, startDesktop, stopDesktop, selectProfile } from './platform/termux/desktop.mjs';
import { Jobs } from './updates/jobs.mjs';
import { installPi, rollbackPi, updateStatus, atIdle } from './updates/runtime.mjs';
import { bundledRoot, appUpdateFile } from './rpc/runtime.mjs';
import { checkPackages, updatePackages, recoverPackages, refreshApt, desktopPackages, apt, pairX11, packageInventory, configureTermux } from './platform/termux/packages.mjs';
import { deliverNotifications } from './platform/termux/notifications.mjs';
import { claimInstance, processStart, probeBackend, backendAlive, serverFile } from './instance.mjs';

export const controlSocket = path.join(dataDir, 'run/control.sock');
const stateFile = path.join(dataDir, 'control.json');
const script = fileURLToPath(import.meta.url);
const serverScript = fileURLToPath(new URL('./http/server.mjs', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function controlRequest(command, value) {
  for (let attempt = 0; ; attempt++) {
    try { return await socketRequest(controlSocket, '/' + command, value, 30000); }
    catch (error) {
      // A manager replacement can close an in-flight status connection. Never replay actions.
      if (command !== 'status' || attempt >= 10 || !['EPIPE', 'ECONNRESET', 'ECONNREFUSED', 'ENOENT'].includes(error.code)) throw error;
      await sleep(100);
    }
  }
}

async function owned(pid, marker) {
  if (!await processStart(pid)) return false;
  try {
    const command = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
    return command.includes(marker);
  } catch { return false; }
}

export async function ensureManager() {
  try { await socketRequest(controlSocket, '/status', undefined, 3000); return; } catch {}
  if (process.env.BASHKITTEN_NO_AUTOSTART === '1') throw Error('The Termux service is starting; reopen Apps if it does not become ready');
  await privateDir(path.dirname(controlSocket));
  const log = openSync(path.join(dataDir, 'control.log'), 'a', 0o600);
  const child = spawn(process.execPath, [script, 'serve'], { detached: true, stdio: ['ignore', log, log], env: process.env });
  closeSync(log); child.unref();
  let error; child.on('error', value => { error = value; });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (error) throw error;
    try { await socketRequest(controlSocket, '/status', undefined, 3000); return; } catch {}
    await sleep(100);
  }
  throw Error('Could not start local control service; see control.log');
}

async function serve() {
  process.umask(0o077);
  await privateDir(path.dirname(controlSocket));
  const lock = controlSocket + '.lock';
  const previous = await socketRequest(controlSocket, '/status', undefined, 3000).catch(() => null);
  if (previous?.manager && await processStart(previous.manager.pid)) {
    if (process.env.BASHKITTEN_ATTACHED_MANAGER !== '1' || previous.manager.attached) return;
    // Transfer a detached manager to Termux's foreground task without stopping Pi.
    if (['running', 'waiting'].includes(previous.packages?.job?.status)) { await sleep(2000); return serve(); }
    await controlRequest('shutdown', {});
    await sleep(200);
    return serve();
  }
  const ownership = await claimInstance('control');
  if (!ownership) {
    if (process.env.BASHKITTEN_ATTACHED_MANAGER === '1') { await sleep(200); return serve(); }
    return;
  }
  await fs.writeFile(lock, String(process.pid), { mode: 0o600 });
  await fs.rm(controlSocket, { force: true });
  let state = await readJson(stateFile, { web: true }), serial = Promise.resolve(), starting = false, lastError = null;
  let retryAt = 0, failures = 0;
  const manifestFile = path.join(bundledRoot, 'build-platform.json');
  const packageFile = (await readJson(manifestFile, null))?.installationStamp || manifestFile;
  const revision = (await readJson(packageFile, null))?.revision;
  const nodeStamp = async () => { const stat = await fs.stat(process.execPath); return `${stat.dev}:${stat.ino}:${stat.mtimeMs}`; };
  const initialNode = await nodeStamp();
  let restarting = false;
  const jobs = new Jobs({ 'finish-app-update': finishAppUpdate, 'prepare-app-update': prepareAppUpdate, 'reload-services': reloadServices, 'check-packages': checkPackages, 'update-packages': updatePackages, 'refresh-lists': async job => { const result = await refreshApt(job); if (result.error) throw Error(result.error); }, 'update-pi': installPi, 'rollback-pi': rollbackPi, 'recover-packages': recoverPackages, 'install-desktop': desktopPackages, 'graphics-profile': selectProfile });
  await jobs.init();
  async function web() {
    return probeBackend();
  }
  async function startWeb() {
    if (starting || await readJson(appUpdateFile, null) || await web()) return;
    starting = true;
    try {
      // Upgrade a pre-discovery backend before publishing a new endpoint.
      const previous = await readJson(serverFile, null);
      if (previous && !previous.token && await backendAlive(previous)) await stopWeb();
      const log = openSync(path.join(dataDir, 'server.log'), 'a', 0o600);
      const child = spawn(process.execPath, [serverScript], { stdio: ['ignore', log, log], env: process.env });
      closeSync(log);
      child.on('error', error => { lastError = error.message; });
      for (let i = 0; i < 100; i++) {
        if (await web()) { failures = 0; lastError = null; return; }
        if (child.exitCode !== null) break;
        await sleep(100);
      }
      throw Error('Backend did not become ready; see server.log');
    } catch (error) {
      lastError = error.message; retryAt = Date.now() + Math.min(60000, 1000 * 2 ** Math.min(++failures, 6));
      throw error;
    } finally { starting = false; }
  }
  async function stopWeb() {
    const info = await readJson(serverFile, null); if (!await backendAlive(info)) return;
    process.kill(info.pid, 'SIGTERM');
    for (let i = 0; i < 100 && await backendAlive(info); i++) await sleep(50);
    if (await backendAlive(info)) process.kill(info.pid, 'SIGKILL');
    for (let i = 0; i < 100 && await backendAlive(info); i++) await sleep(50);
    if (await backendAlive(info)) throw Error('Backend has not stopped yet');
  }
  async function status() {
    const info = await web();
    const sessions = await Promise.all((await allMeta()).map(async meta => {
      const current = await socketRequest(socketPath(meta.id), '/status', undefined, 1000).catch(() => null);
      return { id: meta.id, title: meta.title, cwd: meta.cwd, running: Boolean(current), ...current?.data };
    }));
    return { version: 1, platform, appUpdate: await readJson(appUpdateFile, null), manager: { pid: process.pid, revision, attached: process.env.BASHKITTEN_ATTACHED_MANAGER === '1' }, desktop: platform === 'termux' ? await desktopStatus() : undefined, packages: { ...await updateStatus(), job: await jobs.status() }, web: { status: info ? 'running' : starting ? 'starting' : lastError ? 'error' : 'stopped', desired: state.web, url: info?.url, error: lastError }, sessions };
  }
  async function prepareAppUpdate(job, input) {
    await atIdle(job, async () => {
      await job.phase('Pausing services for Android installation');
      await stopWeb();
      for (const meta of await allMeta()) await socketRequest(socketPath(meta.id), '/shutdown', { restart: true }, 10000).catch(error => {
        if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error;
      });
      await writeJson(appUpdateFile, { packageId: input.packageId, ready: true, createdAt: Date.now() });
      if (job.job.cancelRequested) { await fs.rm(appUpdateFile, { force: true }); job.checkCancellation(); }
    }, { desktop: true });
  }
  async function finishAppUpdate(job, input) {
    if (input.packageId === 'com.termux.x11' && input.installed) await pairX11(job, input.companionVersion);
    await fs.rm(appUpdateFile, { force: true });
  }
  async function reloadServices(job) {
    if (platform === 'termux') await apt(job, ['check']); // Respect an external APT transaction too.
    await atIdle(job, async () => {
      await job.phase('Reloading updated BashKitten / Node');
      await stopWeb();
      for (const meta of await allMeta()) await socketRequest(socketPath(meta.id), '/shutdown', { restart: true }, 10000).catch(error => {
        if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error;
      });
      // Preserve native sessions and intentional stops; new workers load updated code.
      restarting = true;
    }, { desktop: true });
  }
  async function reconcilePackage() {
    if (jobs.busy || await readJson(appUpdateFile, null)) return;
    if (restarting) {
      clearInterval(monitor);
      await new Promise(resolve => server.close(resolve));
      await fs.rm(lock, { force: true });
      if (process.env.BASHKITTEN_ATTACHED_MANAGER === '1') process.exit(75);
      const log = openSync(path.join(dataDir, 'control.log'), 'a', 0o600);
      const child = spawn(process.execPath, [script, 'serve'], { detached: true, stdio: ['ignore', log, log], env: process.env });
      closeSync(log); child.unref();
      child.once('error', error => { console.error(error); process.exit(1); });
      child.once('spawn', () => process.exit(0));
      return;
    }
    const next = (await readJson(packageFile, null))?.revision;
    if ((next && next !== revision) || initialNode !== await nodeStamp()) await jobs.start('reload-services');
  }
  async function stopPi(id, force) {
    const meta = (await allMeta()).find(item => item.id === id);
    if (!meta) throw Error('Session not found');
    await writeJson(path.join(sessionDir(id), 'lifecycle.json'), { stopped: true });
    // Ask the owner to checkpoint drafts and shut down its native Pi child.
    try { await socketRequest(socketPath(id), '/shutdown', {}, force ? 1000 : 10000); return; }
    catch (error) { if (!force && !['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; }
    if (force) {
      const pid = Number(await fs.readFile(socketPath(id) + '.lock', 'utf8').catch(() => '0'));
      const workerScript = fileURLToPath(new URL('./rpc/worker.mjs', import.meta.url));
      if (await owned(pid, workerScript) && await owned(pid, id)) process.kill(-pid, 'SIGKILL');
    }
  }
  async function action(command, value) {
    if (command === 'status') return status();
    if (command === 'package-inventory') return packageInventory();
    if (command === 'termux-source') { await configureTermux(value); return status(); }
    if (command === 'app-update-finish') {
      const held = await readJson(appUpdateFile, null);
      if (held && held.packageId !== value.packageId) throw Error('Another Android installation owns the service pause');
      if (jobs.busy && jobs.job.kind === 'prepare-app-update') { await jobs.cancel(); return status(); }
      if (held && value.packageId === 'com.termux.x11' && value.installed) {
        await jobs.start('finish-app-update', value, jobs.job?.kind === 'finish-app-update' && ['failed', 'interrupted', 'cancelled'].includes(jobs.job.status));
      } else await fs.rm(appUpdateFile, { force: true });
      return status();
    }
    if (command === 'app-update-prepare') {
      if (!/^com\.termux(?:\.(api|x11|boot|widget|styling|window|tasker))?$/.test(value.packageId)) throw Error('Unsupported Android package');
      const held = await readJson(appUpdateFile, null);
      if (held) {
        if (held.packageId !== value.packageId) throw Error('Another Android installation owns the service pause');
      } else await jobs.start('prepare-app-update', { packageId: value.packageId });
      return status();
    }
    if (command === 'package-job' && value.retry && jobs.job?.kind === 'finish-app-update') { await jobs.start(jobs.job.kind, jobs.job.input, true); return status(); }
    if (await readJson(appUpdateFile, null) && !['stop', 'pi-abort', 'pi-stop', 'pi-kill', 'desktop-stop', 'shutdown'].includes(command)) throw Error('Finish or cancel the Android installation before starting work');
    if (jobs.busy && jobs.job.kind === 'prepare-app-update' && ['start', 'restart', 'desktop-start'].includes(command)) throw Error('Waiting for Android installation');
    if (command === 'package-cancel') { await jobs.cancel(); return status(); }
    if (command === 'package-job') {
      const current = await jobs.status();
      await jobs.start(value.retry ? current?.kind : value.kind, value.retry ? current?.input : value.input || {}, Boolean(value.retry));
      return status();
    }
    if (command === 'desktop-settings') { await saveDesktop(value); }
    else if (command === 'desktop-start') { if (jobs.busy) throw Error('Wait for package preparation to finish'); await startDesktop(); }
    else if (command === 'desktop-stop') { await stopDesktop(); }
    else if (['start', 'stop', 'restart'].includes(command)) {
      state.web = command !== 'stop'; await writeJson(stateFile, state);
      if (command !== 'start') await stopWeb();
      if (state.web) await startWeb();
    } else if (command === 'pi-abort') {
      if (!(await allMeta()).some(meta => meta.id === value.id)) throw Error('Session not found');
      await socketRequest(socketPath(value.id), '/stop', {}, 10000);
    } else if (command === 'pi-stop' || command === 'pi-kill') {
      const ids = value?.id ? [value.id] : (await allMeta()).map(meta => meta.id);
      for (const id of ids) await stopPi(id, command === 'pi-kill');
    } else if (command === 'native-file') {
      if (platform !== 'linux') throw Error('Native file opening is only available on Linux');
      return nativeFile(value);
    } else if (command === 'project-root') {
      if (platform !== 'linux') throw Error('Additional roots are only supported on Linux');
      const root = await fs.realpath(value.path);
      if (!(await fs.stat(root)).isDirectory()) throw Error('Choose a directory');
      await fs.access(root, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
      const file = path.join(dataDir, 'project-roots.json'), roots = await readJson(file, []);
      if (!roots.includes(root)) await writeJson(file, [...roots, root]);
      return { path: root };
    } else if (command === 'shutdown') {
      if (jobs.busy) throw Error('Wait for package maintenance to finish before stopping the manager');
      jsonShutdown(); return { ok: true };
    } else throw Error('Unknown control command');
    return status();
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/status') return json(res, await status());
      if (req.method !== 'POST') throw Error('Use POST for control actions');
      const value = await jsonBody(req);
      const operation = serial.then(() => action(req.url.slice(1), value));
      serial = operation.catch(() => {});
      json(res, await operation);
    } catch (error) { json(res, { error: error.message }, 400); }
  });
  function jsonShutdown() { if (jobs.busy) return; setTimeout(async () => { clearInterval(monitor); await fs.rm(lock, { force: true }); server.close(() => process.exit(0)); }, 50); }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(controlSocket, resolve); });
  await fs.chmod(controlSocket, 0o600);
  const monitor = setInterval(() => {
    const operation = serial.then(async () => {
      await reconcilePackage();
      if (!restarting && !(jobs.busy && ['reload-services', 'prepare-app-update'].includes(jobs.job.kind)) && state.web && Date.now() > retryAt) await startWeb();
    });
    serial = operation.catch(() => {});
  }, 2000);
  setInterval(() => deliverNotifications().catch(() => {}), 30000).unref();
  process.on('SIGTERM', jsonShutdown);
  if (state.web) await startWeb().catch(() => {});
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const command = process.argv[2] || 'status';
  if (command === 'serve') await serve();
  else {
    try {
      await ensureManager();
      const value = process.argv[3] ? JSON.parse(process.argv[3]) : {};
      console.log(JSON.stringify(await controlRequest(command, command === 'status' ? undefined : value)));
    } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
  }
}
