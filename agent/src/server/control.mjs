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
import { LocalAI } from './localai/localai.mjs';
import { curatedModels, downloadPreset } from './localai/models.mjs';
import { downloadsStatus, searchModels, modelRepository, startDownload, controlDownload, shutdownDownloads, resumeDownloads, setDownloadCompleteHandler } from './models/downloads.mjs';
import { saveModelSettings } from './models/settings.mjs';
import { importRemoteProvider } from './rpc/managed-provider.mjs';
import { WorkloadPerformance, performanceUnavailable } from './performance.mjs';

export const controlSocket = paths.control;
const stateFile = path.join(dataDir, 'control.json');
const script = fileURLToPath(import.meta.url);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function controlRequest(command, value) {
  const deadline = Date.now() + 120000;
  for (let attempt = 0; ; attempt++) {
    try { return await socketRequest(controlSocket, '/' + command, value, command === 'whisper-acquire' ? 0 : command === 'start' || command === 'restart' || command.startsWith('share-') ? 180000 : 30000); }
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
  let state;
  try { state = await readJson(stateFile, { web: false }); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // This file records desired power state, not credentials or sessions. Keep
    // the damaged file and let an explicit start recover after a power failure.
    await fs.rename(stateFile, stateFile + `.corrupt-${Date.now()}`);
    state = { web: false };
    await writeJson(stateFile, state);
    console.error('Recovered invalid controller power state; preserved the damaged control.json');
  }
  let serial = Promise.resolve();
  let starting = false, stopping = false, lastError = state.error || null, restartPending = false, exiting = false;
  let browserOwner = null, browserWatcher = null, browserClosing = false;
  // The existing subreaper owns all launched workloads, including detached Pi
  // workers and router/model children; unrelated Termux/Pi processes are outside it.
  const performance = new WorkloadPerformance({ pid: process.ppid, started: await processStart(process.ppid) });
  const manifestFile = path.join(bundledRoot, 'build-platform.json');
  const packageFile = (await readJson(manifestFile, null))?.installationStamp || manifestFile;
  const revision = (await readJson(packageFile, null))?.revision;
  const initialNode = (await fs.stat(process.execPath)).ino;
  const remote = new RemoteAccess({ schedule: operation => {
    const pending = serial.then(operation); serial = pending.catch(() => {}); return pending;
  } });
  const stack = new AccessStack({
    fatal: error => { lastError = error.message; serial = serial.then(() => turnOff(error.message)).catch(error => { lastError = error.message; }); },
  });
  // The Display CLI imports this controller; load its implementation only in the manager.
  const display = platform === 'termux' ? new (await import('./platform/termux/display.mjs')).TermuxDisplay() : null;
  const localAI = new LocalAI(stack.services);
  if (localAI) await localAI.initialize();
  setDownloadCompleteHandler(() => localAI?.importProvider());
  stack.remote = remote; remote.stack = stack;
  const jobs = new Jobs({ 'reload-services': reloadServices, 'check-packages': checkPackages, 'update-packages': updatePackages,
    'refresh-lists': async job => { const result = await refreshApt(job); if (result.error) throw Error(result.error); },
    'update-pi': installPi, 'rollback-pi': rollbackPi, 'recover-packages': recoverPackages,
    ...(localAI ? { 'localai-runtime': (job, input) => localAI.install(job, input), 'localai-quantize': (job, input) => localAI.quantize(job, input) } : {}),
  });
  await jobs.init();
  await ensureIntegration();
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
      resumeDownloads();
      await stack.start();
      await stack.services.startup();
      if (localAI) { await localAI.startup(); await localAI.importProvider(); }
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
    const displayError = display ? await display.stop().then(() => null, error => error) : null;
    const speechError = await localAI?.shutdown().then(() => null, error => error);
    const serviceError = await stack.services.stopAll().then(() => null, error => error);
    await shutdownDownloads();
    await stack.stop();
    await releaseWake();
    if (workerError) throw workerError;
    if (displayError) throw displayError;
    if (speechError) throw speechError;
    if (serviceError) throw serviceError;
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
      sessions };
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
    if (command === 'local-session') {
      if (!stack.ready) throw Error('Turn on Agent before connecting');
      return { url: stack.origin, identity: stack.identity, generation: stack.localGeneration,
        cookie: { name: stack.localCookieName, value: stack.localToken } };
    }
    // Private native IPC only; none of these commands is forwarded by the web API.
    if (command === 'remote-pi-import') return importRemoteProvider(value);
    if (command.startsWith('display-')) {
      if (!display) throw Error('Display is available only in local Termux');
      if (command === 'display-status') return display.status();
      if (command === 'display-save') return display.save(value);
      if (command === 'display-stop') return display.stop();
      if (command !== 'display-start') throw Error('Unknown display action');
      if (!stack.ready || stopping) throw Error('Turn on the local Agent before starting Display');
      return display.start();
    }
    if (command.startsWith('localai-')) {
      if (command === 'localai-status') { const job = await jobs.status(); return { ...await localAI.status(), job: ['localai-runtime', 'localai-quantize'].includes(job?.kind) ? job : null }; }
      if (command === 'localai-save') return localAI.save(value);
      if (command === 'localai-model-use') return localAI.useModel(value);
      if (command === 'localai-synthesize') { if (!stack.ready || stopping) throw Error('Turn on Local before generating speech'); return localAI.synthesize(value); }
      if (command === 'localai-synthesis-cancel') return localAI.cancelSynthesis();
      if (command === 'localai-ini') return localAI.ini(value);
      if (command === 'localai-check') return localAI.check(value.engine);
      if (command === 'localai-install') { if (stopping) throw Error('Agent is stopping'); return jobs.start('localai-runtime', { engine: value.engine }); }
      if (command === 'localai-quantize') { if (!stack.ready || stopping) throw Error('Turn on Local before quantizing a model'); return jobs.start('localai-quantize', value); }
      if (command === 'localai-cancel') { if (!['localai-runtime', 'localai-quantize'].includes((await jobs.status())?.kind)) throw Error('No LocalAI operation is active'); await jobs.cancel(); return jobs.status(); }
      if (command === 'localai-share') return localAI.share(value.enabled);
      if (command === 'localai-action') {
        if (!stack.ready || stopping) throw Error('Turn on Local before starting an engine');
        return localAI.action(value.engine, value.action);
      }
      if (command === 'localai-refresh') { await localAI.importProvider(); return localAI.status(); }
      throw Error('Unknown LocalAI action');
    }
    if (command.startsWith('native-models-')) {
      if (command === 'native-models-catalogue') return curatedModels();
      if (command === 'native-models-preset') return downloadPreset(value.id);
      if (command === 'native-models-status') return downloadsStatus();
      if (command === 'native-models-settings') return saveModelSettings(value);
      if (command === 'native-models-search') return searchModels(value);
      if (command === 'native-models-repository') return modelRepository(value);
      if (command === 'native-models-download') return startDownload(value);
      if (command === 'native-models-action') return controlDownload(value.id, value.action);
      throw Error('Unknown model action');
    }
    if (command === 'whisper-capability') return localAI ? localAI.speechCapability() : { available: false };
    if (command === 'whisper-release') { await localAI?.releaseSpeech(value.id, value.completed === true); return { ok: true }; }
    if (command === 'share-status') return remote.status();
    if (command === 'share-setup') return remote.begin(value);
    if (command === 'share-reissue') return remote.begin(value, { reissue: true });
    if (command === 'share-confirm') return remote.confirm(value);
    if (command === 'share-cancel') return remote.cancelSetup(value);
    if (command === 'share-publish') return remote.setEnabled(value.enabled);
    if (command === 'share-files') return remote.setFileManager(value.allowed);
    if (command === 'service-status') return stack.services.status();
    if (command === 'service-save') return stack.services.save(value);
    if (command === 'service-remove') return stack.services.remove(value);
    if (command === 'service-action') {
      if (!stack.ready || stopping) throw Error('Turn on Local before controlling a service');
      if (localAI && value.id === 'localai-llama') { await localAI.action('llama', value.action); return stack.services.status(); }
      return stack.services.action(value);
    }
    if (command === 'remote-services' || command === 'remote-service-action') {
      const published = await remote.state();
      if (!stack.ready || stopping || !stack.tunnelStarted || !published.enabled || published.id !== value.generation) throw Error('Remote services are not available');
      if (command === 'remote-services') return stack.services.status({ remote: true });
      if (localAI && value.id === 'localai-llama') {
        if (!(await stack.services.entries()).some(entry => entry.id === value.id && entry.enabled)) throw Error('Service is not available');
        await localAI.action('llama', value.action); return stack.services.status({ remote: true });
      }
      return stack.services.action(value, { remote: true });
    }
    if (command === 'package-inventory') return packageInventory();
    if (command === 'notifications') return { notifications: await pendingNotifications() };
    if (command === 'notification-settings') return notificationSettings(value.settings);
    if (command === 'notifications-ack') { await acknowledgeNotifications(value.keys); return { ok: true }; }
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
      // Sampling is local, read-only and on demand. It must not queue behind a
      // model loading or package operation, and never starts/stops a workload.
      if (req.url === '/performance-sample') return json(res, await performance.sample(value));
      if (req.url === '/performance-close') return json(res, performance.close(value));
      if (req.url === '/llama-wait' || req.url === '/whisper-acquire') {
        if (!localAI || !state.web || stopping) throw Error('LocalAI is unavailable while Agent is off');
        const cancelled = new AbortController();
        const cancel = () => { cancelled.abort(); if (req.url === '/whisper-acquire') void localAI.releaseSpeech(value.id).catch(() => {}); };
        res.once('close', cancel);
        try {
          const result = req.url === '/llama-wait' ? await localAI.waitReady(value.model, cancelled.signal) : await localAI.acquireSpeech(value.id);
          res.off('close', cancel); return json(res, result);
        } finally { res.off('close', cancel); }
      }
      const operation = serial.then(() => {
        if (res.destroyed) throw Error('Native request cancelled');
        return action(req.url.slice(1), value);
      }); serial = operation.catch(() => {});
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
  // Recover an interrupted On state in the same queue as explicit commands.
  // A browser's first start must wait for recovery to publish its HTTPS URL.
  serial = serial.then(async () => { if (state.web) await startWeb(); }).catch(() => {});
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
      if (localAI && stack.ready && localAI.importState.state === 'pending') await localAI.importProvider();
      const next = (await readJson(packageFile, null))?.revision;
      if ((next && next !== revision) || initialNode !== (await fs.stat(process.execPath)).ino) {
        // The next explicit launch loads the updated controller too; reload children now.
        if (!jobs.job || jobs.job.kind !== 'reload-services' || jobs.job.status !== 'complete') await jobs.start('reload-services');
      }
    }).catch(error => { lastError = error.message; });
  }, 3000);
  process.on('SIGTERM', () => { serial = serial.then(async () => { await turnOff(); if (!stopping) scheduleExit(); }).catch(error => { lastError = error.message; }); });
  process.on('SIGINT', () => process.emit('SIGTERM'));
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
      const value = input === '-' || input === '--stdin' ? JSON.parse((await body(process.stdin)).toString() || '{}') : input ? JSON.parse(input) : {};
      const performanceCommand = ['performance-sample', 'performance-close'].includes(command);
      if (command !== 'browser-shutdown' && !performanceCommand) await ensureManager();
      const result = await controlRequest(command, command === 'status' ? undefined : value).catch(error => {
        if (performanceCommand && ['ENOENT', 'ECONNREFUSED'].includes(error.code)) return command === 'performance-close' ? { ok: true } : performanceUnavailable('The local Agent is off');
        if (command === 'browser-shutdown' && ['ENOENT', 'ECONNREFUSED'].includes(error.code)) return { web: { status: 'stopped' } };
        throw error;
      });
      console.log(JSON.stringify(result));
    } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
  }
}
