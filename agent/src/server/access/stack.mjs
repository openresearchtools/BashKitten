// Caddy routing adapted from Torkitten (Apache-2.0); see NOTICE.
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import net from 'node:net';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { X509Certificate, randomUUID } from 'node:crypto';
import { dataDir, privateDir, readJson, writeJson, randomToken } from '../common.mjs';
import { processStart, backendAlive, serverFile } from '../instance.mjs';
import { accessDir, runDir, paths, binary } from './paths.mjs';
import { authEnvironment, renderAuthelia, accountStatus, authCall } from './accounts.mjs';
import { unixRequest, command } from './io.mjs';
import { HostedServices } from './hosting.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const backendScript = fileURLToPath(new URL('../http/server.mjs', import.meta.url));
const quote = value => JSON.stringify(value);
const portal = '/login /login/ /login/2fa/one-time-password /login/2fa/password /login/authenticated /login/logout /login/favicon.ico /login/manifest.json /login/robots.txt /login/static/* /login/locales /login/locales/* /login/api/state /login/api/configuration /login/api/configuration/password-policy /login/api/checks/safe-redirection /login/api/firstfactor /login/api/logout /login/api/user/info /login/api/secondfactor/totp';
const untrusted = ['Remote-User', 'Remote-Groups', 'Remote-Email', 'Remote-Name', 'X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto', 'X-Forwarded-URI', 'X-Forwarded-Method', 'X-Bashkitten-Proxy'];
function proxyHeaders() { return 'header_up X-Forwarded-For 127.0.0.1\nheader_up X-Forwarded-Host {http.request.hostport}\nheader_up X-Forwarded-Proto https'; }

