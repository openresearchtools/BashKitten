// File-manager authority is host-owned; chat attachments and Pi are separate.
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { dataDir, readJson } from '../common.mjs';
import { authBin, sharingScope, sharingKinds, accessDir } from '../access/paths.mjs';
import { bundledRoot } from '../rpc/runtime.mjs';
import { machineRoot, storageRoot, runtimeRoot } from '../machines/config.mjs';
import { platform } from '../platform/index.mjs';

const context = new AsyncLocalStorage();
const requests = new Set(), listeners = new Set();
const revoking = new Set(), generations = new Map();
const instanceOf = record => record?.instance || 'tor';
const policyEpoch = record => (generations.get('*') || 0) + ':' + (generations.get(instanceOf(record)) || 0);
const blocked = record => revoking.has('*') || revoking.has(instanceOf(record));
export const managerContext = () => context.getStore();
export const withManagerContext = (value, action) => context.run(value, action);
const denied = () => Object.assign(Error('The host has not allowed the remote file manager'), { status: 403, code: 'FILE_MANAGER_DENIED' });

export async function managerAllowed(record) {
  if (record?.local) return true;
  if (!record || blocked(record)) return false;
  try {
    const instance = record.instance || 'tor';
    if (!sharingKinds.includes(instance)) return false;
    const power = await readJson(path.join(accessDir, 'sharing.json'), { enabled: true });
    if (power.enabled !== true) return false;
    const state = await readJson(sharingScope(instance).paths.share);
    return !blocked(record) && state.version === 2 && state.phase === 'ready' && state.enabled === true &&
      state.allowFileManager === true && /^[a-f0-9]{48}$/.test(state.id || '') &&
      (instance === 'tor' ? /^[a-z2-7]{56}\.onion$/ : /^[a-f0-9]{48}\.taskarian\.invalid$/).test(state.onion || '') && /^[a-f0-9]{64}$/.test(state.caSha256 || '') &&
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(state.owner || '') &&
      record.origin === 'https://' + state.onion && record.username === state.owner;
  } catch { return false; }
}

export async function runManagerRequest(req, res, record, action) {
  return runManagerOperation(record, action, {
    cancel: () => { req.destroy(); res.destroy(); },
    watch: abort => { res.once('close', abort); return () => res.off('close', abort); },
  });
}

// The same admission/drain owner also covers native app callbacks and sockets.
// Keeping them here makes policy revocation wait for in-flight atomic writes.
export async function runManagerOperation(record, action, { cancel = () => {}, watch } = {}) {
  const controller = new AbortController();
  const operation = { remote: !record.local, instance: instanceOf(record), owner: record.key, signal: controller.signal };
  const epoch = policyEpoch(record);
  operation.cancel = () => { controller.abort(denied()); cancel(); };
  operation.finished = new Promise(resolve => { operation.finish = resolve; });
  requests.add(operation);
  const disconnected = () => controller.abort(Error('File request closed'));
  const unwatch = watch?.(disconnected);
  try {
    if (!await managerAllowed(record) || (operation.remote && epoch !== policyEpoch(record))) throw denied();
    controller.signal.throwIfAborted();
    return await context.run(operation, () => action(operation));
  } finally {
    unwatch?.(); requests.delete(operation); operation.finish();
  }
}

// Block admission and drain before the controller durably changes the policy.
// Requests may have been starting workers, so stop workers after requests finish.
// The subsequent private refresh releases the barrier against the saved policy.
export async function refreshManagerPolicy(stopRemoteJobs, block, instance = null) {
  if (instance !== null && !sharingKinds.includes(instance)) throw Error('Unknown sharing instance');
  const key = instance || '*';
  if (!block) {
    revoking.delete(key);
    for (const notify of listeners) notify();
    return;
  }
  revoking.add(key); generations.set(key, (generations.get(key) || 0) + 1);
  const active = [...requests].filter(operation => operation.remote && (!instance || operation.instance === instance));
  for (const operation of active) operation.cancel();
  await Promise.all(active.map(operation => operation.finished));
  await stopRemoteJobs(instance);
}

export function watchManagerPolicy(notify) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

const contains = (root, value) => value === root || value.startsWith(root + path.sep);
export const canonicalManagerPath = value => contains('/data/user/0/com.termux', value)
  ? '/data/data/com.termux' + value.slice('/data/user/0/com.termux'.length) : value;
const privatePaths = [
  // All backend-owned state (including Pi credentials and controller logs) is
  // outside ordinary app sources. Dedicated chat/library/history APIs expose
  // only their authorized records; Pi's native filesystem tools are unchanged.
  dataDir,
  ...['access', 'run', 'display', 'llama', 'localai', 'models', 'updates', 'runtimes',
    'services', 'office-sessions', 'bibliography', 'references',
    'runtime.json', 'control.json', 'server.json', 'settings.json', 'autostart.json'].map(name => path.join(dataDir, name)),
  machineRoot, storageRoot, ...(platform === 'linux' ? [runtimeRoot] : []),
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
  return authorizeApplicationPath(filename, { tree });
}
export async function privateManagerPaths() {
  const localAI = await readJson(path.join(dataDir, 'localai/config.json'), null);
  const configured = [localAI?.llama?.preset, localAI?.llama?.keyFile,
    ...(localAI?.llama?.mode === 'custom' ? [localAI.llama.binary, ...(localAI.llama.libraries || [])] : [])].filter(value => typeof value === 'string' && path.isAbsolute(value));
  return Promise.all([...privatePaths, ...configured].map(resolved));
}

// Ordinary app tabs never expose private backend state, including to a local
// broad home-folder source. Chat attachments retain their separate policy.
export async function authorizeApplicationPath(filename, { tree = false } = {}) {
  const access = managerContext();
  access?.signal.throwIfAborted();
  const target = await resolved(filename);
  for (const root of await privateManagerPaths()) {
    if (contains(root, target) || (tree && contains(target, root))) {
      throw Object.assign(Error('This path contains private host configuration'), { status: 403 });
    }
  }
  const stat = await fs.stat(filename).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  // A hard link has no canonical pathname back to the protected original.
  if (stat?.isFile() && stat.nlink !== 1) throw Object.assign(Error('File application operations cannot access hard-linked files'), { status: 403 });
  access?.signal.throwIfAborted();
}
