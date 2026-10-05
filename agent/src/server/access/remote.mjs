// Remote enrollment follows TorKitten v2 (Apache-2.0); see NOTICE.
// BashKitten native controller/lifecycle integration: AGPL-3.0-only.
import fs from 'node:fs/promises';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { privateDir, readJson, writeJson, writePrivate } from '../common.mjs';
import { accessDir, remoteDir, paths, binary } from './paths.mjs';
import { accountStatus, validateAccountCredentials, enrollAccount, completeAccount, cancelAccountSetup } from './accounts.mjs';

const torRoot = path.join(remoteDir, 'tor');
const onion = /^[a-z2-7]{56}\.onion$/;

export class RemoteAccess {
  constructor({ schedule }) { this.schedule = schedule; this.stack = null; this.operations = Promise.resolve(); this.pending = null; this.error = ''; }
  transaction(fn) { const work = this.operations.then(fn); this.operations = work.catch(() => {}); return work; }
  async state() {
    const state = await readJson(paths.share, null);
    if (!state) return { version: 2, phase: 'new', enabled: false, allowFileManager: false };
    if (state.version !== 2 || !['replacing', 'setup', 'ready'].includes(state.phase) || typeof state.enabled !== 'boolean' || typeof state.allowFileManager !== 'boolean' ||
        (state.phase !== 'replacing' && (!/^[a-f0-9]{48}$/.test(state.id || '') || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(state.owner || ''))) ||
        (state.phase === 'ready' && (!onion.test(state.onion || '') || !/^[a-f0-9]{64}$/.test(state.caSha256 || ''))) ||
        (state.enabled && state.phase !== 'ready')) throw Error('Invalid Share Local state; remote access stays closed');
    return state;
  }
  async identity() {
    const state = await this.state();
    if (!state.id || state.phase === 'replacing') return null;
    const keys = await readJson(paths.remoteKeys);
    if (keys.id !== state.id || !/^[A-Z2-7]{52}$/.test(keys.tor_public || '') || !keys.certificate || !keys.host_key || !keys.oidc_key || !keys.fingerprint) throw Error('Remote identity is incomplete; reissue it in Share Local');
    return keys;
  }
  async hostname() {
    try {
      const host = (await fs.readFile(path.join(torRoot, 'onion', 'hostname'), 'utf8')).trim();
      if (!onion.test(host)) throw Error('Invalid remote onion identity');
      return host;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async prepare(stack) {
    this.stack = stack;
    const state = await this.state();
    if (!state.enabled) return [];
    await this.identity();
    if (!(await accountStatus()).initialized || await this.hostname() !== state.onion) throw Error('Remote account setup is incomplete or its onion identity changed');
    for (const file of [paths.users, paths.database, paths.remoteCertificate, paths.connectionQr,
      path.join(torRoot, 'onion/hs_ed25519_secret_key'), path.join(torRoot, 'onion/hs_ed25519_public_key')]) {
      if (!(await fs.stat(file)).isFile()) throw Error('Remote identity is incomplete');
    }
    return ['https://' + await this.hostname()];
  }
  async torConfig(publish) {
    const keys = await this.identity();
    if (!keys) throw Error('Remote identity is not configured');
    const service = path.join(torRoot, 'onion'), authorized = path.join(service, 'authorized_clients');
    await privateDir(path.join(torRoot, 'data')); await privateDir(authorized);
    for (const file of await fs.readdir(authorized)) {
      if (file.endsWith('.auth') && file !== keys.id + '.auth') throw Error('Unexpected Tor authorization; reissue the remote identity');
    }
    await writePrivate(path.join(authorized, keys.id + '.auth'), `descriptor:x25519:${keys.tor_public}\n`);
    const file = path.join(torRoot, 'torrc');
    await writePrivate(file, `DataDirectory ${JSON.stringify(path.join(torRoot, 'data'))}\nSocksPort 0\nAvoidDiskWrites 1\nLog err stderr\n${publish ? '' : 'DisableNetwork 1\n'}HiddenServiceDir ${JSON.stringify(service)}\nHiddenServiceVersion 3\nHiddenServicePort 443 127.0.0.1:${this.stack.remotePort}\n`);
    return file;
  }
  async publish() {
    if (!(await this.state()).enabled) return;
    await this.stack.launch('tor', binary('tor'), ['-f', await this.torConfig(true)], process.env);
  }
  async authentication() {
    const keys = await this.identity(), host = await this.hostname();
    if (!keys || !host) throw Error('Set up the remote identity first');
    const registration = await this.stack.tunnel.call('oauth-registration', { client_id: 'bashkitten-' + keys.id, onion: host });
    return { jwks: [{ key: keys.oidc_key, algorithm: 'RS256', use: 'sig' }], clients: [registration] };
  }
  async startTunnel() {
    if (!(await this.state()).enabled) return;
    if (this.stack.tunnelStarted) return;
    const keys = await this.identity(), host = await this.hostname();
    const result = await this.stack.tunnel.call('start', { socket: paths.tunnel, auth_socket: paths.auth, control_socket: paths.control, generation: keys.id, onion: host, key: keys.host_key });
    if (result.fingerprint !== keys.fingerprint) throw Error('The Chisel host identity changed');
    // Agent still reaches the remote authenticated TLS listener, never Local.
    await this.stack.tunnel.call('service-set', { id: 'agent', network: 'tcp', address: '127.0.0.1:' + this.stack.remotePort });
    this.stack.tunnelStarted = true;
    await this.stack.services.publish();
  }
  cancelPending() {
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.password.fill(0); this.pending = null; }
    cancelAccountSetup();
  }
  async begin(value, { reissue = false } = {}) {
    return this.transaction(async () => {
      if (!this.stack?.ready || this.stack.stopping) throw Error('Turn on Local before Share Local setup');
      validateAccountCredentials(value, { create: true });
      if (typeof value.allowFileManager !== 'boolean') throw Error('Choose whether to allow the remote file manager');
      if (!reissue) {
        const state = await this.state();
        const legacy = state.phase === 'new' && Boolean(await readJson(path.join(accessDir, 'remote.json'), null));
        if (state.phase === 'ready' || legacy) throw Error('Confirm Reissue identity to replace the previous remote account and disconnect its clients');
      }
      // Drain writes before committing the new policy. Admission stays blocked
      // until the durable state is saved, including if a save fails.
      await this.stack.refreshFileManager(true);
      await writeJson(paths.share, { version: 2, phase: 'replacing', enabled: false, allowFileManager: false });
      await this.stack.refreshFileManager();
      this.stack.reconfiguring = true; this.stack.ready = false;
      this.cancelPending();
      try {
        await this.stack.stopNamed('tor');
        await this.stack.stopAuthentication();
        await this.stack.stopNamed('caddy');
        this.stack.remoteOrigins = []; this.stack.remoteAuthOrigin = null;
        await fs.rm(remoteDir, { recursive: true, force: true });
        // Confirmed migration removes old remote authority. Its shared Local CA
        // and the saved service definitions are deliberately kept in place.
        for (const name of ['remote.json', 'hosting-client.json', 'tor', 'users.yml', 'authelia.yml',
          'authelia.sqlite3', 'authelia.sqlite3-wal', 'authelia.sqlite3-shm', 'enrollment.json',
          'initialized.json', 'totp.png', 'valkey.conf', 'sessions', 'notifications.txt',
          'session.secret', 'storage.secret', 'jwt.secret']) {
          await fs.rm(path.join(accessDir, name), { recursive: true, force: true });
        }
        await privateDir(remoteDir);
        await this.stack.startNative();
        const keys = await this.stack.tunnel.call('enrollment-keys');
        await writeJson(paths.remoteKeys, keys);
        await writePrivate(paths.remoteCertificate, keys.certificate);
        await writeJson(paths.share, { version: 2, id: keys.id, phase: 'setup', enabled: false, allowFileManager: value.allowFileManager, owner: value.username });
        await this.stack.launch('tor', binary('tor'), ['-f', await this.torConfig(false)], process.env);
        await this.stack.waitUntil(() => this.hostname(), 'Tor identity');
        await this.stack.stopNamed('tor');
        this.stack.remoteAuthOrigin = 'https://' + await this.hostname();
        await this.stack.startCaddy();
        await this.stack.startAuthentication();
        const setup = await enrollAccount(this.stack.remoteAuthOrigin, value, { create: true, native: this.stack.tunnel });
        const pending = { setupId: setup.setupId, password: Buffer.from(value.password, 'utf8') };
        this.pending = pending;
        pending.timer = setTimeout(() => {
          this.schedule(async () => {
            if (this.pending !== pending) return;
            this.cancelPending();
            await this.stack.stopAuthentication();
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
      await completeAccount(value);
      try {
        const state = await this.state(), keys = await this.identity();
        const bundle = { version: 2, id: keys.id, name: 'BashKitten · ' + state.owner, owner: state.owner, onion: await this.hostname(),
          tor_private: keys.tor_private, root_ca: await this.stack.remoteRoot(), certificate: keys.certificate,
          private_key: keys.private_key, fingerprint: keys.fingerprint };
        const encoded = await this.stack.tunnel.call('encrypt', { bundle, password: pending.password.toString('utf8') });
        await writePrivate(paths.connectionQr, Buffer.from(encoded, 'base64'));
        delete keys.tor_private; delete keys.private_key;
        await writeJson(paths.remoteKeys, keys);
        const caSha256 = new X509Certificate(bundle.root_ca).fingerprint256.replaceAll(':', '').toLowerCase();
        await writeJson(paths.share, { ...state, phase: 'ready', enabled: true, onion: bundle.onion, caSha256 });
        this.cancelPending();
        await this.stack.reconfigureRemote();
        return this.status();
      } catch (error) {
        this.cancelPending();
        const state = await this.state();
        await writeJson(paths.share, { ...state, enabled: false });
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
        if (!(await this.state()).enabled) await this.stack.stopAuthentication();
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
      if (state.enabled === enabled) return this.status();
      await this.stack.refreshFileManager(true);
      await writeJson(paths.share, { ...state, enabled });
      await this.stack.refreshFileManager();
      if (this.stack.ready) await this.stack.reconfigureRemote();
      return this.status();
    });
  }
  async setFileManager(allowed) {
    return this.transaction(async () => {
      if (typeof allowed !== 'boolean') throw Error('Choose whether to allow the remote file manager');
      const state = await this.state();
      if (state.phase !== 'ready') throw Error('Complete Share Local setup first');
      await this.stack.refreshFileManager(true);
      await writeJson(paths.share, { ...state, allowFileManager: allowed });
      await this.stack.refreshFileManager();
      return this.status();
    });
  }
  // Native private IPC only. The encrypted image is never a remote HTTP result.
  async status() {
    try {
      const state = await this.state();
      const migrationRequired = state.phase === 'new' && Boolean(await readJson(path.join(accessDir, 'remote.json'), null));
      const running = Boolean(state.enabled && this.stack?.ready && this.stack.tunnelStarted && this.stack.children.some(child => child.name === 'tor' && child.exit === undefined));
      return { phase: state.phase, enabled: state.enabled, running, allowFileManager: state.allowFileManager, migrationRequired, error: this.error,
        address: state.phase === 'ready' ? 'https://' + await this.hostname() : null,
        qrDataUrl: state.phase === 'ready' ? 'data:image/png;base64,' + (await fs.readFile(paths.connectionQr)).toString('base64') : null };
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
      return { phase: 'error', enabled: false, running: false, allowFileManager: false, reissueRequired: true, error: error.message };
    }
  }
}
