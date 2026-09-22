// SPDX-License-Identifier: GPL-3.0-only
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { dataDir, privateDir, readJson, writeJson } from '../../common.mjs';
import { processStart } from '../../instance.mjs';
import { getModelsDirectory } from '../../models/settings.mjs';

const exec = promisify(execFile), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const executable = '/usr/bin/llama-server';
const packages = { cuda: 'llama-cpp-cuda', vulkan: 'llama-cpp', cpu: 'llama-cpp' };
const defaults = { enabled: false, backend: 'auto', model: '', alias: 'bashkitten-local', contextSize: 8192, gpuLayers: 'auto', threads: 0, publishHost: '' };
const runtimeEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(LLAMA_ARG_|LLAMA_API_KEY|LLAMA_CACHE)/.test(name)));
function requireLinux() {
  if (process.platform !== 'linux' || process.env.PREFIX?.startsWith('/data/data/com.termux/') || !['arm64', 'x64'].includes(process.arch)) throw Error('Managed llama.cpp requires Linux arm64 or amd64');
}
function settings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid llama.cpp settings');
  const result = { ...defaults };
  for (const key of Object.keys(defaults)) if (value[key] !== undefined) result[key] = value[key];
  if (typeof result.enabled !== 'boolean' || !['auto', 'cuda', 'vulkan', 'cpu'].includes(result.backend)) throw Error('Choose Auto, CUDA, Vulkan or CPU');
  for (const key of ['model', 'alias', 'publishHost']) if (typeof result[key] !== 'string' || result[key].includes('\0')) throw Error(`Invalid ${key}`);
  if (result.model.length > 8192 || /[\x00-\x1f\x7f]/.test(result.model)) throw Error('Choose a model from the models folder');
  if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(result.alias)) throw Error('Use a short model name containing letters, numbers, dots or dashes');
  if (result.publishHost && !/^[a-z2-7]{56}\.onion$/.test(result.publishHost)) throw Error('Publish llama.cpp through its own exact v3 onion hostname');
  if (!Number.isInteger(result.contextSize) || result.contextSize < 128 || result.contextSize > 2097152) throw Error('Invalid model context size');
  if (!Number.isInteger(result.threads) || result.threads < 0 || result.threads > 4096) throw Error('Invalid CPU thread count');
  if (!['auto', 'all'].includes(result.gpuLayers) && (!Number.isInteger(result.gpuLayers) || result.gpuLayers < 0 || result.gpuLayers > 100000)) throw Error('Invalid GPU layer count');
  return result;
}
async function installedPackages() {
  const { stdout } = await exec('dpkg-query', ['-W', '-f=${Package}\t${db:Status-Status}\t${Version}\n', 'llama-cpp', 'llama-cpp-cuda'], { timeout: 10000 }).catch(error => ({ stdout: error.stdout || '' }));
  return Object.fromEntries(stdout.split('\n').map(line => line.split('\t')).filter(([, state]) => state === 'installed').map(([name, , version]) => [name, version]));
}
function devicesFrom(output) {
  return [...output.matchAll(/^\s+(CUDA\d+|Vulkan\d+):\s*(.+)$/gm)].map(([, id, description]) => ({ id, description, backend: id.startsWith('CUDA') ? 'cuda' : 'vulkan' }));
}
export async function llamaRuntimeOptions() {
  requireLinux();
  const installed = await installedPackages();
  const info = { installed, devices: [], backend: null, error: null };
  if (!Object.keys(installed).length) return { ...info, error: 'Install a llama.cpp runtime in package settings' };
  try {
    // This loads the packaged backends and initializes actual drivers/devices.
    // An NVIDIA vendor ID or presence of a library alone is not readiness.
    const result = await exec(executable, ['--list-devices'], { env: runtimeEnv(), timeout: 20000, maxBuffer: 256000 });
    info.devices = devicesFrom(result.stdout);
    info.backend = info.devices.some(device => device.backend === 'cuda') ? 'cuda' : info.devices.some(device => device.backend === 'vulkan') ? 'vulkan' : 'cpu';
  } catch (error) { info.error = `The installed llama.cpp runtime cannot load: ${(error.stderr || error.message).slice(-2000)}`; }
  return info;
}
async function cudaLibrariesAvailable() {
  try {
    const [{ stdout: libraries }, { stdout: driver }] = await Promise.all([
      exec('/sbin/ldconfig', ['-p'], { timeout: 10000 }),
      exec('nvidia-smi', ['--query-gpu=driver_version,name', '--format=csv,noheader'], { timeout: 10000 }),
    ]);
    return /\blibcudart\.so\.13\b/.test(libraries) && /\blibcublas\.so\.13\b/.test(libraries) && /\blibcuda\.so\.1\b/.test(libraries) && driver.split('\n').some(line => Number.parseInt(line, 10) >= 580);
  } catch { return false; }
}
async function installPackage(job, name) {
  const installed = await installedPackages();
  if (installed[name]) { await job.log(`${name} ${installed[name]} is already installed.\n`); return; }
  const opposite = name === 'llama-cpp' ? 'llama-cpp-cuda' : 'llama-cpp';
  await job.phase(`Checking ${name}`);
  const args = ['-o', 'Dpkg::Lock::Timeout=300', '-o', 'APT::Status-Fd=3'];
  const simulation = await job.exec('/usr/bin/apt-get', ['-s', 'install', name]);
  const removed = [...simulation.matchAll(/^Remv ([^ :]+)(?::[^ ]+)? /gm)].map(match => match[1]);
  if (removed.some(value => value !== opposite)) throw Error('Changing llama.cpp would remove other packages. Resolve those dependencies first.');
  await stopManagedLlama();
  await job.phase(`Installing ${name}`);
  // The native policy agent obtains privilege; never collect/store a sudo password.
  // APT owns the conflicting-package replacement as one normal transaction.
  if (process.getuid() === 0) await job.exec('/usr/bin/apt-get', [...args, '-y', 'install', name]);
  else await job.exec('/usr/bin/pkexec', ['/usr/bin/apt-get', '-o', 'Dpkg::Lock::Timeout=300', '-y', 'install', name]);
}
export async function installLlamaRuntime(job, { backend = 'auto' } = {}) {
  requireLinux();
  if (!['auto', 'cuda', 'vulkan', 'cpu'].includes(backend)) throw Error('Unknown llama.cpp runtime');
  let chosen = backend;
  if (chosen === 'auto') {
    const current = await llamaRuntimeOptions();
    chosen = current.backend || (await cudaLibrariesAvailable() ? 'cuda' : 'vulkan');
  }
  await installPackage(job, packages[chosen]);
  await job.phase('Checking llama.cpp devices');
  let info = await llamaRuntimeOptions();
  if (backend === 'auto' && chosen === 'cuda' && !info.devices.some(device => device.backend === 'cuda')) {
    await job.log('CUDA could not initialize a supported device; selecting the Vulkan/CPU runtime.\n');
    await installPackage(job, 'llama-cpp'); info = await llamaRuntimeOptions();
  }
  if (info.error) throw Error(info.error);
  if (['cuda', 'vulkan'].includes(backend) && !info.devices.some(device => device.backend === backend)) throw Error(`${backend.toUpperCase()} did not initialize a usable device. Select CPU or repair the driver installation.`);
  await job.log(`Available backend: ${info.backend}; devices: ${info.devices.map(value => value.description).join(', ') || 'CPU'}\n`);
  return info;
}
async function freePort(preferred) {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(preferred || 0, '127.0.0.1', resolve); });
    return server.address().port;
  } catch (error) { if (preferred && error.code === 'EADDRINUSE') return freePort(0); throw error; }
  finally { if (server.listening) await new Promise(resolve => server.close(resolve)); }
}
async function responseJson(url, apiKey, timeout = 5000, value) {
  const response = await fetch(url, { method: value === undefined ? 'GET' : 'POST', headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: value === undefined ? undefined : JSON.stringify(value), redirect: 'error', signal: AbortSignal.timeout(timeout) });
  if ([401, 403].includes(response.status)) throw Error('llama.cpp rejected the API key');
  if (!response.ok) throw Object.assign(Error(`llama.cpp returned HTTP ${response.status}`), { status: response.status });
  const length = Number(response.headers.get('content-length'));
  if (length > 1024 * 1024) { await response.body?.cancel(); throw Error('llama.cpp returned oversized model metadata'); }
  const reader = response.body.getReader(); let bytes = 0, output = '';
  const decoder = new TextDecoder();
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 1024 * 1024) throw Error('llama.cpp returned oversized model metadata'); output += decoder.decode(value, { stream: true }); }
    return JSON.parse(output + decoder.decode());
  } finally { await reader.cancel().catch(() => {}); }
}
export async function probeLlamaEndpoint({ url, apiKey, model }) {
  const origin = new URL(url);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash) throw Error('Use an HTTP(S) llama.cpp endpoint without credentials in its URL');
  origin.pathname = origin.pathname.replace(/\/v1\/?$/, '').replace(/\/$/, '');
  // /health is deliberately public upstream. Only /v1/models proves token access.
  const health = await responseJson(origin.href.replace(/\/$/, '') + '/health');
  if (health.status !== 'ok') throw Error('llama.cpp is still loading the model');
  const result = await responseJson(origin.href.replace(/\/$/, '') + '/v1/models', apiKey);
  if (!Array.isArray(result.data) || !result.data.length) throw Error('llama.cpp has no available model');
  const selected = model ? result.data.find(value => value.id === model) : result.data[0];
  if (!selected) throw Error('The selected model is not loaded in llama.cpp');
  // Router health describes the router itself, not any inference child. Native
  // models carry a status; ordinary single-model servers do not.
  if (selected.status && !['loaded', 'sleeping'].includes(selected.status.value)) throw Error(selected.status.failed ? 'The selected llama.cpp model failed to load' : 'llama.cpp is still loading the selected model');
  return { ready: true, model: selected.id, models: result.data.map(value => ({ id: value.id, meta: value.meta, ...(value.status ? { state: value.status.value } : {}) })) };
}

