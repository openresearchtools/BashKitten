// Authelia configuration/enrollment patterns adapted from Torkitten.
// Copyright 2026 The Torkitten Authors (Apache-2.0); BashKitten changes GPL-3.0-only.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { argon2id } from 'hash-wasm';
import { privateDir, readJson, writeJson, randomToken } from '../common.mjs';
import { accessDir, paths, binary } from './paths.mjs';
import { unixRequest, command } from './io.mjs';

const flows = new Map();
export async function accountStatus() {
  const initialized = Boolean(await readJson(paths.complete, null));
  return { initialized, enrollmentRequired: !initialized, hasUser: initialized || Boolean(await readJson(paths.pending, null)) };
}
export async function authEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AUTHELIA_')));
  for (const [name, key] of Object.entries({ session: 'SESSION_SECRET', storage: 'STORAGE_ENCRYPTION_KEY', jwt: 'IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET' })) {
    const file = path.join(accessDir, name + '.secret');
    try { await fs.writeFile(file, randomToken() + randomToken(), { mode: 0o600, flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    env['AUTHELIA_' + key + '_FILE'] = file;
  }
  env.AUTHELIA_TELEMETRY_METRICS_ENABLED = 'false';
  return env;
}
export async function renderAuthelia(origins, instanceId) {
  await privateDir(accessDir);
  // Authelia rejects an empty file store. This disabled, unprivileged entry has
  // a discarded random password and is replaced by the local owner at setup.
  try {
    await fs.access(paths.users);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const password = await argon2id({ password: randomToken(), salt: randomBytes(16), parallelism: 1, iterations: 3, memorySize: 19456, hashLength: 32, outputType: 'encoded' });
    await fs.writeFile(paths.users, JSON.stringify({ users: { __bashkitten_setup: { disabled: true, displayname: 'Setup pending', password, groups: [] } } }), { mode: 0o600, flag: 'wx' });
  }
  const domains = origins.map(origin => new URL(origin).hostname);
  const config = {
    theme: 'auto',
    server: { address: `unix://${paths.auth}?umask=0077&path=login`, disable_healthcheck: true,
      endpoints: { enable_pprof: false, enable_expvars: false,
        authz: { 'forward-auth': { implementation: 'ForwardAuth', authn_strategies: [{ name: 'CookieSession' }] } } } },
    log: { level: 'warn', format: 'json' },
    totp: { issuer: 'BashKitten', algorithm: 'sha1', digits: 6, period: 30, skew: 1, secret_size: 32, disable_reuse_security_policy: false },
    webauthn: { disable: true },
    authentication_backend: { password_reset: { disable: true }, password_change: { disable: false },
      file: { path: paths.users, watch: true, search: { email: false, case_insensitive: false } } },
    access_control: { default_policy: 'deny', rules: [{ domain: domains, subject: 'group:owner', policy: 'two_factor' }] },
    session: { name: 'bashkitten_' + instanceId.slice(0, 16), same_site: 'lax', inactivity: '1h', expiration: '12h', remember_me: '30d',
      cookies: origins.map(origin => ({ domain: new URL(origin).hostname, authelia_url: origin + '/login', default_redirection_url: origin + '/' })) },
    regulation: { modes: ['user'], max_retries: 3, find_time: '2m', ban_time: '5m' },
    storage: { local: { path: paths.database } },
    notifier: { filesystem: { filename: path.join(accessDir, 'notifications.txt') } },
    ntp: { disable_startup_check: true }, telemetry: { metrics: { enabled: false } },
  };
  await writeJson(paths.config, config);
}
export async function authCall(origin, route, input, cookies = '', timeout = 15000) {
  const target = new URL(origin);
  const result = await unixRequest(paths.auth, '/login' + route, {
    method: input === undefined ? 'GET' : 'POST',
    headers: { host: target.host, 'content-type': 'application/json', cookie: cookies,
      'x-forwarded-host': target.host, 'x-forwarded-proto': 'https', 'x-forwarded-for': '127.0.0.1',
      'x-forwarded-uri': '/login' + route, 'x-forwarded-method': input === undefined ? 'GET' : 'POST' },
    body: input === undefined ? undefined : JSON.stringify(input),
    timeout,
  });
  const value = JSON.parse(result.body);
  if (result.status < 200 || result.status > 299 || value.status === 'KO') throw Error('Authelia rejected the account or verification code');
  return { value, cookies: result.headers['set-cookie']?.map(cookie => cookie.split(';')[0]).join('; ') || cookies };
}
function credentials(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value.username || '') || typeof value.password !== 'string' || value.password.length < 8 || value.password.length > 1024) throw Error('Use a username and a password of at least 8 characters');
}
async function firstFactor(origin, value) {
  let failure;
  // Authelia watches its native user file; allow the watcher to observe creation.
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await authCall(origin, '/api/firstfactor', { username: value.username, password: value.password, keepMeLoggedIn: false }); }
    catch (error) { failure = error; await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  throw failure;
}
export async function enrollAccount(origin, value, { create = false, reset = false } = {}) {
  credentials(value);
  const account = await accountStatus();
  if (create) {
    if (account.hasUser) throw Error('This server already has an account');
    const password = await argon2id({ password: value.password, salt: randomBytes(16), parallelism: 4, iterations: 3, memorySize: 65536, hashLength: 32, outputType: 'encoded' });
    await writeJson(paths.users, { users: { [value.username]: { disabled: false, displayname: value.username, password, groups: ['owner'] } } });
    await writeJson(paths.pending, { username: value.username });
  } else if (!account.hasUser) throw Error('Account not found');
  const session = await firstFactor(origin, value);
  if (!reset && (await accountStatus()).initialized) throw Error('Account setup is complete');
  if (reset || !await fs.stat(paths.qr).catch(() => null)) {
    await fs.rm(paths.qr, { force: true });
    await command(binary('authelia'), ['storage', 'user', 'totp', 'generate', value.username, '--config', paths.config, '--issuer', 'BashKitten', '--path', paths.qr, ...(reset ? ['--force'] : [])], { env: await authEnvironment() });
    await fs.chmod(paths.qr, 0o600);
  }
  if (reset) { await fs.rm(paths.complete, { force: true }); await writeJson(paths.pending, { username: value.username }); }
  const setupId = randomToken();
  for (const [key, flow] of flows) if (flow.until < Date.now()) flows.delete(key);
  if (flows.size > 8) flows.clear();
  flows.set(setupId, { cookies: session.cookies, username: value.username, origin, until: Date.now() + 10 * 60000 });
  const qr = await fs.readFile(paths.qr);
  if (qr.length > 1024 * 1024) throw Error('Invalid enrollment QR');
  return { setupId, qrDataUrl: 'data:image/png;base64,' + qr.toString('base64') };
}
export async function completeAccount({ setupId, code }) {
  const flow = flows.get(setupId);
  if (!flow || flow.until < Date.now()) throw Error('Setup expired; sign in again to continue enrollment');
  if (!/^\d{6}$/.test(code || '')) throw Error('Enter the six-digit verification code');
  await authCall(flow.origin, '/api/secondfactor/totp', { token: code }, flow.cookies);
  await writeJson(paths.complete, { username: flow.username, completed: Date.now() });
  await fs.rm(paths.pending, { force: true }); await fs.rm(paths.qr, { force: true });
  flows.delete(setupId);
  return { initialized: true };
}
