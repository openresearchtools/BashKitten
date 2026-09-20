import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

test('HTTPS uses its own origin and persistent Secure login cookies', { timeout: 30000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-tls-'));
  const cert = path.join(dir, 'cert.pem'), key = path.join(dir, 'key.pem');
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1']);
  const child = spawn(process.execPath, ['src/server/http/server.mjs', '--port=0'], { env: { ...process.env,
    BASHKITTEN_DATA_DIR: dir, PI_CODING_AGENT_DIR: path.join(dir, 'pi'), BASHKITTEN_TLS_CERT: cert, BASHKITTEN_TLS_KEY: key }, stdio: 'ignore' });
  t.after(async () => { child.kill('SIGTERM'); if (child.exitCode === null) await new Promise(r => child.once('exit', r)); await fs.rm(dir, { recursive: true, force: true }); });
  let info;
  for (let i = 0; i < 100; i++) {
    try { info = JSON.parse(await fs.readFile(path.join(dir, 'server.json'))); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(info, 'TLS listener ready');
  const ca = await fs.readFile(cert);
  const request = (route, origin, value) => new Promise((resolve, reject) => {
    const req = https.request(info.url + route, { ca, method: value ? 'POST' : 'GET', headers: { ...(origin ? { origin } : {}), 'Content-Type': 'application/json' } }, res => {
      let body = ''; res.on('data', b => { body += b; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) }));
    }); req.on('error', reject); req.end(value ? JSON.stringify(value) : undefined);
  });
  const credentials = { username: 'tls-test', password: 'local-test-password' };
  assert.equal((await request('/api/signup', info.url.replace('https:', 'http:'), credentials)).status, 403);
  const signed = await request('/api/signup', info.url, credentials);
  assert.equal(signed.status, 200);
  assert.match(signed.headers['set-cookie'][0], /; Secure/);
  assert.match(signed.headers['set-cookie'][0], /HttpOnly; SameSite=Strict/);
});
