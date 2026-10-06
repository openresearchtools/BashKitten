// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { readJson, writeJson, sessionDir } from '../common.mjs';

export const defaultSubagents = Object.freeze({ enabled: false, count: 3, model: '', thinking: '' });
export function subagentSettings(value = defaultSubagents) {
  if (typeof value === 'string') value = JSON.parse(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid subagent settings');
  const settings = { ...defaultSubagents, ...value };
  if (typeof settings.enabled !== 'boolean') throw Error('Choose whether subagents are on');
  if (!Number.isSafeInteger(settings.count) || settings.count < 1) throw Error('Choose a positive number of subagents');
  if (typeof settings.model !== 'string' || typeof settings.thinking !== 'string') throw Error('Invalid subagent model selection');
  if (settings.thinking && !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(settings.thinking)) throw Error('Invalid subagent thinking level');
  return { enabled: settings.enabled, count: settings.count, model: settings.model, thinking: settings.thinking };
}
export const subagentSettingsFile = id => path.join(sessionDir(id), 'subagents.json');
export const readSubagentSettings = async id => subagentSettings(await readJson(subagentSettingsFile(id), defaultSubagents));
export const saveSubagentSettings = async (id, settings) => writeJson(subagentSettingsFile(id), subagentSettings(settings));
