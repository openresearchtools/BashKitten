// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import fs from 'node:fs/promises';
import { dataDir, readJson, writeJson, digest } from '../common.mjs';
import { platform } from '../platform/index.mjs';
import { loadPi, piAgentDir } from '../rpc/runtime.mjs';
import { downloadsStatus, controlDownload } from '../models/downloads.mjs';
import { initializeModelsDirectory } from '../models/settings.mjs';
import { firstRunModelPresets, downloadPreset, presetDownloads } from './models.mjs';
import { localAIDir, runtimeInfo } from './runtimes.mjs';
import { routerModelId, parseRouterINI } from './router-models.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const cancelled = message => Object.assign(Error(message), { code: 'CANCELLED' });
async function missingRuntime(engine, speech) {
  const runtime = await runtimeInfo(engine);
  if (!runtime?.binary || engine === 'whisper' && !runtime.capabilities?.streamingVad) return true;
  const files = engine === 'llama' ? ['llama-server', 'llama-tts'] : ['whisper-server', 'parakeet-cli', 'bashkitten-vad'];
  for (const name of files) {
    try { await fs.access(path.join(path.dirname(runtime.binary), name), fs.constants.X_OK); }
    catch (error) { if (['ENOENT', 'EACCES'].includes(error.code)) return true; throw error; }
  }
  if (engine === 'whisper') {
    try { await speech.vadFiles(); }
    catch { return true; }
  }
  return false;
}
const piSettingsRevision = () => fs.readFile(path.join(piAgentDir, 'settings.json'), 'utf8').then(digest).catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});

