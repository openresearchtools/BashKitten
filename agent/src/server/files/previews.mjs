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
let initialized, cleanupTimer, stopping = false;
const retention = 30 * 60 * 1000, lease = 60 * 1000;

function visible(job) {
  return { id: job.id, status: job.status, kind: job.kind, name: job.name,
    ...(job.error ? { error: job.error } : {}),
    ...(job.status === 'ready' ? { contentUrl: '/api/files/previews/' + job.id + '/content' } : {}) };
}
function find(id) {
  const job = jobs.get(id);
  if (!job || job.owner !== managerContext()?.owner) throw Object.assign(Error('This preview has expired; choose View again'), { status: 404 });
  job.touched = Date.now();
  return job;
}
async function remove(job) {
  if (job.transfers || job.status === 'running') return;
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
async function prune() {
  for (const job of jobs.values()) {
    const age = Date.now() - job.touched;
    if (job.status === 'running' && age > lease) stop(job);
    else if (job.status !== 'running' && age > retention) await remove(job);
  }
}
async function init() {
  initialized ||= fs.rm(scratch, { recursive: true, force: true }).then(() => privateDir(scratch));
  await initialized;
  cleanupTimer ||= setInterval(() => { void prune().catch(() => {}); }, 10000).unref();
}
export async function startFilePreview(input, watch) {
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
  const job = { id, directory, output, name, kind, owner: access.owner, remote: access.remote,
    status: 'running', transfers: 0, touched: Date.now() };
  jobs.set(id, job);
  let resolveFinished;
  job.finished = new Promise(resolve => { resolveFinished = resolve; });
  const finish = async (outcome, code) => {
    if (job.completed) return;
    job.completed = true; job.unwatch?.();
    job.status = job.cancelled ? 'cancelled' : code === 0 && outcome?.status === 'ready' ? 'ready' : 'failed';
    if (job.status === 'failed') job.error = String(outcome?.error || 'The preview worker stopped before completing').slice(0, 1000);
    job.touched = Date.now();
    if (job.status !== 'ready') await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    resolveFinished();
  };
  let outcome, answer = '';
  try {
    const child = spawn(binary('runtime-guard'), [process.execPath, fileURLToPath(new URL('./preview-worker.mjs', import.meta.url)), 'serve'],
      { stdio: ['ignore', 'pipe', 'ignore', 'pipe'] });
    job.child = child;
    job.unwatch = watch?.(() => stop(job));
    child.stdout.on('data', bytes => {
      if (answer.length + bytes.length > 65536) { outcome = { error: 'Invalid preview worker response' }; stop(job); return; }
      answer += bytes.toString('utf8');
    });
    child.once('error', error => { outcome = { error: error.code === 'ENOENT' ? 'The packaged preview worker is unavailable' : error.message }; });
    child.once('close', code => {
      if (!outcome) { try { outcome = JSON.parse(answer); } catch {} }
      void finish(outcome, code);
    });
    child.stdio[3].on('error', () => { stop(job); });
    child.stdio[3].end(JSON.stringify({ file, name, kind, directory, output, scopeRoot: location.scopeRoot, remote: access.remote }));
  } catch (error) { await finish({ error: error.message }, 1); }
  return visible(job);
}
export function filePreview(id) { return visible(find(id)); }
export function cancelFilePreview(id) {
  const job = find(id);
  stop(job);
  if (job.status === 'ready') { job.status = 'cancelled'; void remove(job).catch(() => {}); }
  return visible(job);
}
export async function sendFilePreview(req, res, id) {
  const job = find(id);
  if (job.status !== 'ready') throw Error('The preview is not ready');
  job.transfers++;
  try {
    const extension = path.extname(job.output), name = path.parse(job.name).name + extension;
    await sendFile(req, res, job.output, false, name, {
      artifact: true, generatedPreview: ['text', 'markdown', 'sheet'].includes(job.kind),
    });
  } finally { job.transfers--; job.touched = Date.now(); }
}
export async function revokeRemotePreviews() {
  const selected = [...jobs.values()].filter(job => job.remote);
  for (const job of selected) stop(job);
  await Promise.all(selected.map(job => job.finished));
  for (const job of selected) await remove(job);
}
export async function closeFilePreviews() {
  stopping = true; clearInterval(cleanupTimer);
  for (const job of jobs.values()) stop(job);
  await Promise.all([...jobs.values()].map(job => job.finished));
  await fs.rm(scratch, { recursive: true, force: true });
}
