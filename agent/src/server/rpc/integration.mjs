import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { bundledRoot, loadPi } from './runtime.mjs';
import { platform, telemetryOff } from '../platform/index.mjs';
import { dataDir, readJson, writeJson } from '../common.mjs';

const exec = promisify(execFile);
export const integrationRoot = path.join(bundledRoot, 'pi');
const sourceOf = item => typeof item === 'string' ? item : item.source;
let installing;

// Use Pi's normal local-package installation. It records a path and never
// downloads another Pi, edits native sessions or replaces user extensions.
export async function ensureIntegration() {
  if (installing) return installing;
  installing = register().finally(() => { installing = undefined; });
  return installing;
}
async function register() {
  await fs.access(path.join(integrationRoot, 'package.json'));
  const runtime = await loadPi();
  const agentDir = runtime.pi.getAgentDir();
  const settings = () => runtime.pi.SettingsManager.create(os.homedir(), agentDir, { projectTrusted: false });
  const matches = (item, directory) => {
    const source = sourceOf(item);
    if (/^(?:npm:|git:|https?:|ssh:)/.test(source)) return false;
    return path.resolve(agentDir, source.startsWith('~/') ? path.join(os.homedir(), source.slice(2)) : source) === directory;
  };
  let current = settings();
  const installed = current.getPackages().find(item => matches(item, integrationRoot));
  if (!installed) {
    await exec(process.execPath, [runtime.cli, 'install', integrationRoot], { env: { ...process.env, ...telemetryOff }, cwd: os.homedir(), timeout: 60000, maxBuffer: 1024 * 1024 });
    current = settings();
    current.setPackages(current.getPackages().map(item => matches(item, integrationRoot) ? {
      source: sourceOf(item),
      skills: [`skills/browser-${platform === 'termux' ? 'android' : 'linux'}/SKILL.md`, 'skills/web-search/SKILL.md'],
    } : item));
    await current.flush();
  }
  // Remove only our obsolete managed donor wrapper, not an independently
  // installed WildBuzzard extension or any of its user's files.
  const legacy = path.join(dataDir, 'integrations/wildbuzzard');
  if (current.getPackages().some(item => matches(item, legacy))) {
    await exec(process.execPath, [runtime.cli, 'remove', legacy], { env: { ...process.env, ...telemetryOff }, cwd: os.homedir(), timeout: 60000, maxBuffer: 1024 * 1024 });
  }
  await writeJson(path.join(dataDir, 'integrations/browser.json'), { package: integrationRoot, platform, runtime: runtime.version });
  return integrationStatus();
}
export async function integrationStatus() {
  const record = await readJson(path.join(dataDir, 'integrations/browser.json'), {});
  return { ...record, registered: record.package === integrationRoot, platform };
}
export async function searchRuntime() {
  return readJson(path.join(bundledRoot, 'search/runtime/manifest.json'), null);
}
