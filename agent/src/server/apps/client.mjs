// SPDX-License-Identifier: AGPL-3.0-only
// Private worker/CLI transport. Startup stays with the owning backend and its
// existing HostedServices controller; callers never spawn an application.
import { readJson } from '../common.mjs';
import { serverFile } from '../instance.mjs';
import { unixRequest } from '../access/io.mjs';

export async function appsRequest(value, { signal } = {}) {
  signal?.throwIfAborted();
  const info = await readJson(serverFile, null);
  if (!info?.socket || !/^https:\/\/127\.0\.0\.1:\d+$/.test(info.url || '') || !/^[a-f0-9]{64}$/.test(info.token || '')) {
    throw Error('The owning BashKitten backend is unavailable');
  }
  if (process.env.BASHKITTEN_INSTANCE_TOKEN && process.env.BASHKITTEN_INSTANCE_TOKEN !== info.token) throw Error('The owning backend restarted; reconnect this Pi session');
  const response = await unixRequest(info.socket, '/api/instance/apps', {
    method: 'POST', headers: { host: new URL(info.url).host, authorization: 'Bearer ' + info.token, 'content-type': 'application/json' },
    body: JSON.stringify(value), signal, timeout: 0, limit: 16 * 1024 * 1024,
  });
  let result;
  try { result = JSON.parse(response.body); } catch { throw Error('The application returned an invalid response'); }
  if (response.status >= 400) throw Object.assign(Error(result.error || 'Application request failed'), { status: response.status, code: result.code, details: result.details });
  return result;
}
