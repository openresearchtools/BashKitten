// The browser connects outward after native approval. Pi only sees a private socket.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir, digest, privateDir, body, json } from '../common.mjs';
import { watch } from '../http/web-auth.mjs';

const channels = new Map(), sockets = new Map(), bindings = new Map(), openingSockets = new Map();
const limit = 32 * 1024 * 1024;
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
  for (const pending of channel.pending.values()) { clearTimeout(pending.timer); pending.reject(failure(reason)); }
}
export function closeBrowserChannels(key) {
  for (const channel of channels.values()) if (!key || channel.key === key) close(channel);
}
function touch(channel) {
  clearTimeout(channel.expiry);
  channel.expiry = setTimeout(() => close(channel, 'Browser authentication or connection expired'), 60000);
  channel.expiry.unref();
}
function deliver(channel) {
  if (!channel.poll || !channel.queue.length) return;
  // Never replay a command after uncertain delivery. Pi receives an error instead.
  channel.poll.finish({ commands: channel.queue.splice(0) });
}
function targetFor(sessionId) {
  const selected = bindings.get(sessionId);
  if (selected) {
    const channel = [...channels.values()].find(item => item.clientId === selected.clientId && item.key === selected.key);
    if (!channel) throw failure('Reconnect and allow this browser again');
    return channel;
  }
  if (channels.size !== 1) throw failure(channels.size ? 'Choose the browser for this chat' : 'Open BashKitten and allow browser control');
  const channel = channels.values().next().value;
  bindings.set(sessionId, { clientId: channel.clientId, key: channel.key });
  return channel;
}
function dispatch(sessionId, command) {
  const channel = targetFor(sessionId);
  if (typeof command.method !== 'string' || command.method.length > 128 || !command.params || typeof command.params !== 'object' || Array.isArray(command.params)) throw failure('Invalid browser command', 'invalid_command');
  if (channel.pending.size >= 64) throw failure('Browser command queue is full', 'busy');
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { channel.pending.delete(id); channel.queue = channel.queue.filter(item => item.id !== id); reject(failure('Browser command timed out; its action was not retried', 'timeout')); }, 180000);
    timer.unref();
    channel.pending.set(id, { resolve, reject, timer });
    channel.queue.push({ id, sessionId, method: command.method, params: command.params });
    deliver(channel);
  });
}
export function ensureBrowserSocket(id) {
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
      if (req.method !== 'POST' || req.url !== '/browser') throw failure('Unknown browser operation', 'invalid_command');
      const input = JSON.parse((await body(req, limit)).toString());
      const result = await dispatch(id, { method: input.method, params: input.params || {} });
      json(res, { result });
    } catch (error) { json(res, { error: { message: error.message, code: error.code || 'browser_error' } }, 400); }
  });
  const opening = new Promise((resolve, reject) => { server.once('error', reject); server.listen(file, resolve); });
  sockets.set(id, server);
  try { await opening; await fs.chmod(file, 0o600); return file; }
  catch (error) { sockets.delete(id); throw error; }
}
export async function handleBrowserChannel(req, res, record, route) {
  if (!route.startsWith('/api/browser-channel/')) return false;
  if (req.method !== 'POST') throw Object.assign(Error('Use POST'), { status: 405 });
  const input = JSON.parse((await body(req, limit)).toString() || '{}');
  const operation = route.slice('/api/browser-channel/'.length);
  if (operation === 'open') {
    if (!['linux', 'android'].includes(input.platform) || typeof input.clientId !== 'string' || input.clientId.length > 128) throw Error('Invalid browser identity');
    for (const old of channels.values()) if (old.clientId === input.clientId && old.key === record.key) close(old);
    if (channels.size >= 16) throw Error('Too many browser connections');
    const channel = { id: randomUUID(), clientId: input.clientId, key: record.key, platform: input.platform,
      name: String(input.name || 'Browser').slice(0, 100), capabilities: input.capabilities || {}, queue: [], pending: new Map() };
    channel.unwatch = watch(record, () => close(channel, 'Browser authentication expired'));
    channels.set(channel.id, channel); touch(channel); json(res, { channelId: channel.id }); return true;
  }
  const channel = channels.get(input.channelId);
  if (!channel || channel.key !== record.key) throw Object.assign(Error('Browser connection expired; authorize a new connection'), { status: 403 });
  touch(channel);
  if (operation === 'close') { close(channel); json(res, { ok: true }); }
  else if (operation === 'bind') {
    if (!sessionPattern.test(input.sessionId)) throw Error('Invalid Pi session');
    bindings.set(input.sessionId, { clientId: channel.clientId, key: channel.key }); json(res, { ok: true });
  } else if (operation === 'result') {
    const pending = channel.pending.get(input.id);
    if (!pending) throw Error('Browser command is no longer pending');
    channel.pending.delete(input.id); clearTimeout(pending.timer);
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
