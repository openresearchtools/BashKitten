// The browser connects outward after native approval. Pi only sees a private socket.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir, digest, privateDir, body, json, readMeta } from '../common.mjs';
import { watch } from '../http/web-auth.mjs';

const channels = new Map(), sockets = new Map(), bindings = new Map(), openingSockets = new Map();
const socketSessions = new Map();
const sessionPattern = /^[a-f0-9-]{36}$/;
export const browserSocketPath = id => {
  if (!sessionPattern.test(id)) throw Error('Invalid Pi session');
  return path.join(dataDir, 'run', `browser-${digest(id).slice(0, 16)}.sock`);
};
const failure = (message, code = 'browser_disconnected') => Object.assign(Error(message), { code });
function close(channel, reason = 'Browser control disconnected') {
  if (!channels.delete(channel.id)) return;
  clearTimeout(channel.expiry); channel.unwatch?.();
  channel.poll?.finish({ closed: true, commands: [] });
  for (const pending of channel.pending.values()) { pending.reject(failure(reason)); }
}
export function closeBrowserChannels(key) {
  for (const channel of channels.values()) if (!key || channel.key === key) close(channel);
}
function touch(channel) {
  clearTimeout(channel.expiry);
  // Native clients finish each received batch before polling again. A visible
  // References challenge can await the user; retain only that bounded command's
  // channel while the existing authentication watcher continues to revoke it.
  let deadline = Date.now() + 60000;
  for (const value of channel.pending.values()) deadline = Math.max(deadline, value.resolverDeadline || 0);
  channel.expiry = setTimeout(() => close(channel, 'Browser authentication or connection expired'), deadline - Date.now());
  channel.expiry.unref();
}
function deliver(channel) {
  if (!channel.poll || !channel.queue.length) return;
  // Never replay a command after uncertain delivery. Pi receives an error instead.
  // Both native clients consume up to 64 commands per poll. Leave the rest
  // queued for the next poll, without imposing a total command limit.
  channel.poll.finish({ commands: channel.queue.splice(0, 64) });
}
function targetFor(sessionId) {
  if (process.env.BASHKITTEN_EXECUTION_ROLE === 'container') {
    const owned = [...channels.values()].find(channel => channel.nativeGuest);
    if (!owned) throw failure('The container browser is unavailable');
    return owned;
  }
  const selected = bindings.get(sessionId);
  if (selected) {
    const channel = [...channels.values()].find(item => item.clientId === selected.clientId && item.owner === selected.owner);
    if (!channel) throw failure('Reconnect and allow this browser again');
    return channel;
  }
  if (channels.size !== 1) throw failure(channels.size ? 'Choose the browser for this chat' : 'Open BashKitten and allow browser control');
  const channel = channels.values().next().value;
  bindings.set(sessionId, { clientId: channel.clientId, owner: channel.owner });
  return channel;
}
function dispatch(sessionId, command) {
  const channel = targetFor(sessionId);
  return dispatchOn(channel, sessionId, command);
}
function dispatchOn(channel, sessionId, command, { signal } = {}) {
  if (typeof command.method !== 'string' || command.method.length > 128 || !command.params || typeof command.params !== 'object' || Array.isArray(command.params)) throw failure('Invalid browser command', 'invalid_command');
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const resolverDeadline = command.method === 'references.resolve' ? Date.now() + 630000 : 0;
    let settled = false, timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      pending.resolverDeadline = 0;
      const queued = channel.queue.findIndex(command => command.id === id);
      if (queued !== -1) { channel.queue.splice(queued, 1); channel.pending.delete(id); }
      // A delivered cancelled request retains a minimal receipt slot until the
      // native reply/connection closes. Never replay or reject its late receipt
      // in a way that disconnects unrelated browser commands.
      if (channels.has(channel.id)) touch(channel);
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(failure('Browser request cancelled', 'cancelled'));
    const pending = { resolve: result => finish(null, result), reject: error => finish(error), resolverDeadline };
    channel.pending.set(id, pending);
    channel.queue.push({ id, ...(sessionId ? { sessionId } : {}), method: command.method, params: command.params });
    if (resolverDeadline) { timer = setTimeout(() => finish(failure('Resolver browser response timed out; check the job status', 'timeout')), 630000); timer.unref(); }
    signal?.addEventListener('abort', abort, { once: true });
    if (resolverDeadline) touch(channel);
    deliver(channel);
  });
}

