// SPDX-License-Identifier: AGPL-3.0-only
// Only the native controller and its owned HTTP worker-launcher receive registrar
// authority. No general profile token or Pi environment can register a worker.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { socketPath, privateDir, json, jsonBody } from '../common.mjs';
import { platform } from '../platform/index.mjs';
import { processStart } from '../instance.mjs';
import { endpoint, phoneRequest, privateRequest } from './transport.mjs';

const slots = new Map();
const token = () => randomBytes(32).toString('base64url');
let registrar, server, nativeLink, socket, nativeWatch;
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function ownedOperation(slot, action) {
  const operation = (slot.operation || Promise.resolve()).then(action);
  slot.operation = operation.catch(() => {});
  return operation;
}
export async function initializePhoneOwner() {
  if (platform !== 'termux') return {};
  if (server) return phoneOwnerEnvironment();
  registrar = token();
  // Use the same compact private pathname as the other local worker sockets.
  // A descriptive prefix plus UUID exceeds sun_path in Termux's home directory.
  socket = socketPath(`phone-owner:${randomUUID()}`);
  await privateDir(path.dirname(socket));
  server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/phone' || req.headers.origin || req.headers['content-type'] !== 'application/json') throw Error('Phone authority denied');
      const key = String(req.headers.authorization || '').replace(/^Bearer /, '');
      const registrarCall = equal(key, registrar), slot = slots.get(key);
      if (!registrarCall && !slot) throw Error('Phone authority denied');
      const value = await jsonBody(req);
      if (registrarCall) {
        if (value.action === 'register') {
          if (!/^[a-f0-9-]{36}$/.test(value.worker)) throw Error('Invalid worker');
          const secret = token(); slots.set(secret, { worker: value.worker, session: value.worker, incarnation: randomUUID(), pid: null, alive: false, ready: false });
          return json(res, { secret });
        }
        const target = slots.get(value.secret); if (!target) throw Error('Worker slot expired');
        if (value.action === 'attach') { if (!Number.isSafeInteger(value.pid) || value.pid < 1) throw Error('Invalid owned process'); target.pid = value.pid; target.started = await processStart(value.pid); if (!target.started) throw Error('Owned worker is not running'); target.alive = true; return json(res, { attached: true }); }
        if (value.action === 'revoke') { await revoke(value.secret); return json(res, { revoked: true }); }
        throw Error('Unknown owner operation');
      }
      if (value.action === 'adopt') return await ownedOperation(slot, async () => {
        if (slots.get(key) !== slot) throw Error('Phone worker revoked');
        if (!/^[a-f0-9-]{36}$/.test(value.session)) throw Error('Invalid Pi session');
        slot.ready = false;
        const link = nativeLink;
        if (slot.revocationPending && !link) throw Error('Reconnect Phone controls before adopting this session');
        if (link) {
          try {
            const result = await phoneRequest(link, `Owner ${link.owner}`, 'owner.revoke', { worker: slot.incarnation });
            if (result.revoked !== true || nativeLink !== link || slots.get(key) !== slot) throw Error('Phone authority changed during session adoption');
          } catch (error) {
            slot.revocationPending = true;
            if (nativeLink === link) await disconnectPhoneOwner();
            throw Error('Phone session adoption failed: ' + error.message);
          }
        }
        slot.revocationPending = false; slot.session = value.session; slot.ready = true; return json(res, { adopted: true });
      });
      if (value.action === 'close') { await revoke(key); return json(res, { revoked: true }); }
      return await ownedOperation(slot, async () => {
        if (!slot.alive || !slot.ready) throw Error('Owned native Pi session is not ready');
        if (await processStart(slot.pid) !== slot.started) { slot.alive = false; slots.delete(key); await revokeNative(slot); throw Error('Owned Pi worker stopped or was replaced'); }
        if (value.action !== 'lease' || !nativeLink) throw Error('Phone controls unavailable; enable them in native Phone settings');
        const link = nativeLink;
        const result = await phoneRequest(link, `Owner ${link.owner}`, 'owner.issue', { worker: slot.incarnation, session: slot.session, incarnation: slot.incarnation });
        if (!slot.alive || slots.get(key) !== slot || nativeLink !== link) throw Error('Phone worker revoked');
        return json(res, { endpoint: link.endpoint, ...result });
      });
    } catch (error) { json(res, { error: error.message }, 403); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); }); await fs.chmod(socket, 0o600);
  return phoneOwnerEnvironment();
}
export function phoneOwnerEnvironment() {
  return server ? { BASHKITTEN_PHONE_REGISTRAR_SOCKET: socket, BASHKITTEN_PHONE_REGISTRAR_KEY: registrar } : {};
}
export async function configurePhoneOwner(link) {
  if (platform !== 'termux' || !server || link.version !== 1 || typeof link.owner !== 'string' || link.owner.length < 32) throw Error('Native Phone authority unavailable');
  const url = endpoint(link.endpoint);
  nativeWatch?.destroy(); nativeLink = null;
  await new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify({ version: 1, command: 'owner.watch', args: {} }));
    const req = http.request({ host: '127.0.0.1', port: url.port, path: '/v1', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': bytes.length, Authorization: `Owner ${link.owner}` } }, res => {
      if (res.statusCode !== 200) { res.resume(); req.destroy(); reject(Error('Native Phone lifetime channel rejected')); return; }
      nativeWatch = req; nativeLink = { endpoint: link.endpoint, owner: link.owner };
      res.resume(); const closed = () => { if (nativeWatch === req) { nativeWatch = null; nativeLink = null; } };
      res.on('end', closed); res.on('error', closed); resolve();
    });
    req.once('error', reject); req.end(bytes);
  });
  return { connected: true };
}
async function revoke(secret) {
  const slot = slots.get(secret); if (!slot) return; slot.alive = false; slots.delete(secret);
  await ownedOperation(slot, () => revokeNative(slot));
}
async function revokeNative(slot) {
  const link = nativeLink;
  if (link) try {
    const result = await phoneRequest(link, `Owner ${link.owner}`, 'owner.revoke', { worker: slot.incarnation });
    if (result.revoked !== true) throw Error('Phone worker revocation was not confirmed');
  } catch { if (nativeLink === link) await disconnectPhoneOwner(); }
}
export async function disconnectPhoneOwner() {
  const old = nativeLink; nativeLink = null; nativeWatch?.destroy(); nativeWatch = null;
  if (old) await phoneRequest(old, `Owner ${old.owner}`, 'owner.disconnect').catch(() => {});
}
export async function closePhoneOwner() {
  await disconnectPhoneOwner(); slots.clear(); registrar = undefined;
  if (server) { server.close(); server.closeAllConnections(); server = undefined; await fs.rm(socket, { force: true }); }
}
export async function createPhoneWorkerSlot(worker) {
  const socketPath = process.env.BASHKITTEN_PHONE_REGISTRAR_SOCKET, key = process.env.BASHKITTEN_PHONE_REGISTRAR_KEY;
  if (platform !== 'termux' || !socketPath || !key) return { environment: {}, attach: async () => {}, close: async () => {} };
  const { secret } = await privateRequest(socketPath, key, 'register', { worker });
  const close = () => privateRequest(socketPath, key, 'revoke', { secret }).catch(() => {});
  return { environment: { BASHKITTEN_PHONE_OWNER_SOCKET: socketPath, BASHKITTEN_PHONE_OWNER_WORKER_KEY: secret },
    async attach(child) { try { await privateRequest(socketPath, key, 'attach', { secret, pid: child.pid }); child.once('exit', close); child.once('error', close); } catch (error) { await close(); throw error; } }, close };
}
export function withoutPhoneIssuers(environment) {
  const result = { ...environment };
  for (const key of Object.keys(result)) if (key.startsWith('BASHKITTEN_PHONE_REGISTRAR_') || key.startsWith('BASHKITTEN_PHONE_OWNER_')) delete result[key];
  return result;
}
