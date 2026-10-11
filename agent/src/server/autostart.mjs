// SPDX-License-Identifier: AGPL-3.0-only
// Per-backend custom startup commands. The controller's existing native guard
// owns every child; there is no independent service or process adoption.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataDir, digest, readJson, writeJson } from './common.mjs';
import { binary } from './access/paths.mjs';

const script = fileURLToPath(import.meta.url);
const runFile = id => path.join(dataDir, 'run', 'autostart', id + '.json');
export const autostartFile = path.join(dataDir, 'autostart.json');
const text = value => typeof value === 'string' && !value.includes('\0');
function commands(value) {
  if (!Array.isArray(value)) throw Error('Startup commands must be a list');
  const ids = new Set();
  return value.map(entry => {
    if (!entry || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(entry.id || '') || ids.has(entry.id)) throw Error('Each startup command needs a unique UUID');
    ids.add(entry.id);
    if (!text(entry.name) || !entry.name.trim()) throw Error('Enter a startup command name');
    if (typeof entry.enabled !== 'boolean') throw Error('Choose whether the command starts automatically');
    if (!Array.isArray(entry.argv) || !entry.argv.length || !entry.argv.every(text) || !path.isAbsolute(entry.argv[0])) throw Error('Use an absolute executable path and an array of arguments');
    if (!text(entry.cwd) || !path.isAbsolute(entry.cwd)) throw Error('Use an absolute working directory');
    const env = entry.env ?? {};
    if (!env || typeof env !== 'object' || Array.isArray(env) || Object.entries(env).some(([name, value]) => !/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) || !text(value))) throw Error('Command environment values must be strings with valid variable names');
    return { id: entry.id, name: entry.name.trim(), enabled: entry.enabled, argv: [...entry.argv], cwd: entry.cwd, env: { ...env } };
  });
}
export async function autostartConfig(file = autostartFile) {
  const saved = await readJson(file, { version: 1, commands: [] });
  if (saved.version !== 1) throw Error('Unsupported startup command configuration version');
  const entries = commands(saved.commands);
  return { version: 1, file, revision: digest(JSON.stringify(entries)), commands: entries };
}
export async function saveAutostart(value, file = autostartFile) {
  const before = await autostartConfig(file);
  if (before.revision !== value.revision) throw Error('Startup commands changed. Reload before saving.');
  const entries = commands(value.commands);
  if ((await autostartConfig(file)).revision !== before.revision) throw Error('Startup commands changed while saving. Reload before saving.');
  await writeJson(file, { version: 1, commands: entries });
  return autostartConfig(file);
}
export class AutostartCommands {
  constructor() { this.running = new Map(); this.started = false; this.stopping = false; this.error = null; }
  get active() { return [...this.running.values()].some(owner => owner.child); }
  async status() {
    const config = await autostartConfig();
    return { ...config, error: this.error, status: config.commands.map(entry => {
      const owner = this.running.get(entry.id);
      return { id: entry.id, state: owner?.state || 'stopped', error: owner?.error || '',
        ...(owner?.child ? { ownerPid: owner.child.pid } : {}),
        ...(owner && owner.exitCode !== undefined ? { exitCode: owner.exitCode, signal: owner.signal } : {}),
        savedForNextStart: Boolean(owner?.child && owner.revision !== digest(JSON.stringify(entry))) };
    }) };
  }
  async save(value) {
    const saved = await saveAutostart(value), ids = new Set(saved.commands.map(entry => entry.id));
    await Promise.all([...this.running].filter(([id]) => !ids.has(id)).map(async ([id, owner]) => {
      await this.stop(owner); this.running.delete(id); await fs.rm(runFile(id), { force: true });
    }));
    return this.status();
  }
  async startup() {
    if (this.started) return;
    this.started = true; this.stopping = false; this.error = null;
    let config;
    try { config = await autostartConfig(); }
    catch (error) { this.error = error.message; return; }
    await Promise.all(config.commands.filter(entry => entry.enabled).map(async entry => {
      try { await this.start(entry); }
      catch (error) { this.running.set(entry.id, { state: 'failed', error: error.message }); }
    }));
  }
  async start(entry) {
    if (this.running.get(entry.id)?.child || this.stopping) return;
    await fs.access(entry.argv[0], fs.constants.X_OK);
    if (!(await fs.stat(entry.cwd)).isDirectory()) throw Error('The startup command working directory does not exist');
    if (this.stopping) return;
    await writeJson(runFile(entry.id), entry);
    if (this.stopping) return;
    const child = spawn(binary('runtime-guard'), [process.execPath, script, entry.id, 'serve'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const owner = { child, state: 'starting', error: '', revision: digest(JSON.stringify(entry)), stopping: false };
    this.running.set(entry.id, owner);
    child.stderr.on('data', bytes => { owner.error += bytes.toString(); });
    owner.done = new Promise(resolve => {
      child.once('spawn', () => { if (!owner.stopping) owner.state = 'running'; });
      child.once('error', error => { owner.error = error.message; });
      child.once('close', (code, signal) => {
        owner.child = null; owner.exitCode = code; owner.signal = signal;
        owner.state = owner.stopping ? 'stopped' : code === 0 ? 'completed' : 'failed';
        if (owner.state === 'failed') owner.error ||= `Command exited (${signal || code})`;
        resolve();
      });
    });
  }
  async stop(owner) {
    if (!owner.child) return;
    owner.stopping = true; owner.state = 'stopping'; owner.child.kill('SIGTERM');
    await owner.done;
  }
  async stopAll() {
    this.stopping = true;
    // Signal only live ChildProcess handles owned here. The native subreaper
    // stops their descendants and applies its existing bounded shutdown.
    await Promise.all([...this.running.values()].map(owner => this.stop(owner)));
    this.started = false;
  }
}

// The same guarded-child convention is used by hosted services. Read this
// launch's snapshot before applying user environment overrides to its command.
if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  try {
    if (process.argv[3] !== 'serve' || process.env.BASHKITTEN_GUARDED !== '1' || Number(process.env.BASHKITTEN_GUARD_PID) !== process.ppid || !/^[a-f0-9-]{36}$/.test(process.argv[2] || '')) throw Error('Startup commands must be launched by their controller');
    const [entry] = commands([await readJson(runFile(process.argv[2]))]);
    if (entry.id !== process.argv[2]) throw Error('Startup command identity changed');
    const child = spawn(entry.argv[0], entry.argv.slice(1), { cwd: entry.cwd, env: { ...process.env, ...entry.env }, stdio: 'ignore' });
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { child.kill(signal); });
    child.once('error', error => { console.error(error.message); process.exitCode = 1; });
    child.once('close', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
