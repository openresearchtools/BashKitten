// SPDX-License-Identifier: GPL-3.0-only
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { dataDir, readJson, writeJson } from '../common.mjs';
import { pickerDirectory } from '../files/folders.mjs';

export const modelDataDir = path.join(dataDir, 'models');
const settingsFile = path.join(modelDataDir, 'settings.json');
const defaults = () => ({ directory: path.join(os.homedir(), 'models'), token: '' });
let saving = Promise.resolve();

async function settings() { return { ...defaults(), ...await readJson(settingsFile, {}) }; }
export async function getHuggingFaceToken() { return (await settings()).token || ''; }
export async function modelSettings() {
  const { directory, token } = await settings();
  return { directory, hasToken: Boolean(token) };
}
export async function getModelsDirectory({ create = false } = {}) {
  const { directory } = await settings();
  if (create && directory === defaults().directory) await fs.mkdir(directory, { mode: 0o700, recursive: true });
  const result = await pickerDirectory(directory);
  await fs.access(result.path, constants.W_OK | constants.X_OK);
  return result.path;
}
export async function saveModelSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid model settings');
  const operation = saving.then(async () => {
    const saved = await settings();
    if (Object.hasOwn(value, 'directory')) {
      if (typeof value.directory !== 'string' || !value.directory.trim()) throw Error('Choose a models folder');
      const directory = await pickerDirectory(value.directory);
      await fs.access(directory.path, constants.W_OK | constants.X_OK);
      saved.directory = directory.path;
    }
    if (Object.hasOwn(value, 'token')) {
      if (typeof value.token !== 'string' || /[\x00-\x20\x7f]/.test(value.token)) throw Error('Use a valid Hugging Face token without spaces');
      saved.token = value.token;
    }
    await writeJson(settingsFile, saved);
    return { directory: saved.directory, hasToken: Boolean(saved.token) };
  });
  saving = operation.catch(() => {});
  return operation;
}
