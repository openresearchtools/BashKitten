import { publishNewFile } from './files.mjs';
import { quantizePocket } from './quantize.mjs';
// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { dataDir, readJson, writeJson, privateDir, digest } from '../common.mjs';
import { syncManagedProvider, discoverManagedModels } from '../rpc/managed-provider.mjs';
import { localAIDir, requireLocalRuntime, runtimeInfo, describeRuntime, checkRuntime, installRuntime, validateBinary, managedRuntimeEnvironment, listRuntimeDevices } from './runtimes.mjs';
import { platform } from '../platform/index.mjs';
import { launchInference } from './launch.mjs';
import { parseRouterINI, updateRouterModel, isolatedPreset, routerModelId, browseBackend, verifyTestConfiguration } from './router-models.mjs';
import { RouterModelTest } from './router-test.mjs';

const configFile = path.join(localAIDir, 'config.json');
const ids = { llama: 'localai-llama', whisper: 'localai-whisper' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const defaults = engine => ({ mode: 'managed', binary: '', backend: platform === 'termux' ? 'cpu' : 'auto', port: 0, argv: [], cwd: os.homedir(), env: {},
  ...(engine === 'llama' ? { preset: path.join(localAIDir, 'router.ini'), startup: false, importToPi: true, keyFile: '' } : engine === 'tts' ? { model: '', projector: '', voice: '', language: 'en', modelKind: 'pocket' } : { model: '', modelKind: 'whisper', keepRunning: false, autoSend: true }) });
const cleanText = value => typeof value === 'string' && !value.includes('\0');
// Pi import and voice-message sending do not change the inference command.
const sameRuntimeConfig = (a, b) => JSON.stringify({ ...a, importToPi: undefined, autoSend: undefined }) === JSON.stringify({ ...b, importToPi: undefined, autoSend: undefined });
// A GPU archive also contains its CPU backend. Moving to a different GPU
// archive requires an explicit download, but saving that choice must work first.
const supportsManagedChoice = (runtime, config) => Boolean(runtime?.binary &&
  (['cpu', 'auto'].includes(config.backend) || runtime.backend === config.backend));
const downloadRequired = (engine, config) => Error(`Download the selected ${config.backend === 'auto' ? '' : config.backend + ' '}${engine} runtime in LocalAI first`);
async function readConfiguration() {
  const saved = await readJson(configFile, null);
  if (saved) {
    if (saved.version !== 1) throw Error('Unsupported LocalAI configuration');
    if (saved.whisper.autoSend === undefined) saved.whisper.autoSend = true;
    if (saved.whisper.modelKind === undefined) saved.whisper.modelKind = 'whisper';
    saved.tts ||= defaults('tts');
    return saved;
  }
  // Preserve a prior explicitly enabled setup as Custom. Never install over it.
  const legacy = await readJson(path.join(dataDir, 'llama/config.json'), null);
  const llama = defaults('llama');
  if (legacy) {
    llama.mode = 'custom'; llama.binary = '/usr/bin/llama-server'; llama.backend = legacy.backend || 'auto'; llama.startup = Boolean(legacy.enabled);
    llama.keyFile = path.join(dataDir, 'llama/api-key');
    if (path.isAbsolute(legacy.model || '')) llama.argv = ['/usr/bin/llama-server', '--model', legacy.model, '--alias', legacy.alias || 'bashkitten-local', '--host', '127.0.0.1', '--port', '{port}', '--api-key-file', llama.keyFile,
      '--ctx-size', String(legacy.contextSize ?? 8192), '--gpu-layers', String(legacy.backend === 'cpu' ? 0 : legacy.gpuLayers ?? 'auto'), '--offline', '--jinja', ...(legacy.threads ? ['--threads', String(legacy.threads)] : [])];
  }
  return { version: 1, llama, whisper: defaults('whisper'), tts: defaults('tts') };
}
function configuration(engine, value) {
  if (![...Object.keys(ids), 'tts'].includes(engine) || !value || !['managed', 'custom'].includes(value.mode) || !['auto', 'cuda', 'vulkan', 'cpu'].includes(value.backend)) throw Error('Invalid LocalAI configuration');
  const result = { ...defaults(engine), ...value };
  if (platform === 'termux' && !['cpu', 'vulkan'].includes(result.backend)) throw Error('Choose CPU or GPU (native Termux Vulkan)');
  if (!Number.isInteger(result.port) || result.port < 0 || result.port > 65535) throw Error('Use Automatic (0) or a valid loopback port');
  if (!cleanText(result.binary) || !path.isAbsolute(result.cwd || '') || !cleanText(result.cwd)) throw Error('Choose an executable and absolute working directory');
  if (!Array.isArray(result.argv) || !result.argv.every(cleanText)) throw Error('Launch command must be a JSON array of arguments');
  if (!result.env || typeof result.env !== 'object' || Array.isArray(result.env) || Object.entries(result.env).some(([key, value]) => !/^[A-Za-z_][A-Za-z_0-9]*$/.test(key) || !cleanText(value))) throw Error('Invalid command environment');
  if (engine === 'llama') {
    if (!cleanText(result.preset) || !path.isAbsolute(result.preset) || typeof result.startup !== 'boolean' || typeof result.importToPi !== 'boolean' || !cleanText(result.keyFile) || result.keyFile && !path.isAbsolute(result.keyFile)) throw Error('Choose a router INI, startup and coding-agent import options');
  } else if (engine === 'tts') {
    if (result.mode !== 'managed' || !['pocket', 'qwen3'].includes(result.modelKind) || !/^[a-z]{2,3}$/.test(result.language)) throw Error('Choose Pocket TTS or Qwen3-TTS and a language code');
    for (const key of ['model', 'projector', 'voice']) if (!cleanText(result[key]) || result[key] && !path.isAbsolute(result[key])) throw Error('Choose absolute TTS model, projector and reference audio paths');
    if (result.argv.length || Object.keys(result.env).length) throw Error('TTS uses the verified llama-tts command');
  } else {
    if (!['whisper', 'parakeet'].includes(result.modelKind)) throw Error('Choose Whisper or Parakeet');
    if (typeof result.keepRunning !== 'boolean' || typeof result.autoSend !== 'boolean' || !cleanText(result.model) || result.model && !path.isAbsolute(result.model)) throw Error('Choose a whisper.cpp model and valid voice-message options');
    if (result.mode !== 'managed') throw Error('Whisper uses the verified managed runtime');
    if (Object.keys(result.env).length) throw Error('Whisper does not accept environment overrides that can retain audio');
  }
  return result;
}
function argument(argv, name) {
  const indices = argv.flatMap((value, index) => value === name || value.startsWith(name + '=') ? [index] : []);
  if (indices.length > 1) throw Error('Specify ' + name + ' once');
  if (!indices.length) return null;
  const index = indices[0]; return argv[index] === name ? argv[index + 1] : argv[index].slice(name.length + 1);
}
async function allocatePort(preferred = 0) {
  const server = net.createServer();
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(preferred, '127.0.0.1', resolve); }); }
  catch (error) { if (preferred && error.code === 'EADDRINUSE') return allocatePort(); throw error; }
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function jsonRequest(url, { key, signal, data } = {}) {
  const response = await fetch(url, { redirect: 'error', signal: signal || AbortSignal.timeout(10000), method: data ? 'POST' : 'GET',
    headers: { ...(key ? { Authorization: 'Bearer ' + key } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(Error(`LocalAI returned HTTP ${response.status}`), { loading: response.status === 503 }); }
  return response.json();
}
function validateINI(content) {
  if (typeof content !== 'string' || content.includes('\0')) throw Error('Invalid router INI');
  // Upstream places keys before the first section (including version) in
  // its default preset. Option names/values remain llama.cpp's responsibility.
  for (const [index, raw] of content.split(/\r\n|\r|\n/).entries()) {
    const line = raw.trim(); if (!line || /^[;#]/.test(line)) continue;
    if (/^\[[^\]\r\n]+\]\s*(?:[;#].*)?$/.test(line)) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*[ \t]*=/.test(line)) throw Error(`Invalid router INI syntax at line ${index + 1}`);
  }
}
export class LocalAI {
  constructor(services) { this.services = services; this.importState = { state: 'pending' }; this.speech = null; this.stopping = false; this.serial = Promise.resolve(); this.runningConfig = new Map(); this.errors = new Map(); this.routerTest = new RouterModelTest(); }
  exclusive(action) { const result = this.serial.then(action); this.serial = result.catch(() => {}); return result; }
  async initialize() {
    requireLocalRuntime(); await privateDir(localAIDir);
    const config = await readConfiguration();
    if (!await fs.stat(config.llama.preset).catch(() => null) && config.llama.preset === defaults('llama').preset) {
      await fs.writeFile(config.llama.preset, '# llama.cpp router presets. Model sections use their real paths.\n[*]\nctx-size = 8192\n', { mode: 0o600, flag: 'wx' });
    }
    await writeJson(configFile, config);
  }
  async config() { requireLocalRuntime(); return readConfiguration(); }
  async status() {
    const config = await this.config(), host = await this.services.status();
    const engines = {};
    for (const engine of Object.keys(ids)) {
      const runtime = await runtimeInfo(engine), service = host.services.find(item => item.id === ids[engine]);
      engines[engine] = { config: config[engine], runtime: describeRuntime(runtime), service, url: service ? 'http://' + service.target.address : null,
        savedForNextStart: Boolean(this.services.running.get(ids[engine])?.child && !sameRuntimeConfig(this.runningConfig.get(engine), config[engine])), error: this.errors.get(engine) || '' };
    }
    return { ...engines, tts: { config: config.tts, runtime: describeRuntime(await runtimeInfo('llama')), synthesis: this.synthesisState || { state: 'idle' } }, platform, revision: digest(JSON.stringify(config)), import: this.importState, speechBusy: Boolean(this.speech) };
  }
  async save(value) { return this.exclusive(() => this.saveConfiguration(value)); }
  async saveConfiguration({ engine, config: input, revision }) {
    const saved = await this.config();
    if (revision !== digest(JSON.stringify(saved))) throw Error('LocalAI changed. Refresh before saving.');
    const config = configuration(engine, input);
    if (engine === 'tts') { saved.tts = config; await writeJson(configFile, saved); return this.status(); }
    if (config.mode === 'custom') {
      const verified = await validateBinary(engine, config.binary, engine === 'llama' ? 'cpu' : config.backend, config.env); config.binary = verified.binary; config.libraries = verified.libraries;
    }
    if (engine === 'whisper' && config.model) await this.model(config.model, config.modelKind);
    // Save a new managed device choice before its matching download. Missing
    // Whisper models also remain configurable; starting still requires both.
    if ((config.mode === 'custom' || supportsManagedChoice(await runtimeInfo(engine), config)) &&
        (engine !== 'whisper' || config.model)) await this.command(engine, config, config.port || 1);
    saved[engine] = config; await writeJson(configFile, saved);
    if (!this.services.running.get(ids[engine])?.child) await this.configureService(engine);
    if (engine === 'llama') await this.importProvider();
    return this.status();
  }
  async binary(engine, config, { router = false } = {}) {
    const runtime = await runtimeInfo(engine);
    if (config.mode === 'managed' && !supportsManagedChoice(runtime, config)) throw downloadRequired(engine, config);
    const file = config.mode === 'custom' ? config.binary : runtime?.binary;
    if (!file) throw Error(`Download the ${engine} runtime first`);
    const environment = config.mode === 'custom' ? config.env : managedRuntimeEnvironment(file, config.env, router ? 'auto' : config.backend);
    if (router) {
      const verified = await validateBinary(engine, file, 'cpu', environment);
      return { ...verified, env: environment }; // Model presets, not the package flavour, select devices.
    }
    return validateBinary(engine, file, config.backend === 'auto' && runtime?.selectedBackend && config.mode === 'managed' ? runtime.selectedBackend : config.backend, environment);
  }
  async command(engine, config, port) {
    const runtime = await this.binary(engine, config, { router: engine === 'llama' });
    if (engine === 'whisper' && config.modelKind === 'parakeet') {
      if (config.argv.length || config.keepRunning) throw Error('Parakeet uses its on-demand stdin command; clear the custom command and Keep running');
      const executable = path.join(path.dirname(runtime.binary), 'parakeet-cli');
      await fs.access(executable, fs.constants.X_OK); await this.model(config.model, 'parakeet');
      return { argv: [executable, '--model', config.model, '--file', '-', '--no-prints', ...(runtime.backend === 'cpu' ? ['--no-gpu'] : ['--device', runtime.devices.find(item => item.backend === runtime.backend).id])], cwd: config.cwd, env: runtime.env };
    }
    let argv = config.argv.length ? config.argv.map(value => value === '{port}' ? String(port) : value) : [runtime.binary, '--host', '127.0.0.1', '--port', String(port)];
    if (!config.argv.length) {
      if (engine === 'llama') {
        // One shared download root now also contains TTS GGUFs. Only explicit
        // router entries are chat models; scanning that root would offer speech
        // decoders/projectors to Pi as if they were language models.
        argv.push('--models-preset', config.preset, '--offline', '--jinja');
        if (config.keyFile) argv.push('--api-key-file', config.keyFile);
      } else { argv.push('--model', config.model, '--language', 'auto', '--no-timestamps'); if (runtime.backend === 'cpu') argv.push('--no-gpu'); else argv.push('--device', runtime.devices.find(item => item.backend === runtime.backend).id); }
    }
    if (await fs.realpath(argv[0]) !== runtime.binary || argument(argv, '--host') !== '127.0.0.1' || argument(argv, '--port') !== String(port)) throw Error('The command must use the selected binary, --host 127.0.0.1 and --port {port}');
    if (engine === 'whisper') {
      // Only the upstream server's non-persisting options are accepted. In
      // particular --convert/debug/dump/prompt/context/output paths stay absent.
      const flags = new Set(['--no-gpu', '--no-timestamps', '--no-flash-attn', '--flash-attn', '--suppress-nst']);
      const valued = new Set(['--host', '--port', '--model', '--language', '--threads', '--processors', '--device', '--beam-size', '--best-of', '--no-speech-thold']);
      for (let index = 1; index < argv.length; index++) {
        if (flags.has(argv[index])) continue;
        if (!valued.has(argv[index]) || ++index >= argv.length) throw Error('Whisper command contains an option incompatible with private in-memory dictation');
      }
      if (argument(argv, '--model') !== config.model) throw Error('Whisper command must use the selected model');
      if (runtime.backend === 'cpu' && !argv.includes('--no-gpu')) throw Error('The selected CPU command needs --no-gpu');
      if (runtime.backend !== 'cpu' && (argv.includes('--no-gpu') || !runtime.devices.some(device => device.backend === runtime.backend && device.id === (argument(argv, '--device') || '0')))) throw Error('The Whisper command must use the selected, available GPU device');
      await this.model(config.model, config.modelKind);
    } else {
      const preset = argument(argv, '--models-preset') || config.env.LLAMA_ARG_MODELS_PRESET;
      if (preset && preset !== config.preset) throw Error('The command must use the selected router INI');
      if (argument(argv, '--api-key') !== null && (config.keyFile || argument(argv, '--api-key-file'))) throw Error('Choose the direct application key or its key file, not both');
      if ((argument(argv, '--api-key-file') || config.env.LLAMA_ARG_API_KEY_FILE || '') !== config.keyFile) throw Error('The command and Pi import must use the same selected key file');
    }
    return { argv, cwd: config.cwd, env: runtime.env };
  }
  async configureService(engine, { runtimeRequired = false } = {}) {
    const config = (await this.config())[engine], status = await this.services.status();
    if (engine === 'whisper' && config.modelKind === 'parakeet') { if (runtimeRequired) throw Error('Parakeet starts on demand when you record a message'); return; }
    const existing = status.services.find(item => item.id === ids[engine]);
    const ready = config.mode === 'custom' ? config.binary : supportsManagedChoice(await runtimeInfo(engine), config);
    if (!ready) { if (runtimeRequired) throw downloadRequired(engine, config); return; }
    if (engine === 'whisper' && !config.model) { if (runtimeRequired) throw Error('Choose a Whisper model in LocalAI first'); return; }
    const previousPort = existing ? Number(existing.target.address.split(':').at(-1)) : 0;
    const port = config.port || (this.services.running.get(ids[engine])?.child ? previousPort : await allocatePort(previousPort));
    const command = await this.command(engine, config, port);
    await this.services.save({ internal: true, revision: status.revision, service: { id: ids[engine], name: engine === 'llama' ? 'llama.cpp' : 'Whisper',
      target: { network: 'tcp', address: '127.0.0.1:' + port }, scheme: 'http', openPath: '/', kind: engine === 'llama' ? 'llama' : 'web',
      enabled: engine === 'llama' && Boolean(existing?.enabled), startup: engine === 'llama' && config.startup, command } });
  }
  async action(engine, action) { return this.exclusive(() => this.performAction(engine, action)); }
  async performAction(engine, action) {
    if (!ids[engine] || !['start', 'stop', 'reload'].includes(action)) throw Error('Unknown LocalAI action');
    if (engine === 'whisper' && this.speech) throw Error('Finish or cancel dictation before changing Whisper');
    if (action === 'start' && this.services.running.get(ids[engine])?.child) return this.status();
    if (action === 'reload') await this.services.action({ id: ids[engine], action: 'stop' });
    if (action !== 'stop') await this.configureService(engine, { runtimeRequired: true });
    await this.services.action({ id: ids[engine], action: action === 'reload' ? 'start' : action });
    if (action !== 'stop') this.runningConfig.set(engine, structuredClone((await this.config())[engine]));
    if (engine === 'llama') await this.importProvider();
    return this.status();
  }
  async share(enabled) {
    if (typeof enabled !== 'boolean') throw Error('Choose whether to share llama.cpp');
    if (!this.services.running.get(ids.llama)?.child) await this.configureService('llama', { runtimeRequired: enabled });
    const state = await this.services.status(), entry = state.services.find(item => item.id === ids.llama);
    if (!entry) throw Error('Configure llama.cpp in LocalAI first');
    await this.services.save({ internal: true, revision: state.revision, service: { ...entry, enabled } });
    return this.status();
  }
  async key(config) {
    if (config.keyFile) {
      const key = (await fs.readFile(config.keyFile, 'utf8')).split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#'));
      if (!key) throw Error('The selected application key file has no key to import');
      return key;
    }
    const csv = argument(config.argv, '--api-key') || config.env.LLAMA_API_KEY || '';
    if (!csv.startsWith('"')) return csv.split(',')[0];
    const value = /^"((?:[^"]|"")*)"(?:,|$)/.exec(csv);
    if (!value) throw Error('Invalid application key CSV');
    return value[1].replaceAll('""', '"');
  }
  async catalogue() {
    const service = (await this.services.entries()).find(entry => entry.id === ids.llama);
    if (!service || !this.services.running.get(ids.llama)?.child) throw Error('Local llama.cpp is stopped');
    const url = 'http://' + service.target.address;
    const health = await jsonRequest(url + '/health');
    if (health.status !== 'ok') throw Object.assign(Error('Local llama.cpp is loading'), { loading: true });
    const config = this.runningConfig.get('llama') || (await this.config()).llama;
    const result = await jsonRequest(url + '/models', { key: await this.key(config) });
    if (!Array.isArray(result.data) || !result.data.length || result.data.some(model => typeof model.id !== 'string' || !model.id)) throw Error('No router models are available yet');
    return { url, config, models: result.data };
  }
  async importProvider() {
    const config = (await this.config()).llama;
    if (!config.importToPi) { this.importState = { state: 'off' }; return; }
    try {
      const info = await this.catalogue();
      if (!sameRuntimeConfig(config, info.config)) throw Error('Saved changes are pending Reload; the running service and existing Pi provider are unchanged');
      // Recheck after network/model discovery so opting out cancels pending work.
      if (!(await this.config()).llama.importToPi) return;
      const key = await this.key(info.config);
      const models = await discoverManagedModels(info.url + '/v1', key, 'Local llama.cpp');
      if (JSON.stringify((await this.config()).llama) !== JSON.stringify(config)) return;
      const result = await syncManagedProvider({ id: 'bashkitten-llama', name: 'Local llama.cpp', baseUrl: info.url + '/v1',
        ...(info.config.keyFile ? { apiKeyFile: info.config.keyFile } : key ? { apiKey: key } : {}), models });
      this.importState = { state: result?.state === 'pending' ? 'pending' : 'ready', provider: 'bashkitten-llama', endpoint: info.url + '/v1' };
    } catch (error) { this.importState = { state: 'pending', error: error.message }; }
  }
  async waitReady(model, signal) {
    let requested = false;
    for (;;) {
      signal?.throwIfAborted();
      let info;
      try { info = await this.catalogue(); } catch (error) { if (!error.loading && !['ECONNREFUSED', 'ECONNRESET'].includes(error.cause?.code)) throw error; await pause(250); continue; }
      const entry = info.models.find(item => item.id === model);
      if (!entry) throw Error('The selected model is no longer in the llama.cpp router');
      if (entry.status?.failed) throw Error('llama.cpp could not load the selected model');
      if (!entry.status || ['loaded', 'sleeping'].includes(entry.status.value)) { await this.importProvider(); return { state: 'ready', model, url: info.url }; }
      if (entry.status.value === 'unloaded' && !requested) { requested = true; await jsonRequest(info.url + '/models/load', { key: await this.key(info.config), data: { model } }); }
      await pause(250);
    }
  }
  async ini({ file, content, revision, create = false }) {
    if (!cleanText(file) || !path.isAbsolute(file)) throw Error('Choose an absolute router INI path');
    file = await fs.realpath(file).catch(async error => { if (error.code !== 'ENOENT') throw error; return path.join(await fs.realpath(path.dirname(file)), path.basename(file)); });
    const before = await fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (content === undefined) return { file, content: before || '', revision: before === null ? null : digest(before) };
    if (before !== null && (create || revision !== digest(before)) || before === null && revision !== null) throw Error('The router INI changed outside this editor. Reopen it before saving.');
    validateINI(content);
    const temporary = path.join(path.dirname(file), '.' + path.basename(file) + '-' + randomUUID());
    try {
      const mode = before === null ? 0o600 : (await fs.stat(file)).mode & 0o777;
      const output = await fs.open(temporary, 'wx', mode);
      try { await output.writeFile(content); await output.sync(); } finally { await output.close(); }
      const latest = await fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (latest !== before) throw Error('The router INI changed while saving');
      if (before === null) { await publishNewFile(temporary, file); await fs.rm(temporary, { force: true }); } else await fs.rename(temporary, file);
      const directory = await fs.open(path.dirname(file), 'r'); try { await directory.sync(); } finally { await directory.close(); }
    } finally { await fs.rm(temporary, { force: true }); }
    return { file, content, revision: digest(content) };
  }
  async browse(value) { return browseBackend(value); }
  async routerModels({ file } = {}) {
    const config = (await this.config()).llama;
    const ini = await this.ini({ file: file || config.preset });
    const { models } = parseRouterINI(ini.content);
    let devices = [], deviceError = '';
    try {
      const runtime = await runtimeInfo('llama');
      const binary = config.mode === 'custom' ? config.binary : runtime?.binary;
      if (!binary) throw Error('Download or select llama.cpp to list GPU devices');
      devices = await listRuntimeDevices(binary, config.mode === 'custom' ? config.env : managedRuntimeEnvironment(binary, config.env));
      if (!devices.length) deviceError = 'No GPU devices reported; explicit CPU models remain available';
    } catch (error) { deviceError = 'GPU device discovery: ' + error.message; }
    return { file: ini.file, revision: ini.revision, models, devices, deviceError };
  }
  async saveRouterModel(value) { return this.exclusive(async () => {
    const ini = await this.ini({ file: value.file });
    if (value.revision !== ini.revision) throw Error('The router INI changed. Reopen the model editor.');
    const content = await updateRouterModel(ini.content, value);
    await this.ini({ file: ini.file, content, revision: ini.revision });
    return this.routerModels({ file: ini.file });
  }); }
  async testRouterModel({ file, revision, name, owner }) {
    if (this.stopping || this.routerTest.busy) throw Error('Agent is stopping or a model check is still unloading');
    // Register the owner before any I/O so a closing native view can cancel
    // preparation too; no late launch may escape its cancellation.
    return this.routerTest.start({ owner, model: name,
      prepare: async signal => {
        signal.throwIfAborted();
        const ini = await this.ini({ file });
        if (ini.revision !== revision) throw Error('The router INI changed. Save and reopen it before checking.');
        const model = routerModelId(name);
        if (this.services.running.get(ids.llama)?.child) {
          const running = await this.catalogue();
          if (running.models.some(entry => entry.status?.value !== 'unloaded')) throw Error('A router model is active. Finish its work and unload it before testing another load.');
        }
        const preset = isolatedPreset(ini.content, name), config = (await this.config()).llama;
        await verifyTestConfiguration(config.env);
        signal.throwIfAborted();
        const directory = await fs.mkdtemp(path.join(localAIDir, '.model-check-'));
        try {
          const temporary = path.join(directory, 'router.ini'); await fs.writeFile(temporary, preset, { mode: 0o600 });
          const port = await allocatePort(), command = await this.command('llama', config, port);
          const selector = argument(command.argv, '--models-preset');
          if (selector !== config.preset) throw Error('Model checks require the selected INI in the launcher --models-preset argument');
          if (['--model', '-m', '--models-dir', '--hf-repo', '--hf-model', '-hf', '--model-url', '-mu'].some(flag => argument(command.argv, flag) !== null)) throw Error('This custom launcher selects other models. Remove its global model source before checking an INI preset.');
          for (const key of ['LLAMA_ARG_MODEL', 'LLAMA_ARG_MODEL_URL', 'LLAMA_ARG_HF_REPO', 'LLAMA_ARG_MODELS_DIR']) if (config.env[key] ?? process.env[key]) throw Error('This launcher environment selects other models: ' + key);
          command.argv = command.argv.map((value, index, all) => all[index - 1] === '--models-preset' ? temporary : value.startsWith('--models-preset=') ? '--models-preset=' + temporary : value);
          // Upstream always discovers its model cache, even with an INI. Keep
          // unrelated cached/autoload models out of this temporary router.
          const cache = path.join(directory, 'cache'); await fs.mkdir(cache, { mode: 0o700 });
          command.env = { ...command.env, LLAMA_CACHE: cache, LLAMA_ARG_MODELS_PRESET: temporary };
          signal.throwIfAborted();
          return { directory, command, model, url: 'http://127.0.0.1:' + port, key: await this.key(config) };
        } catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error; }
      },
      request: (prepared, suffix, options) => jsonRequest(prepared.url + suffix, { ...options, key: prepared.key }),
    });
  }
  async model(file, kind = 'whisper') {
    if (!file || !path.isAbsolute(file)) throw Error('Choose a whisper.cpp ggml model');
    const handle = await fs.open(file, 'r');
    // Both upstream Whisper and Parakeet use GGML_FILE_MAGIC. Architecture
    // compatibility is checked by the selected engine when loading the model.
    try { const bytes = Buffer.alloc(4); await handle.read(bytes, 0, 4, 0); if (bytes.readUInt32LE() !== 0x67676d6c) throw Error('This is not a compatible ' + kind + ' model'); }
    finally { await handle.close(); }
  }
  async check(engine) { return checkRuntime(engine, (await this.config())[engine]); }
  async useModel({ engine, file, kind, projector = '' }) { return this.exclusive(async () => {
    if (!['llama', 'whisper', 'tts'].includes(engine) || !cleanText(file) || !path.isAbsolute(file)) throw Error('Choose a downloaded model');
    await fs.access(file);
    const saved = await this.config();
    if (engine === 'llama') {
      const ini = await this.ini({ file: saved.llama.preset });
      const name = path.basename(file).replace(/\.gguf$/i, '');
      if (/[\]\r\n]/.test(name) || /[\r\n]/.test(file + projector) || !/\.gguf$/i.test(file)) throw Error('Choose a GGUF filename representable in router INI');
      if (ini.content.split(/\r?\n/).some(line => line.trim() === '[' + name + ']')) throw Error('This router entry already exists');
      if (projector) { if (!path.isAbsolute(projector)) throw Error('Choose an absolute projector path'); await fs.access(projector); }
      await this.ini({ file: ini.file, revision: ini.revision, content: await updateRouterModel(ini.content, { name, config: { model: file, projector, contextSize: 8192, device: 'none', gpuLayers: 0, fit: true, idleMinutes: 0, cacheGpu: false, flashAttention: 'auto', extra: '' } }) });
      return { ...await this.status(), selectedModel: name };
    }
    const next = { ...saved[engine], model: file, modelKind: kind };
    if (engine === 'tts') next.projector = projector;
    if (kind === 'parakeet') { next.argv = []; next.keepRunning = false; }
    return this.saveConfiguration({ engine, config: next, revision: digest(JSON.stringify(saved)) });
  }); }
  async synthesize({ text, output }) {
    if (this.stopping || this.synthesis) throw Error('Speech synthesis is busy or Agent is stopping');
    if (!cleanText(text) || !text.trim() || !cleanText(output) || !path.isAbsolute(output) || !/\.wav$/i.test(output)) throw Error('Enter text and an absolute output WAV path');
    const config = (await this.config()).tts;
    const runtime = await this.binary('llama', config);
    for (const file of [config.model, config.projector, config.voice]) { if (!file) throw Error('Choose a TTS model, its matching projector and reference voice'); await fs.access(file); }
    if (await fs.stat(output).catch(error => { if (error.code !== 'ENOENT') throw error; return null; })) throw Error('The output file already exists; choose a new WAV filename');
    const temporary = path.join(path.dirname(output), '.bashkitten-tts-' + randomUUID() + '.wav');
    const executable = path.join(path.dirname(runtime.binary), 'llama-tts'); await fs.access(executable, fs.constants.X_OK);
    const argv = [executable, '-m', config.model, '-mm', config.projector, '-p', text, '--tts-speaker-file', config.voice, '--output', temporary,
      '--device', runtime.devices.find(item => item.backend === runtime.backend)?.id || 'none', '-ngl', runtime.backend === 'cpu' ? '0' : '999',
      ...(runtime.backend === 'cpu' ? ['--no-mmproj-offload'] : []),
      ...(config.modelKind === 'qwen3' ? ['--tts-lang', config.language] : [])];
    const child = launchInference({ argv, cwd: config.cwd, env: runtime.env }, { capture: false });
    this.synthesis = child; this.synthesisState = { state: 'generating' };
    const ended = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(Error('Speech synthesis failed; check the runtime, matching model/projector and reference voice'))); });
    this.synthesisFinished = (async () => {
      try {
        await ended;
        const file = await fs.open(temporary, 'r');
        try { const header = Buffer.alloc(12); await file.read(header, 0, 12, 0); if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE' || (await file.stat()).size <= 44) throw Error('The TTS runtime did not produce valid WAV audio'); }
        finally { await file.close(); }
        // Do not replace an output created by another operation while generating.
        await publishNewFile(temporary, output); this.synthesisState = { state: 'complete', output };
      } catch (error) { this.synthesisState = { state: 'failed', error: error.message }; }
      finally { await fs.rm(temporary, { force: true }); this.synthesis = null; }
    })();
    return this.status();
  }
  async cancelSynthesis() { if (this.synthesis) { this.synthesis.kill('SIGTERM'); await this.synthesisFinished; } return this.status(); }
  async quantize(job, input) {
    if (this.stopping || this.quantization) throw Error('Quantization is busy or Agent is stopping');
    this.quantizationJob = job;
    this.quantization = quantizePocket(job, input);
    try { return await this.quantization; }
    finally { this.quantization = null; this.quantizationJob = null; }
  }
  async install(job, { engine }) {
    const before = (await this.config())[engine];
    return installRuntime(job, { engine, config: before }, async (runtime, activate) => {
      await job.phase('Waiting for this runtime to stop before activating the update', 'waiting');
      while (this.services.running.get(ids[engine])?.child || engine === 'whisper' && this.speech || engine === 'llama' && (this.synthesis || this.routerTest.busy)) {
        job.checkCancellation();
        if (JSON.stringify((await this.config())[engine]) !== JSON.stringify(before)) throw Error('Runtime selection changed; update was not activated');
        await pause(250);
      }
      await this.exclusive(async () => {
        const config = await this.config(); job.checkCancellation();
        if (JSON.stringify(config[engine]) !== JSON.stringify(before) || config[engine].mode !== 'managed') throw Error('Runtime selection changed; update was not activated');
        if (this.services.running.get(ids[engine])?.child || engine === 'llama' && (this.synthesis || this.routerTest.busy)) throw Error('The runtime started before update activation; retry after stopping it');
        await job.phase('Activating verified runtime'); await activate();
      });
    });
  }
  async startup() {
    this.stopping = false;
    const config = await this.config();
    if (!config.llama.startup) return;
    try { await this.action('llama', 'start'); this.errors.delete('llama'); }
    catch (error) { this.errors.set('llama', error.message); }
  }

  async speechCapability() {
    const config = (await this.config()).whisper;
    if (!config.model || !(await runtimeInfo('whisper'))?.binary) return { available: false };
    try { await this.command('whisper', config, config.port || 1); return { available: true, host: os.hostname(), autoSend: config.autoSend }; }
    catch { return { available: false }; }
  }
  async acquireSpeech(id) {
    if (this.stopping || this.speech) throw Error('Whisper is busy; finish the current dictation first');
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid dictation request');
    const operation = { id, controller: new AbortController(), keepRunning: false };
    this.speech = operation;
    const check = () => { operation.controller.signal.throwIfAborted(); if (this.stopping || this.speech !== operation) throw Error('Dictation cancelled'); };
    operation.start = this.exclusive(async () => {
      check(); const config = (await this.config()).whisper; check();
      if (config.modelKind === 'parakeet') {
        await this.services.stop(ids.whisper); check();
        const command = await this.command('whisper', config, config.port || 1); check();
        return { kind: 'parakeet', command };
      }
      operation.keepRunning = config.keepRunning;
      if (this.services.running.get(ids.whisper)?.child && !sameRuntimeConfig(this.runningConfig.get('whisper'), config)) await this.services.stop(ids.whisper);
      check(); await this.configureService('whisper', { runtimeRequired: true }); check();
      await this.services.action({ id: ids.whisper, action: 'start' }); check();
      this.runningConfig.set('whisper', structuredClone(config));
      return (await this.status()).whisper;
    });
    try {
      const whisper = await operation.start;
      if (whisper.kind === 'parakeet') { check(); return { ...whisper, id }; }
      for (;;) {
        check();
        if (!this.services.running.get(ids.whisper)?.child) throw Error('Whisper stopped while loading');
        try { await jsonRequest(whisper.url + '/health', { signal: AbortSignal.any([operation.controller.signal, AbortSignal.timeout(3000)]) }); break; }
        catch (error) { check(); if (!error.loading && !['ECONNREFUSED', 'ECONNRESET'].includes(error.cause?.code) && error.name !== 'TimeoutError') throw error; await pause(250); }
      }
      check();
      return { url: whisper.url, id };
    } catch (error) { await this.releaseSpeech(id); throw error; }
  }
  async releaseSpeech(id, completed = false) {
    const operation = this.speech;
    if (operation?.id !== id) return;
    operation.controller.abort();
    operation.release ||= (async () => {
      // Cancellation can arrive during configure/start. Drain it before Stop so
      // a late spawn cannot outlive the recording or whole-Agent shutdown.
      await operation.start.catch(() => {});
      if (!completed || !operation.keepRunning || this.stopping) await this.services.stop(ids.whisper);
      if (this.speech === operation) this.speech = null;
    })();
    return operation.release;
  }
  async shutdown() { this.stopping = true; await this.routerTest.cancel(); await this.quantizationJob?.cancel(); await this.quantization?.catch(() => {}); await this.cancelSynthesis(); if (this.speech) await this.releaseSpeech(this.speech.id); }
}
