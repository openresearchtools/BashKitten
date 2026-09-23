#!/usr/bin/env node
// One private controller owns Agent. Linux may bind it to its native browser;
// Termux and an explicit standalone CLI keep their independent lifetime.
import http from 'node:http';
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { dataDir, sessionDir, privateDir, readMeta, readJson, writeJson, json, jsonBody, socketRequest, socketPath, allMeta, body } from './common.mjs';
import { platform } from './platform/index.mjs';
import { nativeFile } from './platform/linux/files.mjs';
import { Jobs } from './updates/jobs.mjs';
import { installPi, rollbackPi, updateStatus, atIdle } from './updates/runtime.mjs';
import { bundledRoot } from './rpc/runtime.mjs';
import { checkPackages, updatePackages, recoverPackages, refreshApt, apt, packageInventory } from './platform/termux/packages.mjs';
import { pendingNotifications, acknowledgeNotifications, notificationSettings } from './rpc/notifications.mjs';
import { claimInstance, processStart } from './instance.mjs';
import { ensureIntegration } from './rpc/integration.mjs';
import { AccessStack } from './access/stack.mjs';
import { RemoteAccess } from './access/remote.mjs';
import { paths, binary } from './access/paths.mjs';
import { acquireWake, releaseWake } from './access/wake.mjs';
import { enrollAccount, completeAccount } from './access/accounts.mjs';
import { managedLlamaStatus, startManagedLlama, stopManagedLlama, configureManagedLlama, subscribeManagedLlama, llamaRuntimeOptions, installLlamaRuntime, probeLlamaEndpoint, readManagedLlamaConnection, waitForManagedLlamaReady, refreshManagedLlama } from './platform/linux/llama.mjs';
import { syncManagedLlamaProvider } from './platform/linux/llama-provider.mjs';

