// SPDX-License-Identifier: AGPL-3.0-only
// Ordinary tabs use their own short bootstrap and scoped cookie, never the
// protected Agent cookie. Remote bytes still arrive through the saved Chisel
// service mapping. This gateway does not choose or manufacture that mapping.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { dataDir, randomToken, privateDir, json, writeJson } from '../common.mjs';

const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const unavailable = message => Object.assign(Error(message), { status: 503 });
export const applicationSocket = path.join(dataDir, 'run/apps.sock');
const httpSocket = path.join(dataDir, 'run/apps-http.sock');
const endpointFile = path.join(dataDir, 'run/apps.json');
const safePath = value => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[\x00-\x20\x7f\\#]/.test(value);

export class ApplicationGateway {
  constructor({ authorize, handle, upgrade, register, ensureTLS, validateProxy, resolveEditor, validateGrant }) {
    this.authorize = authorize; this.handle = handle; this.upgrade = upgrade; this.register = register;
    this.ensureTLS = ensureTLS; this.validateProxy = validateProxy;
    this.resolveEditor = resolveEditor;
    this.validateGrant = validateGrant;
    this.grants = new Map(); this.sockets = new Set(); this.servers = []; this.closing = false;
    this.configuring = new Map(); this.active = new Set();
  }
  grant(record, scope) {
    if (scope.workerId || scope.purpose === 'files-sidecar') {
      const previous = [...this.grants.values()].find(grant => !grant.revoked && grant.record.key === record.key && grant.scope.workerId === scope.workerId && grant.scope.purpose === scope.purpose && grant.scope.projectId === scope.projectId && grant.scope.root === scope.root);
      if (previous) return previous;
    }
    const grant = { id: randomUUID(), record, scope, active: new Set(), created: Date.now() };
    this.grants.set(grant.id, grant); return grant;
  }
  async endpoint() {
    if (this.closing) throw unavailable('The application gateway is stopping');
    if (!this.starting) this.starting = this.listen().catch(error => { this.starting = null; throw error; });
    return this.starting;
  }
  async listen() {
    // Both supported platforms use Linux sockaddr_un.sun_path[108], including
    // the terminating NUL. Reject truncation before touching an existing socket.
    if ([applicationSocket, httpSocket].some(value => Buffer.byteLength(value) > 107)) throw unavailable('The owning backend runtime directory is too long for a native application socket');
    await privateDir(path.dirname(applicationSocket));
    // The backend's existing kernel instance lock is held before construction.
    await fs.rm(httpSocket, { force: true }); await fs.rm(applicationSocket, { force: true });
    const create = () => {
      const server = http.createServer((req, res) => this.request(req, res));
      server.requestTimeout = 0;
      server.on('connection', socket => { this.sockets.add(socket); socket.once('close', () => this.sockets.delete(socket)); });
      server.on('upgrade', (req, socket, head) => { this.socketRequest(req, socket, head).catch(() => socket.destroy()); });
      this.servers.push(server); return server;
    };
    const shared = create();
    try {
      await new Promise((resolve, reject) => { shared.once('error', reject); shared.listen(httpSocket, resolve); });
      await fs.chmod(httpSocket, 0o600);
      const tls = await this.ensureTLS();
      if (!/^https:\/\/127\.0\.0\.1:[0-9]+$/.test(tls.origin) || !tls.identity?.caPem) throw unavailable('The application TLS identity is unavailable');
      this.origin = tls.origin; this.identity = tls.identity;
      // Existing machine carriers need a private Unix endpoint. Forward TLS
      // bytes unchanged to Caddy; certificates/authentication stay with Caddy.
      const tlsServer = net.createServer(client => {
        client.pause(); this.sockets.add(client); client.on('error', () => client.destroy());
        const upstream = net.createConnection({ host: '127.0.0.1', port: Number(new URL(this.origin).port) });
        this.sockets.add(upstream); upstream.on('error', () => client.destroy());
        client.once('close', () => { this.sockets.delete(client); upstream.destroy(); });
        upstream.once('close', () => { this.sockets.delete(upstream); client.destroy(); });
        upstream.once('connect', () => { client.pipe(upstream); upstream.pipe(client); client.resume(); });
      });
      this.servers.push(tlsServer);
      await new Promise((resolve, reject) => { tlsServer.once('error', reject); tlsServer.listen(applicationSocket, resolve); });
      await fs.chmod(applicationSocket, 0o600);
      if (this.closing) throw unavailable('The application gateway stopped during startup');
      await writeJson(endpointFile, { url: this.origin, pid: process.pid });
      return { origin: this.origin, socketPath: applicationSocket, identity: this.identity };
    } catch (error) {
      for (const server of this.servers.splice(0)) { server.close(); server.closeAllConnections?.(); }
      throw error;
    }
  }
  async open(component, record, scope) {
    const endpoint = await this.endpoint();
    if (!['files', 'references'].includes(component)) throw Error('Unknown web application');
    for (const grant of this.grants.values()) if (grant.nonce && grant.expires <= Date.now()) {
      // A short bootstrap must expire, but an authenticated native opener can
      // still resolve the document identity into a fresh human grant later.
      delete grant.nonce; delete grant.expires; delete grant.secret;
    }
    const grant = this.grant(record, scope);
    grant.component = component; grant.nonce = randomToken(); grant.secret = randomToken(); grant.expires = Date.now() + 120000;
    grant.basePath = `/apps/${component}/${grant.id}/`;
    if (!safePath(scope.openPath || '/')) { this.grants.delete(grant.id); throw Error('Invalid native application open path'); }
    const target = new URL((scope.openPath || '/').slice(1), 'http://application.invalid' + grant.basePath);
    if (!target.pathname.startsWith(grant.basePath)) { this.grants.delete(grant.id); throw Error('Application open path leaves its scope'); }
    target.searchParams.set('launch', grant.nonce);
    const openPath = target.pathname + target.search;
    try {
      await this.register({ id: 'files', name: 'Files', kind: 'web', scheme: 'https',
        target: { network: 'unix', address: applicationSocket }, openPath: '/', enabled: true, startup: false, command: null });
      return { component, serviceId: 'files', url: endpoint.origin + openPath, openPath, identity: endpoint.identity };
    } catch (error) { this.grants.delete(grant.id); throw error; }
  }
  resolve(value) {
    let url;
    try { url = new URL(value); } catch { throw Object.assign(Error('Invalid application URL'), { status: 400 }); }
    if (!this.origin || url.origin !== this.origin || url.username || url.password || url.hash) throw Object.assign(Error('This URL is not owned by this backend application gateway'), { status: 403 });
    const match = /^\/apps\/(files|references)\/([a-f0-9-]{36})\//.exec(url.pathname);
    const grant = match && this.grants.get(match[2]);
    if (!grant || grant.component !== match[1] || grant.revoked) throw Object.assign(Error('The application launch is no longer available'), { status: 404 });
    url.searchParams.delete('launch');
    return { grant, path: '/' + url.pathname.slice(grant.basePath.length) + url.search, url };
  }
  async locate(req) {
    this.validateProxy(req);
    const host = req.headers.host || '';
    if (!/^127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(host) || Number(host.split(':')[1]) > 65535) throw Object.assign(Error('Invalid application host'), { status: 403 });
    const origin = 'https://' + host, url = new URL(req.url, origin);
    const suppliedCookies = String(req.headers.cookie || '').split(';').map(value => value.trim());
    const matches = grant => {
      const name = 'bkapp_' + grant.id.replaceAll('-', '');
      const values = suppliedCookies.filter(value => value.startsWith(name + '='));
      return !grant.revoked && values.length === 1 && equal(values[0].slice(name.length + 1), grant.secret);
    };
    if (url.pathname.startsWith('/apps/office/')) {
      if (url.searchParams.has('launch')) throw Object.assign(Error('Open the Office document through its launch view'), { status: 401 });
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== origin) throw Object.assign(Error('Invalid application request origin'), { status: 403 });
      const candidates = [...this.grants.values()].filter(matches).map(grant => grant.id);
      if (!candidates.length) throw Object.assign(Error('Application session required'), { status: 401 });
      const id = await this.resolveEditor(req, candidates);
      const grant = this.grants.get(id);
      if (!grant || !candidates.includes(id)) throw Object.assign(Error('This Office document is not authorized'), { status: 403 });
      return { origin, url, grant, authenticated: true, basePath: '/apps/office/', component: 'office' };
    }
    const match = /^\/apps\/(files|references)\/([a-f0-9-]{36})\//.exec(url.pathname);
    const grant = match && this.grants.get(match[2]);
    if (!grant || grant.component !== match[1] || grant.revoked) throw Object.assign(Error('Open this application from BashKitten again'), { status: 401 });
    const cookieName = 'bkapp_' + grant.id.replaceAll('-', '');
    return { origin, url, grant, cookieName, authenticated: matches(grant), basePath: grant.basePath, component: grant.component };
  }
  async request(req, res) {
    try {
      const context = await this.locate(req), { grant, url, cookieName, component } = context;
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
      await this.authorizeOperation(grant.id, 'web', async operation => {
        if (url.searchParams.has('launch')) {
          const nonce = url.searchParams.get('launch');
          if (req.method !== 'GET' || url.searchParams.getAll('launch').length !== 1 || grant.expires <= Date.now() || !equal(nonce, grant.nonce)) throw Object.assign(Error('This application launch expired or was already used'), { status: 401 });
          // Consume only after asynchronous authority checks, without another await.
          delete grant.nonce; delete grant.expires;
          url.searchParams.delete('launch');
          // Unique names preserve each captured grant while native Collabora's
          // shared service_root uses one fixed /apps/office URL namespace.
          res.setHeader('Set-Cookie', `${cookieName}=${grant.secret}; Path=/apps/; Secure; HttpOnly; SameSite=Strict`);
          res.writeHead(303, { Location: url.pathname + url.search }); res.end(); return;
        }
        if (!context.authenticated) throw Object.assign(Error('Application session required'), { status: 401 });
        if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== context.origin) throw Object.assign(Error('Invalid application request origin'), { status: 403 });
        await this.configuring.get(component);
        operation.signal.throwIfAborted();
        const stop = () => { req.destroy(); res.destroy(); };
        stop.response = res;
        const active = { component, stop, socket: component === 'files' && context.url.pathname.slice(context.basePath.length) === 'api/events' };
        active.done = new Promise(resolve => { active.finish = resolve; }); this.active.add(active);
        grant.active.add(stop);
        try { await this.handle(component, req, res, { ...context, signal: operation.signal }); }
        finally { grant.active.delete(stop); this.active.delete(active); active.finish(); }
      }, { response: res, cancel: () => { req.destroy(); res.destroy(); }, watch: abort => { res.once('close', abort); return () => res.off('close', abort); } });
    } catch (error) {
      if (res.headersSent) res.destroy(); else json(res, { error: error.message, code: error.code }, error.status || 400);
    }
  }
  async socketRequest(req, socket, head) {
    const context = await this.locate(req), { grant, component } = context;
    if (!context.authenticated || context.url.searchParams.has('launch') || req.headers.origin !== context.origin) throw Error('Invalid application socket authority');
    return this.authorizeOperation(grant.id, 'socket', async operation => {
      await this.configuring.get(component);
      operation.signal.throwIfAborted();
      const stop = () => socket.destroy(); grant.active.add(stop);
      const active = { component, stop, socket: true };
      active.done = new Promise(resolve => { active.finish = resolve; }); this.active.add(active);
      try {
        await this.upgrade(component, req, socket, head, { ...context, signal: operation.signal });
        if (!socket.destroyed) await new Promise(resolve => socket.once('close', resolve));
      } finally { grant.active.delete(stop); this.active.delete(active); active.finish(); }
    }, { cancel: () => socket.destroy(), watch: abort => { socket.once('close', abort); return () => socket.off('close', abort); } });
  }
  async configure(component, work) {
    const previous = this.configuring.get(component) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const active = [...this.active].filter(item => item.component === component);
      // Native event sockets reconnect after configuration reload. Actual file
      // transfers and atomic mutations finish before the shared process restarts.
      for (const item of active) if (item.socket) item.stop();
      await Promise.all(active.map(item => item.done));
      if (this.closing) throw unavailable('The application gateway is stopping');
      return await work();
    });
    this.configuring.set(component, pending);
    try { return await pending; }
    finally { if (this.configuring.get(component) === pending) this.configuring.delete(component); }
  }
  async componentOperation(component, work, stop = () => {}) {
    await this.configuring.get(component);
    if (this.closing) throw unavailable('The application gateway is stopping');
    const active = { component, stop, socket: false };
    active.done = new Promise(resolve => { active.finish = resolve; }); this.active.add(active);
    try { return await work(); }
    finally { this.active.delete(active); active.finish(); }
  }
  async authorizeOperation(id, operation, work, options) {
    const grant = this.grants.get(id);
    if (!grant || grant.revoked) throw Object.assign(Error('The application grant expired'), { status: 403 });
    grant.operations ||= new Set();
    const active = { response: options?.response };
    grant.operations.add(active);
    active.done = this.authorize(grant.record, async context => {
      if (grant.revoked || this.closing) throw Object.assign(Error('The application grant was revoked'), { status: 403 });
      const controller = new AbortController(), stop = () => controller.abort(Error('The application grant was revoked'));
      stop.response = options?.response;
      grant.active.add(stop);
      try {
        await this.validateGrant?.(grant);
        const signal = AbortSignal.any([context.signal, controller.signal]); signal.throwIfAborted();
        return await work({ ...context, signal, grant, operation });
      } finally { grant.active.delete(stop); }
    }, options).finally(() => grant.operations.delete(active));
    return active.done;
  }
  revokeWhere(predicate, { response } = {}) {
    const pending = [];
    for (const grant of this.grants.values()) if (predicate(grant)) {
      grant.revoked = true;
      for (const stop of grant.active) if (!response || stop.response !== response) stop();
      for (const operation of grant.operations || []) if (!response || operation.response !== response) pending.push(operation.done);
    }
    return Promise.allSettled(pending);
  }
  async revokeRemote() {
    await this.revokeWhere(grant => !grant.record.local);
  }
  async close() {
    this.closing = true;
    for (const grant of this.grants.values()) { grant.revoked = true; for (const stop of grant.active) stop(); }
    for (const socket of this.sockets) socket.destroy();
    for (const server of this.servers) { server.close(); server.closeAllConnections?.(); }
    await this.starting?.catch(() => {});
    await fs.rm(endpointFile, { force: true }); await fs.rm(applicationSocket, { force: true }); await fs.rm(httpSocket, { force: true });
  }
}
