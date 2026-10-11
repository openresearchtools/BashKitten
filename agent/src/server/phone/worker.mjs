// SPDX-License-Identifier: AGPL-3.0-only
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { socketPath, privateDir, json } from '../common.mjs';
import { privateRequest } from './transport.mjs';

/** Each Pi incarnation gets its own socket/key. Native session adoption rotates
 * authority behind this socket, rather than trusting Pi's spawn-time session env. */
export async function createPhoneWorker({ sessionId }) {
  const ownerSocket = process.env.BASHKITTEN_PHONE_OWNER_SOCKET, ownerKey = process.env.BASHKITTEN_PHONE_OWNER_WORKER_KEY;
  if (!ownerSocket || !ownerKey) return { environment: {}, adopt: async () => {}, close: async () => {} };
  const key = randomBytes(32).toString('base64url');
  const socket = socketPath(`phone-pi:${randomUUID()}`);
  await privateDir(path.dirname(socket));
  let active = true, transition = Promise.resolve(), generation = 0;
  const server = http.createServer(async (req, res) => {
    try {
      const authorization = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${key}`);
      if (!active || req.method !== 'POST' || req.url !== '/phone' || req.headers.origin || authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) throw Error('Owned Pi Phone grant required');
      const start = generation; await transition;
      const grant = await privateRequest(ownerSocket, ownerKey, 'lease');
      if (!active || start !== generation) throw Error('Phone session changed; command was not submitted');
      json(res, grant);
    } catch (error) { json(res, { error: error.message }, 403); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); }); await fs.chmod(socket, 0o600);
  const adopt = session => { generation++; transition = transition.catch(() => {}).then(() => privateRequest(ownerSocket, ownerKey, 'adopt', { session })); return transition; };
  // Attach is performed by the spawning owner before the worker becomes ready.
  if (sessionId) await adopt(sessionId);
  return { environment: { BASHKITTEN_PHONE_SOCKET: socket, BASHKITTEN_PHONE_WORKER_KEY: key }, adopt,
    async close() { active = false; generation++; server.close(); server.closeAllConnections(); await fs.rm(socket, { force: true }); await privateRequest(ownerSocket, ownerKey, 'close').catch(() => {}); } };
}
