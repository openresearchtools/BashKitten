#!/usr/bin/env node
// One small local supervisor shared by the native hosts. Pi workers stay detached.
import http from 'node:http';
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { dataDir, sessionDir, privateDir, readJson, writeJson, json, jsonBody, socketRequest, workerRequest, socketPath, allMeta } from './common.mjs';
import { platform } from './platform/index.mjs';
import { nativeFile } from './platform/linux/files.mjs';

export const controlSocket = path.join(dataDir, 'run/control.sock');
const stateFile = path.join(dataDir, 'control.json');
const serverFile = path.join(dataDir, 'server.json');
const script = fileURLToPath(import.meta.url);
const serverScript = fileURLToPath(new URL('./http/server.mjs', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const controlRequest = (command, value) => socketRequest(controlSocket, '/' + command, value, 30000);

async function owned(pid, marker) {
  if (!Number.isInteger(pid) || pid < 2) return false;
  try {
    const command = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
    return command.includes(marker);
  } catch { return false; }
}

export async function ensureManager() {
  try { await controlRequest('status'); return; } catch {}
  await privateDir(path.dirname(controlSocket));
  const log = openSync(path.join(dataDir, 'control.log'), 'a', 0o600);
  const child = spawn(process.execPath, [script, 'serve'], { detached: true, stdio: ['ignore', log, log], env: process.env });
  closeSync(log); child.unref();
  let error; child.on('error', value => { error = value; });
  for (let i = 0; i < 100; i++) {
    if (error) throw error;
    try { await controlRequest('status'); return; } catch {}
    await sleep(100);
  }
  throw Error('Could not start local control service; see control.log');
}

async function serve() {
  process.umask(0o077);
  await privateDir(path.dirname(controlSocket));
  const lock = controlSocket + '.lock';
  try {
    const pid = Number(await fs.readFile(lock, 'utf8'));
    if (await owned(pid, script)) return;
    await fs.rm(lock, { force: true });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await fs.writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') return; throw error; }
  await fs.rm(controlSocket, { force: true });
  let state = await readJson(stateFile, { web: true }), serial = Promise.resolve(), starting = false, lastError = null;
  let retryAt = 0, failures = 0;
  async function web() {
    const info = await readJson(serverFile, null);
    return info && await owned(info.pid, info.script) && info.script === serverScript ? info : null;
  }
  async function startWeb() {
    if (starting || await web()) return;
    starting = true;
    try {
      const log = openSync(path.join(dataDir, 'server.log'), 'a', 0o600);
      const child = spawn(process.execPath, [serverScript], { stdio: ['ignore', log, log], env: process.env });
      closeSync(log);
      child.on('error', error => { lastError = error.message; });
      for (let i = 0; i < 100; i++) {
        if (await web()) { failures = 0; lastError = null; return; }
        if (child.exitCode !== null) break;
        await sleep(100);
      }
      throw Error('Backend did not become ready; see server.log');
    } catch (error) {
      lastError = error.message; retryAt = Date.now() + Math.min(60000, 1000 * 2 ** Math.min(++failures, 6));
      throw error;
    } finally { starting = false; }
  }
  async function stopWeb() {
    const info = await web(); if (!info) return;
    process.kill(info.pid, 'SIGTERM');
    for (let i = 0; i < 100 && await owned(info.pid, serverScript); i++) await sleep(50);
    if (await owned(info.pid, serverScript)) throw Error('Backend has not stopped yet');
  }
  async function status() {
    const info = await web();
    const sessions = await Promise.all((await allMeta()).map(async meta => {
      const current = await socketRequest(socketPath(meta.id), '/status', undefined, 1000).catch(() => null);
      return { id: meta.id, title: meta.title, cwd: meta.cwd, running: Boolean(current), ...current?.data };
    }));
    return { version: 1, platform, web: { status: info ? 'running' : starting ? 'starting' : lastError ? 'error' : 'stopped', desired: state.web, url: info?.url, error: lastError }, sessions };
  }
  async function stopPi(id, force) {
    const meta = (await allMeta()).find(item => item.id === id);
    if (!meta) throw Error('Session not found');
    await writeJson(path.join(sessionDir(id), 'lifecycle.json'), { stopped: true });
    // Ask the owner to checkpoint drafts and shut down its native Pi child.
    try { await socketRequest(socketPath(id), '/shutdown', {}, force ? 1000 : 10000); return; }
    catch (error) { if (!force && !['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; }
    if (force) {
      const pid = Number(await fs.readFile(socketPath(id) + '.lock', 'utf8').catch(() => '0'));
      const workerScript = fileURLToPath(new URL('./rpc/worker.mjs', import.meta.url));
      if (await owned(pid, workerScript) && await owned(pid, id)) process.kill(-pid, 'SIGKILL');
    }
  }
  async function action(command, value) {
    if (command === 'status') return status();
    if (['start', 'stop', 'restart'].includes(command)) {
      state.web = command !== 'stop'; await writeJson(stateFile, state);
      if (command !== 'start') await stopWeb();
      if (state.web) await startWeb();
    } else if (command === 'pi-stop' || command === 'pi-kill') {
      const ids = value?.id ? [value.id] : (await allMeta()).map(meta => meta.id);
      for (const id of ids) await stopPi(id, command === 'pi-kill');
    } else if (command === 'native-file') {
      if (platform !== 'linux') throw Error('Native file opening is only available on Linux');
      return nativeFile(value);
    } else if (command === 'project-root') {
      if (platform !== 'linux') throw Error('Additional roots are only supported on Linux');
      const root = await fs.realpath(value.path);
      if (!(await fs.stat(root)).isDirectory()) throw Error('Choose a directory');
      await fs.access(root, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
      const file = path.join(dataDir, 'project-roots.json'), roots = await readJson(file, []);
      if (!roots.includes(root)) await writeJson(file, [...roots, root]);
      return { path: root };
    } else if (command === 'shutdown') {
      jsonShutdown(); return { ok: true };
    } else throw Error('Unknown control command');
    return status();
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/status') return json(res, await status());
      if (req.method !== 'POST') throw Error('Use POST for control actions');
      const value = await jsonBody(req);
      const operation = serial.then(() => action(req.url.slice(1), value));
      serial = operation.catch(() => {});
      json(res, await operation);
    } catch (error) { json(res, { error: error.message }, 400); }
  });
  function jsonShutdown() { setTimeout(async () => { clearInterval(monitor); await fs.rm(lock, { force: true }); server.close(() => process.exit(0)); }, 50); }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(controlSocket, resolve); });
  await fs.chmod(controlSocket, 0o600);
  const monitor = setInterval(() => {
    if (state.web && Date.now() > retryAt) { const operation = serial.then(startWeb); serial = operation.catch(() => {}); }
  }, 2000);
  process.on('SIGTERM', jsonShutdown);
  if (state.web) await startWeb().catch(() => {});
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const command = process.argv[2] || 'status';
  if (command === 'serve') await serve();
  else {
    try {
      await ensureManager();
      const value = process.argv[3] ? JSON.parse(process.argv[3]) : {};
      console.log(JSON.stringify(await controlRequest(command, command === 'status' ? undefined : value)));
    } catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
  }
}
