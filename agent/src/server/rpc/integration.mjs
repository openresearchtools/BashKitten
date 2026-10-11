import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { bundledRoot, loadPi } from './runtime.mjs';
import { platform, telemetryOff } from '../platform/index.mjs';
import { dataDir, readJson, writeJson } from '../common.mjs';

export const integrationRoot = path.join(bundledRoot, 'pi');
const sourceOf = item => typeof item === 'string' ? item : item.source;
let installing;

function packageCommand(cli, command, source) {
  return new Promise((resolve, reject) => {
    // Package output is not a response payload. Let Pi finish independently of
    // its output size, without collecting the full output in the worker.
    const child = spawn(process.execPath, [cli, command, source], {
      env: { ...process.env, ...telemetryOff }, cwd: os.homedir(),
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve() : reject(Error(`Pi package ${command} failed (${signal || code})`)));
  });
}

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
  const baseSkills = [`skills/browser-${platform === 'termux' ? 'android' : 'linux'}/SKILL.md`, 'skills/web-search/SKILL.md'];
  const previousSkills = [...baseSkills, ...(platform === 'termux' ? ['skills/termux-display/SKILL.md'] : [])];
  const previousAllSkills = [...previousSkills, 'skills/subagents/SKILL.md'];
  const manifest = JSON.parse(await fs.readFile(path.join(integrationRoot, 'package.json'), 'utf8'));
  const role = process.env.BASHKITTEN_EXECUTION_ROLE;
  const roleGuide = role === 'termux' ? 'termux-use' : role === 'container' ? 'computer-use' : null;
  const commonSkills = manifest.bashkitten?.browserGuides
    ? manifest.pi.skills.filter(directory => !directory.startsWith('./desktop-guides/') && (directory !== './skills/phoneuse' || role === 'termux')).map(directory => directory.replace(/^\.\//, '') + '/SKILL.md')
    : [...previousAllSkills, 'skills/chats/SKILL.md', 'skills/ask-user/SKILL.md', ...(role === 'termux' ? ['skills/phoneuse/SKILL.md'] : [])];
  const skills = [...commonSkills];
  if (roleGuide) {
    const guide = `desktop-guides/${roleGuide}/SKILL.md`;
    await fs.access(path.join(integrationRoot, guide));
    skills.push(guide);
  }
  const registrationFile = path.join(dataDir, 'integrations/browser.json');
  const previousRegistration = await readJson(registrationFile, {});
  const previousPackaged = ['skills/browser/SKILL.md', 'skills/websearch/SKILL.md', 'skills/subagents/SKILL.md'];
  if (platform === 'termux') previousPackaged.push('skills/termux-display/SKILL.md');
  const installed = current.getPackages().find(item => matches(item, integrationRoot));
  if (!installed) {
    await packageCommand(runtime.cli, 'install', integrationRoot);
    current = settings();
    current.setPackages(current.getPackages().map(item => matches(item, integrationRoot) ? {
      source: sourceOf(item),
      skills,
    } : item));
    await current.flush();
  } else if ([baseSkills, previousSkills, previousAllSkills, previousPackaged, previousRegistration.managedSkills].filter(Boolean).some(previous => JSON.stringify(installed.skills) === JSON.stringify(previous))) {
    // Upgrade only our original managed selection; preserve user skill filters.
    current.setPackages(current.getPackages().map(item => item === installed ? { ...item, skills } : item));
    await current.flush();
  }
  // Remove only our obsolete managed donor wrapper, not an independently
  // installed WildBuzzard extension or any of its user's files.
  const legacy = path.join(dataDir, 'integrations/wildbuzzard');
  if (current.getPackages().some(item => matches(item, legacy))) {
    await packageCommand(runtime.cli, 'remove', legacy);
  }
  await writeJson(path.join(dataDir, 'integrations/browser.json'), { package: integrationRoot, platform, runtime: runtime.version, executionRole: role || 'host', managedSkills: skills });
  return integrationStatus();
}
export async function integrationStatus() {
  const record = await readJson(path.join(dataDir, 'integrations/browser.json'), {});
  return { ...record, registered: record.package === integrationRoot, platform };
}
export async function searchRuntime() {
  return readJson(path.join(bundledRoot, 'search/runtime/manifest.json'), null);
}
