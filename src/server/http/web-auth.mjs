import path from 'node:path';
import fs from 'node:fs/promises';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';
import { dataDir, readJson, writeJson, digest, randomToken } from '../common.mjs';

const authFile = path.join(dataDir, 'web-auth.json');
const loginFile = path.join(dataDir, 'web-logins.json');
const cookieName = 'bashkitten_session';
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
let writes = Promise.resolve();
function locked(fn) { const work = writes.then(fn); writes = work.catch(() => {}); return work; }
export const hasUser = async () => Boolean(await readJson(authFile, null));
export async function login(req) {
  const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  if (!token) return null;
  const key = digest(token), records = await readJson(loginFile, {}), record = records[key];
  return record && record.expires > Date.now() ? { ...record, key } : null;
}
export function checkOrigin(req) {
  if (req.headers.origin !== `http://${req.headers.host}`) throw Object.assign(Error('Invalid request origin'), { status: 403 });
}
export function checkCsrf(req, record) {
  if (!equal(digest(String(req.headers['x-bashkitten-csrf'] || '')), record.csrfHash)) throw Object.assign(Error('Invalid CSRF token'), { status: 403 });
}
export async function bootstrap(record) {
  if (!record) return { hasUser: await hasUser(), authenticated: false };
  return locked(async () => {
    const records = await readJson(loginFile, {}), csrf = randomToken();
    if (!records[record.key]) return { hasUser: true, authenticated: false };
    records[record.key].csrfHash = digest(csrf); await writeJson(loginFile, records);
    return { hasUser: true, authenticated: true, csrf };
  });
}
export async function authenticate(value, signup, res) {
  return locked(async () => {
    const { username, password } = value;
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 128 || password.length > 1024 || password.length < 8 || !username.trim()) throw Error('Enter a username and a password of at least 8 characters');
    let auth = await readJson(authFile, null);
    if (signup) {
      if (auth) throw Error('The local account already exists');
      const passwordHash = await argon2id({ password, salt: randomBytes(16), parallelism: 1, iterations: 3, memorySize: 19456, hashLength: 32, outputType: 'encoded' });
      auth = { username, passwordHash };
      // wx prevents concurrent signup across separate server processes too.
      await fs.writeFile(authFile, JSON.stringify(auth), { flag: 'wx', mode: 0o600 });
    } else {
      if (!auth || !await argon2Verify({ password, hash: auth.passwordHash }) || !equal(auth.username, username)) throw Error('Invalid username or password');
    }
    const records = await readJson(loginFile, {}), token = randomToken(), csrf = randomToken();
    for (const [key, record] of Object.entries(records)) if (record.expires <= Date.now()) delete records[key];
    records[digest(token)] = { csrfHash: digest(csrf), expires: Date.now() + 30 * 86400000 };
    await writeJson(loginFile, records);
    res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
    return { csrf };
  });
}
export async function logout(record, res) {
  await locked(async () => { const records = await readJson(loginFile, {}); delete records[record.key]; await writeJson(loginFile, records); });
  res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}
