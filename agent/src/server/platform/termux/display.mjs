// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dataDir, privateDir, writePrivate, digest, body } from '../../common.mjs';
import { platform } from '../index.mjs';
import { binary } from '../../access/paths.mjs';

const script = fileURLToPath(import.meta.url), exec = promisify(execFile);
const directory = path.join(dataDir, 'display');
export const displayCommand = path.join(directory, 'launch.sh');
const runningCommand = path.join(directory, 'running.sh');
const previousCommand = path.join(directory, 'last-working.sh');
const shell = () => path.join(path.dirname(process.execPath), 'sh');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const temporary = process.env.TMPDIR || path.join(path.dirname(process.execPath), '../tmp');
const defaultCommand = `exec termux-x11 "$DISPLAY" -nolisten tcp -xstartup 'env LIBGL_ALWAYS_SOFTWARE=true dbus-launch --exit-with-session xfce4-session'
`;

function requireTermux() {
  if (platform !== 'termux') throw Error('Display is available only in local Termux');
}

async function desktopReady(environment) {
  return exec('xprop', ['-root', '_NET_SUPPORTING_WM_CHECK'], {
    env: { ...process.env, ...environment }, timeout: 1000,
  }).then(result => /window id # 0x[1-9a-f][0-9a-f]*/i.test(result.stdout), () => false);
}

async function command() {
  requireTermux();
  await privateDir(directory);
  // Never replace a saved command when the package or controller is upgraded.
  await fs.writeFile(displayCommand, defaultCommand, { flag: 'wx', mode: 0o600 }).catch(error => {
    if (error.code !== 'EEXIST') throw error;
  });
  return fs.readFile(displayCommand, 'utf8');
}

async function validate(text) {
  if (typeof text !== 'string' || !text.trim() || text.includes('\0')) throw Error('Enter a shell launch command');
  await new Promise((resolve, reject) => {
    const child = spawn(shell(), ['-n'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', bytes => { error += bytes; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(Error(error.trim() || 'Invalid shell syntax')));
    child.stdin.on('error', reject); child.stdin.end(text);
  });
}

/** Optional display uses the existing subreaper, independent of core readiness. */
export class TermuxDisplay {
  child = null;
  stopped = null;
  stopping = false;
  state = 'stopped';
  error = '';
  output = '';
  activeCommand = '';
  environment = {};

  async status() {
    if (this.state === 'running' && !await desktopReady(this.environment)) {
      await this.stop();
      this.state = 'failed'; this.error = 'The desktop window manager is no longer available. Open output for details.';
    }
    const text = await command();
    const sockets = await fs.readdir(path.join(temporary, '.X11-unix')).catch(error => {
      if (error.code === 'ENOENT') return []; throw error;
    });
    return { state: this.state, error: this.error, output: this.output,
      command: text, revision: digest(text), commandPath: displayCommand,
      previousCommandPath: previousCommand, environment: this.environment,
      otherDisplaySockets: sockets.filter(name => /^X\d+$/.test(name)).map(name => ':' + name.slice(1))
        .filter(display => display !== this.environment.DISPLAY),
      savedForNextStart: Boolean(this.child && text !== this.activeCommand) };
  }

  async save(value) {
    const before = await command();
    if (value.revision !== digest(before)) throw Error('The launch command changed. Reopen it before saving.');
    const text = value.reset === true ? defaultCommand : value.command;
    await validate(text);
    if (await command() !== before) throw Error('The launch command changed while saving. Reopen it.');
    await writePrivate(displayCommand, text);
    return this.status();
  }

  async start() {
    requireTermux();
    if (this.child) return this.status();
    const text = await command();
    await validate(text);
    // X itself arbitrates a bind race. Never remove another server's lock/socket.
    let number = 1;
    while (await fs.lstat(path.join(temporary, `.X${number}-lock`)).then(() => true, error => {
      if (error.code === 'ENOENT') return false; throw error;
    }) || await fs.lstat(path.join(temporary, '.X11-unix', `X${number}`)).then(() => true, error => {
      if (error.code === 'ENOENT') return false; throw error;
    })) number++;
    this.environment = { DISPLAY: `:${number}` };
    const env = { ...process.env, ...this.environment };
    await writePrivate(runningCommand, text);
    this.activeCommand = text; this.error = ''; this.output = ''; this.state = 'starting';
    const child = spawn(binary('runtime-guard'), [process.execPath, script, 'serve'], {
      cwd: os.homedir(), env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
      this.output = (this.output + bytes.toString()).slice(-65536);
    });
    this.stopped = new Promise(resolve => {
      const finish = error => {
        if (this.child !== child) return;
        this.child = null; this.environment = {};
        this.state = this.stopping ? 'stopped' : 'failed';
        if (!this.stopping) this.error = error;
        this.stopping = false;
        resolve();
      };
      child.once('error', error => finish(error.message));
      child.once('close', (code, signal) => finish(`Display exited (${signal || code}). Open output for details.`));
    });
    try {
      // Require the X server and a window manager, not merely a spawned PID.
      for (const deadline = Date.now() + 20000; Date.now() < deadline;) {
        if (this.child !== child) throw Error(this.error);
        const ready = await desktopReady(this.environment);
        if (ready && this.child === child) {
          this.state = 'running'; await writePrivate(previousCommand, text); return this.status();
        }
        await pause(200);
      }
      throw Error('The desktop did not become ready. The command must use the supplied DISPLAY and keep its X server in the foreground.');
    } catch (error) {
      await this.stop(); this.state = 'failed'; this.error = error.message; throw error;
    }
  }

  async stop() {
    requireTermux();
    if (this.child) {
      this.stopping = true; this.state = 'stopping';
      this.child.kill('SIGTERM');
      let timer;
      try {
        await Promise.race([this.stopped, new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Display processes have not stopped yet')), 10000);
        })]);
      } finally { clearTimeout(timer); }
    }
    this.state = 'stopped';
    return this.status();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  try {
    requireTermux();
    const [action = 'status', option] = process.argv.slice(2);
    if (action === 'serve') {
      if (process.env.BASHKITTEN_GUARDED !== '1' || Number(process.env.BASHKITTEN_GUARD_PID) !== process.ppid) throw Error('Display must start through its controller');
      // Exiting this owner lets the existing guard reap all GUI descendants,
      // including D-Bus/driver helpers that detached from the original shell.
      process.on('SIGTERM', () => process.exit(0));
      process.on('SIGINT', () => process.exit(0));
      const child = spawn(shell(), [runningCommand], { cwd: os.homedir(), stdio: 'inherit' });
      child.once('error', error => { console.error(error.message); process.exit(1); });
      child.once('close', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
    } else {
      const { ensureManager, controlRequest } = await import('../../control.mjs');
      await ensureManager();
      if (action === 'command') {
        const current = await controlRequest('display-status', {});
        if (!option) process.stdout.write(current.command);
        else if (option === '--path') console.log(current.commandPath);
        else if (option === '--set' || option === '--reset') {
          const value = { revision: current.revision, reset: option === '--reset' };
          if (!value.reset) value.command = (await body(process.stdin)).toString('utf8');
          await controlRequest('display-save', value);
          console.log('Saved for the next display start.');
        } else throw Error('Use command, command --path, command --set or command --reset');
      } else if (['status', 'start', 'stop'].includes(action) && !option) {
        console.log(JSON.stringify(await controlRequest('display-' + action, {}), null, 2));
      } else throw Error('Use command, status, start or stop');
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
