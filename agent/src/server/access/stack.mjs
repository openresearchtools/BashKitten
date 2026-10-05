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
import { authEnvironment, renderAuthelia, authCall } from './accounts.mjs';
import { unixRequest, command } from './io.mjs';
import { NativeTunnel } from './tunnel.mjs';
import { HostedServices } from './hosting.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const backendScript = fileURLToPath(new URL('../http/server.mjs', import.meta.url));
const quote = value => JSON.stringify(value);
const untrusted = ['Remote-User', 'Remote-Groups', 'Remote-Email', 'Remote-Name', 'X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto', 'X-Forwarded-URI', 'X-Forwarded-Method', 'X-Bashkitten-Proxy', 'X-Bashkitten-Access'];
function proxyHeaders() { return 'header_up X-Forwarded-For 127.0.0.1\nheader_up X-Forwarded-Host {http.request.hostport}\nheader_up X-Forwarded-Proto https'; }

export class AccessStack {
  constructor({ fatal } = {}) { this.fatal = fatal; this.children = []; this.info = null; this.stopping = false; this.ready = false; this.services = new HostedServices(this); }
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
      this.localToken = randomToken(); this.localGeneration = randomUUID();
      this.localCookieName = '__Host-bashkitten_local_' + identity.instanceId.replaceAll('-', '');
      // Tor must never forward to the native local listener, even with a forged Host.
      do { this.remotePort = await availablePort(0); } while (this.remotePort === port);
      this.remoteOrigins = []; this.remoteAuthOrigin = null;
      try {
        await this.launch('backend', process.execPath, [backendScript], { ...process.env,
          BASHKITTEN_ACCESS_ORIGIN: this.origin, BASHKITTEN_PROXY_TOKEN: this.proxyToken,
          BASHKITTEN_INSTANCE_TOKEN: this.instanceToken, BASHKITTEN_BACKEND_SOCKET: paths.backend,
          BASHKITTEN_AUTH_SOCKET: paths.auth, BASHKITTEN_LOCAL_COOKIE: this.localCookieName,
          BASHKITTEN_LOCAL_TOKEN: this.localToken });
        await this.waitUntil(async () => {
          const response = await unixRequest(paths.backend, '/api/instance', { headers: { host: new URL(this.origin).host, authorization: 'Bearer ' + this.instanceToken } });
          return response.status === 200;
        }, 'Agent backend');
        await this.startCaddy();
        const backend = this.children.find(child => child.name === 'backend');
        this.info = { pid: backend.pid, started: backend.started, script: backendScript, token: this.instanceToken,
          url: this.origin, requestedPort: preferred, identity: this.identity, socket: paths.backend,
          managerPid: process.pid, managerStarted: await processStart(process.pid), children: this.identities() };
        await writeJson(serverFile, this.info);
        this.ready = true;
        // Account-free Local is also the native repair path for a damaged share.
        this.remote.error = '';
        try {
          if ((await this.remote.prepare(this)).length) await this.reconfigureRemote();
        } catch (error) {
          this.remote.error = error.message;
          if (!this.ready) throw error;
        }
        return this.info;
      } catch (error) {
        failure = error; await this.stopChildren();
        // A bind race may choose another port. Authentication/config failures fail closed.
        if (error.fatal || error.message.includes('Authelia') || attempt === 3) break;
      }
    }
    throw failure;
  }
  async startNative() {
    if (!this.tunnel) this.tunnel = await NativeTunnel.launch(this);
    if (this.tunnel.closed) throw Error('Native remote controller stopped');
  }
  async startCaddy() {
    await this.writeCaddy();
    await this.launch('caddy', binary('caddy'), ['run', '--config', paths.caddyJson], { ...process.env, XDG_DATA_HOME: paths.storage });
    await this.waitUntil(async () => {
      const response = await unixRequest(paths.admin, '/pki/ca/local');
      if (response.status !== 200) return false;
      const caPem = JSON.parse(response.body).root_certificate, ca = new X509Certificate(caPem);
      if (!ca.ca) throw Error('Caddy returned an invalid CA');
      const caSha256 = ca.fingerprint256.replaceAll(':', '').toLowerCase();
      if (this.identity.caSha256 && this.identity.caSha256 !== caSha256) throw Object.assign(Error('Saved BashKitten certificate identity changed'), { fatal: true });
      this.identity = { instanceId: this.identity.instanceId, caPem, caSha256 };
      return true;
    }, 'Caddy');
    await this.waitUntil(() => verifiedHttps(this.origin, this.identity.caPem), 'HTTPS');
    if (this.remoteOrigins.length) await this.remoteRoot();
    await writeJson(paths.identity, this.identity);
  }
  async remoteRoot() {
    const state = await this.remote.state();
    if (!state.id || state.phase === 'replacing') throw Error('Remote identity is not configured');
    const response = await unixRequest(paths.admin, '/pki/ca/remote-' + state.id);
    if (response.status !== 200) throw Error('Remote CA is not ready');
    const pem = JSON.parse(response.body).root_certificate, ca = new X509Certificate(pem);
    if (!ca.ca || !ca.verify(ca.publicKey)) throw Error('Caddy returned an invalid remote CA');
    if (state.phase === 'ready' && ca.fingerprint256.replaceAll(':', '').toLowerCase() !== state.caSha256) throw Error('The remote CA changed; reissue the identity in Share Local');
    return pem;
  }
  async startAuthentication() {
    if (!this.remoteAuthOrigin) throw Error('Set up Share Local before starting remote authentication');
    if (this.authStarted) return;
    if (this.authStarting) return this.authStarting;
    this.authStarting = (async () => {
      await this.startNative();
      // Authelia encrypts its session values with the persistent session secret.
      // Keep them durable across whole-group shutdown without a public listener.
      await privateDir(paths.sessionStore);
      await fs.writeFile(paths.sessionConfig, `port 0\nunixsocket ${quote(paths.sessionSocket)}\nunixsocketperm 700\nprotected-mode yes\ndaemonize no\nset-proc-title no\nloglevel warning\ndir ${quote(paths.sessionStore)}\nsave ""\nappendonly yes\nappendfsync always\n`, { mode: 0o600 });
      await this.launch('valkey', binary('valkey-server'), [paths.sessionConfig], process.env);
      await this.waitUntil(() => new Promise(resolve => {
        const client = net.createConnection(paths.sessionSocket);
        let response = '';
        client.setTimeout(2000, () => client.destroy());
        client.on('connect', () => client.write('*1\r\n$4\r\nPING\r\n'));
        client.on('data', chunk => { response += chunk; if (response.includes('\r\n')) client.destroy(); });
        client.on('error', () => {});
        client.on('close', () => resolve(response === '+PONG\r\n'));
      }), 'Valkey');
      const state = await this.remote.state();
      await renderAuthelia(this.remoteAuthOrigin, state.id, this.tunnel, await this.remote.authentication());
      this.authEnv = await authEnvironment();
      await command(binary('authelia'), ['config', 'validate', '--config', paths.config], { env: this.authEnv });
      await this.launch('authelia', binary('authelia'), ['--config', paths.config], this.authEnv);
      await this.waitUntil(async () => { await authCall(this.remoteAuthOrigin, '/api/health', undefined, '', 2000); return true; }, 'Authelia');
      this.authStarted = true;
      if (this.info) { this.info.children = this.identities(); await writeJson(serverFile, this.info); }
    })();
    try { await this.authStarting; }
    catch (error) { await this.stopAuthentication(); throw error; }
    finally { this.authStarting = null; }
  }
  async stopNamed(name) {
    const record = this.children.find(child => child.name === name);
    if (!record) return;
    record.stopping = true;
    await terminate(record);
    this.children = this.children.filter(child => child !== record);
    await writeJson(paths.group, { manager: process.pid, managerStarted: await processStart(process.pid), children: this.identities() });
  }
  async stopAuthentication() {
    this.remote?.cancelPending();
    this.authStarted = false;
    await this.stopNamed('remote');
    this.tunnel = null; this.tunnelStarted = false;
    await this.stopNamed('authelia');
    await this.stopNamed('valkey');
    for (const file of [paths.auth, paths.sessionSocket, paths.tunnel]) await fs.rm(file, { force: true });
    if (this.info) { this.info.children = this.identities(); await writeJson(serverFile, this.info); }
  }
  identities() { return this.children.map(({ name, pid, started, file }) => ({ name, pid, started, file })); }
  async launch(name, file, args, env, { pipe = false } = {}) {
    const logFile = path.join(dataDir, name + '.log');
    const stat = await fs.stat(logFile).catch(() => null);
    if (stat?.size > 256000) { const text = await fs.readFile(logFile, 'utf8'); await fs.writeFile(logFile, text.slice(-128000), { mode: 0o600 }); }
    const log = openSync(logFile, 'a', 0o600);
    const child = spawn(file, args, { stdio: pipe ? ['pipe', 'pipe', log] : ['ignore', log, log], env }); closeSync(log);
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    const record = { name, file, pid: child.pid, started: await processStart(child.pid), child };
    this.children.push(record); await writeJson(paths.group, { manager: process.pid, managerStarted: await processStart(process.pid), children: this.identities() });
    child.once('exit', (code, signal) => {
      record.exit = `${signal || code}`;
      if (this.ready && !this.stopping && !record.stopping) { this.ready = false; this.fatal?.(Error(`${name} stopped (${signal || code})`)); }
    });
    return record;
  }
  async waitUntil(probe, name) {
    const until = Date.now() + 25000;
    while (Date.now() < until) {
      const dead = this.children.find(child => child.exit !== undefined && !child.stopping);
      if (dead) throw Error(`${dead.name} stopped during startup; see ${dead.name}.log`);
      try { if (await probe()) return; } catch (error) { if (error.fatal) throw error; }
      await sleep(100);
    }
    throw Error(`${name} did not become ready; see its service log`);
  }
  async writeCaddy() {
    const remote = this.remoteAuthOrigin ? await this.remote.state() : {};
    const caId = remote.id && remote.phase !== 'replacing' ? 'remote-' + remote.id : null;
    const strip = untrusted.map(name => `request_header -${name}`).join('\n');
    const backend = access => `reverse_proxy ${quote('unix/' + paths.backend)} {\n${proxyHeaders()}\nheader_up X-Bashkitten-Proxy ${this.proxyToken}\nheader_up X-Bashkitten-Access ${access}\nflush_interval -1\n}`;
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
${caId ? `ca ${caId} {\nname "BashKitten Remote CA"\n}` : ''}
}
}
${this.origin} {
bind 127.0.0.1
tls internal
route {
${strip}
@private path /api/instance /api/instance/* /login /login/*
respond @private "Not found" 404
${backend('local')}
}
}
`;
    const addresses = (this.remoteOrigins || []).map(origin => origin + ':' + this.remotePort);
    if (addresses.length) config += `${addresses.join(', ')} {
bind 127.0.0.1
tls {
issuer internal {
ca ${caId}
}
}
route {
${strip}
@private path /api/instance /api/instance/* /.well-known/bashkitten-ca /login/api/authz/*
respond @private "Not found" 404
@portal path /login /login/*
handle @portal {
reverse_proxy ${quote('unix/' + paths.auth)} {
${proxyHeaders()}
}
}
@carrier path /tunnel/* /services /services/*
handle @carrier {
route {
request_header -Cookie
forward_auth ${quote('unix/' + paths.auth)} {
uri /login/api/authz/tunnel
${proxyHeaders()}
}
reverse_proxy ${quote('unix/' + paths.tunnel)} {
${proxyHeaders()}
}
}
}
@assets path /app.css /logo.png /favicon.ico
handle @assets {
${backend('remote')}
}
handle {
forward_auth ${quote('unix/' + paths.auth)} {
uri /login/api/authz/forward-auth
${proxyHeaders()}
copy_headers Remote-User Remote-Groups Remote-Email Remote-Name
}
${backend('remote')}
}
}
}
`;
    await fs.writeFile(paths.caddy, config, { mode: 0o600 });
    // These native Caddy options are JSON-only: isolate remote signing/leaf
    // storage and pin the exact enrolled client leaf, leaving Local untouched.
    const adapted = JSON.parse(await command(binary('caddy'), ['adapt', '--config', paths.caddy, '--adapter', 'caddyfile'], { stdoutOnly: true }));
    if (caId) {
      await privateDir(paths.remoteStorage);
      const storage = { module: 'file_system', root: paths.remoteStorage };
      adapted.apps.pki.certificate_authorities[caId].storage = storage;
      let isolated = false;
      for (const policy of adapted.apps.tls?.automation?.policies || []) {
        if (policy.issuers?.some(issuer => issuer.module === 'internal' && issuer.ca === caId)) { policy.storage = storage; isolated = true; }
      }
      if (addresses.length && !isolated) throw Error('Caddy did not isolate the remote certificate store');
    }
    if (addresses.length) {
      let found = false;
      for (const server of Object.values(adapted.apps.http.servers)) {
        if (!server.listen.includes('127.0.0.1:' + this.remotePort)) continue;
        found = true; server.protocols = ['h1'];
        // Caddy omits default TLS policies until provisioning. Declare this
        // listener's required client authentication before loading the config.
        server.tls_connection_policies = [{ client_authentication: {
          mode: 'require_and_verify', ca: { provider: 'file', pem_files: [paths.remoteCertificate] },
          verifiers: [{ verifier: 'leaf', leaf_certs_loaders: [{ loader: 'file', files: [paths.remoteCertificate] }] }],
        } }];
      }
      if (!found) throw Error('Caddy did not create the remote TLS listener');
    }
    await writeJson(paths.caddyJson, adapted);
  }
  async reconfigureRemote() {
    if (!this.ready || this.stopping) throw Error('Turn on Agent before changing remote access');
    this.reconfiguring = true;
    this.ready = false;
    try {
      await this.stopNamed('tor');
      this.remoteOrigins = await this.remote.prepare(this);
      this.remoteAuthOrigin = this.remoteOrigins[0] || null;
      if (this.remoteOrigins.length) { await this.startAuthentication(); await this.remote.startTunnel(); }
      else await this.stopAuthentication();
      // The local listener and its native session stay live while publishing changes.
      await this.writeCaddy();
      await command(binary('caddy'), ['reload', '--config', paths.caddyJson, '--address', 'unix/' + paths.admin]);
      if (this.remoteOrigins.length) await this.remoteRoot();
      await this.remote.publish();
      this.info.children = this.identities(); await writeJson(serverFile, this.info);
      this.remote.error = '';
      this.ready = true;
    } catch (error) {
      this.remote.error = error.message;
      try {
        await this.closeRemote();
        this.ready = true;
      } catch (failure) { this.fatal?.(failure); throw failure; }
      throw error;
    }
    finally { this.reconfiguring = false; }
  }
  async closeRemote() {
    await this.stopNamed('tor');
    await this.stopAuthentication();
    this.remoteOrigins = []; this.remoteAuthOrigin = null;
    // Close remote ingress without changing Local's listener, trust or session.
    if (this.children.some(child => child.name === 'caddy')) {
      await this.writeCaddy();
      await command(binary('caddy'), ['reload', '--config', paths.caddyJson, '--address', 'unix/' + paths.admin]);
    } else await this.startCaddy(); // Identity reissue deliberately stops Caddy.
    this.info.children = this.identities(); await writeJson(serverFile, this.info);
    if (!await this.localReady()) throw Error('The Local listener could not be restored after remote publishing failed');
  }
  async reload() {
    if (!this.ready || this.stopping) return;
    await this.writeCaddy();
    await command(binary('caddy'), ['reload', '--config', paths.caddyJson, '--address', 'unix/' + paths.admin]);
  }
  async refreshFileManager(block = false) {
    if (!this.children.some(child => child.name === 'backend' && child.exit === undefined)) return;
    const result = await unixRequest(paths.backend, '/api/instance/file-manager', { method: 'POST',
      headers: { host: new URL(this.origin).host, authorization: 'Bearer ' + this.instanceToken, 'content-type': 'application/json' },
      body: JSON.stringify({ block }), timeout: 120000 });
    if (result.status !== 200) throw Error('The backend could not finish revoking remote file operations');
  }
  async healthy() {
    if (!this.ready || !this.info) return false;
    for (const child of this.children) if (!await sameProcess(child)) return false;
    try {
      if (this.authStarted) await authCall(this.remoteAuthOrigin, '/api/health', undefined, '', 2000);
      return await verifiedHttps(this.origin, this.identity.caPem);
    } catch { return false; }
  }
  async localReady() { return Boolean(this.identity?.caPem) && verifiedHttps(this.origin, this.identity.caPem); }
  async status() { return { identity: this.identity || await readJson(paths.identity, null), auth: { mode: 'native-local', generation: this.localGeneration } }; }
  async stopIngress() {
    this.stopping = true; this.ready = false;
    const caddy = this.children.find(child => child.name === 'caddy');
    if (caddy) await terminate(caddy);
  }
  async stop() { this.stopping = true; this.ready = false; await this.stopChildren(); this.info = null; }
  async stopChildren() {
    this.remote?.cancelPending();
    for (const child of [...this.children].reverse()) await terminate(child);
    this.children = []; this.authStarted = false; this.tunnel = null; this.tunnelStarted = false; this.localToken = null; this.localGeneration = null;
    await fs.rm(paths.group, { force: true });
    for (const file of [paths.auth, paths.sessionSocket, paths.tunnel, paths.admin, paths.backend, paths.backendInfo]) await fs.rm(file, { force: true });
  }
  async cleanPrevious() {
    const group = await readJson(paths.group, null);
    if (group?.manager && group.manager !== process.pid && group.managerStarted && await processStart(group.manager) === group.managerStarted) throw Error('Another access controller is still running');
    for (const child of [...(group?.children || [])].reverse()) await terminate(child);
    const legacy = await readJson(serverFile, null);
    if (legacy && await backendAlive(legacy)) await terminate({ pid: legacy.pid, started: legacy.started, file: legacy.script });
    for (const file of [paths.auth, paths.sessionSocket, paths.tunnel, paths.admin, paths.backend, paths.backendInfo]) await fs.rm(file, { force: true });
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
