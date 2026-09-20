// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const execute = promisify(execFile);
const browserPackage = 'org.openresearchtools.wildbuzzard';

export function sessionLocation(manager) {
  const id = manager.getSessionId();
  if (!id) throw new Error('Pi did not provide a session identity');
  const scope = 'pi-' + createHash('sha256').update(id).digest('hex');
  return { scope, directory: resolve(manager.getSessionDir(), 'wildbuzzard', scope) };
}

export async function prepareSession(manager) {
  const session = sessionLocation(manager);
  await mkdir(session.directory, { recursive: true, mode: 0o700 });
  const info = await lstat(session.directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Browser session storage must be a private directory');
  if ((info.mode & 0o077) !== 0) throw new Error('Browser session directory must have mode 0700');
  return session;
}

export async function browserCall(method, params = {}, { scope, output, signal, authorize = false } = {}) {
  const { stdout } = await execute('pm', ['path', browserPackage], { encoding: 'utf8', signal, timeout: 10000 });
  const apk = stdout.split('\n').find(line => line.startsWith('package:') && line.trim().endsWith('/base.apk'))?.trim().slice(8);
  if (!apk || !apk.startsWith('/data/app/')) throw new Error('Install Wild Buzzard for Android first');
  const env = { ...process.env, CLASSPATH: apk };
  delete env.LD_PRELOAD; delete env.LD_LIBRARY_PATH;
  const args = ['/', 'org.openresearchtools.wildbuzzard.BrowserCommand'];
  if (scope) args.push('--session', scope);
  if (output) args.push('--output', output);
  args.push(...(authorize ? ['--authorize'] : ['--json', JSON.stringify({ method, params })]));
  try {
    const result = await execute('/system/bin/app_process', args, { env, signal, timeout: 240000, maxBuffer: 2_000_000 });
    const response = JSON.parse(result.stdout);
    if ('error' in response) throw new Error(response.error);
    return response.result;
  } catch (error) {
    if (error.stdout) {
      try { const response = JSON.parse(error.stdout); if (response.error) throw new Error(response.error); }
      catch (parsed) { if (!(parsed instanceof SyntaxError)) throw parsed; }
    }
    throw new Error(error.stderr?.trim() || error.message, { cause: error });
  }
}

export async function captureScreenshot(manager, tabId, signal, call = browserCall) {
  const session = await prepareSession(manager);
  await call('tabs.show', { tabId }, { scope: session.scope, signal });
  const path = join(session.directory, `screenshot-${randomUUID()}.png`);
  let result;
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      result = await call('screenshot', { tabId, transfer: true }, { scope: session.scope, output: path, signal });
      break;
    } catch (error) {
      if (!error.message.includes('Show this tab before capturing') || Date.now() >= deadline) throw error;
      await delay(200, undefined, { signal });
    }
  }
  const data = await readFile(path);
  if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Browser did not return a PNG image');
  return {
    content: [{ type: 'text', text: `Screenshot saved to ${path}` }, { type: 'image', data: data.toString('base64'), mimeType: 'image/png' }],
    details: { path, mimeType: 'image/png', width: result.width, height: result.height, session: session.scope },
  };
}

export async function saveDownload(manager, downloadId, signal, call = browserCall) {
  const session = await prepareSession(manager);
  const downloads = await call('downloads.list', {}, { scope: session.scope, signal });
  const entry = downloads.find(file => file.id === downloadId);
  if (!entry) throw new Error('Download is not in this browser session');
  const name = String(entry.name || 'download').replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 120) || 'download';
  const path = join(session.directory, `download-${randomUUID()}-${name}`);
  const result = await call('downloads.get', { downloadId }, { scope: session.scope, output: path, signal });
  return { content: [{ type: 'text', text: JSON.stringify({ ...result, path }) }], details: { ...result, path, session: session.scope } };
}
