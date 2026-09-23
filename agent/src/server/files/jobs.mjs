import fs from 'node:fs/promises';
import path from 'node:path';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dataDir, privateDir } from '../common.mjs';
import { fileDirectory, relativePath, sendFile } from './files.mjs';

const scratch = path.join(dataDir, 'run', 'file-jobs');
const jobs = new Map();
const retention = 30 * 60 * 1000;
let initialized, cleanupTimer, stopping = false;

function visible(job) {
  const result = { id: job.id, operation: job.operation, status: job.status, completed: job.completed, current: job.current };
  if (job.error) result.error = job.error;
  if (job.operation === 'archive' && job.status === 'done') result.downloadUrl = `/api/files/jobs/${job.id}/download`;
  return result;
}
async function remove(job) {
  if (job.downloads) return false;
  jobs.delete(job.id); await fs.rm(job.directory, { recursive: true, force: true }); return true;
}
async function prune() {
  for (const job of jobs.values()) if (job.status !== 'running' && Date.now() - job.finished > retention) await remove(job);
}
async function init() {
  // This backend owns all workers; interrupted scratch is never a resumable job.
  initialized ||= fs.rm(scratch, { recursive: true, force: true }).then(() => privateDir(scratch));
  await initialized;
  cleanupTimer ||= setInterval(() => { void prune().catch(() => {}); }, 60000).unref();
}
function find(id) {
  const job = jobs.get(id);
  if (!job) throw Object.assign(Error('This file operation has expired'), { status: 404 });
  return job;
}
export function fileJob(id) { return visible(find(id)); }
export async function startFileJob(input, { whole = false } = {}) {
  if (stopping) throw Object.assign(Error('The file service is stopping'), { status: 503 });
  if (!['copy', 'delete', 'archive'].includes(input.operation)) throw Error('Choose copy, delete or archive');
  if (!Array.isArray(input.paths) || !input.paths.length) throw Error('Select files or folders');
  const location = await fileDirectory(input.root);
  const paths = [...new Set(input.paths.map(value => relativePath(value, whole && input.operation === 'archive')))];
  const selections = new Set(paths);
  const selected = paths.filter(value => {
    let parent = value;
    while (parent) {
      parent = path.dirname(parent);
      if (parent === '.') parent = '';
      if (selections.has(parent)) return false;
    }
    return true;
  });
  if (input.operation === 'copy' && (typeof input.destination !== 'string' || !input.destination)) throw Error('Choose a copy destination');
  const destination = input.operation === 'copy' ? await fileDirectory(input.destination) : null;
  await init(); await prune();
  const id = randomUUID(), directory = path.join(scratch, id), output = path.join(directory, 'archive.zip');
  await privateDir(directory);
  if (stopping) { await fs.rm(directory, { recursive: true, force: true }); throw Error('The file service is stopping'); }
  const job = { id, operation: input.operation, status: 'running', completed: 0, current: '', directory, output, downloads: 0,
    filename: (whole ? path.basename(location.path) || 'repository' : 'selected-files') + '.zip' };
  jobs.set(id, job);
  let child;
  try { child = fork(new URL('./worker.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] }); }
  catch (error) { jobs.delete(id); await fs.rm(directory, { recursive: true, force: true }); throw error; }
  job.child = child;
  job.finishedPromise = new Promise(resolve => { job.resolve = resolve; });
  const finish = async (status, error) => {
    if (job.finished) return;
    job.status = job.cancelRequested ? 'cancelled' : status; job.error = error?.slice(0, 1000); job.finished = Date.now();
    clearTimeout(job.killTimer);
    if (job.status !== 'done') await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    job.resolve();
  };
  let outcome;
  child.on('message', message => {
    if (message?.type === 'progress') { job.completed = Math.max(job.completed, Number(message.completed) || 0); job.current = String(message.current || '').slice(0, 1000); }
    if (message?.type === 'result') outcome = message;
  });
  child.once('error', error => { outcome = { status: 'failed', error: error.message }; });
  child.once('exit', code => { void finish(outcome?.status || 'failed', outcome?.error || (code ? 'File worker stopped before completing' : undefined)); });
  child.send({ ...input, ...location, root: location.path, paths: selected, destination: destination?.path, destinationScope: destination?.scopeRoot, scratch, output }, error => {
    if (error) { outcome = { status: 'failed', error: error.message }; child.kill(); }
  });
  return visible(job);
}
export function cancelFileJob(id) {
  const job = find(id);
  if (job.status === 'running' && !job.cancelRequested) {
    job.cancelRequested = true; job.child.kill('SIGTERM');
    job.killTimer = setTimeout(() => job.child.kill('SIGKILL'), 3000).unref();
  }
  return visible(job);
}
export async function downloadFileJob(req, res, id) {
  const job = find(id);
  if (job.operation !== 'archive' || job.status !== 'done') throw Error('The archive is not ready');
  job.downloads++; job.finished = Date.now();
  try { await sendFile(req, res, job.output, true, job.filename); }
  finally { job.downloads--; }
}
export async function sendZip(req, res, root) {
  const { id } = await startFileJob({ operation: 'archive', root, paths: [''] }, { whole: true });
  const closed = () => { if (!res.writableFinished) cancelFileJob(id); };
  res.once('close', closed);
  if (res.destroyed) cancelFileJob(id);
  try {
    const job = find(id); await job.finishedPromise;
    if (res.destroyed) return;
    if (job.status !== 'done') throw Error(job.error || 'Archive cancelled');
    await downloadFileJob(req, res, id);
  } finally { res.off('close', closed); const job = jobs.get(id); if (job) await remove(job); }
}
export async function closeFileJobs() {
  stopping = true;
  clearInterval(cleanupTimer);
  for (const job of jobs.values()) if (job.status === 'running') cancelFileJob(job.id);
  await Promise.all([...jobs.values()].map(job => job.finishedPromise));
  await fs.rm(scratch, { recursive: true, force: true });
}
