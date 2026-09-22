import { timingSafeEqual, createHmac, createHash } from 'node:crypto';
import { unixRequest } from '../access/io.mjs';

const proxyToken = process.env.BASHKITTEN_PROXY_TOKEN;
const authSocket = process.env.BASHKITTEN_AUTH_SOCKET;
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function origin(req) {
  if (!proxyToken || !equal(req.headers['x-bashkitten-proxy'], proxyToken) || req.headers['x-forwarded-proto'] !== 'https') throw Object.assign(Error('Trusted HTTPS proxy required'), { status: 403 });
  return 'https://' + req.headers.host;
}
export async function login(req) {
  origin(req);
  const username = req.headers['remote-user'], cookie = req.headers.cookie;
  return typeof username === 'string' && username && cookie ? { username, cookie, key: createHash('sha256').update(cookie).digest('hex'), origin: origin(req) } : null;
}
export function checkOrigin(req) {
  if (req.headers.origin !== origin(req)) throw Object.assign(Error('Invalid request origin'), { status: 403 });
}
const csrf = record => createHmac('sha256', proxyToken).update(record.username + '\0' + record.cookie).digest('hex');
export function checkCsrf(req, record) {
  if (!equal(req.headers['x-bashkitten-csrf'], csrf(record))) throw Object.assign(Error('Invalid CSRF token'), { status: 403 });
}
export async function bootstrap(record) { return { hasUser: true, authenticated: Boolean(record), ...(record ? { csrf: csrf(record) } : { loginUrl: '/login' }) }; }
export async function valid(record) {
  if (!record) return false;
  try {
    const result = await unixRequest(authSocket, '/login/api/authz/forward-auth', { headers: {
      host: new URL(record.origin).host, cookie: record.cookie,
      'x-forwarded-host': new URL(record.origin).host, 'x-forwarded-proto': 'https',
      'x-forwarded-uri': '/', 'x-forwarded-method': 'GET', 'x-forwarded-for': '127.0.0.1',
    }, timeout: 5000 });
    return result.status >= 200 && result.status < 300 && result.headers['remote-user'] === record.username;
  } catch { return false; }
}
const streams = new Map();
export function watch(record, close) {
  const key = record.cookie;
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
  const result = await unixRequest(authSocket, '/login/api/logout', { method: 'POST', headers: {
    host: new URL(record.origin).host, cookie: record.cookie, 'content-type': 'application/json',
    'x-forwarded-host': new URL(record.origin).host, 'x-forwarded-proto': 'https', 'x-forwarded-for': '127.0.0.1',
  }, body: '{}' });
  if (result.status < 200 || result.status > 299) throw Error('Authelia could not sign out');
  if (result.headers['set-cookie']) res.setHeader('Set-Cookie', result.headers['set-cookie']);
  for (const close of streams.get(record.cookie) || []) close();
}
