// File-manager authority is host-owned; chat attachments and Pi are separate.
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { dataDir, readJson } from '../common.mjs';
import { paths, authBin } from '../access/paths.mjs';
import { bundledRoot } from '../rpc/runtime.mjs';

const context = new AsyncLocalStorage();
const requests = new Set(), listeners = new Set();
let revoking = false, generation = 0;
export const managerContext = () => context.getStore();
export const withManagerContext = (value, action) => context.run(value, action);
const denied = () => Object.assign(Error('The host has not allowed the remote file manager'), { status: 403, code: 'FILE_MANAGER_DENIED' });

export async function managerAllowed(record) {
  if (record?.local) return true;
  if (!record || revoking) return false;
  try {
    const state = await readJson(paths.share);
    return !revoking && state.version === 2 && state.phase === 'ready' && state.enabled === true &&
      state.allowFileManager === true && /^[a-f0-9]{48}$/.test(state.id || '') &&
      /^[a-z2-7]{56}\.onion$/.test(state.onion || '') && /^[a-f0-9]{64}$/.test(state.caSha256 || '') &&
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(state.owner || '') &&
      record.origin === 'https://' + state.onion && record.username === state.owner;
  } catch { return false; }
}

export async function runManagerRequest(req, res, record, action) {
  const controller = new AbortController();
  const operation = { remote: !record.local, owner: record.key, signal: controller.signal };
  const epoch = generation;
  operation.cancel = () => { controller.abort(denied()); req.destroy(); res.destroy(); };
  operation.finished = new Promise(resolve => { operation.finish = resolve; });
  requests.add(operation);
  const disconnected = () => controller.abort(Error('File request closed'));
  res.once('close', disconnected);
  try {
    if (!await managerAllowed(record) || (operation.remote && epoch !== generation)) throw denied();
    controller.signal.throwIfAborted();
    return await context.run(operation, action);
  } finally {
    res.off('close', disconnected); requests.delete(operation); operation.finish();
  }
}

// Block admission and drain before the controller durably changes the policy.
// Requests may have been starting workers, so stop workers after requests finish.
// The subsequent private refresh releases the barrier against the saved policy.
export async function refreshManagerPolicy(stopRemoteJobs, block) {
  if (!block) {
    revoking = false;
    for (const notify of listeners) notify();
    return;
  }
  revoking = true; generation++;
  const active = [...requests].filter(operation => operation.remote);
  for (const operation of active) operation.cancel();
  await Promise.all(active.map(operation => operation.finished));
  await stopRemoteJobs();
}

export function watchManagerPolicy(notify) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

const contains = (root, value) => value === root || value.startsWith(root + path.sep);
export const canonicalManagerPath = value => contains('/data/user/0/com.termux', value)
  ? '/data/data/com.termux' + value.slice('/data/user/0/com.termux'.length) : value;
const privatePaths = [
  ...['access', 'run', 'display', 'llama', 'localai', 'models', 'updates', 'runtimes',
    'runtime.json', 'control.json', 'server.json', 'settings.json'].map(name => path.join(dataDir, name)),
  bundledRoot.replace(/\/$/, ''), authBin, path.join(os.homedir(), '.config/systemd/user'),
  ...(process.env.PREFIX ? [process.env.PREFIX] : []),
].map(canonicalManagerPath);

// Resolve existing parents too, so absent destinations cannot bypass the policy
// through an alias. Call again on opened descriptors before reading/writing.
async function resolved(filename) {
  try { return canonicalManagerPath(await fs.realpath(filename)); }
  catch (error) {
    if (error.code !== 'ENOENT' || filename === path.dirname(filename)) throw error;
    return path.join(await resolved(path.dirname(filename)), path.basename(filename));
  }
}
export async function authorizeManagerPath(filename, { tree = false } = {}) {
  const access = managerContext();
  access?.signal.throwIfAborted();
  if (!access?.remote) return;
  const target = await resolved(filename);
  const localAI = await readJson(path.join(dataDir, 'localai/config.json'), null);
  const configured = [localAI?.llama?.preset, localAI?.llama?.keyFile,
    ...(localAI?.llama?.mode === 'custom' ? [localAI.llama.binary, ...(localAI.llama.libraries || [])] : [])].filter(value => typeof value === 'string' && path.isAbsolute(value));
  for (const entry of [...privatePaths, ...configured]) {
    const root = await resolved(entry);
    if (contains(root, target) || (tree && contains(target, root))) {
      throw Object.assign(Error('This path contains private host configuration'), { status: 403 });
    }
  }
  const stat = await fs.stat(filename).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  // A hard link has no canonical pathname back to the protected original.
  if (stat?.isFile() && stat.nlink !== 1) throw Object.assign(Error('Remote file operations cannot access hard-linked files'), { status: 403 });
  access.signal.throwIfAborted();
}
