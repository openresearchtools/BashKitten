// SPDX-License-Identifier: AGPL-3.0-only
import http from 'node:http';

const MAX_BYTES = 16 * 1024 * 1024;
/** The existing owned Pi worker binds its current session; callers cannot choose authority. */
export function appsRequest(value, signal) {
  const socketPath = process.env.BASHKITTEN_WORKER_SOCKET;
  const key = process.env.BASHKITTEN_WORKER_KEY;
  if (!socketPath || !key) throw Error('References and Office require a live BashKitten Pi worker');
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > MAX_BYTES) throw Error('Application request exceeds 16 MiB; use bounded pages or native file import');
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, path: '/apps', method: 'POST', signal,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' } }, response => {
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) response.destroy(Error('Application response exceeds 16 MiB; request a bounded page'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (response.statusCode !== 200) throw Object.assign(Error(value.error?.message || value.error || 'Application request rejected'), { status: response.statusCode, code: value.code, details: value.details });
          resolve(value);
        } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    // Native jobs/transport own timeouts and progress. Caller cancellation closes
    // this request and propagates through the worker to the shared module owner.
    request.end(body);
  });
}

export async function applicationRequest(component, method, path, body, { signal, request = appsRequest } = {}) {
  signal?.throwIfAborted();
  if (!['references', 'office', 'files'].includes(component)) throw Error('Unknown application component');
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw Error('Unsupported application method');
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\x00-\x20\\#]/.test(path) || path.split(/[/?]/).some(part => ['.', '..'].includes(decodeURIComponent(part)))) throw Error('Use a component-relative API path');
  const reply = await request({ component, method, path, ...(body === undefined ? {} : { body }) }, signal);
  signal?.throwIfAborted();
  if (!Number.isInteger(reply?.status)) throw Error('Application owner returned an invalid response');
  if (reply.status >= 400) throw Object.assign(Error(reply.body?.error?.message || reply.body?.error || `${component} returned HTTP ${reply.status}`), { status: reply.status, code: reply.body?.code, details: reply.body?.details ?? reply.body, headers: reply.headers });
  return reply;
}

export function applicationFailure(error) {
  const details = { error: { message: error.message, ...(error.code ? { code: error.code } : {}),
    ...(error.status ? { status: error.status } : {}), ...(error.details ? { details: error.details } : {}) } };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(details) }], details };
}
