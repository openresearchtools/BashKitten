// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import { startDownload } from '../models/downloads.mjs';

// Exact upstream assets verified together with the runtime builder. Catalogues
// are metadata only; all downloads use the existing resumable, hashed worker.
const catalogue = JSON.parse(await fs.readFile(new URL('./models.json', import.meta.url), 'utf8'));
export function curatedModels() {
  const presets = [];
  for (const model of catalogue.models) {
    const kind = /parakeet/i.test(model.repository) ? 'parakeet' : /whisper/i.test(model.repository) ? 'whisper' : /pocket/i.test(model.repository) ? 'pocket' : /Qwen3-TTS/i.test(model.repository) ? 'qwen3' : 'llama';
    for (const file of model.files.filter(item => !/mmproj/.test(item.name) && !/-f32\./.test(item.name))) {
      const files = [file];
      if (['pocket', 'qwen3'].includes(kind)) {
        const projector = model.files.find(item => /mmproj/.test(item.name) && (kind === 'pocket' || /Q8_0/.test(item.name)));
        if (!projector) continue;
        files.push(projector);
      }
      presets.push({ id: model.repository + '/' + file.name, title: file.name.replace(/\.(gguf|bin)$/i, ''), kind,
        engine: kind === 'llama' ? 'llama' : ['whisper', 'parakeet'].includes(kind) ? 'whisper' : 'tts',
        repository: model.repository, revision: model.revision, files: files.map(item => item.name), bytes: files.reduce((total, item) => total + item.bytes, 0), license: model.license });
    }
  }
  return { verifiedAt: catalogue.verifiedAt, presets: presets.sort((a, b) => a.bytes - b.bytes) };
}
export async function downloadPreset(id) {
  const preset = curatedModels().presets.find(item => item.id === id);
  if (!preset) throw Error('Choose a listed model');
  return startDownload({ id: preset.repository, revision: preset.revision, files: preset.files });
}
