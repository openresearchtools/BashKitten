// SPDX-License-Identifier: AGPL-3.0-only
// Browser exit only stops this data directory's explicitly owned machines.
// The private Podman store and exact ownership labels exclude host containers.
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson, socketRequest } from '../common.mjs';
import { processStart } from '../instance.mjs';
import { machineRoot, locations, containerName, machineLabel } from './config.mjs';
import { podman } from './process.mjs';

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
  for (const endpoint of [path.join(p.guestDisplay, 'wayland-0'), path.join(p.display, 'presenter.sock')]) {
    const previous = await fs.lstat(endpoint).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!previous) continue;
    if (!previous.isSocket() || previous.uid !== process.getuid()) throw Error('Display endpoint ownership changed');
    const sockets = await fs.readFile('/proc/net/unix', 'utf8');
    if (sockets.split('\n').some(line => line.trim().match(/^(?:\S+\s+){7}(.*)$/)?.[1] === endpoint)) throw Error('A display endpoint is still in use');
    const current = await fs.lstat(endpoint);
    if (!current.isSocket() || current.uid !== previous.uid || current.dev !== previous.dev || current.ino !== previous.ino) throw Error('Display endpoint changed during cleanup');
    await fs.unlink(endpoint);
  }
  await fs.rm(file, { force: true });
  await fs.rm(path.join(p.display, 'ready.json'), { force: true });
}
async function inspectOwned(id, name) {
  const result = await podman(['container', 'inspect', name], { allowFailure: true, signal: timeout(2000) });
  if (result.code) {
    const exists = await podman(['container', 'exists', name], { allowFailure: true, signal: timeout(2000) });
    if (exists.code === 1) return null;
    throw Error(result.stderr.trim() || 'Could not check the owned container');
  }
  const value = JSON.parse(result.stdout)[0];
  if (value?.Config?.Labels?.[machineLabel] !== id) throw Error('Container ownership changed; refusing to stop it');
  return value;
}
async function stopContainer(id, name) {
  const info = await inspectOwned(id, name);
  if (!info?.State?.Running && !info?.State?.Paused) return;
  if (name === containerName(id)) await socketRequest(path.join(locations(id).exchange, 'agent/control.sock'), '/shutdown', {}, 2000).catch(() => {});
  await podman(['stop', '--ignore', '--time=6', name], { allowFailure: true, signal: timeout(8000) }).catch(() => {});
  const remaining = await inspectOwned(id, name);
  if (remaining?.State?.Running || remaining?.State?.Paused) await podman(['kill', '--signal=KILL', name], { signal: timeout(3000) });
  const final = await inspectOwned(id, name);
  if (final?.State?.Running || final?.State?.Paused) throw Error('The owned container has not stopped');
}
export async function shutdownOwnedMachines({ stopMedia = async () => {} } = {}) {
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
  return { stopped: true };
}