const modelList = values => values.map(value => ({ id: value.id, state: value.status?.value || 'loaded', ...(value.status?.failed ? { failed: true } : {}) }));

export class ManagedLlama {
  constructor(directory = path.join(dataDir, 'llama')) {
    this.directory = directory; this.configFile = path.join(directory, 'config.json'); this.processFile = path.join(directory, 'process.json');
    this.keyFile = path.join(directory, 'api-key'); this.listeners = new Set(); this.desired = false; this.serial = Promise.resolve(); this.modelSerial = Promise.resolve();
    this.generation = 0; this.failures = []; this.current = { state: 'stopped', desired: false, models: [] }; this.config = { ...defaults }; this.descendants = new Map(); this.modelLoads = new Map();
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(value, force = false) {
    if (!force && Object.entries(value).every(([name, entry]) => JSON.stringify(this.current[name]) === JSON.stringify(entry)) && this.current.desired === this.desired) return;
    this.current = { ...this.current, ...value, desired: this.desired };
    for (const fn of this.listeners) Promise.resolve().then(() => fn(this.status())).catch(() => {});
  }
  status() {
    const result = { ...this.current, config: { ...this.config } };
    if (result.state === 'ready' && this.config.publishHost) result.proxy = { host: this.config.publishHost, upstream: new URL(result.url).host };
    return result;
  }
  async configure(value) {
    requireLinux(); this.config = settings({ ...await readJson(this.configFile, defaults), ...value });
    await writeJson(this.configFile, this.config); return this.status();
  }
  async key() {
    await privateDir(this.directory);
    const token = await fs.readFile(this.keyFile, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return ''; });
    if (/^[a-f0-9]{64}\n?$/.test(token)) { await fs.chmod(this.keyFile, 0o600); return token.trim(); }
    if (token) throw Error('Invalid saved llama.cpp API key');
    const generated = randomBytes(32).toString('hex'); await fs.writeFile(this.keyFile, generated + '\n', { mode: 0o600, flag: 'wx' }); return generated;
  }
  async connection(model = this.current.model) {
    if (this.current.state !== 'ready' || !this.desired) throw Error('Managed llama.cpp is not ready');
    return { url: this.current.url, baseUrl: this.current.url + '/v1', model, apiKey: await this.key() };
  }
  exclusive(fn) { const work = this.serial.then(fn); this.serial = work.catch(() => {}); return work; }
  async start(value) {
    requireLinux();
    return this.exclusive(async () => {
      if (value) await this.configure(value); else this.config = settings(await readJson(this.configFile, defaults));
      if (!this.config.enabled) { await this.stopChild(); return this.status(); }
      const modelsDirectory = path.isAbsolute(this.config.model) ? null : await getModelsDirectory({ create: true });
      const signature = JSON.stringify({ ...this.config, model: modelsDirectory ? null : this.config.model, modelsDirectory });
      if (this.desired && this.launchSignature === signature && (['starting', 'loading', 'ready'].includes(this.current.state) || this.current.pid)) {
        if (modelsDirectory && this.config.model && this.current.model !== this.config.model) this.emit({ model: this.config.model, state: 'loading', error: null });
        return this.status();
      }
      await this.stopChild(); this.desired = true; this.failures = []; this.launchSignature = signature;
      try { await this.launch(); } catch (error) { this.emit({ state: 'failed', error: error.message }); }
      return this.status();
    });
  }
  async stop() { this.desired = false; ++this.generation; clearTimeout(this.retry); return this.exclusive(async () => { await this.stopChild(); return this.status(); }); }
  async alive(info) {
    if (!info?.started || await processStart(info.pid) !== info.started) return false;
    try { const argv = (await fs.readFile(`/proc/${info.pid}/cmdline`, 'utf8')).split('\0'); return argv.includes(this.keyFile) && argv.includes('--api-key-file') && argv.includes(info.modelsDirectory || info.model); } catch { return false; }
  }
  async captureChildren(info = this.processInfo) {
    if (!await this.alive(info)) return;
    const collect = async pid => {
      const tasks = await fs.readdir(`/proc/${pid}/task`).catch(() => []);
      const childLists = await Promise.all(tasks.map(task => fs.readFile(`/proc/${pid}/task/${task}/children`, 'utf8').catch(() => '')));
      const children = [...new Set(childLists.join(' ').trim().split(/\s+/).filter(Boolean).map(Number))];
      for (const child of children) { const started = await processStart(child); if (started) { this.descendants.set(child, started); await collect(child); } }
    };
    await collect(info.pid);
  }
  async stopChildren() {
    for (const [pid, started] of this.descendants) if (await processStart(pid) === started) {
      try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    for (const [pid, started] of this.descendants) {
      for (let i = 0; i < 20 && await processStart(pid) === started; i++) await sleep(50);
      if (await processStart(pid) === started) throw Error('Could not confirm that an owned llama.cpp model process stopped');
    }
    this.descendants.clear();
  }
  async stopChild() {
    this.desired = false; ++this.generation; clearTimeout(this.retry);
    const info = this.processInfo || await readJson(this.processFile, null);
    await this.captureChildren(info);
    if (await this.alive(info)) {
      this.emit({ state: 'stopping' });
      try { process.kill(info.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      for (let i = 0; i < 120 && await this.alive(info); i++) await sleep(100);
      if (await this.alive(info)) { try { process.kill(info.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
      for (let i = 0; i < 20 && await this.alive(info); i++) await sleep(50);
      if (await this.alive(info)) throw Error('Could not confirm that the owned llama.cpp process stopped');
    }
    await this.stopChildren();
    this.child = null; this.processInfo = null; await fs.rm(this.processFile, { force: true });
    this.current = { state: 'stopped', desired: false, models: [] }; this.emit({}, true);
  }
  async log(bytes, key) {
    this.logs = (this.logs || Promise.resolve()).then(async () => {
      const file = path.join(this.directory, 'output.log');
      await fs.appendFile(file, String(bytes).replaceAll(key, '[redacted]'), { mode: 0o600 });
      if ((await fs.stat(file)).size > 256000) { const text = await fs.readFile(file, 'utf8'); await fs.writeFile(file, text.slice(-192000), { mode: 0o600 }); }
    }).catch(() => {});
    return this.logs;
  }
  async launch() {
    const generation = ++this.generation, config = { ...this.config };
    this.modelLoads.clear();
    this.emit({ state: 'starting', error: null, pid: null, url: null, retryAt: null });
    // Existing absolute-file configurations keep working until a directory
    // model is selected. New configurations use the one shared models folder.
    const modelsDirectory = path.isAbsolute(config.model) ? null : await getModelsDirectory({ create: true });
    const model = modelsDirectory ? null : await fs.realpath(config.model);
    if (model && !(await fs.stat(model)).isFile()) throw Error('Choose a GGUF model file');
    const info = await llamaRuntimeOptions(); if (info.error) throw Error(info.error);
    const backend = config.backend === 'auto' ? info.backend : config.backend;
    const device = info.devices.find(value => value.backend === backend);
    if (backend !== 'cpu' && !device) throw Error(`${backend.toUpperCase()} is not available in the installed llama.cpp runtime`);
    const key = await this.key(), previous = await readJson(this.processFile, null), port = await freePort(previous?.port);
    if (!this.desired || generation !== this.generation) return;
    const args = ['--host', '127.0.0.1', '--port', String(port), ...(modelsDirectory ? ['--models-dir', modelsDirectory] : ['--model', model, '--alias', config.alias]), '--ctx-size', String(config.contextSize), '--api-key-file', this.keyFile, '--device', device?.id || 'none', '--gpu-layers', String(backend === 'cpu' ? 0 : config.gpuLayers), '--jinja', '--offline'];
    if (config.threads) args.push('--threads', String(config.threads));
    // Stay in the controller's guarded process group. A dead owner cannot leave
    // a detached inference daemon behind; explicit stops still use exact identity.
    const child = spawn(executable, args, { env: runtimeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    child.stdout.on('data', bytes => { void this.log(bytes, key); }); child.stderr.on('data', bytes => { void this.log(bytes, key); });
    let failure; child.once('error', error => { failure = error; });
    child.once('close', (code, signal) => { if (generation === this.generation && this.desired) this.crashed(failure?.message || `llama.cpp exited (${signal || code})`, generation); });
    const started = await processStart(child.pid);
    if (!started) return;
    this.processInfo = { pid: child.pid, started, model, modelsDirectory, port };
    await writeJson(this.processFile, this.processInfo);
    if (!this.desired || generation !== this.generation || !await this.alive(this.processInfo)) return;
    this.emit({ state: 'loading', pid: child.pid, backend, device: device?.description || 'CPU', model: modelsDirectory ? config.model : config.alias, modelsDirectory, models: [], url: `http://127.0.0.1:${port}` });
    void this.watchReady(generation, key);
  }
  async catalogue(key, reload = false) {
    const result = await responseJson(this.current.url + '/v1/models' + (reload ? '?reload=1' : ''), key);
    if (!Array.isArray(result.data)) throw Error('llama.cpp returned invalid model metadata');
    this.emit({ models: modelList(result.data) });
    return result.data;
  }
  async refresh() {
    if (!this.desired || !this.current.url) throw Error('Start local llama.cpp to read its models folder');
    if (this.processInfo?.modelsDirectory && await getModelsDirectory({ create: true }) !== this.processInfo.modelsDirectory) return this.start();
    await this.catalogue(await this.key(), Boolean(this.processInfo?.modelsDirectory));
    return this.status();
  }
  routerModel(model, key) {
    // Serialize the short native catalogue/load request, not model loading.
    // A concurrent Pi wait must not act on an old unloaded-model snapshot.
    const work = this.modelSerial.then(() => this.routerModelStep(model, key));
    this.modelSerial = work.catch(() => {}); return work;
  }
  async routerModelStep(model, key) {
    const generation = this.generation;
    const models = await this.catalogue(key), selected = model ? models.find(value => value.id === model) : models[0];
    if (!selected) throw Object.assign(Error(model ? 'The selected model is not in the models folder; refresh the list or choose another model' : 'No GGUF models found in the models folder'), { modelUnavailable: true });
    if (!this.desired || generation !== this.generation) throw Error('Managed llama.cpp is stopped');
    if (['loaded', 'sleeping'].includes(selected.status?.value)) {
      const attempt = this.modelLoads.get(selected.id);
      if (attempt) {
        attempt.readyAt ||= Date.now(); attempt.retryAt = null;
        if (Date.now() - attempt.readyAt > 120000) this.modelLoads.delete(selected.id);
      }
      return { ready: true, model: selected.id };
    }
    if (selected.status?.value === 'unloaded') {
      let attempt = this.modelLoads.get(selected.id);
      if (selected.status.failed && !attempt?.retryAt) {
        const failures = (attempt?.failures || 0) + 1;
        attempt = { failures, retryAt: Date.now() + Math.min(30000, 1000 * 2 ** (failures - 1)) };
        this.modelLoads.set(selected.id, attempt);
      }
      if (attempt?.failures > 5) throw Object.assign(Error(`llama.cpp could not load ${selected.id} after repeated failures`), { modelUnavailable: true });
      if (attempt?.retryAt > Date.now()) return { ready: false, model: selected.id, retryAt: attempt.retryAt, error: `llama.cpp is retrying ${selected.id}` };
      if (!attempt?.loading) {
        const loading = { failures: attempt?.failures || 0, loading: true };
        this.modelLoads.set(selected.id, loading);
        try { await responseJson(this.current.url + '/models/load', key, 10000, { model: selected.id }); }
        finally { loading.loading = false; }
        await this.captureChildren();
      }
    }
    return { ready: false, model: selected.id };
  }
  async watchReady(generation, key) {
    let deadline = Date.now() + 15 * 60 * 1000, lastModel, failure = '';
    while (this.desired && generation === this.generation) {
      if (!this.processInfo) return;
      const model = this.current.model;
      if (model !== lastModel) { lastModel = model; deadline = Date.now() + 15 * 60 * 1000; }
      try {
        await this.captureChildren();
        const result = this.processInfo?.modelsDirectory ? await this.routerModel(model, key) : await probeLlamaEndpoint({ url: this.current.url, apiKey: key, model });
        if (!this.desired || generation !== this.generation) return;
        if (this.current.model !== model) continue;
        if (result.ready && await this.alive(this.processInfo)) {
          this.readyAt ||= Date.now(); deadline = Date.now() + 15 * 60 * 1000;
          this.emit({ state: 'ready', model: result.model, error: null, retryAt: null });
        } else this.emit({ state: 'loading', model: result.model, error: result.error || null, retryAt: result.retryAt || null });
      } catch (error) {
        failure = error.message;
        if (this.desired && generation === this.generation && error.modelUnavailable) this.emit({ state: 'failed', error: failure, retryAt: null });
      }
      if (Date.now() >= deadline) {
        if (this.desired && generation === this.generation) { await this.stop(); this.emit({ state: 'failed', error: `Model did not become ready: ${failure}` }); }
        return;
      }
      await sleep(750);
    }
  }
  crashed(error, generation) {
    if (!this.desired || generation !== this.generation) return;
    this.processInfo = null; this.child = null;
    const now = Date.now();
    this.failures = this.readyAt && now - this.readyAt > 120000 ? [] : this.failures.filter(at => now - at < 300000);
    this.readyAt = null; this.failures.push(now);
    const exhausted = this.failures.length > 5, delay = Math.min(30000, 1000 * 2 ** (this.failures.length - 1));
    this.emit({ state: 'failed', pid: null, error, retryAt: exhausted ? null : now + delay });
    if (!exhausted) this.retry = setTimeout(() => {
      if (this.desired && generation === this.generation) void this.exclusive(async () => {
        if (!this.desired || generation !== this.generation) return;
        await this.stopChildren();
        if (this.desired && generation === this.generation) await this.launch();
      }).catch(value => this.emit({ state: 'failed', error: value.message, retryAt: null }));
    }, delay);
  }
  async waitReady({ timeout = 15 * 60 * 1000, model } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (!this.desired) throw Error(this.current.error || 'Managed llama.cpp is stopped');
      if (this.current.pid && this.current.url) {
        if (this.processInfo?.modelsDirectory) {
          const selected = model || this.current.model;
          try {
            const result = await this.routerModel(selected, await this.key());
            if (result.ready && this.desired && await this.alive(this.processInfo)) {
              // Independent Pi sessions can wait for different native models;
              // this must not change the configured selection or replay a turn.
              return { url: this.current.url, baseUrl: this.current.url + '/v1', model: result.model, apiKey: await this.key() };
            }
          } catch (error) { if (error.modelUnavailable) throw error; }
        } else if (this.current.state === 'ready') {
          if (model && model !== this.current.model) throw Error('The selected local llama.cpp model is not ready');
          await probeLlamaEndpoint({ url: this.current.url, apiKey: await this.key(), model: this.current.model });
          return this.connection();
        }
      } else if (this.current.state === 'failed' && !this.current.retryAt) throw Error(this.current.error || 'Managed llama.cpp is stopped');
      await sleep(250);
    }
    throw Error('Timed out waiting for the selected llama.cpp model');
  }
}

const managed = new ManagedLlama();
export const managedLlamaStatus = () => managed.status();
export const configureManagedLlama = value => managed.configure(value);
export const startManagedLlama = value => managed.start(value);
export const stopManagedLlama = () => managed.stop();
export const refreshManagedLlama = () => managed.refresh();
export const waitForManagedLlamaReady = options => managed.waitReady(options);
export const readManagedLlamaConnection = () => managed.connection();
export const subscribeManagedLlama = listener => managed.subscribe(listener);
