// Service definitions and native lifecycle, adapted from TorKitten v2 (Apache-2.0).
// BashKitten adaptations: SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readJson, writeJson, privateDir, digest } from '../common.mjs';
import { platform } from '../platform/index.mjs';
import { accessDir, binary } from './paths.mjs';
import { engineEnvironment } from '../localai/environment.mjs';

const stateFile = path.join(accessDir, 'hosting.json');
const runningDir = path.join(accessDir, 'services');
const script = fileURLToPath(import.meta.url), exec = promisify(execFile);
const idPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const localAI = id => ['localai-llama', 'localai-whisper'].includes(id);
const unit = id => `bashkitten-service-${id}.scope`;
const text = value => typeof value === 'string' && !value.includes('\0');

function target(value) {
  if (value?.network === 'unix' && text(value.address) && path.isAbsolute(value.address) && path.normalize(value.address) === value.address) return value;
  const match = value?.network === 'tcp' && /^(127(?:\.\d{1,3}){3}|\[::1\]):([0-9]+)$/.exec(value.address);
  if (!match || !net.isIP(match[1].replace(/[\[\]]/g, '')) || Number(match[2]) < 1 || Number(match[2]) > 65535) throw Error('Choose a numeric loopback address and port, or an absolute Unix socket');
  return { network: 'tcp', address: value.address };
}
function definition(value) {
  if (!value || !idPattern.test(value.id) || value.id === 'agent') throw Error('Invalid service ID');
  if (!text(value.name) || !value.name.trim()) throw Error('Enter a service name');
  if (typeof value.enabled !== 'boolean' || typeof value.startup !== 'boolean') throw Error('Choose remote access and launch on startup');
  if (!['http', 'https'].includes(value.scheme) || !['web', 'llama'].includes(value.kind)) throw Error('Choose the service type and HTTP or HTTPS');
  if (!text(value.openPath) || !value.openPath.startsWith('/') || value.openPath.startsWith('//') || /[\x00-\x20\x7f\\]/.test(value.openPath)) throw Error('Use a URL path beginning with /');
  let command = null;
  if (value.command) {
    const { argv, cwd, env = {} } = value.command;
    if (!Array.isArray(argv) || !argv.length || !argv.every(text) || !path.isAbsolute(argv[0])) throw Error('Use an absolute executable path and an array of arguments');
    if (!text(cwd) || !path.isAbsolute(cwd)) throw Error('Choose an absolute working directory');
    if (!env || typeof env !== 'object' || Array.isArray(env) || Object.entries(env).some(([name, value]) => !/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) || !text(value))) throw Error('Invalid command environment');
    command = { argv, cwd, env };
  }
  if (value.startup && !command) throw Error('Launch on startup needs an owned command');
  return { id: value.id, name: value.name.trim(), target: target(value.target), kind: value.kind, scheme: value.scheme,
    openPath: value.openPath, enabled: value.enabled, startup: value.startup, command };
}
function reachable(endpoint) {
  return new Promise(resolve => {
    const match = endpoint.network === 'tcp' && /^(.*):([0-9]+)$/.exec(endpoint.address);
    const socket = net.createConnection(match ? { host: match[1].replace(/[\[\]]/g, ''), port: Number(match[2]) } : { path: endpoint.address });
    const finish = result => { socket.destroy(); resolve(result); };
    socket.setTimeout(2000, () => finish(false)); socket.once('connect', () => finish(true)); socket.once('error', () => finish(false));
  });
}

