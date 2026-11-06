// Remote enrollment follows TorKitten v2 (Apache-2.0); see NOTICE.
// Taskarian native controller/lifecycle integration: AGPL-3.0-only.
import fs from 'node:fs/promises';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { privateDir, readJson, writeJson, writePrivate } from '../common.mjs';
import { accessDir, binary, sharingScope } from './paths.mjs';
import { createAccounts, validateAccountCredentials } from './accounts.mjs';

const onion = /^[a-z2-7]{56}\.onion$/;

export class RemoteAccess {
  constructor({ schedule, scope = sharingScope() }) { this.scope = scope; this.kind = scope.kind; this.paths = scope.paths; this.accounts = createAccounts(scope); this.torRoot = path.join(scope.remoteDir, 'tor'); this.schedule = schedule; this.stack = null; this.operations = Promise.resolve(); this.pending = null; this.error = ''; this.publicationRequested = null; }
  validHost(host) { return (this.kind === 'tor' ? onion : /^[a-f0-9]{48}\.taskarian\.invalid$/).test(host || ''); }
  transaction(fn) { const work = this.operations.then(fn); this.operations = work.catch(() => {}); return work; }
  async state() {
    const state = await readJson(this.paths.share, null);
    if (!state) return { version: 2, phase: 'new', enabled: false, startup: false, allowFileManager: false };
    if (state.version !== 2 || !['replacing', 'setup', 'ready'].includes(state.phase) || typeof state.enabled !== 'boolean' || typeof state.allowFileManager !== 'boolean' || (state.startup !== undefined && typeof state.startup !== 'boolean') ||
        (state.phase !== 'replacing' && (!/^[a-f0-9]{48}$/.test(state.id || '') || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(state.owner || ''))) ||
        (state.phase === 'ready' && (!this.validHost(state.onion) || !/^[a-f0-9]{64}$/.test(state.caSha256 || ''))) ||
        (state.enabled && state.phase !== 'ready')) throw Error('Invalid Share Local state; remote access stays closed');
    return { ...state, startup: state.startup ?? state.enabled };
  }
  shouldPublish(state) {
    // Snapshot launch policy once. Saving a future startup choice must not
    // turn a currently enabled encrypted route on or off.
    this.publicationRequested ??= state.startup;
    return this.group?.enabled !== false && state.enabled && this.publicationRequested;
  }
  async identity() {
    const state = await this.state();
    if (!state.id || state.phase === 'replacing') return null;
    const keys = await readJson(this.paths.remoteKeys);
    if (keys.id !== state.id || (this.kind === 'tor' && !/^[A-Z2-7]{52}$/.test(keys.tor_public || '')) || !keys.certificate || !keys.host_key || !keys.oidc_key || !keys.fingerprint) throw Error('Remote identity is incomplete; reissue it in Share Local');
    return keys;
  }
  async hostname() {
    if (this.kind !== 'tor') { const state = await this.state(); return state.id ? state.id + '.taskarian.invalid' : null; }
    try {
      const host = (await fs.readFile(path.join(this.torRoot, 'onion', 'hostname'), 'utf8')).trim();
      if (!onion.test(host)) throw Error('Invalid remote onion identity');
      return host;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async prepare(stack) {
    this.stack = stack;
    const state = await this.state();
    if (!this.shouldPublish(state)) return [];
    await this.identity();
    if (!(await this.accounts.accountStatus()).initialized || await this.hostname() !== state.onion) throw Error('Remote account setup is incomplete or its onion identity changed');
    for (const file of [this.paths.users, this.paths.database, this.paths.remoteCertificate, this.paths.connectionQr,
      ...(this.kind === 'tor' ? [path.join(this.torRoot, 'onion/hs_ed25519_secret_key'), path.join(this.torRoot, 'onion/hs_ed25519_public_key')] : [])]) {
      if (!(await fs.stat(file)).isFile()) throw Error('Remote identity is incomplete');
    }
    return ['https://' + await this.hostname()];
  }
  async torConfig(publish) {
    const keys = await this.identity();
    if (!keys) throw Error('Remote identity is not configured');
    const service = path.join(this.torRoot, 'onion'), authorized = path.join(service, 'authorized_clients');
    await privateDir(path.join(this.torRoot, 'data')); await privateDir(authorized);
    for (const file of await fs.readdir(authorized)) {
      if (file.endsWith('.auth') && file !== keys.id + '.auth') throw Error('Unexpected Tor authorization; reissue the remote identity');
    }
    await writePrivate(path.join(authorized, keys.id + '.auth'), `descriptor:x25519:${keys.tor_public}\n`);
    const file = path.join(this.torRoot, 'torrc');
    await writePrivate(file, `DataDirectory ${JSON.stringify(path.join(this.torRoot, 'data'))}\nSocksPort 0\nAvoidDiskWrites 1\nLog err stderr\n${publish ? '' : 'DisableNetwork 1\n'}HiddenServiceDir ${JSON.stringify(service)}\nHiddenServiceVersion 3\nHiddenServicePort 443 127.0.0.1:${this.stack.remotePort}\n`);
    return file;
  }
  async publish() {
    if (!this.shouldPublish(await this.state())) return;
    if (this.kind === 'tor') await this.stack.launch('tor', binary('tor'), ['-f', await this.torConfig(true)], process.env);
    else await this.stack.startTransport();
  }
  async authentication() {
    const keys = await this.identity(), host = await this.hostname();
    if (!keys || !host) throw Error('Set up the remote identity first');
    const registration = await this.stack.tunnel.call('oauth-registration', { client_id: 'taskarian-' + keys.id, onion: host });
    return { jwks: [{ key: keys.oidc_key, algorithm: 'RS256', use: 'sig' }], clients: [registration] };
  }
  async startTunnel() {
    if (!this.shouldPublish(await this.state())) return;
    if (this.stack.tunnelStarted) return;
    const keys = await this.identity(), host = await this.hostname();
    const result = await this.stack.tunnel.call('start', { socket: this.paths.tunnel, auth_socket: this.paths.auth, control_socket: this.paths.control, generation: keys.id, onion: host, key: keys.host_key });
    if (result.fingerprint !== keys.fingerprint) throw Error('The Chisel host identity changed');
    // Agent still reaches the remote authenticated TLS listener, never Local.
    await this.stack.tunnel.call('service-set', { id: 'agent', network: 'tcp', address: '127.0.0.1:' + this.stack.remotePort });
    this.stack.tunnelStarted = true;
    await this.stack.services.publish();
  }
  cancelPending() {
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.password.fill(0); this.pending = null; }
    this.accounts.cancelAccountSetup();
  }
  async begin(value, { reissue = false } = {}) {
    return this.transaction(async () => {
      if (!this.stack?.ready || this.stack.stopping) throw Error('Turn on Local before Share Local setup');
      validateAccountCredentials(value, { create: true });
      if (typeof value.allowFileManager !== 'boolean') throw Error('Choose whether to allow the remote file manager');
      const previous = await this.state();
      const startup = previous.phase === 'ready' ? previous.startup : undefined;
      if (!reissue) {
        const state = await this.state();
        const legacy = this.kind === 'tor' && state.phase === 'new' && Boolean(await readJson(path.join(accessDir, 'remote.json'), null));
        if (state.phase === 'ready' || legacy) throw Error('Confirm Reissue identity to replace the previous remote account and disconnect its clients');
      }
      // Drain writes before committing the new policy. Admission stays blocked
      // until the durable state is saved, including if a save fails.
      await this.stack.refreshFileManager(true);
      this.publicationRequested = false;
      await writeJson(this.paths.share, { version: 2, phase: 'replacing', enabled: false, startup, allowFileManager: false });
      await this.stack.refreshFileManager();
      this.stack.reconfiguring = true; this.stack.ready = false;
      this.cancelPending();
      try {
        if (this.kind === 'tor') {
          await this.stack.stopNamed('tor');
          await this.stack.stopAuthentication();
          await this.stack.stopNamed('caddy');
        } else await this.stack.closeRemote();
        this.stack.remoteOrigins = []; this.stack.remoteAuthOrigin = null;
        await fs.rm(this.scope.remoteDir, { recursive: true, force: true });
        // Confirmed migration removes old remote authority. Its shared Local CA
        // and the saved service definitions are deliberately kept in place.
        for (const name of (this.kind === 'tor' ? ['remote.json', 'hosting-client.json', 'tor', 'users.yml', 'authelia.yml',
          'authelia.sqlite3', 'authelia.sqlite3-wal', 'authelia.sqlite3-shm', 'enrollment.json',
          'initialized.json', 'totp.png', 'valkey.conf', 'sessions', 'notifications.txt',
          'session.secret', 'storage.secret', 'jwt.secret'] : [])) {
          await fs.rm(path.join(accessDir, name), { recursive: true, force: true });
        }
        await privateDir(this.scope.remoteDir);
        await this.stack.startNative();
        const keys = await this.stack.tunnel.call('enrollment-keys');
        await writeJson(this.paths.remoteKeys, keys);
        await writePrivate(this.paths.remoteCertificate, keys.certificate);
        await writeJson(this.paths.share, { version: 2, id: keys.id, phase: 'setup', enabled: false, startup, allowFileManager: value.allowFileManager, owner: value.username });
        if (this.kind === 'tor') {
          await this.stack.launch('tor', binary('tor'), ['-f', await this.torConfig(false)], process.env);
          await this.stack.waitUntil(() => this.hostname(), 'Tor identity');
          await this.stack.stopNamed('tor');
        }
        this.stack.remoteAuthOrigin = 'https://' + await this.hostname();
        await this.stack.startCaddy();
        await this.stack.startAuthentication();
        const setup = await this.accounts.enrollAccount(this.stack.remoteAuthOrigin, value, { create: true, native: this.stack.tunnel });
        const pending = { setupId: setup.setupId, password: Buffer.from(value.password, 'utf8') };
        this.pending = pending;
        pending.timer = setTimeout(() => {
          this.schedule(async () => {
            if (this.pending !== pending) return;
            this.cancelPending();
            if (this.kind === 'tor') await this.stack.stopAuthentication();
            else await this.stack.closeRemote();
          }).catch(error => this.stack.fatal?.(error));
        }, 10 * 60000).unref();
        this.stack.ready = true;
        this.error = '';
        return setup;
      } catch (error) {
        this.error = error.message;
        this.cancelPending();
        try {
          await this.stack.closeRemote();
          this.stack.ready = true;
        } catch (failure) { this.stack.fatal?.(failure); throw failure; }
        throw error;
      } finally { this.stack.reconfiguring = false; }
    });
  }
  async confirm(value) {
    return this.transaction(async () => {
      const pending = this.pending;
      if (!pending || pending.setupId !== value.setupId) throw Error('Setup expired; start Share Local setup again');
      if (!pending.verified) { await this.accounts.completeAccount(value); pending.verified = true; }
      try {
        const state = await this.state(), keys = await this.identity();
        const bundle = { version: this.kind === 'tor' ? 2 : 3, id: keys.id, name: 'Taskarian · ' + state.owner, owner: state.owner, onion: await this.hostname(),
          tor_private: keys.tor_private, root_ca: await this.stack.remoteRoot(), certificate: keys.certificate,
          private_key: keys.private_key, fingerprint: keys.fingerprint };
        if (this.kind !== 'tor') {
          const transport = await this.stack.startTransport();
          if (!['ready', 'running'].includes(transport.state)) return { ...(await this.status()), setupId: pending.setupId, awaitingNetwork: true };
          bundle.host = bundle.onion; delete bundle.onion; delete bundle.tor_private;
          bundle.transport = { kind: this.kind, address: transport.address };
        }
        const encoded = await this.stack.tunnel.call('encrypt', { bundle, password: pending.password.toString('utf8') });
        await writePrivate(this.paths.connectionQr, Buffer.from(encoded, 'base64'));
        delete keys.tor_private; delete keys.private_key;
        await writeJson(this.paths.remoteKeys, keys);
        const caSha256 = new X509Certificate(bundle.root_ca).fingerprint256.replaceAll(':', '').toLowerCase();
        const saved = await readJson(this.paths.share);
        await writeJson(this.paths.share, { ...state, phase: 'ready', enabled: true, startup: saved.startup ?? true, onion: bundle.onion || bundle.host, ...(bundle.transport ? { transportAddress: bundle.transport.address } : {}), caSha256 });
        this.publicationRequested = true;
        this.cancelPending();
        await this.stack.reconfigureRemote();
        return this.status();
      } catch (error) {
        this.cancelPending();
        const state = await this.state();
        await writeJson(this.paths.share, { ...state, enabled: false });
        if (this.stack.ready) await this.stack.reconfigureRemote();
        else { await this.stack.stopNamed('tor'); await this.stack.stopAuthentication(); }
        throw error;
      }
    });
  }
  async cancelSetup({ setupId } = {}) {
    return this.transaction(async () => {
      if (this.pending && this.pending.setupId === setupId) {
        this.cancelPending();
        if (!(await this.state()).enabled) {
          if (this.kind === 'tor') await this.stack.stopAuthentication();
          else await this.stack.closeRemote();
        }
      }
      return this.status();
    });
  }
  async setEnabled(enabled) {
    return this.transaction(async () => {
      if (typeof enabled !== 'boolean') throw Error('Publishing must be on or off');
      const state = await this.state();
      if (state.phase !== 'ready') throw Error('Complete Share Local account and authenticator setup first');
      if (enabled && (!this.stack.ready || this.stack.stopping)) throw Error('Turn on Local before publishing');
      const stopped = !this.stack?.authStarted && !this.stack?.tunnelStarted && !this.stack?.remoteOrigins?.length &&
        !this.stack?.children.some(child => (this.kind === 'tor' ? ['tor', 'remote', 'authelia', 'valkey'] : ['caddy', 'remote', 'authelia', 'valkey', 'cloudflared']).includes(child.name));
      // A failed child closes ingress without changing the user's saved intent.
      // On must retry that route; Off must finish cleaning up any remaining pieces.
      if (state.enabled === enabled && this.publicationRequested === enabled && (enabled ? this.isRunning(state) : stopped)) return this.status();
      this.publicationRequested = enabled;
      await this.stack.refreshFileManager(true);
      await writeJson(this.paths.share, { ...state, enabled });
      await this.stack.refreshFileManager();
      if (!enabled && this.kind !== 'tor') await this.stack.closeRemote();
      else if (this.stack.ready) await this.stack.reconfigureRemote();
      return this.status();
    });
  }
  async setStartup(enabled) {
    return this.transaction(async () => {
      if (typeof enabled !== 'boolean') throw Error('Choose whether publishing starts automatically');
      const state = await this.state();
      if (state.phase !== 'ready') throw Error('Complete Share Local setup before choosing automatic publishing');
      // Establish this runtime's old policy before changing only the next one.
      this.shouldPublish(state);
      await writeJson(this.paths.share, { ...state, startup: enabled });
      return this.status();
    });
  }
  async setFileManager(allowed) {
    return this.transaction(async () => {
      if (typeof allowed !== 'boolean') throw Error('Choose whether to allow the remote file manager');
      const state = await this.state();
      if (state.phase !== 'ready') throw Error('Complete Share Local setup first');
      await this.stack.refreshFileManager(true);
      await writeJson(this.paths.share, { ...state, allowFileManager: allowed });
      await this.stack.services.publish();
      await this.stack.refreshFileManager();
      return this.status();
    });
  }
  async export(value) {
    return this.transaction(async () => {
      const state = await this.state();
      if (state.phase !== 'ready') throw Error('Complete Share Local setup first');
      if (this.kind !== 'tor') {
        const transport = await this.stack.transportStatus();
        if (!['ready', 'running'].includes(transport.state)) throw Error('Turn on this sharing instance before refreshing its connection image');
        const image = (await fs.readFile(this.paths.connectionQr)).toString('base64');
        const bundle = await this.stack.tunnel.call('decrypt', { image, password: value.password });
        try {
          if (bundle.id !== state.id || bundle.host !== state.onion || bundle.transport?.kind !== this.kind) throw Error('The encrypted connection identity does not match this sharing instance');
          bundle.transport.address = transport.address;
          const encoded = await this.stack.tunnel.call('encrypt', { bundle, password: value.password });
          await writePrivate(this.paths.connectionQr, Buffer.from(encoded, 'base64'));
          await writeJson(this.paths.share, { ...state, transportAddress: transport.address });
        } finally { bundle.private_key = ''; }
      }
      return this.status();
    });
  }
  // Native private IPC only. The encrypted image is never a remote HTTP result.
  isRunning(state) {
    const stack = this.stack;
    return Boolean(this.group?.enabled !== false && state.enabled && stack?.ready && !stack.stopping && !stack.reconfiguring && stack.authStarted &&
      stack.tunnelStarted && (this.kind === 'tor' || ['ready', 'running'].includes(stack.transport?.state)) && stack.tunnel && !stack.tunnel.closed && stack.remoteOrigins?.length &&
      (this.kind === 'tor' ? ['backend', 'caddy', 'tor', 'remote', 'authelia', 'valkey'] : ['caddy', 'remote', 'authelia', 'valkey', ...(this.kind === 'cloudflare' ? ['cloudflared'] : [])]).every(name =>
        stack.children.some(child => child.name === name && child.exit === undefined && !child.stopping)));
  }
  async status() {
    try {
      const state = await this.state();
      const migrationRequired = this.kind === 'tor' && state.phase === 'new' && Boolean(await readJson(path.join(accessDir, 'remote.json'), null));
      const transport = this.kind === 'tor' ? null : await this.stack?.transportStatus();
      const qrRefreshRequired = state.phase === 'ready' && this.kind !== 'tor' && (this.kind === 'cloudflare' ? !transport?.address || transport.address !== state.transportAddress : Boolean(transport?.address && transport.address !== state.transportAddress));
      const running = this.isRunning(state);
      return { instance: this.kind, kind: this.kind, phase: state.phase, enabled: state.enabled, groupEnabled: this.group?.enabled !== false, publicationRequested: this.shouldPublish(state), startup: state.startup, running, allowFileManager: state.allowFileManager, migrationRequired, error: transport?.error || this.error,
        transportState: transport?.state || (running ? 'running' : 'off'), loginUrl: transport?.login_url || null, qrRefreshRequired, awaitingNetwork: Boolean(this.pending?.verified && !['ready', 'running'].includes(transport?.state)),
        address: state.phase === 'ready' ? 'https://' + await this.hostname() : null,
        qrDataUrl: state.phase === 'ready' && !qrRefreshRequired ? 'data:image/png;base64,' + (await fs.readFile(this.paths.connectionQr)).toString('base64') : null };
    } catch (error) {
      this.error = error.message;
      if (this.stack?.ready && (this.stack.remoteOrigins?.length || this.stack.authStarted)) {
        this.stack.reconfiguring = true; this.stack.ready = false;
        try {
          await this.stack.closeRemote();
          this.stack.ready = true;
        } catch (failure) { this.stack.fatal?.(failure); throw failure; }
        finally { this.stack.reconfiguring = false; }
      }
      return { instance: this.kind, kind: this.kind, phase: 'error', enabled: false, groupEnabled: this.group?.enabled !== false, publicationRequested: false, startup: false, running: false, allowFileManager: false, reissueRequired: true, error: error.message };
    }
  }
}
