// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import { startDownload, controlDownload } from '../models/downloads.mjs';
import { hfRequest } from '../models/huggingface.mjs';
import { modelDataDir } from '../models/settings.mjs';
import { digest, writeJson, writePrivate } from '../common.mjs';

// Only catalogue metadata is bundled. Weights and their pinned attribution,
// full licenses and supporting audio are downloaded separately on request.
const catalogue = JSON.parse(await fs.readFile(new URL('./models.json', import.meta.url), 'utf8'));
const noticesDirectory = model => path.join(modelDataDir, 'notices', digest(model.repository + '@' + model.revision));
const supportPath = asset => path.join(modelDataDir, 'supporting-assets', asset.sha256 + path.extname(asset.file));
function presetCatalogue() {
  const presets = [];
  for (const model of catalogue.models) {
    const kind = /parakeet/i.test(model.repository) ? 'parakeet' : /whisper/i.test(model.repository) ? 'whisper' : /pocket/i.test(model.repository) ? 'pocket' : /Qwen3-TTS/i.test(model.repository) ? 'qwen3' : 'llama';
    for (const file of model.files.filter(item => !/mmproj/.test(item.name) && !/-f32\./.test(item.name))) {
      const files = [file];
      if (model.projector || ['pocket', 'qwen3'].includes(kind)) {
        const projector = model.projector ? model.files.find(item => item.name === model.projector)
          : model.files.find(item => /mmproj/.test(item.name) && (kind === 'pocket' || /Q8_0/.test(item.name)));
        if (!projector) continue;
        files.push(projector);
      }
      const reference = model.referenceVoice && catalogue.supportingAssets[model.referenceVoice];
      presets.push({ id: model.repository + '/' + file.name, title: file.name.replace(/\.(gguf|bin)$/i, ''), kind,
        engine: kind === 'llama' ? 'llama' : ['whisper', 'parakeet'].includes(kind) ? 'whisper' : 'tts',
        repository: model.repository, revision: model.revision, files: files.map(item => item.name),
        bytes: files.reduce((total, item) => total + item.bytes, reference?.bytes || 0), license: model.license,
        noticesDirectory: noticesDirectory(model), ...(reference ? { referenceVoicePath: supportPath(reference), referenceVoice: reference } : {}) });
    }
  }
  return { verifiedAt: catalogue.verifiedAt, distribution: catalogue.distribution, defaults: catalogue.defaults, presets: presets.sort((a, b) => a.bytes - b.bytes) };
}
export async function curatedModels() {
  const result = presetCatalogue(), verified = new Map();
  for (const preset of result.presets) {
    if (!preset.referenceVoicePath) continue;
    if (!verified.has(preset.referenceVoicePath)) {
      const stat = await fs.stat(preset.referenceVoicePath).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
      verified.set(preset.referenceVoicePath, stat?.isFile() && stat.size === preset.referenceVoice.bytes
        && digest(await fs.readFile(preset.referenceVoicePath)) === preset.referenceVoice.sha256);
    }
    if (!verified.get(preset.referenceVoicePath)) delete preset.referenceVoicePath;
  }
  return result;
}
export function firstRunModelPresets(platform) {
  const selected = catalogue.defaults[platform];
  if (!selected) throw Error('Local AI setup is not supported on this platform');
  const presets = presetCatalogue().presets;
  return Object.fromEntries(Object.entries(selected).map(([engine, id]) => {
    const preset = presets.find(item => item.id === id && item.engine === engine);
    if (!preset) throw Error('The default model catalogue is incomplete');
    return [engine, preset];
  }));
}

