// SPDX-License-Identifier: AGPL-3.0-only
// Browser exit only stops this data directory's explicitly owned machines.
// The private Podman store and exact ownership labels exclude host containers.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, socketRequest } from '../common.mjs';
import { claimInstance, processStart } from '../instance.mjs';
import { machineRoot, locations, containerName, machineLabel, podmanRuntime, helper, prepareStorage, preparePodmanRuntime, daemonSocket } from './config.mjs';
import { podman, quiescePodman, run } from './process.mjs';
import { binary } from '../access/paths.mjs';

const timeout = milliseconds => AbortSignal.timeout(milliseconds);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
export async function stopOwnedGateway(id) {
  const p = locations(id), file = path.join(p.runtime, 'gateway.json');
  const gateway = await readJson(file, null);
  if (gateway?.pid && await processStart(gateway.pid) === gateway.started) {
    try { process.kill(gateway.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    for (const until = Date.now() + 2000; Date.now() < until && await processStart(gateway.pid) === gateway.started;) await pause(50);
    if (await processStart(gateway.pid) === gateway.started) {
      try { process.kill(gateway.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      for (const until = Date.now() + 1000; Date.now() < until && await processStart(gateway.pid) === gateway.started;) await pause(25);
      if (await processStart(gateway.pid) === gateway.started) throw Error('The owned display gateway has not stopped');
    }
  }
  // The gateway deliberately delegates pathname cleanup to its lifecycle owner.
  // This also repairs old stopped gateways whose record was already removed.
  // A stopped process can still have Unix socket references being released by
  // the kernel. Wait for their disappearance; never unlink a live endpoint.
  const endpointsUntil = Date.now() + 1000;
  for (const endpoint of [path.join(p.guestDisplay, 'wayland-0'), path.join(p.display, 'presenter.sock')]) {
    const previous = await fs.lstat(endpoint).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!previous) continue;
    if (!previous.isSocket() || previous.uid !== process.getuid()) throw Error('Display endpoint ownership changed');
    for (;;) {
      const sockets = await fs.readFile('/proc/net/unix', 'utf8');
      if (!sockets.split('\n').some(line => line.trim().match(/^(?:\S+\s+){7}(.*)$/)?.[1] === endpoint)) break;
      if (Date.now() >= endpointsUntil) throw Error('A display endpoint is still in use');
      await pause(25);
    }
    const current = await fs.lstat(endpoint);
    if (!current.isSocket() || current.uid !== previous.uid || current.dev !== previous.dev || current.ino !== previous.ino) throw Error('Display endpoint changed during cleanup');
    await fs.unlink(endpoint);
  }
  await fs.rm(file, { force: true });
  await fs.rm(path.join(p.display, 'ready.json'), { force: true });
}
async function inspectOwned(id, name) {
  const result = await podman(['container', 'inspect', name], { cleanup: true, allowFailure: true, signal: timeout(2000) });
  if (result.code) {
    const exists = await podman(['container', 'exists', name], { cleanup: true, allowFailure: true, signal: timeout(2000) });
    if (exists.code === 1) return null;
    throw Error(result.stderr.trim() || 'Could not check the owned container');
  }
  const value = JSON.parse(result.stdout)[0];
  if (value?.Config?.Labels?.[machineLabel] !== id) throw Error('Container ownership changed; refusing to stop it');
  return value;
}
async function idleOwnedMachines() {
  const entries = await fs.readdir(machineRoot, {withFileTypes:true});
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(entry.name)) continue;
    const id=entry.name, files=locations(id);
    const saved = await readJson(files.operation,null);
    if (saved?.state === 'running') return false;
    // Only the old owner has its media ChildProcess handles. A stopped main
    // container alone cannot establish that this whole service is idle.
    const detail = await socketRequest(daemonSocket,'/get',{id},5000);
    if (detail.machine?.id !== id || !Array.isArray(detail.media)) throw Error('The legacy machine status is incomplete');
    if (['preparing','starting','stopping','deleting'].includes(detail.machine.state) || detail.media.some(channel => channel.running)) return false;
    for (const name of [containerName(id),containerName(id)+'-materialize',containerName(id)+'-source']) {
      const info = await inspectOwned(id,name);
      if (info?.State?.Running || info?.State?.Paused || info?.State?.Restarting) return false;
    }
    const gateway = await readJson(path.join(files.runtime,'gateway.json'),null);
    if (gateway) {
      if (!Number.isInteger(gateway.pid) || !gateway.started) throw Error('The display gateway identity is incomplete');
      if (await processStart(gateway.pid) === gateway.started) return false;
    }
  }
  return true;
}
async function stopContainer(id, name) {
  const info = await inspectOwned(id, name);
  if (!info?.State?.Running && !info?.State?.Paused) return;
  if (name === containerName(id)) await socketRequest(path.join(locations(id).exchange, 'agent/control.sock'), '/shutdown', {}, 2000).catch(() => {});
  await podman(['stop', '--ignore', '--time=6', name], { cleanup: true, allowFailure: true, signal: timeout(8000) }).catch(() => {});
  const remaining = await inspectOwned(id, name);
  if (remaining?.State?.Running || remaining?.State?.Paused) await podman(['kill', '--signal=KILL', name], { cleanup: true, signal: timeout(3000) });
  const final = await inspectOwned(id, name);
  if (final?.State?.Running || final?.State?.Paused) throw Error('The owned container has not stopped');
}
export async function shutdownOwnedMachines({ stopMedia = async () => {} } = {}) {
  // Fence late HTTP reads and cancelled lifecycle continuations too. Do not
  // remove namespace state while a previously accepted Podman still uses it.
  await quiescePodman();
  const directories = await fs.readdir(machineRoot, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const ids = directories.filter(entry => entry.isDirectory() && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(entry.name)).map(entry => entry.name);
  const results = await Promise.allSettled(ids.map(async id => {
    const p = locations(id);
    const stopped = await Promise.allSettled([
      stopContainer(id, containerName(id)), stopContainer(id, containerName(id) + '-materialize'),
      stopMedia(id), stopOwnedGateway(id),
    ]);
    const failure = stopped.find(result => result.status === 'rejected')?.reason;
    const saved = await readJson(p.state, {});
    await writeJson(p.state, { ...saved, state: failure ? 'error' : 'stopped', lastError: failure?.message || null, updatedAt: new Date().toISOString() });
    if (failure) throw failure;
  }));
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) throw Error(failures.map(result => result.reason.message).join('; '));
  await stopPrivatePause();
  return { stopped: true };
}

async function stopPrivatePause() {
  const state = path.join(podmanRuntime, 'libpod/tmp');
  const snapshots = new Map();
  for (const name of ['pause.pid', 'ns_handles']) {
    const file = path.join(state, name);
    const stat = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) continue;
    if (!stat.isFile() || stat.uid !== process.getuid()) throw Error('Private Podman namespace state ownership changed');
    snapshots.set(file, stat);
  }
  const pidFile = path.join(state, 'pause.pid');
  if (snapshots.has(pidFile)) {
    const text = (await fs.readFile(pidFile, 'utf8')).trim();
    if (!/^[1-9][0-9]*$/.test(text) || !Number.isSafeInteger(Number(text))) throw Error('Invalid private Podman pause identity');
    const pid = Number(text), started = await processStart(pid);
    if (started) {
      const executable = (await fs.readlink(`/proc/${pid}/exe`)).replace(/ \(deleted\)$/, '');
      if (![helper('podman'), helper('catatonit')].includes(executable)) throw Error('Private Podman pause executable changed');
      await run(binary('runtime-guard'), ['stop-podman-pause', text, started, podmanRuntime, executable], { signal: timeout(3000) });
    }
  }
  for (const [file, previous] of snapshots) {
    const current = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!current) continue;
    if (current.dev !== previous.dev || current.ino !== previous.ino || current.uid !== previous.uid || !current.isFile()) throw Error('Private Podman namespace state changed during cleanup');
    await fs.unlink(file);
  }
}