/** One host catalogue; commands are private. Remote clients receive IDs/state only. */
export class HostedServices {
  constructor(stack) { this.stack = stack; this.running = new Map(); this.published = new Set(); }
  async entries() {
    const saved = await readJson(stateFile, { version: 2, services: [] });
    if (saved.version !== undefined && saved.version !== 2) throw Error('Unsupported saved service version');
    if (!Array.isArray(saved.services)) throw Error('Invalid saved services');
    // Preserve old definitions, but require an explicit native Save to publish
    // them through the new identity. Do not reactivate legacy onion routes.
    const entries = saved.version === 2 ? saved.services.map(definition) : saved.services.map(entry => {
      const url = new URL(entry.target);
      if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
      return definition({ id: entry.name, name: entry.name, target: { network: 'tcp', address: url.hostname + ':' + (url.port || '80') },
        kind: 'web', scheme: url.protocol.slice(0, -1), openPath: '/', enabled: false, startup: false, command: null });
    });
    if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw Error('Duplicate service ID');
    return entries;
  }
  async status({ remote = false } = {}) {
    const entries = (await this.entries()).filter(entry => !remote || entry.enabled);
    const services = await Promise.all(entries.map(async entry => {
      const owner = this.running.get(entry.id), online = await reachable(entry.target);
      const value = { id: entry.id, name: entry.name, kind: entry.kind, scheme: entry.scheme, openPath: entry.openPath,
        state: owner?.state || (entry.command ? 'stopped' : 'external'), reachable: online,
        actions: entry.command ? ['start', 'stop', 'reload'] : [], error: owner?.error || '' };
      return remote ? value : { ...entry, ...value, output: owner?.output || '', savedForNextStart: Boolean(owner?.child && owner.revision !== digest(JSON.stringify(entry))) };
    }));
    if (remote) services.unshift({ id: 'agent', name: 'Agent', kind: 'agent', scheme: 'https', openPath: '/',
      state: this.stack.ready ? 'running' : 'stopped', reachable: this.stack.ready, actions: [], error: '' });
    return { services, ...(!remote ? { revision: digest(JSON.stringify(await this.entries())) } : {}) };
  }
  async publish() {
    if (!this.stack.tunnelStarted) { this.published.clear(); return; }
    const entries = (await this.entries()).filter(entry => entry.enabled);
    const ids = new Set(entries.map(entry => entry.id));
    for (const id of this.published) if (!ids.has(id)) await this.stack.tunnel.call('service-remove', { id });
    for (const entry of entries) await this.stack.tunnel.call('service-set', { id: entry.id, ...entry.target });
    this.published = ids;
  }
  async unpublish(id) {
    if (this.stack.tunnelStarted) await this.stack.tunnel.call('service-remove', { id });
    this.published.delete(id);
  }
  async save(value) {
    const entries = await this.entries();
    if (value.revision !== digest(JSON.stringify(entries))) throw Error('Services changed. Refresh before saving.');
    if (localAI(value.service?.id) && !value.internal) throw Error('Configure this service in LocalAI');
    const entry = definition({ ...value.service, id: value.service?.id || randomUUID() });
    if (entry.id === 'localai-whisper' && entry.enabled) throw Error('Whisper is available only through authenticated dictation');
    const index = entries.findIndex(item => item.id === entry.id);
    if (index >= 0 && JSON.stringify(entries[index]) === JSON.stringify(entry)) return this.status();
    if (index >= 0 && (!entry.enabled || JSON.stringify(entries[index].target) !== JSON.stringify(entry.target) || JSON.stringify(entries[index].command) !== JSON.stringify(entry.command))) await this.unpublish(entry.id);
    if (index === -1) entries.push(entry); else entries[index] = entry;
    await writeJson(stateFile, { version: 2, services: entries });
    await this.publish(); return this.status();
  }
  async remove(value) {
    const entries = await this.entries();
    if (localAI(value.id)) throw Error('Configure this service in LocalAI');
    if (value.revision !== digest(JSON.stringify(entries))) throw Error('Services changed. Refresh before removing.');
    if (!entries.some(entry => entry.id === value.id)) throw Error('Service no longer exists');
    await this.unpublish(value.id); await this.stop(value.id);
    await writeJson(stateFile, { version: 2, services: entries.filter(entry => entry.id !== value.id) });
    return this.status();
  }
  async action({ id, action }, { remote = false } = {}) {
    const entry = (await this.entries()).find(entry => entry.id === id && (!remote || entry.enabled));
    if (!entry) throw Error('Service is not available');
    if (!entry.command) throw Error('This external service has no BashKitten launch command');
    if (!['start', 'stop', 'reload'].includes(action)) throw Error('Unknown service action');
    if (action !== 'start') {
      await this.unpublish(id);
      await this.stop(id);
    }
    if (action !== 'stop') await this.start(entry);
    await this.publish(); return this.status({ remote });
  }
  async start(entry) {
    if (this.running.get(entry.id)?.child) return;
    const { argv, cwd } = entry.command;
    await fs.access(argv[0], fs.constants.X_OK);
    if (!(await fs.stat(cwd)).isDirectory()) throw Error('The service working directory no longer exists');
    await privateDir(runningDir);
    await writeJson(path.join(runningDir, entry.id + '.json'), entry);
    const child = spawn(binary('runtime-guard'), [process.execPath, script, entry.id, 'serve'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const owner = { child, state: 'starting', error: '', output: '', revision: digest(JSON.stringify(entry)), stopping: false };
    this.running.set(entry.id, owner);
    const secrets = Object.entries(entry.command.env).filter(([name]) => /key|token|password|secret/i.test(name)).map(([, value]) => value).filter(Boolean);
    const keyAt = entry.command.argv.indexOf('--api-key');
    if (keyAt >= 0 && entry.command.argv[keyAt + 1]) secrets.push(entry.command.argv[keyAt + 1]);
    for (const value of entry.command.argv) if (value.startsWith('--api-key=')) secrets.push(value.slice('--api-key='.length));
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
      if (entry.id === 'localai-whisper') return; // Inference output never enters retained logs.
      owner.rawOutput = (owner.rawOutput || '') + bytes.toString();
      owner.rawOutput = owner.rawOutput.slice(-65536);
      let text = owner.rawOutput; for (const secret of secrets) text = text.replaceAll(secret, '[redacted]');
      // Withhold a possible partial secret until the next chunk completes it.
      for (const secret of secrets) for (let n = 1; n < secret.length; n++) if (text.endsWith(secret.slice(0, n))) text = text.slice(0, -n);
      owner.output = text;
    });
    owner.done = new Promise(resolve => {
      child.once('error', error => { owner.error = error.message; });
      child.once('close', (code, signal) => {
        owner.child = null; owner.state = owner.stopping ? 'stopped' : 'failed';
        if (!owner.stopping) owner.error ||= `Service exited (${signal || code}). Open output on the host for details.`;
        resolve();
      });
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    owner.state = 'running';
  }
  async stop(id) {
    const owner = this.running.get(id);
    if (!owner?.child) return;
    owner.stopping = true; owner.state = 'stopping';
    // The guard still owns the scope's descendants, including if systemd or
    // the controller dies. A scope preserves that parent/child ownership.
    let failure;
    if (platform === 'linux') await exec('systemctl', ['--user', 'stop', unit(id)], { timeout: 15000 }).catch(error => { failure = error; });
    owner.child?.kill('SIGTERM');
    let timer;
    try {
      await Promise.race([owner.done, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('The service has not finished stopping')), 10000);
      })]);
    } finally { clearTimeout(timer); }
    if (failure && owner.child) throw failure;
  }
  async startup() {
    for (const entry of await this.entries()) if (entry.startup && !localAI(entry.id)) {
      try { await this.start(entry); }
      catch (error) { this.running.set(entry.id, { state: 'failed', error: error.message }); }
    }
  }
  async stopAll() {
    const results = await Promise.allSettled([...this.running.keys()].map(id => this.stop(id)));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  try {
    const [id, action] = process.argv.slice(2);
    if (action !== 'serve' || !idPattern.test(id) || process.env.BASHKITTEN_GUARDED !== '1' || Number(process.env.BASHKITTEN_GUARD_PID) !== process.ppid) throw Error('Service must start through its private controller');
    const entry = definition(await readJson(path.join(runningDir, id + '.json')));
    process.on('SIGTERM', () => process.exit(0)); process.on('SIGINT', () => process.exit(0));
    const args = entry.command.argv;
    const env = localAI(id) ? engineEnvironment(entry.command.env) : { ...process.env, ...entry.command.env };
    // Scope units retain the existing guard's ancestry; detached user services
    // would otherwise survive a killed controller. Never expand arguments.
    const child = platform === 'linux'
      ? spawn('systemd-run', ['--user', '--scope', '--quiet', '--collect', '--no-ask-password', '--expand-environment=no', '--unit=' + unit(id),
        '--description=BashKitten ' + entry.name, '--', ...args], { cwd: entry.command.cwd, env, stdio: 'inherit' })
      : spawn(args[0], args.slice(1), { cwd: entry.command.cwd, env, stdio: 'inherit' });
    child.once('error', error => { console.error(error.message); process.exit(1); });
    child.once('close', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
