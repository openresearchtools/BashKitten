import { timingSafeEqual, createHmac, createHash } from 'node:crypto';
import { sharingScope, sharingKinds } from '../access/paths.mjs';
import { unixRequest } from '../access/io.mjs';

const proxyToken = process.env.TASKARIAN_PROXY_TOKEN;
const authSocket = process.env.TASKARIAN_AUTH_SOCKET;
const localOrigin = process.env.TASKARIAN_ACCESS_ORIGIN;
const localCookieName = process.env.TASKARIAN_LOCAL_COOKIE;
const localToken = process.env.TASKARIAN_LOCAL_TOKEN;
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function origin(req) {
  if (!proxyToken || !equal(req.headers['x-taskarian-proxy'], proxyToken) || req.headers['x-forwarded-proto'] !== 'https') throw Object.assign(Error('Trusted HTTPS proxy required'), { status: 403 });
  return 'https://' + req.headers.host;
}
export async function login(req) {
  const requestOrigin = origin(req);
  if (req.headers['x-taskarian-access'] === 'local') {
    if (requestOrigin !== localOrigin || !localCookieName || !localToken) return null;
    const values = String(req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(localCookieName + '='));
    if (values.length !== 1 || !equal(values[0].slice(localCookieName.length + 1), localToken)) return null;
    return localAuthority();
  }
  if (req.headers['x-taskarian-access'] !== 'remote') return null;
  const instance = req.headers['x-taskarian-instance'] || 'tor';
  if (!sharingKinds.includes(instance)) return null;
  const username = req.headers['remote-user'], cookie = req.headers.cookie;
  return typeof username === 'string' && username && cookie ? { instance, username, cookie, key: createHash('sha256').update(instance + '\0' + cookie).digest('hex'), origin: origin(req) } : null;
}
// For authenticated private worker/controller operations only. This record never
// crosses an API boundary and is checked/revoked by the same web-session owner.
export function localAuthority() {
  if (!localOrigin || !localToken) throw Error('The local backend identity is unavailable');
  return { local: true, username: 'local', cookie: localToken, key: createHash('sha256').update('local\0' + localToken).digest('hex'), origin: localOrigin };
}
export function checkOrigin(req) {
  if (req.headers.origin !== origin(req)) throw Object.assign(Error('Invalid request origin'), { status: 403 });
}
const csrf = record => createHmac('sha256', proxyToken).update((record.instance || 'tor') + '\0' + record.username + '\0' + record.cookie).digest('hex');
export function checkCsrf(req, record) {
  if (!equal(req.headers['x-taskarian-csrf'], csrf(record))) throw Object.assign(Error('Invalid CSRF token'), { status: 403 });
}
export async function bootstrap(record) { return { hasUser: true, authenticated: Boolean(record), local: Boolean(record?.local), ...(record ? { csrf: csrf(record) } : { loginUrl: '/login' }) }; }
export async function valid(record) {
  if (!record) return false;
  if (record.local) return record.origin === localOrigin && equal(record.cookie, localToken);
  try {
    const result = await unixRequest(record.instance && record.instance !== 'tor' ? sharingScope(record.instance).paths.auth : authSocket, '/login/api/authz/forward-auth', { headers: {
      host: new URL(record.origin).host, cookie: record.cookie,
      'x-forwarded-host': new URL(record.origin).host, 'x-forwarded-proto': 'https',
      'x-forwarded-uri': '/', 'x-forwarded-method': 'GET', 'x-forwarded-for': '127.0.0.1',
    }, timeout: 5000 });
    return result.status >= 200 && result.status < 300 && result.headers['remote-user'] === record.username;
  } catch { return false; }
}
const streams = new Map();
const streamKey = record => (record.instance || 'tor') + '\0' + record.cookie;
export function watch(record, close) {
  const key = streamKey(record);
  if (!streams.has(key)) streams.set(key, new Set());
  streams.get(key).add(close);
  let checking = false;
  const timer = setInterval(async () => {
    if (checking) return; checking = true;
    try { if (!await valid(record)) close(); } finally { checking = false; }
  }, 15000);
  timer.unref();
  return () => { clearInterval(timer); streams.get(key)?.delete(close); if (!streams.get(key)?.size) streams.delete(key); };
}
export async function logout(record, res) {
  if (record.local) throw Error('Use Turn off to disconnect the local Agent');
  const result = await unixRequest(record.instance && record.instance !== 'tor' ? sharingScope(record.instance).paths.auth : authSocket, '/login/api/logout', { method: 'POST', headers: {
    host: new URL(record.origin).host, cookie: record.cookie, 'content-type': 'application/json',
    'x-forwarded-host': new URL(record.origin).host, 'x-forwarded-proto': 'https', 'x-forwarded-for': '127.0.0.1',
  }, body: '{}' });
  if (result.status < 200 || result.status > 299) throw Error('Authelia could not sign out');
  if (result.headers['set-cookie']) res.setHeader('Set-Cookie', result.headers['set-cookie']);
  for (const close of streams.get(streamKey(record)) || []) close();
}
