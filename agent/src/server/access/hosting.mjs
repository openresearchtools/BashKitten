// Named onion routes follow Torkitten's Apache-2.0 mapping pattern; see NOTICE.
// BashKitten persistence, loopback validation and cookie isolation are GPL-3.0-only.
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { readJson, writeJson } from '../common.mjs';
import { accessDir } from './paths.mjs';

const stateFile = path.join(accessDir, 'hosting.json');
const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const cacheMs = 5000;
function serviceName(value) {
  if (typeof value !== 'string' || !label.test(value.toLowerCase())) throw Error('Use a single name of 1–63 letters, numbers or hyphens, starting and ending with a letter or number');
  return value.toLowerCase();
}
function loopbackTarget(value) {
  if (typeof value !== 'string') throw Error('Enter a loopback HTTP address');
  const match = /^http:\/\/(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::([0-9]{1,5}))?\/?$/i.exec(value);
  if (!match || (match[1].startsWith('127.') && net.isIP(match[1]) !== 4) || (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535))) {
    throw Error('Use http://127.0.0.1:port, another 127.x.x.x address, localhost or [::1], without credentials, a path, query or fragment');
  }
  const url = new URL(value);
  // Never resolve localhost through DNS or a mutable hosts-file entry.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.origin;
}
function service(value) {
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw Error('Enabled must be true or false');
  return { name: serviceName(value.name), target: loopbackTarget(value.target), enabled: value.enabled ?? true };
}
function probe(target) {
  return new Promise(resolve => {
    let timer, settled = false;
    const finish = (status, error = null) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ status, error, checkedAt: new Date().toISOString() });
    };
    // Headers alone prove that an HTTP service is reachable, including a login
    // redirect or an application error. Do not follow redirects or read bodies.
    const req = http.request(target, { method: 'HEAD', agent: false }, res => {
      finish('online'); res.destroy();
    });
    req.on('error', error => finish('offline', error.code === 'ECONNREFUSED' ? 'Local service is not running' : 'Local service did not respond'));
    timer = setTimeout(() => { finish('offline', 'Local service did not respond'); req.destroy(); }, 2000);
    req.end();
  });
}

export class HostedServices {
  constructor(stack) { this.stack = stack; this.operations = Promise.resolve(); this.checks = new Map(); this.refreshing = null; }
  transaction(fn) { const work = this.operations.then(fn); this.operations = work.catch(() => {}); return work; }
  async entries() {
    const state = await readJson(stateFile, { services: [] });
    if (!Array.isArray(state.services) || state.services.length > 32) throw Error('Invalid hosted website settings');
    const entries = state.services.map(service);
    if (new Set(entries.map(entry => entry.name)).size !== entries.length) throw Error('Duplicate hosted website name');
    return entries;
  }
  async status({ refresh = false } = {}) {
    const entries = await this.entries();
    const enabled = Boolean(this.stack.remote && (await this.stack.remote.state()).enabled);
    const onion = enabled ? await this.stack.remote.hostname('agent') : null;
    if (refresh && !this.refreshing) {
      const pending = entries.filter(entry => entry.enabled && (!this.checks.has(entry.target) || Date.now() - Date.parse(this.checks.get(entry.target).checkedAt) >= cacheMs));
      this.refreshing = (async () => {
        // Four concurrent probes bound resource use and total refresh time.
        await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
          while (pending.length) { const entry = pending.shift(); this.checks.set(entry.target, await probe(entry.target)); }
        }));
      })().finally(() => { this.refreshing = null; });
    }
    if (refresh) await this.refreshing;
    return { enabled, onion, services: entries.map(entry => ({ ...entry, url: onion ? `https://${entry.name}.${onion}/` : null,
      ...(entry.enabled ? this.checks.get(entry.target) || { status: 'unknown', checkedAt: null, error: null } : { status: 'disabled', checkedAt: null, error: null }) })) };
  }
  async replace(entries, previous) {
    await writeJson(stateFile, { services: entries });
    try { await this.stack.reload(); }
    catch (error) {
      await writeJson(stateFile, { services: previous });
      await this.stack.reload().catch(() => {});
      throw error;
    }
    const targets = new Set(entries.map(entry => entry.target));
    for (const target of this.checks.keys()) if (!targets.has(target)) this.checks.delete(target);
    return this.status();
  }
  async save(value) {
    return this.transaction(async () => {
      const entry = service(value), entries = await this.entries();
      const previousName = value.previousName === undefined ? entry.name : serviceName(value.previousName);
      const index = entries.findIndex(item => item.name === previousName);
      if (value.previousName !== undefined && index === -1) throw Error('Hosted website no longer exists');
      if (entries.some((item, i) => i !== index && item.name === entry.name)) throw Error('A website already uses that name');
      if (index === -1 && entries.length >= 32) throw Error('Remove an unused website before adding another');
      const next = entries.slice(); if (index === -1) next.push(entry); else next[index] = entry;
      return this.replace(next, entries);
    });
  }
  async remove({ name }) {
    return this.transaction(async () => {
      name = serviceName(name); const entries = await this.entries();
      if (!entries.some(entry => entry.name === name)) throw Error('Hosted website no longer exists');
      return this.replace(entries.filter(entry => entry.name !== name), entries);
    });
  }
  async routes({ port, authSocket, strip, proxyHeaders }) {
    if (!this.stack.remote || !(await this.stack.remote.state()).enabled) return '';
    const onion = await this.stack.remote.hostname('agent');
    if (!onion) return '';
    const quote = JSON.stringify;
    return (await this.entries()).filter(entry => entry.enabled).map(entry => `
https://${entry.name}.${onion}:${port} {
bind 127.0.0.1
tls internal
route {
${strip}
request_header -X-Bashkitten-*
forward_auth ${quote('unix/' + authSocket)} {
uri /login/api/authz/forward-auth
${proxyHeaders}
}
reverse_proxy ${entry.target} {
${proxyHeaders}
header_up Cookie ${quote('(?i)(^|;)[[:blank:]]*bashkitten_[^=;]*=[^;]*')} "$1"
header_down Set-Cookie ${quote('(?i)^[[:blank:]]*bashkitten_[^=;]*=.*$')} ""
header_down Set-Cookie ${quote('(?i);[[:blank:]]*domain[[:blank:]]*=[^;]*')} ""
header_down -Clear-Site-Data
flush_interval -1
}
}
}
`).join('');
  }
}