// These small, immutable prerequisites use the existing authenticated HF client
// where applicable. No model job starts unless every required notice is saved.
async function fetchPinned(asset, destination, signal) {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > 1024 * 1024 || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw Error('The model attribution catalogue is invalid');
  const saved = await fs.stat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (saved?.isFile() && saved.size === asset.bytes && digest(await fs.readFile(destination)) === asset.sha256) return;
  const url = new URL(asset.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['huggingface.co', 'raw.githubusercontent.com', 'creativecommons.org'].includes(url.hostname)) throw Error('The model attribution source is invalid');
  const timeout = AbortSignal.timeout(30000), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let request;
  try {
    const response = url.hostname === 'huggingface.co'
      ? (request = await hfRequest(url.href, { signal: combined })).response
      : await fetch(url, { signal: combined, redirect: 'error' });
    if (!response.ok) { await response.body?.cancel(); throw Error('Could not download the model license or supporting file'); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      combined.throwIfAborted(); size += chunk.length;
      if (size > asset.bytes) throw Error('The model information download exceeded its verified size');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (size !== asset.bytes || digest(bytes) !== asset.sha256) throw Error('The model license or supporting file did not match its verified source');
    combined.throwIfAborted(); await writePrivate(destination, bytes);
  } finally { request?.close(); }
}
async function prepareModelInformation(preset, signal) {
  const model = catalogue.models.find(item => item.repository === preset.repository && item.revision === preset.revision);
  if (!model?.license || !model.notices?.length) throw Error('This model is missing verified license information');
  const notices = [];
  for (const asset of model.notices) {
    const file = digest(asset.url).slice(0, 16) + '-' + path.basename(asset.file);
    await fetchPinned(asset, path.join(preset.noticesDirectory, file), signal);
    notices.push({ ...asset, savedFile: file });
  }
  if (preset.referenceVoice) await fetchPinned(preset.referenceVoice, preset.referenceVoicePath, signal);
  signal?.throwIfAborted();
  await writeJson(path.join(preset.noticesDirectory, 'NOTICE.json'), {
    distribution: 'Model weights, projectors, supporting audio and these notices are downloaded separately; they are not bundled with BashKitten.',
    repository: model.repository, revision: model.revision, license: model.license, attribution: model.attribution, provenanceNotes: model.provenanceNotes || [],
    files: model.files.filter(file => preset.files.includes(file.name)), notices,
    ...(preset.referenceVoice ? { referenceVoice: { ...preset.referenceVoice, savedFile: preset.referenceVoicePath } } : {}),
  });
}
export async function readPresetNotices(id, index) {
  const preset = presetCatalogue().presets.find(item => item.id === id);
  if (!preset) throw Error('Choose a listed model');
  const model = catalogue.models.find(item => item.repository === preset.repository);
  const summary = [catalogue.distribution, model.attribution,
    'Model source: https://huggingface.co/' + model.repository + '/tree/' + model.revision,
    'License: ' + model.license, ...(model.provenanceNotes || []),
    ...(preset.referenceVoice ? [preset.referenceVoice.attribution, 'Reference voice license: ' + preset.referenceVoice.license] : [])].join('\n\n');
  const files = [{ index: 0, name: 'Source and attribution', bytes: Buffer.byteLength(summary) },
    ...model.notices.map((asset, i) => ({ index: i + 1, name: asset.title, bytes: asset.bytes }))];
  if (index === undefined) return { title: model.repository, files };
  if (!Number.isInteger(index) || index < 0 || index >= files.length) throw Error('Choose a listed model notice');
  let content = summary;
  if (index > 0) {
    const asset = model.notices[index - 1];
    const file = path.join(preset.noticesDirectory, digest(asset.url).slice(0, 16) + '-' + path.basename(asset.file));
    const stat = await fs.stat(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (!stat?.isFile() || stat.size !== asset.bytes || stat.size > 1024 * 1024) throw Error('Download this model to save its verified licenses and source information for offline viewing');
    const bytes = await fs.readFile(file);
    if (digest(bytes) !== asset.sha256) throw Error('The saved model notice changed. Download the model information again before viewing it');
    content = asset.url + '\n\n' + bytes.toString('utf8');
  }
  const result = { title: model.repository, name: files[index].name, content };
  // Termux's existing PendingIntent bridge has a bounded reply size.
  if (Buffer.byteLength(JSON.stringify(result)) > 90 * 1024) throw Error('This model notice exceeds the supported viewer size');
  return result;
}
export async function downloadPreset(id, { signal } = {}) {
  const preset = presetCatalogue().presets.find(item => item.id === id);
  if (!preset) throw Error('Choose a listed model');
  await prepareModelInformation(preset, signal);
  signal?.throwIfAborted();
  const job = await startDownload({ id: preset.repository, revision: preset.revision, files: preset.files });
  if (signal?.aborted) { await controlDownload(job.id, 'cancel'); signal.throwIfAborted(); }
  return { ...job, noticesDirectory: preset.noticesDirectory, ...(preset.referenceVoicePath ? { referenceVoicePath: preset.referenceVoicePath } : {}) };
}