/** Setup checkpoints own downloads, never a second model/configuration store. */
export class FirstRunLocalAI {
  constructor(localAI, speech) { this.localAI = localAI; this.speech = speech; this.file = path.join(localAIDir, 'first-run.json'); }
  async initialize() {
    this.state = await readJson(this.file, null);
    const result = await this.localAI.initialize({ initial: this.state?.initial, beforeCreate: async initial => {
      if (this.state) return;
      await initializeModelsDirectory();
      const presets = firstRunModelPresets(platform === 'termux' ? 'android' : 'linux');
      this.state = { version: 1, status: 'pending', models: Object.values(presets).map(item => ({ title: item.title, bytes: item.bytes })),
        baseline: { config: digest(JSON.stringify(initial.config)), ini: digest(initial.ini.content), piSettings: await piSettingsRevision() }, initial, downloads: {} };
      await this.save();
    } });
    if (!this.state) return;
    if (result.conflict) { this.state.status = 'failed'; this.state.error = 'Local AI settings changed during initial setup. Your choices were kept.'; }
    else if (this.state.status === 'running') this.state.status = 'interrupted';
    if (this.state.initial) delete this.state.initial;
    await this.save();
    if (this.state.status === 'pending') await this.initializeDefaultModel();
  }
  async save() { await writeJson(this.file, this.state); }
  async initializeDefaultModel() {
    if (this.state.defaultModelAttempted) return;
    // Seed before normal Pi package registration creates settings.json. Waiting
    // for downloads would confuse that automatic write with a user's choice.
    // Decide once, before writing: a later unset must survive every retry.
    this.state.defaultModelAttempted = true; await this.save();
    if (this.state.baseline.piSettings !== null) return;
    const { pi } = await loadPi();
    if (await piSettingsRevision() !== null) return;
    const settings = pi.SettingsManager.create(dataDir, piAgentDir, { projectTrusted: false });
    if (settings.drainErrors().length) throw Error('Could not read the existing Pi settings; they were left unchanged.');
    // No asynchronous boundary between this snapshot and the stock Pi setter.
    // Explicit empty/null and half-configured selections always win.
    if (settings.getDefaultProvider() !== undefined || settings.getDefaultModel() !== undefined) return;
    const preset = firstRunModelPresets(platform === 'termux' ? 'android' : 'linux').llama;
    const name = path.basename(preset.files.find(file => !/mmproj/i.test(file))).replace(/\.gguf$/i, '');
    settings.setDefaultModelAndProvider('bashkitten-llama', routerModelId(name));
    await settings.flush();
    const errors = settings.drainErrors();
    if (errors.length) throw Error('Could not save the default model: ' + errors.map(item => item.error?.message || item.message || String(item)).join('; '));
  }
  status() {
    if (!this.state) return null;
    return { status: this.state.status, error: this.state.error || '', models: this.state.models,
      canResume: ['failed', 'interrupted', 'cancelled'].includes(this.state.status) };
  }
  async guidedStatus(job) {
    const snapshot = await this.localAI.guidedSnapshot(), catalogue = await presetDownloads();
    const defaults = firstRunModelPresets(platform === 'termux' ? 'android' : 'linux');
    let router = [], routerError = '';
    try { router = parseRouterINI(snapshot.ini.content).models; } catch (error) { routerError = error.message; }
    const firstRun = this.state && !['complete', 'failed', 'cancelled'].includes(this.state.status);
    const loadError = await this.localAI.routerFailure();
    const result = { revision: snapshot.revision };
    for (const engine of ['llama', 'whisper', 'tts']) {
      const config = snapshot.config[engine], owned = snapshot.owned[engine];
      const empty = engine === 'llama' ? !routerError && !router.length && config.mode === 'managed' && !config.argv.length : !config.model;
      const matched = engine === 'llama' ? null : catalogue.presets.find(item => item.engine === engine && item.kind === config.modelKind && item.downloaded &&
        item.files.some(name => !/mmproj/i.test(name) && item.paths[name] === config.model) && (engine !== 'tts' ||
          item.files.some(name => /mmproj/i.test(name) && item.paths[name] === config.projector) && item.referenceVoicePath === config.voice));
      const selected = engine === 'llama' ? owned ? config.guided.id : config.guided?.id || defaults.llama.id
        : matched?.id || (owned ? config.guided.id : empty && firstRun ? defaults[engine].id : '');
      const preset = catalogue.presets.find(item => item.id === selected);
      const modelPath = preset?.paths?.[preset.files.find(name => !/mmproj/i.test(name))];
      const selectedModel = router.find(model => modelPath && model.config.model === modelPath) ||
        router.find(model => model.id === routerModelId(path.basename(selected).replace(/\.gguf$/i, ''))) || (!owned ? router[0] : null);
      const hardware = await this.localAI.guidedDevices(engine), current = engine === 'llama' ? selectedModel?.config.device : config.backend === 'cpu' ? 'none' : 'gpu';
      const device = !current || current === 'none' ? 'cpu' : current;
      const devices = [{ id: 'cpu', label: 'CPU', available: true }];
      if (engine === 'llama') devices.push(...hardware.devices.map(item => ({ id: item.id, label: item.id + ': ' + item.name, available: true })));
      else devices.push({ id: 'gpu', label: 'GPU', available: Boolean(hardware.devices.length), detail: hardware.error });
      if (!devices.some(item => item.id === device)) devices.push({ id: device, label: device + ' (unavailable)', available: false, detail: hardware.error || 'The selected device is no longer available.' });
      const pending = job?.kind === 'localai-guided-select' && job.input.engine === engine;
      result[engine] = { selected, device, mode: engine !== 'llama' || owned || empty && !config.guided ? 'guided' : 'custom', devices,
        presets: catalogue.presets.filter(item => item.engine === engine && item.guided !== false).map(({ id, title, bytes, modelBytes, projectorBytes, downloaded, status, kind, contextLength }) => ({ id, title, bytes, modelBytes, projectorBytes, downloaded, status, kind, contextLength, recommended: id === defaults[engine].id })),
        pending: pending && !['complete', 'failed', 'cancelled', 'interrupted'].includes(job.status) ? { id: job.input.id, device: job.input.device, contextSize: job.input.contextSize, status: job.status } : null,
        error: pending && job.error || (engine === 'llama' ? routerError || loadError : ''),
        ...(engine === 'llama' ? { context: { selected: selectedModel?.config.contextSize || 65536, max: preset?.contextLength || null,
          detail: preset?.contextLength ? 'Model-supported limit from its pinned native configuration. Memory fit uses llama.cpp; a chosen context size remains explicit.' : 'Choose a guided model to see its verified context limit.' },
          images: Boolean(owned && preset?.downloaded && selectedModel?.config.projector &&
            preset.files.some(name => /mmproj/i.test(name) && preset.paths[name] === selectedModel.config.projector)) } : {}) };
    }
    return result;
  }
  async select(job, input) {
    const { engine, id, revision, replaceCustom = false } = input;
    if (!['llama', 'whisper', 'tts'].includes(engine) || typeof id !== 'string' || typeof revision !== 'string') throw Error('Choose a listed local model');
    const state = await this.guidedStatus(), preset = (await presetDownloads()).presets.find(item => item.id === id && item.engine === engine);
    if (!preset || preset.guided === false) throw Error('Choose a listed local model');
    if (state.revision !== revision) throw Error('Local AI or its router INI changed. Refresh before selecting a model.');
    if (state[engine].mode === 'custom' && !replaceCustom) throw Error('Advanced settings own this engine. Choose Restore guided model to replace the active configuration.');
    const choice = input.device || 'cpu';
    if (!state[engine].devices.some(item => item.id === choice && item.available)) throw Error('The selected device is unavailable; choose an available device.');
    if (engine === 'llama' && input.contextSize !== undefined && (!Number.isSafeInteger(input.contextSize) || input.contextSize < 1 || !preset.contextLength || input.contextSize > preset.contextLength)) throw Error('Choose a context size within this model’s verified limit.');
    const controller = new AbortController(); let currentDownload;
    const check = async () => {
      job.checkCancellation(); if (this.localAI.stopping) throw cancelled('Model setup stopped with Agent.');
      if ((await this.localAI.guidedSnapshot()).revision !== revision) throw Error('Local AI or its router INI changed during download. Your choices were kept; select the model again.');
    };
    const timer = setInterval(() => { try { job.checkCancellation(); if (this.localAI.stopping) throw cancelled('Agent stopped'); } catch (error) { controller.abort(error); } }, 200);
    try {
      await check(); await initializeModelsDirectory();
      const runtimeEngine = engine === 'tts' ? 'llama' : engine;
      if (await missingRuntime(runtimeEngine, this.speech)) {
        await job.phase('Downloading the model runtime');
        await this.localAI.install(job, { engine: runtimeEngine, guided: true, repair: true });
      }
      await check();
      let current = (await presetDownloads()).presets.find(item => item.id === id);
      if (!current.downloaded) {
        let download = current.download;
        if (!download || download.status === 'cancelled' || download.status === 'complete') download = await downloadPreset(id, { signal: controller.signal });
        else if (['paused', 'error', 'interrupted'].includes(download.status)) await controlDownload(download.id, 'resume');
        currentDownload = download.id;
        await job.phase('Downloading ' + preset.title);
        for (;;) {
          await check();
          download = (await downloadsStatus()).jobs.find(item => item.id === currentDownload);
          if (!download) throw Error('The model download was removed; select the model again.');
          job.job.progress = { downloaded: download.downloaded, total: download.total, bytesPerSecond: download.bytesPerSecond }; await job.save();
          if (download.status === 'complete') break;
          if (['paused', 'cancelled'].includes(download.status)) throw cancelled('The model download was paused or cancelled. Select it again to resume.');
          if (['error', 'interrupted'].includes(download.status)) throw Error(download.error || 'The model download was interrupted.');
          await pause(500);
        }
        currentDownload = null; current = (await presetDownloads()).presets.find(item => item.id === id);
      }
      if (!current.downloaded) throw Error('A required model asset is missing or changed. Download the preset again.');
      const files = { model: current.paths[preset.files.find(name => !/mmproj/i.test(name))],
        projector: current.paths[preset.files.find(name => /mmproj/i.test(name))] || '', voice: current.referenceVoicePath || '' };
      let device;
      if (choice !== 'cpu') {
        const hardware = await this.localAI.guidedDevices(engine, { fresh: true });
        device = engine === 'llama' ? hardware.devices.find(item => item.id === choice) : hardware.devices[0];
        if (!device) throw Error(hardware.error || 'The selected GPU is no longer available.');
      }
      // An active router/recognition server keeps its current model until it
      // can be restarted safely by the same service owner.
      const serviceId = engine === 'llama' ? 'localai-llama' : 'localai-whisper';
      const running = engine !== 'tts' && Boolean(this.localAI.services.running.get(serviceId)?.child);
      if (running || engine === 'tts' && this.localAI.synthesis) await job.phase('Waiting for current local model work to finish', 'waiting');
      for (;;) {
        await check();
        const active = engine === 'llama' && running ? await this.localAI.routerBusy()
          : engine === 'whisper' ? Boolean(this.localAI.speech) : Boolean(this.localAI.synthesis);
        if (!active) break;
        await pause(500);
      }
      await check(); await job.phase('Selecting ' + preset.title);
      const contextSize = input.contextSize ?? (engine === 'llama' && state.llama.selected === id ? state.llama.context.selected : undefined);
      await this.localAI.applyGuided({ engine, preset, files, device, revision, contextSize });
      if (running && !this.localAI.stopping) {
        if (engine === 'llama') await this.localAI.reloadRouterPresets();
        else await this.localAI.action(engine, preset.kind === 'parakeet' ? 'stop' : 'reload');
      }
      if (engine === 'llama') await this.localAI.importProvider();
    } catch (error) {
      if (currentDownload) await controlDownload(currentDownload, 'pause').catch(() => {});
      throw error;
    } finally { clearInterval(timer); }
  }
  async unchanged() {
    const config = await this.localAI.config(), ini = await this.localAI.ini({ file: config.llama.preset });
    const target = this.state.plan;
    if (![this.state.baseline.config, ...(target ? [digest(JSON.stringify(target.config))] : [])].includes(digest(JSON.stringify(config))) ||
        ![this.state.baseline.ini, ...(target ? [digest(target.ini.content)] : [])].includes(ini.revision)) {
      throw Error('Local AI settings changed. Your choices were kept. Downloaded files remain available in Models.');
    }
  }
  async run(job) {
    if (!this.state || this.state.status === 'complete') throw Error('Automatic setup is only available for a new Local AI configuration');
    const controller = new AbortController();
    const check = () => { job.checkCancellation(); if (this.localAI.stopping) throw cancelled('Local AI setup stopped with Agent.'); controller.signal.throwIfAborted(); };
    const timer = setInterval(() => {
      try { check(); } catch (error) { controller.abort(error); }
    }, 200);
    this.state.status = 'running'; delete this.state.error; await this.save();
    let currentDownload;
    try {
      await this.unchanged();
      for (const engine of ['llama', 'whisper']) {
        check(); await this.unchanged();
        if (await missingRuntime(engine, this.speech)) {
          await job.phase(`Downloading ${engine === 'llama' ? 'llama.cpp and speech synthesis' : 'speech recognition'} runtime`);
          await this.localAI.install(job, { engine, repair: true });
        }
      }
      const presets = firstRunModelPresets(platform === 'termux' ? 'android' : 'linux'), files = {};
      for (const [engine, preset] of Object.entries(presets)) {
        check(); await this.unchanged();
        await job.phase(`Downloading ${preset.title}`);
        let saved = this.state.downloads[engine];
        const existing = await downloadsStatus();
        if (!saved || !saved.id && saved.preset !== preset.id) {
          saved = this.state.downloads[engine] = { preset: preset.id, directory: existing.directory, before: existing.jobs.map(item => item.id) };
          await this.save();
        }
        let download = saved.id && existing.jobs.find(item => item.id === saved.id);
        if (!saved.id) {
          // Recover the narrow crash window between the downloader persisting
          // its job and this owner saving the returned ID. Older/user jobs are
          // excluded by the durable pre-start inventory, never guessed by name.
          const candidates = existing.jobs.filter(item => !saved.before.includes(item.id) && item.repository === preset.repository &&
            item.revision === preset.revision && item.directory === saved.directory && item.files.length === preset.files.length &&
            preset.files.every(name => item.files.some(file => file.path === name)));
          if (candidates.length > 1) throw Error('More than one matching setup download exists. Choose the intended download in Models.');
          download = candidates[0];
          if (download) { saved.id = download.id; saved.referenceVoicePath = preset.referenceVoicePath || ''; delete saved.before; await this.save(); }
        }
        if (!download || download.status === 'cancelled') {
          // A cancelled job is restarted only by this explicit Resume run.
          if (saved.id) { saved = this.state.downloads[engine] = { preset: preset.id, directory: existing.directory, before: existing.jobs.map(item => item.id) }; await this.save(); }
          download = await downloadPreset(preset.id, { signal: controller.signal });
          currentDownload = download.id;
          saved = this.state.downloads[engine] = { id: download.id, preset: preset.id, referenceVoicePath: download.referenceVoicePath || '' };
          await this.save();
        } else {
          currentDownload = download.id;
          if (download.repository !== preset.repository || download.revision !== preset.revision || saved.preset !== preset.id) throw Error('The saved download belongs to an earlier model selection. Choose models in Local AI.');
          if (['paused', 'error', 'interrupted'].includes(download.status)) await controlDownload(download.id, 'resume');
        }
        for (;;) {
          check(); await this.unchanged();
          download = (await downloadsStatus()).jobs.find(item => item.id === saved.id);
          if (!download) throw Error('The setup download was removed. Retry setup.');
          job.job.progress = { downloaded: download.downloaded, total: download.total, bytesPerSecond: download.bytesPerSecond }; await job.save();
          if (download.status === 'complete') break;
          if (['paused', 'cancelled'].includes(download.status)) throw cancelled('Setup was stopped from model downloads. Resume setup when ready.');
          if (download.status === 'error') throw Error(download.error || 'Model download failed');
          await pause(500);
        }
        currentDownload = null;
        const resolved = name => {
          const file = download.files.find(item => item.path === name && item.status === 'complete');
          if (!file) throw Error('The verified model download is incomplete');
          return path.join(download.directory, file.outputPath);
        };
        const model = preset.files.find(name => !/mmproj/i.test(name)), projector = preset.files.find(name => /mmproj/i.test(name));
        files[engine] = { id: preset.id, contextLength: preset.contextLength, model: resolved(model), kind: preset.kind, ...(projector ? { projector: resolved(projector) } : {}),
          ...(engine === 'tts' ? { voice: saved.referenceVoicePath } : {}) };
      }
      check(); await this.unchanged();
      await job.phase('Setting up local models');
      if (!this.state.plan) { this.state.plan = await this.localAI.firstRunPlan(files); await this.save(); }
      check(); await this.localAI.applyFirstRun(this.state.baseline, this.state.plan);
      await job.phase('Checking local voice tools');
      check(); const speech = await this.speech.ready(); check();
      if (!speech.ready) throw Error(speech.error || 'The selected speech runtime is not ready');
      await job.phase('Starting the local model router');
      check(); await this.localAI.action('llama', 'start'); check();
      const deadline = Date.now() + 90000;
      while (this.localAI.importState.state !== 'ready') {
        check(); await this.unchanged();
        if (Date.now() > deadline) throw Error(this.localAI.importState.error || 'The local model router did not become ready. Retry setup.');
        await pause(500); await this.localAI.importProvider();
      }
      check(); await this.unchanged();
      this.state.status = 'complete'; delete this.state.plan; await this.save();
    } catch (error) {
      if (currentDownload) await controlDownload(currentDownload, 'pause').catch(() => {});
      this.state.status = error.code === 'CANCELLED' || controller.signal.aborted ? 'cancelled' : 'failed';
      this.state.error = error.message; await this.save(); throw error;
    } finally { clearInterval(timer); }
  }
}