export const controlSocket = path.join(dataDir, 'run/control.sock');
const stateFile = path.join(dataDir, 'control.json');
const script = fileURLToPath(import.meta.url);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function controlRequest(command, value) {
  const deadline = Date.now() + 120000;
  for (let attempt = 0; ; attempt++) {
    try { return await socketRequest(controlSocket, '/' + command, value, command === 'start' || command === 'restart' ? 120000 : 30000); }
    catch (error) {
      // A fresh launch can reach the old controller after its status reply but
      // before shutdown finishes. Retry rejected starts or failed connections,
      // never an operation whose response was lost after connecting.
      if (command === 'start' && ['AGENT_SHUTTING_DOWN', 'ENOENT', 'ECONNREFUSED'].includes(error.code) && Date.now() < deadline) {
        await ensureManager({ waitForShutdown: true });
        continue;
      }
      if (command !== 'status' || attempt >= 10 || !['EPIPE', 'ECONNRESET', 'ECONNREFUSED', 'ENOENT'].includes(error.code)) throw error;
      await sleep(100);
    }
  }
}
function spawnManager(detached) {
  const log = detached ? openSync(path.join(dataDir, 'control.log'), 'a', 0o600) : null;
  const child = spawn(binary('runtime-guard'), [process.execPath, script, 'serve'], {
    detached, stdio: detached ? ['ignore', log, log] : 'inherit',
    env: { ...process.env, BASHKITTEN_TERMUX: platform === 'termux' ? '1' : '0' },
  });
  if (log !== null) closeSync(log);
  return child;
}
export async function ensureManager({ waitForShutdown = false } = {}) {
  await privateDir(path.dirname(controlSocket));
  let child, error, draining = false;
  for (const deadline = Date.now() + 30000; Date.now() < deadline;) {
    if (error) throw error;
    try {
      const existing = await socketRequest(controlSocket, '/status', undefined, 3000);
      draining = existing.manager?.exiting || waitForShutdown && existing.web?.status === 'stopping';
      if (!draining) return;
    } catch (failure) {
      if (!['EPIPE', 'ECONNRESET', 'ECONNREFUSED', 'ENOENT'].includes(failure.code)) throw failure;
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        child = spawnManager(true); child.unref();
        child.on('error', value => { error = value; });
      }
    }
    await sleep(100);
  }
  throw Error(draining ? 'Agent is still completing shutdown; retry Turn on' : 'Could not start Agent controller; see control.log');
}
async function ownedWorker(id) {
  const pid = Number(await fs.readFile(socketPath(id) + '.lock', 'utf8').catch(() => '0'));
  const started = await processStart(pid);
  if (!started) return null;
  const worker = fileURLToPath(new URL('./rpc/worker.mjs', import.meta.url));
  const args = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')).split('\0');
  const owner = (await readMeta(id)).workerOwner || id;
  return args.includes(worker) && args.includes(owner) ? { pid, started } : null;
}
async function stopPi(id, force = false, markStopped = true) {
  await readMeta(id);
  if (markStopped) await writeJson(path.join(sessionDir(id), 'lifecycle.json'), { stopped: true });
  const owned = await ownedWorker(id);
  try { await socketRequest(socketPath(id), '/shutdown', { restart: !markStopped }, force ? 1000 : 10000); }
  catch (error) { if (!force && !['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; }
  if (!owned) return;
  for (let i = 0; i < 40 && await processStart(owned.pid) === owned.started; i++) await sleep(50);
  if (await processStart(owned.pid) === owned.started) process.kill(-owned.pid, 'SIGKILL');
}
async function serve() {
  process.umask(0o077);
  await privateDir(path.dirname(controlSocket));
  const ownership = await claimInstance('control');
  if (!ownership) return;
  await fs.rm(controlSocket, { force: true });
  const lock = controlSocket + '.lock';
  await fs.writeFile(lock, String(process.pid), { mode: 0o600 });
  let state = await readJson(stateFile, { web: false }), serial = Promise.resolve();
  let starting = false, stopping = false, lastError = state.error || null, restartPending = false, exiting = false;
  let browserOwner = null, browserWatcher = null, browserClosing = false;
  const manifestFile = path.join(bundledRoot, 'build-platform.json');
  const packageFile = (await readJson(manifestFile, null))?.installationStamp || manifestFile;
  const revision = (await readJson(packageFile, null))?.revision;
  const initialNode = (await fs.stat(process.execPath)).ino;
  const remote = new RemoteAccess({ llama: async () => {
    if (platform !== 'linux' || managedLlamaStatus().state !== 'ready') return null;
    const value = await readManagedLlamaConnection();
    return { upstream: new URL(value.url).host, bearerToken: value.apiKey };
  } });
  const stack = new AccessStack({
    fatal: error => { lastError = error.message; serial = serial.then(() => turnOff(error.message)).catch(error => { lastError = error.message; }); },
    llamaProxy: () => remote.llamaProxy(),
  });
  stack.remote = remote; remote.stack = stack;
  const jobs = new Jobs({ 'reload-services': reloadServices, 'check-packages': checkPackages, 'update-packages': updatePackages,
    'refresh-lists': async job => { const result = await refreshApt(job); if (result.error) throw Error(result.error); },
    'update-pi': installPi, 'rollback-pi': rollbackPi, 'recover-packages': recoverPackages,
    ...(platform === 'linux' ? { 'llama-runtime': installLlamaRuntime } : {}),
  });
  await jobs.init();
  await ensureIntegration();
  if (platform === 'linux') subscribeManagedLlama(current => {
    serial = serial.then(async () => { await syncManagedLlamaProvider(current); await stack.reload(); }).catch(error => { lastError = error.message; });
  });
  async function persist() { await writeJson(stateFile, { ...state, error: lastError }); }
  async function adoptBrowser(value) {
    if (platform !== 'linux') throw Error('Browser-owned Agent is only available on Linux');
    if (!Number.isInteger(value?.pid) || value.pid < 2 || !/^[1-9][0-9]*$/.test(value.started || '')) throw Error('Invalid browser process identity');
    if (browserClosing) throw Error('The previous browser is stopping Agent; retry Turn on');
    if (browserOwner) {
      if (browserOwner.pid !== value.pid || browserOwner.started !== value.started) throw Error('Agent is already owned by another browser process');
      return;
    }
    if (await processStart(value.pid) !== value.started || (await fs.stat(`/proc/${value.pid}`)).uid !== process.getuid()) throw Error('The browser process is no longer running');
    const child = spawn(binary('runtime-guard'), ['wait-owner', String(value.pid), value.started], { stdio: ['ignore', 'pipe', 'inherit'] });
    browserWatcher = child;
    const closed = error => {
      if (browserWatcher !== child || exiting) return;
      browserWatcher = null; browserClosing = true;
      serial = serial.then(async () => { await turnOff(error); if (!stopping) scheduleExit(); }).catch(error => { lastError = error.message; });
    };
    child.once('exit', code => closed(code === 0 ? null : 'Browser lifetime tracking stopped'));
    child.once('error', error => closed(error.message));
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(Error('Could not track the browser process')), 5000);
        let output = '';
        const finish = (error) => {
          clearTimeout(timer);
          child.stdout.removeListener('data', data);
          child.removeListener('exit', earlyExit);
          child.removeListener('error', finish);
          error ? reject(error) : resolve();
        };
        const data = bytes => {
          output += bytes;
          if (output === 'ready\n') finish();
          else if (output.length > 64 || output.includes('\n')) finish(Error('Invalid browser lifetime tracker response'));
        };
        const earlyExit = () => finish(Error('The browser lifetime tracker could not start'));
        child.stdout.on('data', data);
        child.once('exit', earlyExit);
        child.once('error', finish);
      });
      if (browserClosing || await processStart(value.pid) !== value.started) throw Error('The browser process is no longer running');
      browserOwner = { pid: value.pid, started: value.started };
    } catch (error) {
      browserClosing = true;
      child.kill('SIGTERM');
      throw error;
    }
  }
  async function startWeb() {
    if (starting || stopping || stack.ready) return;
    starting = true; lastError = null;
    try {
      await acquireWake();
      await stack.start();
      if (platform === 'linux') await startManagedLlama();
    } catch (error) {
      lastError = error.message; state.web = false;
      await stopGroup().catch(failure => { lastError += '; ' + failure.message; });
      await persist(); throw error;
    } finally { starting = false; }
  }
  async function stopWorkers() {
    const workers = await Promise.allSettled((await allMeta()).map(meta => stopPi(meta.id, false, false).catch(() => stopPi(meta.id, true, false))));
    const failure = workers.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
  async function stopGroup() {
    await stack.stopIngress();
    // Complete the rest of group cleanup even if a worker needs the guard's
    // final descendant cleanup.
    const workerError = await stopWorkers().then(() => null, error => error);
    if (platform === 'linux') await stopManagedLlama();
    await stack.stop();
    await releaseWake();
    if (workerError) throw workerError;
  }
  async function turnOff(error = null) {
    state.web = false; stopping = true;
    if (error) lastError = error;
    await persist();
    await stack.stopIngress();
    try {
      // Stop Pi now while an existing package transaction finishes safely.
      // Cancellation lets the current native package step finish.
      if (jobs.busy) { await jobs.cancel(); await stopWorkers(); return; }
      await stopGroup(); stopping = false; await persist();
    }
    catch (failure) { lastError = failure.message; await persist(); throw failure; }
  }
  async function status() {
    const sessions = await Promise.all((await allMeta()).map(async meta => {
      const current = await socketRequest(socketPath(meta.id), '/status', undefined, 1000).catch(() => null);
      return { id: meta.id, title: meta.title, cwd: meta.cwd, running: Boolean(current), ...current?.data };
    }));
    return { version: 2, platform, manager: { pid: process.pid, revision, exiting, browserOwner, attached: process.env.BASHKITTEN_ATTACHED_MANAGER === '1' },
      packages: { ...await updateStatus(), job: await jobs.status() },
      web: { status: stopping ? 'stopping' : starting || stack.reconfiguring ? 'starting' : stack.ready ? 'running' : lastError ? 'error' : 'stopped',
        desired: state.web, url: stack.ready || stack.reconfiguring ? stack.origin : undefined, error: lastError, ...await stack.status() },
      ...(platform === 'linux' ? { llama: managedLlamaStatus() } : {}), sessions };
  }
  async function reloadServices(job) {
    if (platform === 'termux') await apt(job, ['check']);
    await atIdle(job, async () => {
      await job.phase('Reloading updated BashKitten / Node');
      await stopGroup(); restartPending = true;
    });
  }
  async function action(command, value = {}) {
    if (command === 'status') return status();
    if (exiting) throw Object.assign(Error('Agent controller is completing shutdown; retry Turn on'), { code: 'AGENT_SHUTTING_DOWN' });
    if (command === 'browser-shutdown') {
      if (!browserOwner || browserOwner.pid !== value.browserOwner?.pid || browserOwner.started !== value.browserOwner?.started) throw Error('This browser does not own the local Agent');
      browserClosing = true;
      await turnOff(); if (!stopping) scheduleExit();
      return status();
    }
    if (command === 'get_remote_access') return remote.status();
    if (command === 'set_remote_access') return remote.setEnabled(value.enabled);
    if (command === 'create_remote_connection') return remote.create(value);
    if (command === 'revoke_remote_connection') return remote.revoke(value.id);
    if (command === 'get_hosted_services') return stack.hosting.status({ refresh: value.refresh === true });
    if (command === 'save_hosted_service') return stack.hosting.save(value);
    if (command === 'delete_hosted_service') return stack.hosting.remove(value);
    if (command === 'hosting-client') return remote.hostingClient();
    if (command === 'package-inventory') return packageInventory();
    if (command === 'notifications') return { notifications: await pendingNotifications() };
    if (command === 'notification-settings') return notificationSettings(value.settings);
    if (command === 'notifications-ack') { await acknowledgeNotifications(value.keys); return { ok: true }; }
    if (command === 'account-totp') return completeAccount(value);
    if (['account-create', 'account-enroll', 'account-reset-totp'].includes(command)) {
      if (!stack.ready) throw Error('Turn on Agent before account setup');
      return enrollAccount(stack.origin, value, { create: command === 'account-create', reset: command === 'account-reset-totp' });
    }
    if (command === 'package-cancel') { await jobs.cancel(); return status(); }
    if (command === 'package-job') {
      if (stopping) throw Error('Agent is stopping');
      const current = await jobs.status();
      await jobs.start(value.retry ? current?.kind : value.kind, value.retry ? current?.input : value.input || {}, Boolean(value.retry));
    } else if (['start', 'stop', 'restart', 'shutdown'].includes(command)) {
      if (command === 'stop' || command === 'shutdown') { await turnOff(); if (!stopping) scheduleExit(); }
      else {
        if (browserClosing || stopping) throw Object.assign(Error('Agent is completing shutdown'), { code: 'AGENT_SHUTTING_DOWN' });
        if (jobs.busy && command === 'restart') throw Error('Wait for package maintenance to finish');
        if (value.browserOwner) await adoptBrowser(value.browserOwner);
        if (command === 'restart') await stopGroup();
        state.web = true; lastError = null; await persist(); await startWeb();
      }
    } else if (command === 'pi-abort') {
      if (!(await allMeta()).some(meta => meta.id === value.id)) throw Error('Session not found');
      await socketRequest(socketPath(value.id), '/stop', {}, 10000);
    } else if (command === 'pi-stop' || command === 'pi-kill') {
      for (const id of value.id ? [value.id] : (await allMeta()).map(meta => meta.id)) await stopPi(id, command === 'pi-kill');
    } else if (command.startsWith('llama-')) {
      if (platform !== 'linux') throw Error('Managed llama.cpp is available on Linux');
      if (command === 'llama-options') return llamaRuntimeOptions();
      if (command === 'llama-probe') return probeLlamaEndpoint(value);
      if (command === 'llama-refresh') {
        if (!value.onlyIfRunning || managedLlamaStatus().desired) await refreshManagedLlama();
        return status();
      }
      if (command === 'llama-configure') await configureManagedLlama(value.config || value);
      else if (command === 'llama-start' || command === 'llama-stop') await configureManagedLlama({ enabled: command === 'llama-start' });
      else throw Error('Unknown llama.cpp control');
      if (command === 'llama-stop') await stopManagedLlama();
      else if (stack.ready) await startManagedLlama();
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
    } else throw Error('Unknown control command');
    return status();
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/status') return json(res, await status());
      if (req.method !== 'POST') throw Error('Use POST for control actions');
      const value = await jsonBody(req);
      if (req.url === '/llama-wait') {
        if (platform !== 'linux' || !state.web || stopping) throw Error('Local llama.cpp is unavailable while Agent is off');
        const connection = await waitForManagedLlamaReady({ model: value.model, timeout: 15 * 60 * 1000 });
        const current = managedLlamaStatus();
        await syncManagedLlamaProvider(current);
        return json(res, { ...current, state: 'ready', model: connection.model, url: connection.url });
      }
      const operation = serial.then(() => action(req.url.slice(1), value)); serial = operation.catch(() => {});
      json(res, await operation);
    } catch (error) { json(res, { error: error.message, code: error.code }, 400); }
  });
  function scheduleExit() {
    if (exiting) return; exiting = true;
    setTimeout(async () => {
      clearInterval(monitor);
      browserWatcher?.kill('SIGTERM'); browserWatcher = null;
      await fs.rm(lock, { force: true });
      server.close(() => { ownership.close(); process.exit(0); });
    }, 100).unref();
  }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(controlSocket, resolve); });
  await fs.chmod(controlSocket, 0o600);
  let failedHealth = 0;
  const monitor = setInterval(() => {
    serial = serial.then(async () => {
      if (stopping && !jobs.busy) { await turnOff(); if (!stopping) scheduleExit(); return; }
      if (!stopping && stack.ready) {
        failedHealth = await stack.healthy() ? 0 : failedHealth + 1;
        if (failedHealth >= 2) { await turnOff('Agent service health check failed'); return; }
      }
      if (jobs.busy || stopping) return;
      if (restartPending) {
        if (state.web) await startWeb();
        restartPending = false;
      }
      const next = (await readJson(packageFile, null))?.revision;
      if ((next && next !== revision) || initialNode !== (await fs.stat(process.execPath)).ino) {
        // The next explicit launch loads the updated controller too; reload children now.
        if (!jobs.job || jobs.job.kind !== 'reload-services' || jobs.job.status !== 'complete') await jobs.start('reload-services');
      }
    }).catch(error => { lastError = error.message; });
  }, 3000);
  process.on('SIGTERM', () => { serial = serial.then(async () => { await turnOff(); if (!stopping) scheduleExit(); }).catch(error => { lastError = error.message; }); });
  process.on('SIGINT', () => process.emit('SIGTERM'));
  if (state.web) await startWeb().catch(() => {});
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const command = process.argv[2] || 'status';
  if (command === 'serve') {
    if (process.env.BASHKITTEN_GUARDED === '1' && Number(process.env.BASHKITTEN_GUARD_PID) === process.ppid) await serve();
    else {
      await privateDir(dataDir);
      const child = spawnManager(false);
      child.once('error', error => { console.error(error.message); process.exitCode = 1; });
      child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
    }
  } else {
    try {
      const input = process.argv[3];
      const value = input === '-' || input === '--stdin' ? JSON.parse((await body(process.stdin, 65536)).toString() || '{}') : input ? JSON.parse(input) : {};
      if (command !== 'browser-shutdown') await ensureManager();
      const result = await controlRequest(command, command === 'status' ? undefined : value).catch(error => {
        if (command === 'browser-shutdown' && ['ENOENT', 'ECONNREFUSED'].includes(error.code)) return { web: { status: 'stopped' } };
        throw error;
      });
      console.log(JSON.stringify(result));
    } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
  }
}
