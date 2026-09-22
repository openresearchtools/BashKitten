// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from Wild Buzzard's native Android Pi client; see NOTICE.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, lstat, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';

const execute = promisify(execFile);
const byteLimit = 32 * 1024 * 1024;
function unwrap(response) {
  if (response.error) throw Object.assign(new Error(response.error.message || String(response.error)), { code: response.error.code });
  return response.result;
}
async function androidCall(method, params, { output, signal }) {
  const { stdout } = await execute('pm', ['path', 'com.bashkitten'], { encoding: 'utf8', signal, timeout: 10000 });
  const apk = stdout.split('\n').find(line => line.startsWith('package:') && line.trim().endsWith('/base.apk'))?.trim().slice(8);
  if (!apk?.startsWith('/data/app/')) throw Error('Install and open BashKitten for Android first');
  const env = { ...process.env, CLASSPATH: apk };
  delete env.LD_PRELOAD; delete env.LD_LIBRARY_PATH;
  const args = ['/', 'com.bashkitten.BrowserCommand'];
  if (output) args.push('--output', output);
  args.push('--json', JSON.stringify({ method, params }));
  try {
    const result = await execute('/system/bin/app_process', args, { env, signal, timeout: 240000, maxBuffer: byteLimit });
    return unwrap(JSON.parse(result.stdout));
  } catch (error) {
    if (error.stdout) {
      let response;
      try { response = JSON.parse(error.stdout); } catch { /* Keep the actual process failure. */ }
      if (response?.error) return unwrap(response);
    }
    if (signal?.aborted) throw signal.reason || error;
    throw Error(error.stderr?.trim() || error.message, { cause: error });
  }
}
function linuxCall(method, params, { signal }) {
  return new Promise((resolveCall, reject) => {
    const process = spawn('bashkitten', ['--no-start', '--agent-json'], { signal, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [], errors = []; let bytes = 0, errorBytes = 0;
    const timer = setTimeout(() => { process.kill(); reject(Error('The browser command timed out')); }, 240000);
    process.on('error', error => { clearTimeout(timer); reject(error); });
    process.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > byteLimit) { process.kill(); reject(Error('The browser response is too large')); } else chunks.push(chunk); });
    process.stderr.on('data', chunk => { errorBytes += chunk.length; if (errorBytes < 65536) errors.push(chunk); });
    process.on('close', code => {
      clearTimeout(timer);
      try {
        const text = Buffer.concat(chunks).toString();
        if (!text.trim()) throw Error(Buffer.concat(errors).toString().trim() || `Browser command exited with ${code}`);
        const response = JSON.parse(text);
        if (code && !response.error) throw Error(`Browser command exited with ${code}`);
        resolveCall(unwrap(response));
      } catch (error) { reject(error); }
    });
    process.stdin.on('error', () => {});
    process.stdin.end(JSON.stringify({ method, params }));
  });
}
async function remoteCall(socket, method, params, { signal }) {
  const parent = await lstat(resolve(socket, '..'));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) || parent.uid !== process.getuid()) throw Error('Browser bridge must use an owner-private directory');
  return new Promise((resolveCall, reject) => {
    const request = http.request({ socketPath: socket, path: '/browser', method: 'POST', signal, headers: { 'Content-Type': 'application/json' } }, response => {
      const chunks = []; let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; if (bytes > byteLimit) request.destroy(Error('The browser response is too large')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString());
          if (response.statusCode >= 400 && !value.error) throw Error(`Browser connection returned HTTP ${response.statusCode}`);
          resolveCall(unwrap(value));
        } catch (error) { reject(error); }
      });
    });
    request.setTimeout(240000, () => request.destroy(Error('The remote browser did not respond')));
    request.on('error', reject);
    request.end(JSON.stringify({ method, params }));
  });
}
export async function browserCall(method, params = {}, options = {}) {
  if (typeof method !== 'string' || !method || typeof params !== 'object' || !params || Array.isArray(params)) throw Error('Use a browser method and parameter object');
  // Selecting remote control is explicit. A revoked/disconnected remote never
  // falls through to a different local browser.
  if (process.env.BASHKITTEN_BROWSER_SOCKET) return remoteCall(process.env.BASHKITTEN_BROWSER_SOCKET, method, params, options);
  return process.platform === 'android' ? androidCall(method, params, options) : linuxCall(method, params, options);
}
async function storage(manager) {
  const id = manager.getSessionId();
  if (!id) throw Error('Pi did not provide a session identity');
  const directory = resolve(manager.getSessionDir(), 'bashkitten-browser', createHash('sha256').update(id).digest('hex'));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) throw Error('Browser artifacts need a private directory');
  return directory;
}
async function saveResult(result, destination) {
  const encoded = result?.data ?? result?.base64;
  if (typeof encoded === 'string') {
    const data = Buffer.from(encoded, 'base64');
    if (!data.length || data.length > byteLimit) throw Error('Invalid browser file transfer');
    await writeFile(destination, data, { flag: 'wx', mode: 0o600 });
  }
  // Android's Binder transfer writes this exact requested destination itself.
  const info = await lstat(destination);
  if (!info.isFile() || info.isSymbolicLink()) throw Error('Invalid browser file transfer');
  return info;
}
export async function captureScreenshot(manager, tabId, signal) {
  const destination = join(await storage(manager), `screenshot-${randomUUID()}.png`);
  await browserCall('tabs.show', { tabId }, { signal });
  const result = await browserCall('screenshot', { tabId, transfer: true }, { output: destination, signal });
  const info = await saveResult(result, destination);
  if (info.size > byteLimit) throw Error('Browser screenshot is too large');
  const data = await readFile(destination);
  if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('Browser did not return a PNG image');
  return { content: [{ type: 'text', text: `Screenshot saved to ${destination}` }, { type: 'image', data: data.toString('base64'), mimeType: 'image/png' }], details: { path: destination, width: result?.width, height: result?.height } };
}
export async function saveDownload(manager, downloadId, signal) {
  const downloads = await browserCall('downloads.list', {}, { signal });
  const entry = (Array.isArray(downloads) ? downloads : downloads.downloads || []).find(file => file.id === downloadId);
  if (!entry) throw Error('Download is not available in this browser');
  const name = String(entry.name || 'download').replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 120) || 'download';
  const destination = join(await storage(manager), `download-${randomUUID()}-${name}`);
  const result = await browserCall('downloads.get', { downloadId }, { output: destination, signal });
  await saveResult(result, destination);
  return { content: [{ type: 'text', text: JSON.stringify({ path: destination, name, mimeType: result?.mimeType }) }], details: { path: destination, name, mimeType: result?.mimeType } };
}
