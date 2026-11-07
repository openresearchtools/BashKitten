// SPDX-License-Identifier: AGPL-3.0-only
// Independent publishing stacks reuse the existing Caddy, Authelia, process
// guard and Chisel owners. Applications keep their one existing service owner.
import fs from 'node:fs/promises';
import path from 'node:path';
import tls from 'node:tls';
import http from 'node:http';
import { lookup } from 'node:dns/promises';
import { createInterface } from 'node:readline';
import { privateDir, readJson, writeJson } from '../common.mjs';
import { accessDir, binary, sharingKinds, sharingScope } from './paths.mjs';
import { AccessStack, availablePort } from './stack.mjs';
import { RemoteAccess } from './remote.mjs';
import { command } from './io.mjs';

const groupFile = path.join(accessDir, 'sharing.json');
const quickAddress = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

class SharingStack extends AccessStack {
  constructor(owner, remote, scope) {
    super({ owner, scope, fatal: error => { remote.error = error.message; } });
    this.remote = remote; remote.stack = this;
    this.services = owner.services;
    this.transport = null;
  }
  async initialize() {
    this.stopping = false; this.ready = this.owner.ready;
    this.origin = this.owner.origin; this.proxyToken = this.owner.proxyToken;
    this.instanceToken = this.owner.instanceToken;
    if (!this.remotePort) {
      const used = new Set([this.owner.remotePort, ...[...(this.owner.sharing?.stacks.values() || [])].map(stack => stack.remotePort)]);
      do { this.remotePort = await availablePort(0); } while (used.has(this.remotePort));
    }
    this.remoteOrigins ||= []; this.remoteAuthOrigin ||= null;
    await privateDir(this.scope.accessDir); await privateDir(this.scope.runDir);
  }
  async startCaddy() {
    await this.writeCaddy();
    if (this.children.some(child => child.name === 'caddy' && child.exit === undefined)) {
      await command(binary('caddy'), ['reload', '--config', this.paths.caddyJson, '--address', 'unix/' + this.paths.admin]);
    } else {
      await this.launch('caddy', binary('caddy'), ['run', '--config', this.paths.caddyJson], { ...process.env, XDG_DATA_HOME: this.paths.storage });
    }
    await this.waitUntil(async () => { await this.remoteRoot(); return true; }, 'Sharing Caddy');
    if (this.remoteOrigins.length) {
      const ca = await this.remoteRoot(), host = await this.remote.hostname();
      // Caddy obtains its internal leaf asynchronously after reload. Wait for
      // actual server-identity verification before reporting the route ready.
      await this.waitUntil(() => new Promise(resolve => {
        const socket = tls.connect({ host: '127.0.0.1', port: this.remotePort, servername: host, ca, rejectUnauthorized: true });
        socket.setTimeout(2000, () => socket.destroy());
        let verified = false;
        socket.once('secureConnect', () => { verified = true; socket.destroy(); });
        socket.once('error', () => {});
        socket.once('close', () => resolve(verified));
      }), 'Sharing TLS');
    }
  }
  async startTransport() {
    await this.startNative();
    if (this.scope.kind !== 'cloudflare') {
      // tsnet.Start owns initial login and saved-profile reconnection. Merely
      // observing startup must not force an interactive provider login.
      if (!this.transport) this.transport = await this.tunnel.call('transport-start', {
        kind: this.scope.kind, dir: path.join(this.scope.remoteDir, 'network'),
        host: await this.remote.hostname(), initialize: (await this.remote.state()).phase !== 'ready', target: '127.0.0.1:' + this.remotePort,
      });
      else this.transport = await this.tunnel.call('transport-status');
      if (this.transport.error) throw Error(this.transport.error);
      return this.transport;
    }
    if (this.children.some(child => child.name === 'cloudflared' && child.exit === undefined && !child.stopping)) return this.transportStatus();
    this.transport = { kind: 'cloudflare', state: 'starting' };
    // Native cloudflared's TCP origin is its supported WebSocket byte carrier.
    // The bytes are the enrolled Caddy TLS stream; Cloudflare cannot terminate it.
    const config = path.join(this.scope.remoteDir, 'cloudflared.yml');
    await fs.writeFile(config, '{}\n', { mode: 0o600 });
    await this.launch('cloudflared', binary('cloudflared'), [
      'tunnel', '--config', config, '--quick-service', 'https://api.trycloudflare.com', '--no-autoupdate', '--url', 'tcp://127.0.0.1:' + this.remotePort,
      '--protocol', 'http2', '--loglevel', 'info', '--metrics', '127.0.0.1:0',
    ], { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !['OTEL_', 'SENTRY_', 'TUNNEL_', 'CLOUDFLARED_', 'CLOUDFLARE_', 'CF_'].some(prefix => key.startsWith(prefix)))), SENTRY_DSN: '' }, { capture: true });
    // Provisioning and public DNS can take longer than the controller action.
    // The existing pending setup/status flow waits for upstream readiness.
    return this.transportStatus();
  }
  captureOutput(name, output) {
    if (name !== 'cloudflared') return;
    const lines = createInterface({ input: output, crlfDelay: Infinity });
    lines.on('line', line => {
      const address = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
      if (this.transport?.state === 'starting' && !this.transport.address && address && quickAddress.test(address)) this.transport.address = address;
      const metrics = /Starting metrics server on 127\.0\.0\.1:([0-9]+)\/metrics\b/.exec(line);
      if (metrics && Number(metrics[1]) > 0 && Number(metrics[1]) <= 65535) this.metricsPort = Number(metrics[1]);
    });
  }
  async cloudflareReady() {
    if (!this.metricsPort || !this.transport?.address) return false;
    const connected = await new Promise(resolve => {
      const request = http.get({ host: '127.0.0.1', port: this.metricsPort, path: '/ready' }, response => { response.resume(); resolve(response.statusCode === 200); });
      request.setTimeout(2000, () => request.destroy()); request.once('error', () => resolve(false));
    });
    if (!connected) return false;
    // Quick provisioning may print a name before its public DNS is published.
    // This is only the explicitly selected provider address; the private Agent
    // identity is never resolved or sent outside its enrolled TLS stream.
    let timer;
    try {
      return await Promise.race([lookup(new URL(this.transport.address).hostname).then(() => true, () => false), new Promise(resolve => { timer = setTimeout(() => resolve(false), 2000); })]);
    } finally { clearTimeout(timer); }
  }
  async transportStatus() {
    if (this.scope.kind === 'cloudflare' && this.transport?.address) this.transport.state = await this.cloudflareReady() ? 'running' : 'starting';
    if (this.scope.kind !== 'cloudflare' && this.transport && this.tunnel && !this.tunnel.closed) {
      this.transport = await this.tunnel.call('transport-status');
    }
    return this.transport || { kind: this.scope.kind, state: 'off' };
  }
  async reconfigureRemote() {
    if (!this.owner.ready || this.owner.stopping) throw Error('Turn on Local before publishing');
    await this.initialize(); this.reconfiguring = true;
    try {
      if (this.transport && (await this.transportStatus()).state === 'error') await this.closeRemote();
      this.remoteOrigins = await this.remote.prepare(this);
      this.remoteAuthOrigin = this.remoteOrigins[0] || null;
      if (!this.remoteOrigins.length) { await this.closeRemote(); return; }
      await this.startCaddy(); await this.startAuthentication(); await this.remote.startTunnel();
      await this.remote.publish(); this.remote.error = '';
    } catch (error) {
      this.remote.error = error.message; await this.closeRemote(); throw error;
    } finally { this.reconfiguring = false; this.ready = this.owner.ready; }
  }
  async closeRemote() {
    this.remote.cancelPending(); this.authStarted = false; this.tunnelStarted = false;
    const failures = [];
    // The native helper owns its provider goroutines and closes them on SIGTERM.
    // Use the existing bounded exact-process owner, including if provider IPC
    // stopped responding; each remaining daemon still receives cleanup.
    for (const name of ['cloudflared', 'remote', 'authelia', 'valkey', 'caddy']) {
      try { await this.stopNamed(name); } catch (error) { failures.push(error); }
    }
    this.transport = null; this.metricsPort = null; this.tunnel = null;
    this.remoteOrigins = []; this.remoteAuthOrigin = null;
    for (const file of [this.paths.admin, this.paths.auth, this.paths.tunnel, this.paths.sessionSocket]) await fs.rm(file, { force: true });
    if (failures.length) throw new AggregateError(failures, 'The sharing stack could not completely stop');
  }
  async refreshFileManager(block = false) { return this.owner.refreshFileManager(block, this.scope.kind); }
  async cleanPrevious() {
    // The standard owner checks the private process identity before cleanup.
    await super.cleanPrevious();
  }
}

