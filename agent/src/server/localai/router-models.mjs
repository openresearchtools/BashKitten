// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const aliases = {
  model: ['model', 'm', 'LLAMA_ARG_MODEL'], projector: ['mmproj', 'mm', 'LLAMA_ARG_MMPROJ'],
  contextSize: ['ctx-size', 'c', 'LLAMA_ARG_CTX_SIZE'], device: ['device', 'dev', 'LLAMA_ARG_DEVICE'],
  gpuLayers: ['gpu-layers', 'n-gpu-layers', 'ngl', 'LLAMA_ARG_N_GPU_LAYERS'], fit: ['fit', 'LLAMA_ARG_FIT'],
  idleMinutes: ['sleep-idle-seconds', 'LLAMA_ARG_SLEEP_IDLE_SECONDS'],
  flashAttention: ['flash-attn', 'fa', 'LLAMA_ARG_FLASH_ATTN'],
  cacheGpu: ['kv-offload', 'kvo', 'no-kv-offload', 'nkvo', 'LLAMA_ARG_KV_OFFLOAD'],
  projectorGpu: ['mmproj-offload', 'no-mmproj-offload', 'LLAMA_ARG_MMPROJ_OFFLOAD'],
  projectorDevice: ['mmproj-device', 'mmdev', 'MTMD_BACKEND_DEVICE'],
};
const fields = new Map(Object.entries(aliases).flatMap(([field, names]) => names.map(name => [name, field])));
const header = line => /^\s*\[([^\]\r\n]+)\]\s*(?:[;#].*)?$/.exec(line);
const pair = line => /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/.exec(line);
const text = value => typeof value === 'string' && !/[\0\r\n]/.test(value);
const truthy = value => ['true', 'on', '1', 'enabled'].includes(value);
const boolean = (value, fallback) => value === undefined ? fallback : truthy(value);
const negative = new Set(['no-kv-offload', 'nkvo', 'no-mmproj-offload']);
const valueText = value => value.split(/[;#]/, 1)[0].trim();
export const routerModelId = name => { const colon = name.lastIndexOf(':'); if (colon < 0) return name; const tag = name.slice(colon + 1); return name.slice(0, colon + 1) + (tag.match(/[-.]([A-Z0-9_]+)$/i)?.[1] || tag).toUpperCase(); };
const number = (value, fallback) => value !== undefined && Number.isFinite(Number(value)) ? Number(value) : fallback;

/** Preserve untouched lines, comments, section order and unknown upstream options. */
export function parseRouterINI(content) {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const sections = [{ name: null, lines: [] }];
  for (const line of content.split(/\r?\n/)) {
    const match = header(line);
    if (match) {
      const name = match[1].trim();
      if (sections.some(section => section.name === name)) throw Error('Duplicate router INI section: ' + name);
      sections.push({ name, header: line, lines: [] });
    } else sections.at(-1).lines.push(line);
  }
  // Upstream stores keys in std::map, so synonymous keys use lexical order.
  const values = section => {
    const entries = Object.fromEntries((section?.lines || []).flatMap(line => {
      const match = pair(line); return match ? [[match[1], valueText(match[2])]] : [];
    }));
    return Object.fromEntries(Object.keys(entries).sort().map(key => [fields.get(key) || key,
      negative.has(key) ? String(!truthy(entries[key])) : entries[key]]));
  };
  // Top-level options are upstream's separate [default] model, not [*].
  const inherited = values(sections.find(section => section.name === '*'));
  const models = sections.filter(section => section.name && section.name !== '*').map(section => {
    const own = values(section), effective = { ...inherited, ...own };
    const device = effective.device || '', cpu = device === 'none';
    const seconds = number(effective.idleMinutes, -1);
    return { name: section.name, id: routerModelId(section.name), config: {
      model: effective.model || '', projector: effective.projector || '', contextSize: number(effective.contextSize, 0),
      device, gpuLayers: /^(?:all|auto)$/.test(effective.gpuLayers || '') ? effective.gpuLayers : number(effective.gpuLayers, 'auto'),
      fit: boolean(effective.fit, true), idleMinutes: seconds < 0 ? 0 : seconds / 60,
      flashAttention: effective.flashAttention || 'auto', cacheGpu: boolean(effective.cacheGpu, true),
      extra: section.lines.filter(line => { const match = pair(line); return match && !fields.has(match[1]); }).join(eol),
    } };
  });
  return { sections, models, eol };
}

export async function modelValues(config) {
  if (!config || !text(config.model) || !path.isAbsolute(config.model) || !text(config.projector || '')
      || config.projector && !path.isAbsolute(config.projector)) throw Error('Choose absolute model and optional projector paths on the backend');
  for (const file of [config.model, config.projector].filter(Boolean)) {
    if (!(await fs.stat(file)).isFile()) throw Error('Choose a regular model file');
    await fs.access(file, fs.constants.R_OK);
  }
  if (!Number.isSafeInteger(config.contextSize) || config.contextSize < 0) throw Error('Context length must be a non-negative integer');
  if (!text(config.device) || !/^(?:|none|(?:CUDA|Vulkan)\d+(?:,(?:CUDA|Vulkan)\d+)*)$/.test(config.device)) throw Error('Choose CPU or an actual llama.cpp GPU device');
  if (!['all', 'auto'].includes(config.gpuLayers) && (!Number.isSafeInteger(config.gpuLayers) || config.gpuLayers < 0)) throw Error('GPU layers must be all, auto or a non-negative integer');
  if (typeof config.fit !== 'boolean' || typeof config.cacheGpu !== 'boolean' || !['on', 'off', 'auto'].includes(config.flashAttention)) throw Error('Choose fit, KV offload and flash-attention settings');
  if (!Number.isFinite(config.idleMinutes) || config.idleMinutes < 0 || !Number.isSafeInteger(config.idleMinutes * 60) || config.idleMinutes * 60 > 2147483) throw Error('Use whole seconds expressed in minutes, up to 2147483 seconds (the engine’s supported range); 0 is indefinite');
  if (typeof config.extra !== 'string' || config.extra.includes('\0')) throw Error('Extra parameters must be INI key=value lines');
  const extra = [];
  for (const line of config.extra.split(/\r?\n/)) {
    if (!line.trim() || /^\s*[;#]/.test(line)) { extra.push(line); continue; }
    const match = pair(line);
    if (!match || fields.has(match[1])) throw Error('Use the named controls for model settings; additional parameters must be other INI keys');
    extra.push(line);
  }
  for (const value of [config.model, config.projector]) if (/[;#]/.test(value || '')) throw Error('The upstream INI format cannot represent ; or # in model paths');
  const cpu = config.device === 'none';
  return { values: {
    model: config.model, projector: config.projector || '', contextSize: config.contextSize, device: config.device || null,
    gpuLayers: cpu ? 0 : config.gpuLayers, fit: config.fit ? 'on' : 'off',
    idleMinutes: config.idleMinutes === 0 ? -1 : config.idleMinutes * 60,
    flashAttention: config.flashAttention, cacheGpu: cpu ? 'false' : String(config.cacheGpu), projectorGpu: cpu ? 'false' : 'true', projectorDevice: cpu ? 'none' : config.device.split(',')[0] || null,
  }, extra };
}

export async function updateRouterModel(content, { name, originalName, config }) {
  if (!text(name) || !name.trim() || name !== name.trim() || /[\[\]]/.test(name) || name === '*') throw Error('Choose a model name without brackets');
  const parsed = parseRouterINI(content), old = originalName ? parsed.sections.find(section => section.name === originalName) : null;
  if (originalName && !old) throw Error('The original model section no longer exists');
  if (parsed.sections.some(section => section !== old && section.name && routerModelId(section.name) === routerModelId(name))) throw Error('That router model name already exists');
  const { values, extra } = await modelValues(config), written = new Set(), lines = [];
  const previous = parsed.models.find(model => model.name === originalName)?.config;
  const changed = new Set(Object.keys(values).filter(field => !previous ||
    (['projectorGpu', 'projectorDevice'].includes(field) ? previous.device !== config.device : previous[field] !== config[field])));
  if (changed.has('device') && !config.device && (parsed.sections.find(section => section.name === '*')?.lines || [])
      .some(line => { const match = pair(line); return match && fields.get(match[1]) === 'device'; })) throw Error('Engine default inherits the [*] device. Edit that global INI setting or choose an explicit device.');
  const extraChanged = !previous || previous.extra !== config.extra;
  for (const line of old?.lines || []) {
    const match = pair(line);
    if (!match) { lines.push(line); continue; }
    const field = fields.get(match[1]);
    if (!field) { if (!extraChanged) lines.push(line); continue; }
    if (!changed.has(field)) { lines.push(line); continue; }
    if (written.has(field)) continue;
    written.add(field);
    if (values[field] !== null) { const comment = match[2].match(/[;#].*$/)?.[0]; lines.push(`${aliases[field][0]} = ${values[field]}` + (comment ? ' ' + comment : '')); }
  }
  for (const [field, value] of Object.entries(values)) if (changed.has(field) && !written.has(field) && value !== null) lines.push(`${aliases[field][0]} = ${value}`);
  if (extraChanged) lines.push(...extra);
  const next = { name, header: old && name === originalName ? old.header : '[' + name + ']', lines };
  if (old) parsed.sections[parsed.sections.indexOf(old)] = next; else parsed.sections.push(next);
  return parsed.sections.flatMap(section => section.header ? [section.header, ...section.lines] : section.lines).join(parsed.eol);
}

export function isolatedPreset(content, name) {
  const parsed = parseRouterINI(content);
  if (parsed.sections[0].lines.some(line => { const match = pair(line); return match && match[1] !== 'version'; })) throw Error('Move top-level model options to an explicit section before testing; they define upstream’s separate default model');
  if (!parsed.models.some(model => model.name === name)) throw Error('Router model no longer exists');
  return parsed.sections.filter(section => section.name === null || section.name === '*' || section.name === name)
    .flatMap(section => section.header ? [section.header, ...section.lines] : section.lines).join(parsed.eol);
}

// Released llama.cpp also reads these files before launcher env/arguments.
// Preserve unrelated settings, but reject hidden global model sources in a test.
export async function verifyTestConfiguration(environment = {}) {
  const env = { ...process.env, ...environment };
  const userConfig = env.XDG_CONFIG_HOME || path.join(env.HOME || os.homedir(), '.config');
  const selectors = new Set(['m', 'model', 'LLAMA_ARG_MODEL', 'mu', 'model-url', 'LLAMA_ARG_MODEL_URL',
    'hf', 'hfr', 'hf-repo', 'LLAMA_ARG_HF_REPO', 'models-dir', 'LLAMA_ARG_MODELS_DIR', 'dr', 'docker-repo', 'LLAMA_ARG_DOCKER_REPO']);
  for (const file of ['/etc/llama.cpp/config.ini', path.join(userConfig, 'llama.cpp', 'config.ini')]) {
    const content = await fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (content === null) continue;
    const { sections } = parseRouterINI(content);
    for (const section of sections.filter(section => [null, '*', 'default'].includes(section.name))) {
      for (const line of section.lines) {
        const match = pair(line);
        if (match && selectors.has(match[1]) && valueText(match[2])) throw Error('A global llama.cpp configuration selects another model source: ' + file + ' (' + match[1] + '). Remove that source override before checking an INI model.');
      }
    }
  }
}

/** Local native chooser: every path belongs to this backend, never the UI host. */
export async function browseBackend({ path: requested = '', kind = 'file' } = {}) {
  if (!['file', 'folder', 'save'].includes(kind) || !text(requested)) throw Error('Invalid backend file picker request');
  let folder = requested || os.homedir();
  if (!path.isAbsolute(folder)) throw Error('Choose an absolute backend path');
  const stat = await fs.stat(folder).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (!stat || !stat.isDirectory()) folder = path.dirname(folder);
  folder = await fs.realpath(folder); await fs.access(folder, fs.constants.R_OK | fs.constants.X_OK);
  const entries = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    try {
      const info = await fs.stat(file), directory = info.isDirectory();
      if (!directory && (!info.isFile() || kind === 'folder')) continue;
      await fs.access(file, fs.constants.R_OK | (directory ? fs.constants.X_OK : 0));
      entries.push({ name: entry.name, path: file, directory, size: directory ? null : info.size });
    } catch { /* Omit entries this backend cannot open. */ }
  }
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  return { path: folder, parent: folder === path.dirname(folder) ? null : path.dirname(folder), home: os.homedir(), entries };
}
