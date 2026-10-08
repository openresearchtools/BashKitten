// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dataDir, privateDir } from '../common.mjs';
import { binary } from '../access/paths.mjs';
import { fileDirectory, filePath, sendFile } from './files.mjs';
import { managerContext } from './access.mjs';
import { previewKind } from './preview-types.mjs';

const scratch = path.join(dataDir, 'run', 'file-previews');
const jobs = new Map();
let initialized, stopping = false;

async function remove(job) {
  if (job.status === 'running') return;
  jobs.delete(job.id);
  await fs.rm(job.directory, { recursive: true, force: true });
}
function stop(job) {
  if (job.status !== 'running' || job.cancelled) return;
  job.cancelled = true;
  // The existing native guard reaps the worker AND LibreOffice descendants.
  // Do not kill the guard itself before it has confirmed descendant cleanup.
  job.child.kill('SIGTERM');
}
async function init() {
  initialized ||= fs.rm(scratch, { recursive: true, force: true }).then(() => privateDir(scratch));
  await initialized;
}
async function startFilePreview(input, watch) {
  const access = managerContext();
  if (!access) throw Error('File-manager request required');
  if (stopping) throw Object.assign(Error('The file service is stopping'), { status: 503 });
  const location = await fileDirectory(input.root), file = await filePath(location.path, input.path);
  const name = path.basename(file), kind = await previewKind(file, name);
  if (!kind) throw Object.assign(Error('No preview is available for this file; use Download'), { status: 415 });
  await init();
  const id = randomUUID(), directory = path.join(scratch, id);
  await privateDir(directory);
  if (stopping || access.signal.aborted) { await fs.rm(directory, { recursive: true, force: true }); throw Error('The preview was stopped'); }
  const output = path.join(directory, kind === 'pdf' || kind === 'office' ? 'document.pdf' : kind === 'image' ? 'image' + path.extname(name) : 'document.html');
  const job = { id, directory, output, name, kind, remote: access.remote, status: 'running' };
  jobs.set(id, job);
  let resolveFinished;
  job.finished = new Promise(resolve => { resolveFinished = resolve; });
  let outcome, answer = '', errorText = '';
  const finish = async (outcome, code, signal) => {
    if (job.completed) return;
    job.completed = true; job.unwatch?.();
    job.status = job.cancelled ? 'cancelled' : code === 0 && outcome?.status === 'ready' ? 'ready' : 'failed';
    if (job.status === 'failed') job.error = String(outcome?.error ||
      'The preview worker stopped (' + (signal || 'exit ' + code) + ')' + (errorText.trim() ? ': ' + errorText.trim() : '')).slice(0, 1000);
    if (job.status !== 'ready') await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    resolveFinished();
  };
  try {
    const child = spawn(binary('runtime-guard'), [process.execPath, fileURLToPath(new URL('./preview-worker.mjs', import.meta.url)), 'serve'],
      { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    job.child = child;
    job.unwatch = watch?.(() => stop(job));
    child.stdout.on('data', bytes => {
      if (answer.length + bytes.length > 65536) { outcome = { error: 'Invalid preview worker response' }; stop(job); return; }
      answer += bytes.toString('utf8');
    });
    child.stderr.on('data', bytes => { errorText = (errorText + bytes.toString('utf8')).slice(-2000); });
    child.once('error', error => { outcome = { error: error.code === 'ENOENT' ? 'The packaged preview worker is unavailable' : error.message }; });
    child.once('close', (code, signal) => {
      if (!outcome) { try { outcome = JSON.parse(answer); } catch {} }
      void finish(outcome, code, signal);
    });
    child.stdio[3].on('error', () => { stop(job); });
    child.stdio[3].end(JSON.stringify({ file, name, kind, directory, output, scopeRoot: location.scopeRoot, remote: access.remote }));
  } catch (error) { await finish({ error: error.message }, 1); }
  return job;
}
// A user can open a document with the browser's ordinary download request.
// Conversion stays in the guarded worker while this asynchronous request waits;
// disconnecting/cancelling the download stops all of its conversion processes.
export async function prepareAndSendFile(req, res, input, watch) {
  const job = await startFilePreview(input, watch);
  const signal = managerContext().signal;
  const cancelled = () => stop(job);
  signal.addEventListener('abort', cancelled, { once: true });
  try {
    if (signal.aborted) cancelled();
    await job.finished;
    signal.throwIfAborted();
    if (job.status !== 'ready') throw Object.assign(Error(job.error || 'The preview was cancelled'), { status: 422 });
    const name = path.parse(job.name).name + path.extname(job.output);
    await sendFile(req, res, job.output, false, name, {
      artifact: true, generatedPreview: ['text', 'markdown', 'sheet'].includes(job.kind),
    });
  } finally {
    signal.removeEventListener('abort', cancelled);
    stop(job);
    await job.finished;
    await remove(job);
  }
}
export async function revokeRemotePreviews() {
  const selected = [...jobs.values()].filter(job => job.remote);
  for (const job of selected) stop(job);
  await Promise.all(selected.map(job => job.finished));
  for (const job of selected) await remove(job);
}
export async function closeFilePreviews() {
  stopping = true;
  for (const job of jobs.values()) stop(job);
  await Promise.all([...jobs.values()].map(job => job.finished));
  await fs.rm(scratch, { recursive: true, force: true });
}
