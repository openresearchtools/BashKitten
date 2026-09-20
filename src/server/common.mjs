import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';

export const dataDir = path.resolve(process.env.BASHKITTEN_DATA_DIR || path.join(os.homedir(), '.local/share/bashkitten-pi'));
export const sessionsDir = path.join(dataDir, 'sessions');
export const randomToken = () => randomBytes(32).toString('hex');
export const digest = value => createHash('sha256').update(value).digest('hex');
export const sessionDir = id => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid session ID');
  return path.join(sessionsDir, id);
};
export const socketPath = id => path.join(dataDir, 'run', `${digest(id).slice(0, 16)}.sock`);
export async function privateDir(dir) { await fs.mkdir(dir, { recursive: true, mode: 0o700 }); await fs.chmod(dir, 0o700); }
export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
}
export async function writeJson(file, value) {
  await privateDir(path.dirname(file));
  const temp = `${file}.${randomToken().slice(0, 12)}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, file);
}
export async function createJson(file, value) {
  await privateDir(path.dirname(file));
  const lock = file + '.creating';
  try { await fs.mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = await readJson(path.join(lock, 'owner.json'), null);
    let stale = false;
    if (owner) { try { process.kill(owner.pid, 0); } catch (error) { stale = error.code === 'ESRCH'; } }
    else stale = Date.now() - (await fs.stat(lock).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs > 30000;
    if (stale) { await fs.rm(lock, { recursive: true, force: true }); return createJson(file, value); }
    return false;
  }
  try {
    await writeJson(path.join(lock, 'owner.json'), { pid: process.pid });
    try { await fs.access(file); return false; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeJson(file, value); return true;
  } finally { await fs.rm(lock, { recursive: true, force: true }); }
}
export const readMeta = id => readJson(path.join(sessionDir(id), 'ui.json'));
export const writeMeta = meta => writeJson(path.join(sessionDir(meta.id), 'ui.json'), meta);
export function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
export async function body(req, limit = 32 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(Error('Upload is too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function jsonBody(req) {
  const bytes = await body(req);
  try { return bytes.length ? JSON.parse(bytes) : {}; } catch { throw Error('Invalid JSON request'); }
}
export async function formBody(req) {
  return new Response(await body(req), { headers: { 'Content-Type': req.headers['content-type'] } }).formData();
}
export function workerRequest(id, route, value) {
  return socketRequest(socketPath(id), route, value);
}
export function socketRequest(socket, route, value, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: socket, path: route, method: value === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      body(res, 128 * 1024 * 1024).then(bytes => {
        const result = JSON.parse(bytes.toString());
        if (res.statusCode >= 400) reject(Error(result.error)); else resolve(result);
      }).catch(reject);
    });
    req.setTimeout(timeout, () => req.destroy(Error('Local service did not respond')));
    req.on('error', reject);
    req.end(value === undefined ? undefined : JSON.stringify(value));
  });
}

export async function allMeta() {
  const result = [];
  for (const id of await fs.readdir(sessionsDir).catch(() => [])) {
    try { result.push(await readMeta(id)); } catch {}
  }
  return result;
}
export async function existingDirectory(input) {
  const value = !input || input === '~' ? os.homedir() : input.startsWith('~/') ? path.join(os.homedir(), input.slice(2)) : input;
  if (!path.isAbsolute(value)) throw Error('Use an absolute folder path');
  const real = await fs.realpath(value);
  if (!(await fs.stat(real)).isDirectory()) throw Error('Choose a folder');
  return real;
}
export function safeName(name) {
  if (!name || name === '.' || name === '..' || /[/\\\x00-\x1f]/.test(name) || Buffer.byteLength(name) > 240) throw Error('Use a single valid file or folder name');
  return name;
}
export async function withinRoot(root, relative = '') {
  const base = await fs.realpath(root);
  const target = await fs.realpath(path.resolve(base, relative));
  const fromRoot = path.relative(base, target);
  if (fromRoot === '..' || fromRoot.startsWith('..' + path.sep) || path.isAbsolute(fromRoot)) throw Object.assign(Error('Path leaves this working folder'), { status: 403 });
  return target;
}