// Orphan/legacy cleanup also needs a subreaper. It must not create a new pause
// process outside the existing guard simply by inspecting the private store.
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'idle' && process.argv[3] === 'serve') {
  // The caller holds machines-update; the still-running legacy owner keeps its
  // machines lock. This bounded read does not stop any of its existing work.
  if (Number(process.env.BASHKITTEN_GUARD_PID) !== process.ppid) throw Error('The container cleanup guard is unavailable');
  const deadline = setTimeout(() => process.kill(process.ppid,'SIGTERM'),10000);
  try {
    // Schema 1 predates the private Podman runtime directory. Create only that
    // owned runtime path; do not rewrite the still-running owner's config files.
    await preparePodmanRuntime();
    console.log(JSON.stringify({idle:await idleOwnedMachines()}));
  }
  finally { clearTimeout(deadline); }
} else if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'serve') {
  const owner = await claimInstance('machines');
  if (!owner) throw Error('The container service is already owned');
  try {
    if (Number(process.env.BASHKITTEN_GUARD_PID) !== process.ppid) throw Error('The container cleanup guard is unavailable');
    // This one-shot controller is already draining. Arm the same bounded guard
    // deadline now; a lost caller must not leave an orphan cleanup process.
    process.on('SIGTERM', () => {});
    process.kill(process.ppid, 'SIGTERM');
    await prepareStorage(); await shutdownOwnedMachines();
  }
  finally { owner.close(); }
}
