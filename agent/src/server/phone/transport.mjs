// SPDX-License-Identifier: AGPL-3.0-only
import http from 'node:http';

export function endpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Phone endpoint must be the native literal loopback listener');
  return url;
}
export async function phoneRequest(link, credential, command, args = {}, { signal, timeoutMs = 30000 } = {}) {
  const url = endpoint(link.endpoint);
  return new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify({ version: 1, command, args, timeoutMs }));
    const req = http.request({ host: '127.0.0.1', port: url.port, path: '/v1', method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'Content-Length': bytes.length, Authorization: credential } }, res => {
      const chunks = [];
      res.on('data', b => chunks.push(b)); res.on('error', reject);
      res.on('end', () => { try { const value = JSON.parse(Buffer.concat(chunks)); if (res.statusCode !== 200 || value.error) throw Object.assign(Error(value.error || 'Phone request failed'), { code: value.code }); resolve(value.result); } catch (error) { reject(error); } });
    });
    req.setTimeout(timeoutMs, () => req.destroy(Error('Phone request timed out; an uncertain action must not be replayed')));
    req.on('error', reject); req.end(bytes);
  });
}
export function privateRequest(socketPath, secret, action, value = {}) {
  return new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify({ action, ...value }));
    const req = http.request({ socketPath, path: '/phone', method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', 'Content-Length': bytes.length } }, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('error', reject); res.on('end', () => { try { const value = JSON.parse(Buffer.concat(chunks)); if (res.statusCode !== 200) throw Error(value.error || 'Phone authority unavailable'); resolve(value); } catch (e) { reject(e); } });
    });
    req.setTimeout(10000, () => req.destroy(Error('Phone authority did not respond'))); req.on('error', reject); req.end(bytes);
  });
}