// The ordinary References app may resume only its already-authorized backend
// job through the same browser owner used by Pi. No general web command bridge.
export function dispatchReferenceResolver(record, { projectId, requestId }, { signal } = {}) {
  if (!sessionPattern.test(projectId || '') || !sessionPattern.test(requestId || '') || !record?.key) throw failure('Invalid resolver job', 'invalid_command');
  const candidates = [...channels.values()].filter(channel => channel.key === record.key && channel.owner === record.username);
  if (candidates.length !== 1) throw failure(candidates.length ? 'Choose a single authorized BashKitten browser for this account' : 'Open BashKitten and allow browser control');
  const channel = candidates[0];
  if (!Array.isArray(channel.capabilities?.methods) || !channel.capabilities.methods.includes('references.resolve')) throw failure('Update this browser to enable References capture', 'unsupported');
  if ([...channel.pending.values()].filter(value => value.resolverDeadline).length >= 32) throw failure('Too many pending resolver browser requests', 'busy');
  return dispatchOn(channel, null, { method: 'references.resolve', params: { projectId, requestId } }, { signal });
}
export function ensureBrowserSocket(id, sessionId = id) {
  if (!sessionPattern.test(sessionId)) throw Error('Invalid Pi session');
  socketSessions.set(id, sessionId);
  if (openingSockets.has(id)) return openingSockets.get(id);
  const operation = openBrowserSocket(id).finally(() => openingSockets.delete(id));
  openingSockets.set(id, operation); return operation;
}
async function openBrowserSocket(id) {
  const file = browserSocketPath(id);
  if (sockets.has(id)) return file;
  await privateDir(path.dirname(file));
  // Only the single-instance HTTP backend owns these sockets.
  await fs.rm(file, { force: true });
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/session') {
        const input = JSON.parse((await body(req)).toString());
        const meta = await readMeta(input.id);
        if ((meta.browserOwner || meta.workerOwner || meta.id) !== id) throw failure('Invalid browser session owner', 'invalid_session');
        socketSessions.set(id, input.id);
        return json(res, { ok: true });
      }
      if (req.method !== 'POST' || req.url !== '/browser') throw failure('Unknown browser operation', 'invalid_command');
      const input = JSON.parse((await body(req, Infinity)).toString());
      const result = await dispatch(socketSessions.get(id), { method: input.method, params: input.params || {} });
      json(res, { result });
    } catch (error) { json(res, { error: { message: error.message, code: error.code || 'browser_error' } }, 400); }
  });
  const opening = new Promise((resolve, reject) => { server.once('error', reject); server.listen(file, resolve); });
  sockets.set(id, server);
  try { await opening; await fs.chmod(file, 0o600); return file; }
  catch (error) { sockets.delete(id); throw error; }
}
export async function closeBrowserSocket(id, { keepBinding = false } = {}) {
  if (!keepBinding) bindings.delete(id);
  for (const [owner, sessionId] of socketSessions) {
    if (sessionId !== id) continue;
    await openingSockets.get(owner)?.catch(() => {});
    const server = sockets.get(owner);
    if (server) { sockets.delete(owner); server.close(); server.closeAllConnections(); }
    socketSessions.delete(owner);
    await fs.rm(browserSocketPath(owner), { force: true });
  }
}
export async function handleBrowserChannel(req, res, record, route) {
  if (!route.startsWith('/api/browser-channel/')) return false;
  if (req.method !== 'POST') throw Object.assign(Error('Use POST'), { status: 405 });
  const input = JSON.parse((await body(req, Infinity)).toString() || '{}');
  const operation = route.slice('/api/browser-channel/'.length);
  if (operation === 'open') {
    if (!['linux', 'android'].includes(input.platform) || typeof input.clientId !== 'string' || input.clientId.length > 128) throw Error('Invalid browser identity');
    for (const old of channels.values()) if (old.clientId === input.clientId && old.key === record.key) close(old);
    const channel = { id: randomUUID(), clientId: input.clientId, key: record.key, owner: record.username, platform: input.platform,
      nativeGuest: record.nativeGuest === true, name: String(input.name || 'Browser').slice(0, 100), capabilities: input.capabilities || {}, queue: [], pending: new Map() };
    channel.unwatch = watch(record, () => close(channel, 'Browser authentication expired'));
    channels.set(channel.id, channel); touch(channel); json(res, { channelId: channel.id }); return true;
  }
  const channel = channels.get(input.channelId);
  if (!channel || channel.key !== record.key) throw Object.assign(Error('Browser connection expired; authorize a new connection'), { status: 403 });
  touch(channel);
  if (operation === 'close') { close(channel); json(res, { ok: true }); }
  else if (operation === 'bind') {
    if (!sessionPattern.test(input.sessionId)) throw Error('Invalid Pi session');
    bindings.set(input.sessionId, { clientId: channel.clientId, owner: channel.owner }); json(res, { ok: true });
  } else if (operation === 'result') {
    const pending = channel.pending.get(input.id);
    if (!pending) throw Error('Browser command is no longer pending');
    channel.pending.delete(input.id);
    if (input.error) pending.reject(failure(typeof input.error === 'string' ? input.error : input.error.message || 'Browser action failed', input.error.code));
    else pending.resolve(input.result);
    json(res, { ok: true });
  } else if (operation === 'poll') {
    if (channel.poll) throw Object.assign(Error('A browser poll is already active'), { status: 409 });
    let done = false;
    const timer = setTimeout(() => finish({ commands: [] }), 25000);
    const finish = value => { if (done) return; done = true; clearTimeout(timer); channel.poll = null; json(res, value); };
    channel.poll = { finish };
    res.once('close', () => { if (!done) { done = true; clearTimeout(timer); channel.poll = null; close(channel); } });
    deliver(channel);
  } else throw Object.assign(Error('Unknown browser channel operation'), { status: 404 });
  return true;
}
