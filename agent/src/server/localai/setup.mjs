// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import fs from 'node:fs/promises';
import { dataDir, readJson, writeJson, digest } from '../common.mjs';
import { platform } from '../platform/index.mjs';
import { loadPi, piAgentDir } from '../rpc/runtime.mjs';
import { downloadsStatus, controlDownload } from '../models/downloads.mjs';
import { firstRunModelPresets, downloadPreset } from './models.mjs';
import { localAIDir, runtimeInfo } from './runtimes.mjs';
import { routerModelId } from './router-models.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const cancelled = message => Object.assign(Error(message), { code: 'CANCELLED' });
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
        if (!await runtimeInfo(engine)) {
          await job.phase(`Downloading ${engine === 'llama' ? 'llama.cpp and speech synthesis' : 'speech recognition'} runtime`);
          await this.localAI.install(job, { engine });
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
          job.job.progress = { downloaded: download.downloaded, total: download.total }; await job.save();
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
        files[engine] = { model: resolved(model), kind: preset.kind, ...(projector ? { projector: resolved(projector) } : {}),
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
