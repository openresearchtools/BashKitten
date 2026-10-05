// Authelia configuration/enrollment patterns adapted from Torkitten.
// Copyright 2026 The Torkitten Authors (Apache-2.0); BashKitten changes AGPL-3.0-only.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateDir, readJson, writeJson, randomToken } from '../common.mjs';
import { remoteDir, paths, binary } from './paths.mjs';
import { unixRequest, command } from './io.mjs';

const flows = new Map();
export async function accountStatus() {
  const initialized = Boolean(await readJson(paths.complete, null));
  return { initialized, enrollmentRequired: !initialized, hasUser: initialized || Boolean(await readJson(paths.pending, null)) };
}
export async function authEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AUTHELIA_')));
  const initialized = (await accountStatus()).initialized;
  for (const [name, key] of Object.entries({ session: 'SESSION_SECRET', storage: 'STORAGE_ENCRYPTION_KEY', jwt: 'IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET', hmac: 'IDENTITY_PROVIDERS_OIDC_HMAC_SECRET' })) {
    const file = path.join(remoteDir, name + '.secret');
    if (initialized) {
      if (!(await fs.readFile(file, 'utf8')).trim()) throw Error('Remote authentication secret is missing; reissue the identity');
    } else {
      try { await fs.writeFile(file, randomToken() + randomToken(), { mode: 0o600, flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    env['AUTHELIA_' + key + '_FILE'] = file;
  }
  env.AUTHELIA_TELEMETRY_METRICS_ENABLED = 'false';
  return env;
}
export async function renderAuthelia(origin, instanceId, native, oidc) {
  await privateDir(remoteDir);
  // Authelia rejects an empty file store. This disabled, unprivileged entry has
  // a discarded random password and is replaced by the local owner at setup.
  try {
    await fs.access(paths.users);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const password = await native.call('hash-password', { password: randomToken() });
    await fs.writeFile(paths.users, JSON.stringify({ users: { __bashkitten_setup: { disabled: true, displayname: 'Setup pending', password, groups: [] } } }), { mode: 0o600, flag: 'wx' });
  }
  const host = new URL(origin).hostname;
  if (!/^[a-z2-7]{56}\.onion$/.test(host)) throw Error('Remote authentication requires its enrolled onion');
  const config = {
    theme: 'auto',
    server: { address: `unix://${paths.auth}?umask=0077&path=login`, disable_healthcheck: true,
      asset_path: fileURLToPath(new URL('../../web/', import.meta.url)),
      endpoints: { enable_pprof: false, enable_expvars: false,
        authz: { 'forward-auth': { implementation: 'ForwardAuth', authn_strategies: [{ name: 'CookieSession' }] },
          tunnel: { implementation: 'ForwardAuth', authn_strategies: [{ name: 'HeaderAuthorization', schemes: ['Bearer'] }] } } } },
    log: { level: 'warn', format: 'json' },
    totp: { issuer: 'BashKitten', algorithm: 'sha1', digits: 6, period: 30, skew: 1, secret_size: 32, disable_reuse_security_policy: false },
    webauthn: { disable: true },
    authentication_backend: { password_reset: { disable: true }, password_change: { disable: true },
      file: { path: paths.users, watch: true, search: { email: false, case_insensitive: false } } },
    access_control: { default_policy: 'deny', rules: [{ domain: host, subject: 'group:owner', policy: 'two_factor' }] },
    session: { name: 'bashkitten_' + instanceId.slice(0, 16), same_site: 'lax', inactivity: '1h', expiration: '12h', remember_me: '30d',
      redis: { host: paths.sessionSocket, port: 0 },
      cookies: [{ domain: host, authelia_url: origin + '/login', default_redirection_url: origin + '/' }] },
    regulation: { modes: ['user'], max_retries: 3, find_time: '2m', ban_time: '5m' },
    storage: { local: { path: paths.database } },
    notifier: { filesystem: { filename: path.join(remoteDir, 'notifications.txt') } },
    identity_providers: { oidc },
    ntp: { disable_startup_check: true }, telemetry: { metrics: { enabled: false } },
  };
  await writeJson(paths.config, config);
}
export function cancelAccountSetup() { flows.clear(); }
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
export function validateAccountCredentials(value, { create = false } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value.username || '')) throw Error('Use a username of 1–64 letters, digits, dots, underscores or hyphens, starting with a letter or digit');
  if (create) {
    const length = typeof value.password === 'string' ? [...value.password].length : 0;
    if (length < 12 || length > 256 || !value.password.isWellFormed()) throw Error('Use a password of 12–256 characters');
  } else if (typeof value.password !== 'string' || value.password.length < 8 || value.password.length > 1024) {
    throw Error('Enter the existing account password');
  }
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
export async function enrollAccount(origin, value, { create = false, reset = false, native } = {}) {
  validateAccountCredentials(value, { create });
  const account = await accountStatus();
  if (create) {
    if (account.hasUser) throw Error('This server already has an account');
    // Native validation uses the same Unicode length rule as encrypted QR setup.
    // Existing-account verification above keeps accepting its original password.
    const password = await native.call('hash-password', { password: value.password });
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
  // Reuse Authelia's stored key, including when an unfinished setup resumes.
  // These secrets are returned only over the private local enrollment channel.
  const exported = await command(binary('authelia'), ['storage', 'user', 'totp', 'export', 'uri', '--config', paths.config], { env: await authEnvironment() });
  let otpauthUrl, secret;
  for (const line of exported.split(/\r?\n/)) {
    if (!line.startsWith('otpauth://totp/')) continue;
    try {
      const uri = new URL(line);
      if (decodeURIComponent(uri.pathname.slice(1)) !== 'BashKitten:' + value.username || uri.searchParams.get('issuer') !== 'BashKitten') continue;
      const key = uri.searchParams.get('secret');
      if (!/^[A-Z2-7]{16,128}$/.test(key || '')) continue;
      otpauthUrl = uri.href; secret = key;
      break;
    } catch { /* Do not expose malformed secret-bearing output in errors. */ }
  }
  if (!otpauthUrl) throw Error('Authelia did not return the account setup key');
  const setupId = randomToken();
  for (const [key, flow] of flows) if (flow.until < Date.now()) flows.delete(key);
  if (flows.size > 8) flows.clear();
  flows.set(setupId, { cookies: session.cookies, username: value.username, origin, until: Date.now() + 10 * 60000 });
  const qr = await fs.readFile(paths.qr);
  if (qr.length > 1024 * 1024) throw Error('Invalid enrollment QR');
  return { setupId, qrDataUrl: 'data:image/png;base64,' + qr.toString('base64'), secret, otpauthUrl };
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