export class AccessStack {
  constructor({ fatal, llamaProxy = () => null } = {}) { this.fatal = fatal; this.llamaProxy = llamaProxy; this.children = []; this.info = null; this.stopping = false; this.ready = false; this.hosting = new HostedServices(this); }
  async start() {
    if (this.ready) return this.info;
    this.stopping = false;
    await privateDir(accessDir); await privateDir(runDir); await privateDir(paths.storage);
    await this.cleanPrevious();
    let identity = await readJson(paths.identity, null);
    if (!identity) { identity = { instanceId: randomUUID() }; await writeJson(paths.identity, identity); }
    this.identity = identity;
    const config = await readJson(path.join(dataDir, 'settings.json'), {});
    const previous = await readJson(serverFile, null);
    const preferred = Number(config.web_port || previous?.requestedPort || 3939);
    let selected = previous?.requestedPort === preferred ? Number(new URL(previous.url).port) : preferred;
    let failure;
    for (let attempt = 0; attempt < 4; attempt++) {
      const port = await availablePort(attempt ? 0 : selected);
      this.origin = 'https://127.0.0.1:' + port;
      this.proxyToken = randomToken(); this.instanceToken = randomToken();
      try {
        this.remoteOrigins = this.remote ? await this.remote.prepare(this, port) : [];
        await renderAuthelia([this.origin, ...this.remoteOrigins], identity.instanceId);
        this.authEnv = await authEnvironment();
        await command(binary('authelia'), ['config', 'validate', '--config', paths.config], { env: this.authEnv });
        await this.launch('authelia', binary('authelia'), ['--config', paths.config], this.authEnv);
        await this.waitUntil(async () => { await authCall(this.origin, '/api/health', undefined, '', 2000); return true; }, 'Authelia');
        await this.launch('backend', process.execPath, [backendScript], { ...process.env,
          BASHKITTEN_ACCESS_ORIGIN: this.origin, BASHKITTEN_PROXY_TOKEN: this.proxyToken,
          BASHKITTEN_INSTANCE_TOKEN: this.instanceToken, BASHKITTEN_BACKEND_SOCKET: paths.backend,
          BASHKITTEN_AUTH_SOCKET: paths.auth });
        await this.waitUntil(async () => {
          const response = await unixRequest(paths.backend, '/api/instance', { headers: { host: new URL(this.origin).host, authorization: 'Bearer ' + this.instanceToken } });
          return response.status === 200;
        }, 'Agent backend');
        await this.writeCaddy();
        await this.launch('caddy', binary('caddy'), ['run', '--config', paths.caddy, '--adapter', 'caddyfile'], { ...process.env, XDG_DATA_HOME: paths.storage });
        await this.waitUntil(async () => {
          const response = await unixRequest(paths.admin, '/pki/ca/local');
          if (response.status !== 200) return false;
          const caPem = JSON.parse(response.body).root_certificate;
          const ca = new X509Certificate(caPem);
          if (!ca.ca) throw Error('Caddy returned an invalid CA');
          const caSha256 = ca.fingerprint256.replaceAll(':', '').toLowerCase();
          if (identity.caSha256 && identity.caSha256 !== caSha256) throw Object.assign(Error('Saved BashKitten certificate identity changed'), { fatal: true });
          this.identity = { instanceId: identity.instanceId, caPem, caSha256 };
          return true;
        }, 'Caddy');
        await this.waitUntil(() => verifiedHttps(this.origin, this.identity.caPem), 'HTTPS');
        await writeJson(paths.identity, this.identity);
        const backend = this.children.find(child => child.name === 'backend');
        this.info = { pid: backend.pid, started: backend.started, script: backendScript, token: this.instanceToken,
          url: this.origin, requestedPort: preferred, identity: this.identity, socket: paths.backend,
          managerPid: process.pid, managerStarted: await processStart(process.pid), children: this.identities() };
        await writeJson(serverFile, this.info);
        this.ready = true;
        return this.info;
      } catch (error) {
        failure = error; await this.stopChildren();
        // A bind race may choose another port. Authentication/config failures fail closed.
        if (error.fatal || error.message.includes('Authelia') || attempt === 3) break;
      }
    }
    throw failure;
  }
  identities() { return this.children.map(({ name, pid, started, file }) => ({ name, pid, started, file })); }
  async launch(name, file, args, env) {
    const logFile = path.join(dataDir, name + '.log');
    const stat = await fs.stat(logFile).catch(() => null);
    if (stat?.size > 256000) { const text = await fs.readFile(logFile, 'utf8'); await fs.writeFile(logFile, text.slice(-128000), { mode: 0o600 }); }
    const log = openSync(logFile, 'a', 0o600);
    const child = spawn(file, args, { stdio: ['ignore', log, log], env }); closeSync(log);
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    const record = { name, file, pid: child.pid, started: await processStart(child.pid), child };
    this.children.push(record); await writeJson(paths.group, { manager: process.pid, managerStarted: await processStart(process.pid), children: this.identities() });
    child.once('exit', (code, signal) => {
      record.exit = `${signal || code}`;
      if (this.ready && !this.stopping) { this.ready = false; this.fatal?.(Error(`${name} stopped (${signal || code})`)); }
    });
  }
  async waitUntil(probe, name) {
    const until = Date.now() + 25000;
    while (Date.now() < until) {
      const dead = this.children.find(child => child.exit !== undefined);
      if (dead) throw Error(`${dead.name} stopped during startup; see ${dead.name}.log`);
      try { if (await probe()) return; } catch (error) { if (error.fatal) throw error; }
      await sleep(100);
    }
    throw Error(`${name} did not become ready; see its service log`);
  }
  async writeCaddy() {
    const addresses = [this.origin, ...(this.remoteOrigins || []).map(origin => origin + ':' + new URL(this.origin).port)];
    const strip = untrusted.map(name => `request_header -${name}`).join('\n');
    const backend = `reverse_proxy ${quote('unix/' + paths.backend)} {\n${proxyHeaders()}\nheader_up X-Bashkitten-Proxy ${this.proxyToken}\nflush_interval -1\n}`;
    let config = `{
admin ${quote('unix/' + paths.admin)}
persist_config off
storage file_system {
root ${quote(paths.storage)}
}
skip_install_trust
auto_https disable_redirects
pki {
ca local {
name "BashKitten Local CA"
}
}
}
${addresses.join(', ')} {
bind 127.0.0.1
tls internal
route {
${strip}
@private path /api/instance
respond @private "Not found" 404
@portal path ${portal}
handle @portal {
reverse_proxy ${quote('unix/' + paths.auth)} {
${proxyHeaders()}
}
}
@assets path /app.css /logo.png /favicon.ico /.well-known/bashkitten-ca
handle @assets {
${backend}
}
handle {
forward_auth ${quote('unix/' + paths.auth)} {
uri /login/api/authz/forward-auth
${proxyHeaders()}
copy_headers Remote-User Remote-Groups Remote-Email Remote-Name
}
${backend}
}
}
}
`;
    config += await this.hosting.routes({ port: new URL(this.origin).port, authSocket: paths.auth, strip, proxyHeaders: proxyHeaders() });
    const proxy = await this.llamaProxy();
    if (proxy?.host && /^[a-z2-7]{56}\.onion$/.test(proxy.host) && /^127\.0\.0\.1:\d+$/.test(proxy.upstream)) {
      config += `\nhttps://${proxy.host}:${new URL(this.origin).port} {\nbind 127.0.0.1\ntls internal\nroute {\n${strip}\nrequest_header -Cookie\n@identity {\npath /.well-known/bashkitten-ca\nmethod GET\n}\nhandle @identity {\n${backend}\n}\nhandle {\nreverse_proxy ${proxy.upstream} {\nflush_interval -1\n}\n}\n}\n}\n`;
    }
    await fs.writeFile(paths.caddy, config, { mode: 0o600 });
  }
  async reloadPublisher() {
    const record = this.children.find(child => child.name === 'tor');
    if (!record || !await sameProcess(record)) throw Error('Tor publisher is not running');
    process.kill(record.pid, 'SIGHUP');
  }
  async reconfigureRemote({ restartTor = true } = {}) {
    if (!this.ready || this.stopping) throw Error('Turn on Agent before changing remote access');
    this.reconfiguring = true;
    this.ready = false;
    const previous = JSON.stringify(this.remoteOrigins || []);
    const stopNamed = async name => {
      const record = this.children.find(child => child.name === name);
      if (record) { await terminate(record); this.children = this.children.filter(child => child !== record); }
    };
    try {
      if (restartTor) await stopNamed('tor');
      this.remoteOrigins = await this.remote.prepare(this, Number(new URL(this.origin).port), { reload: !restartTor });
      if (JSON.stringify(this.remoteOrigins) !== previous) {
        // Keep the proxy accepting its already-authorized control request while
        // Authelia's cookie providers change. New auth checks fail closed during
        // the socket replacement; Caddy applies the new hosts by live reload.
        await stopNamed('authelia');
        await fs.rm(paths.auth, { force: true });
        await renderAuthelia([this.origin, ...this.remoteOrigins], this.identity.instanceId);
        await command(binary('authelia'), ['config', 'validate', '--config', paths.config], { env: this.authEnv });
        await this.launch('authelia', binary('authelia'), ['--config', paths.config], this.authEnv);
        await this.waitUntil(async () => { await authCall(this.origin, '/api/health', undefined, '', 2000); return true; }, 'Authelia');
      }
      await this.writeCaddy();
      await command(binary('caddy'), ['reload', '--config', paths.caddy, '--adapter', 'caddyfile', '--address', 'unix/' + paths.admin]);
      this.info.children = this.identities(); await writeJson(serverFile, this.info);
      this.ready = true;
    } catch (error) { this.fatal?.(error); throw error; }
    finally { this.reconfiguring = false; }
  }
  async reload() {
    if (!this.ready || this.stopping) return;
    await this.writeCaddy();
    await command(binary('caddy'), ['reload', '--config', paths.caddy, '--adapter', 'caddyfile', '--address', 'unix/' + paths.admin]);
  }
  async healthy() {
    if (!this.ready || !this.info) return false;
    for (const child of this.children) if (!await sameProcess(child)) return false;
    try {
      await authCall(this.origin, '/api/health', undefined, '', 2000);
      return await verifiedHttps(this.origin, this.identity.caPem);
    } catch { return false; }
  }
  async status() { return { identity: this.identity || await readJson(paths.identity, null), auth: await accountStatus() }; }
  async stopIngress() {
    this.stopping = true; this.ready = false;
    const caddy = this.children.find(child => child.name === 'caddy');
    if (caddy) await terminate(caddy);
  }
  async stop() { this.stopping = true; this.ready = false; await this.stopChildren(); this.info = null; }
  async stopChildren() {
    for (const child of [...this.children].reverse()) await terminate(child);
    this.children = [];
    await fs.rm(paths.group, { force: true });
    for (const file of [paths.auth, paths.admin, paths.backend, paths.backendInfo]) await fs.rm(file, { force: true });
  }
  async cleanPrevious() {
    const group = await readJson(paths.group, null);
    if (group?.manager && group.manager !== process.pid && group.managerStarted && await processStart(group.manager) === group.managerStarted) throw Error('Another access controller is still running');
    for (const child of [...(group?.children || [])].reverse()) await terminate(child);
    const legacy = await readJson(serverFile, null);
    if (legacy && await backendAlive(legacy)) await terminate({ pid: legacy.pid, started: legacy.started, file: legacy.script });
    for (const file of [paths.auth, paths.admin, paths.backend, paths.backendInfo]) await fs.rm(file, { force: true });
  }
}
async function availablePort(preferred) {
  const server = net.createServer();
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(preferred, '127.0.0.1', resolve); }); }
  catch (error) { if (error.code === 'EADDRINUSE' && preferred) return availablePort(0); throw error; }
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
export async function sameProcess(child) {
  if (!child?.pid || !child.started || await processStart(child.pid) !== child.started) return false;
  try { return (await fs.readFile(`/proc/${child.pid}/cmdline`, 'utf8')).split('\0').includes(child.file); } catch { return false; }
}
async function terminate(child) {
  if (!await sameProcess(child)) return;
  process.kill(child.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 100 && await sameProcess(child); attempt++) await sleep(50);
  if (await sameProcess(child)) process.kill(child.pid, 'SIGKILL');
  for (let attempt = 0; attempt < 40 && await sameProcess(child); attempt++) await sleep(50);
  if (await sameProcess(child)) throw Error(`${child.name || 'Owned process'} has not stopped`);
}
export function verifiedHttps(origin, ca) {
  return new Promise(resolve => {
    const req = https.get(origin + '/.well-known/bashkitten-ca', { ca, rejectUnauthorized: true }, res => { res.resume(); resolve(res.statusCode === 200); });
    req.setTimeout(2000, () => req.destroy()); req.on('error', () => resolve(false));
  });
}
