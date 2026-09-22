import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadPi } from './runtime.mjs';
import { digest, privateDir, randomToken } from '../common.mjs';
import { platform } from '../platform/index.mjs';

const begin = '<!-- bashkitten:environment -->', end = '<!-- /bashkitten:environment -->';
async function read(file) { try { return await fs.readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }

export async function syncContext({ agentDir, target = platform, home = os.homedir(), prefix = process.env.PREFIX || '/data/data/com.termux/files/usr' } = {}) {
  const { pi: { getAgentDir, SettingsManager } } = await loadPi();
  agentDir ||= getAgentDir();
  if (!['linux', 'termux'].includes(target)) throw Error('Unknown environment');
  await privateDir(agentDir);
  const template = await fs.readFile(new URL(`../platform/${target}/pi-context/AGENTS.md`, import.meta.url), 'utf8');
  const values = { HOME: home, PREFIX: prefix, PI_AGENT_DIR: agentDir };
  const content = template.replace(/\{\{(HOME|PREFIX|PI_AGENT_DIR)\}\}/g, (_, key) => values[key]).trim();
  const block = `${begin}\n${content}\n${end}`;
  const primary = path.join(agentDir, 'AGENTS.md');
  const files = [primary];
  if (await read(path.join(agentDir, 'AGENTS.override.md')) !== null) files.push(path.join(agentDir, 'AGENTS.override.md'));
  for (const file of files) {
    let previous = await read(file), text = previous;
    if (text === null && file === primary) {
      for (const alternate of ['AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD']) {
        text = await read(path.join(agentDir, alternate));
        if (text !== null) break;
      }
    }
    text ||= '';
    const start = text.indexOf(begin), finish = text.indexOf(end);
    if ((start >= 0) !== (finish >= 0) || (start >= 0 && finish < start)) throw Error(`Repair the incomplete BashKitten environment block in ${file}`);
    const next = start < 0 ? (text ? text.trimEnd() + '\n\n' : '') + block + '\n' : text.slice(0, start) + block + text.slice(finish + end.length);
    if (next === previous) continue;
    if (previous !== null) {
      try { await fs.writeFile(file + '.bashkitten-backup', previous, { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const temporary = file + '.' + randomToken() + '.tmp';
    await fs.writeFile(temporary, next, { mode: 0o600 });
    await fs.rename(temporary, file);
  }
  const settings = SettingsManager.create(home, agentDir, { projectTrusted: false });
  if (settings.getEnableInstallTelemetry()) settings.setEnableInstallTelemetry(false);
  await settings.flush();
  return digest(block);
}
