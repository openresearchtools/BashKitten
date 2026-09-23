// Tor v3 client authorization; no passwords or TOTP seeds enter connection exports.
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { privateDir, readJson, writeJson } from '../common.mjs';
import { accessDir, binary } from './paths.mjs';

const root = path.join(accessDir, 'tor');
const stateFile = path.join(accessDir, 'remote.json');
const hostingClientFile = path.join(accessDir, 'hosting-client.json');
const onion = /^[a-z2-7]{56}\.onion$/;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function base32(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, value = 0, out = '';
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function deviceKey() {
  const pair = generateKeyPairSync('x25519');
  return { publicKey: base32(pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)),
    privateKey: base32(pair.privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32)) };
}
export class RemoteAccess {
  constructor({ llama = () => null } = {}) { this.llama = llama; this.stack = null; this.operations = Promise.resolve(); }
  transaction(fn) { const work = this.operations.then(fn); this.operations = work.catch(() => {}); return work; }
  async state() { return readJson(stateFile, { enabled: false, devices: [] }); }
  async hostingKey() {
    let key = await readJson(hostingClientFile, null);
    if (!key) { key = deviceKey(); await writeJson(hostingClientFile, key); }
    if (!/^[A-Z2-7]{52}$/.test(key.publicKey || '') || !/^[A-Z2-7]{52}$/.test(key.privateKey || '')) throw Error('Invalid local hosting client identity');
    return key;
  }
  // Trusted native bridge only: never expose this record through the web API.
  async hostingClient() {
    if (!this.stack?.ready || !(await this.state()).enabled) throw Error('Turn on Agent and enable remote access first');
    const host = await this.hostname('agent'), identity = this.stack.identity;
    if (!host || !identity?.caPem || !identity?.caSha256) throw Error('The remote endpoint is not ready');
    const key = await this.hostingKey();
    return { version: 1, name: 'Local hosted websites', kind: 'agent', url: 'https://' + host,
      clientAuthorization: key.privateKey, caPem: identity.caPem, caSha256: identity.caSha256, instanceId: identity.instanceId };
  }
  async hostname(kind) {
    const value = (await fs.readFile(path.join(root, kind, 'hostname'), 'utf8').catch(() => '')).trim();
    return onion.test(value) ? value : null;
  }
  async prepare(stack, port, { reload = false } = {}) {
    this.stack = stack;
    const state = await this.state();
    if (!state.enabled) return [];
    await privateDir(root); await privateDir(path.join(root, 'data'));
    let text = `DataDirectory ${JSON.stringify(path.join(root, 'data'))}\nSocksPort 0\nAvoidDiskWrites 1\nLog err stderr\n`;
    const kinds = ['agent', ...(state.devices.some(device => device.kind === 'llama') || await this.llama() ? ['llama'] : [])];
    for (const kind of kinds) {
      const service = path.join(root, kind), authorized = path.join(service, 'authorized_clients');
      await privateDir(service); await privateDir(authorized);
      for (const file of await fs.readdir(authorized)) if (file.endsWith('.auth')) await fs.rm(path.join(authorized, file));
      const devices = state.devices.filter(device => device.kind === kind);
      if (kind === 'agent') devices.push({ id: 'local-hosting', publicKey: (await this.hostingKey()).publicKey });
      // An empty authorization directory means public access in Tor. A discarded
      // private key keeps the service private before its first enrollment/after revoke.
      const keys = devices.length ? devices : [{ id: 'closed', publicKey: deviceKey().publicKey }];
      for (const key of keys) await fs.writeFile(path.join(authorized, key.id + '.auth'), `descriptor:x25519:${key.publicKey}\n`, { mode: 0o600 });
      text += `HiddenServiceDir ${JSON.stringify(service)}\nHiddenServiceVersion 3\nHiddenServicePort 443 127.0.0.1:${port}\n`;
    }
    const config = path.join(root, 'torrc'); await fs.writeFile(config, text, { mode: 0o600 });
    if (reload) await stack.reloadPublisher();
    else await stack.launch('tor', binary('tor'), ['-f', config], process.env);
    for (let attempt = 0; attempt < 150; attempt++) {
      const names = await Promise.all(kinds.map(kind => this.hostname(kind)));
      if (names.every(Boolean)) return ['https://' + names[0]];
      if (stack.children.find(child => child.name === 'tor')?.exit !== undefined) throw Error('Tor could not start; see tor.log');
      await wait(100);
    }
    throw Error('Tor did not create its private onion service');
  }
  async status() {
    const state = await this.state();
    return { enabled: state.enabled, address: state.enabled && await this.hostname('agent') ? 'https://' + await this.hostname('agent') : null,
      tlsCaPin: this.stack?.identity?.caSha256 || null, restartRequired: false,
      devices: state.devices.map(({ id, name, createdAt, kind }) => ({ id, name, createdAt, kind })) };
  }
  async setEnabled(enabled) {
    return this.transaction(async () => {
      const state = await this.state();
      if (state.enabled !== Boolean(enabled)) {
        await writeJson(stateFile, { ...state, enabled: Boolean(enabled) });
        await this.stack.reconfigureRemote();
      }
      return this.status();
    });
  }
  async create({ name, kind = 'agent' }) {
    return this.transaction(async () => {
      const state = await this.state();
      if (!state.enabled) throw Error('Enable remote access first');
      if (!['agent', 'llama'].includes(kind)) throw Error('Unknown remote kind');
      const runtime = kind === 'llama' ? await this.llama() : null;
      if (kind === 'llama' && (!runtime?.bearerToken || !runtime?.upstream)) throw Error('Start the managed llama provider first');
      const title = String(name || '').trim();
      if (!title || title.length > 100) throw Error('Name this connection (1–100 characters)');
      if (state.devices.length >= 64) throw Error('Revoke an unused connection before adding another');
      const key = deviceKey(), id = randomUUID();
      const device = { id, name: title, kind, publicKey: key.publicKey, createdAt: new Date().toISOString() };
      await writeJson(stateFile, { ...state, devices: [...state.devices, device] });
      // Adding an authorization only needs Tor's native config reload. Restarting
      // the publisher here cuts an onion caller's request before its one-time
      // connection key can be delivered. Revocation still closes old circuits.
      await this.stack.reconfigureRemote({ restartTor: false });
      const host = await this.hostname(kind);
      if (!host || !this.stack.identity?.caSha256) throw Error('The remote endpoint is not ready');
      const connection = { version: 1, name: title, kind, url: 'https://' + host, clientAuthorization: key.privateKey,
        caSha256: this.stack.identity.caSha256, instanceId: this.stack.identity.instanceId,
        ...(kind === 'llama' ? { bearerToken: runtime.bearerToken } : {}) };
      const { default: QRCode } = await import('qrcode');
      return { connection, qrDataUrl: await QRCode.toDataURL(JSON.stringify(connection), { errorCorrectionLevel: 'M', margin: 2, width: 384 }) };
    });
  }
  async revoke(id) {
    return this.transaction(async () => {
      const state = await this.state();
      if (!state.devices.some(device => device.id === id)) throw Error('Unknown connection');
      await writeJson(stateFile, { ...state, devices: state.devices.filter(device => device.id !== id) });
      // Restarting our Tor publisher closes existing circuits as well as revoking
      // future descriptor access. No browser Tor client or unrelated daemon is touched.
      await this.stack.reconfigureRemote();
      return this.status();
    });
  }
  async llamaProxy() {
    if (!(await this.state()).enabled) return null;
    const runtime = await this.llama(), host = await this.hostname('llama');
    return runtime?.upstream && host ? { host, upstream: runtime.upstream } : null;
  }
}