export class SharingInstances {
  constructor(owner, tor, schedule) {
    this.owner = owner; this.tor = tor; this.stacks = new Map(); this.remotes = new Map([['tor', tor]]);
    this.enabled = true; this.loaded = false;
    tor.group = this;
    for (const kind of sharingKinds.slice(1)) {
      const scope = sharingScope(kind), remote = new RemoteAccess({ schedule, scope });
      remote.group = this; this.remotes.set(kind, remote);
      this.stacks.set(kind, new SharingStack(owner, remote, scope));
    }
    owner.sharing = this;
  }
  async load() {
    if (this.loaded) return;
    const state = await readJson(groupFile, { enabled: true });
    if (typeof state.enabled !== 'boolean') throw Error('Invalid sharing power state');
    this.enabled = state.enabled; this.loaded = true;
  }
  get(value = {}) {
    const remote = this.remotes.get(value.instance || 'tor');
    if (!remote) throw Error('Unknown sharing instance');
    return remote;
  }
  async cleanPrevious() { for (const stack of this.stacks.values()) await stack.cleanPrevious(); }
  async start() {
    await this.load();
    for (const [kind, stack] of this.stacks) {
      await stack.initialize();
      const remote = this.remotes.get(kind);
      try { if ((await remote.prepare(stack)).length) await stack.reconfigureRemote(); }
      catch (error) { remote.error = error.message; await stack.closeRemote(); }
    }
  }
  async stop() {
    const failures = [];
    for (const stack of this.stacks.values()) {
      stack.stopping = true; stack.remote.cancelPending();
      try { await stack.closeRemote(); } catch (error) { stack.remote.error = error.message; failures.push(error); }
      finally { stack.ready = false; stack.remotePort = null; }
    }
    if (failures.length) throw new AggregateError(failures, 'Some sharing stacks could not stop');
  }
  async status(value = {}) {
    await this.load();
    if (value.instance) return this.get(value).status();
    const instances = await Promise.all([...this.remotes.values()].map(remote => remote.status()));
    const tor = instances[0];
    return { ...tor, instances, error: instances.find(item => item.enabled && item.error)?.error || tor.error, enabled: this.enabled && instances.some(item => item.publicationRequested || item.awaitingNetwork),
      running: instances.some(item => item.running), configured: instances.some(item => item.phase === 'ready' || item.awaitingNetwork),
      selectedInstances: instances.filter(item => item.enabled || item.awaitingNetwork).map(item => item.instance) };
  }
  async setEnabled(value) {
    await this.load();
    if (!value.all) {
      if (value.enabled && !this.enabled) { this.enabled = true; await writeJson(groupFile, { enabled: true }); }
      const remote = this.get(value); await remote.stack?.initialize?.();
      return remote.setEnabled(value.enabled);
    }
    if (typeof value.enabled !== 'boolean') throw Error('Publishing must be on or off');
    if (value.enabled && (!this.owner.ready || this.owner.stopping)) throw Error('Turn on Local before publishing');
    await this.owner.refreshFileManager(true, null);
    this.enabled = value.enabled; await writeJson(groupFile, { enabled: this.enabled });
    let failure;
    // Every selected route is attempted independently. One provider login or
    // failure must not stop the other selected routes from making progress.
    for (const remote of this.remotes.values()) {
      try {
        const state = await remote.state();
        remote.publicationRequested = value.enabled && state.enabled;
        if (!value.enabled && remote.kind !== 'tor') await remote.stack.closeRemote();
        else {
          if (remote.kind !== 'tor') await remote.stack.initialize();
          if (this.owner.ready) await remote.stack.reconfigureRemote();
        }
      } catch (error) { remote.error = error.message; failure ||= error; }
    }
    await this.owner.refreshFileManager(false, null);
    const status = await this.status();
    return { ...status, ...(failure ? { error: failure.message } : {}) };
  }
  async begin(value, options) {
    await this.load();
    if (!this.enabled) { this.enabled = true; await writeJson(groupFile, { enabled: true }); }
    const remote = this.get(value); await remote.stack?.initialize?.();
    return remote.begin(value, options);
  }
  async activeGeneration(generation) {
    if (!this.owner.ready || !this.enabled) return null;
    for (const remote of this.remotes.values()) {
      let state; try { state = await remote.state(); } catch { continue; }
      // Incoming authenticated traffic already reached its carrier. Cached
      // provider readiness is for display, never a recovery admission gate.
      if (state.id === generation && remote.isAdmissible(state)) return remote;
    }
    return null;
  }
}
