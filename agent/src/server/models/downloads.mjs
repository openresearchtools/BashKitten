// SPDX-License-Identifier: GPL-3.0-only
// Changed JavaScript adaptation of BashKitten Rust / SimpleHF download behavior.
// Original authors, source revisions and licenses: third_party/NOTICE.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { modelDataDir, modelSettings, getModelsDirectory } from './settings.mjs';
import { pickerDirectory } from '../files/folders.mjs';
import { privateDir } from '../common.mjs';
import { repositoryId, revisionId, repositoryPath, repositoryFiles, hfRequest, resolvePath, modelError, publicModelError } from './huggingface.mjs';
export { searchModels, modelRepository } from './huggingface.mjs';

const recordsDir = path.join(modelDataDir, 'downloads');
const jobs = new Map(), running = new Map();
let loaded, closing = false, mutations = Promise.resolve();
let downloadCompleteHandler;
export function setDownloadCompleteHandler(handler) { downloadCompleteHandler = handler; }
const terminal = new Set(['complete', 'cancelled']);
// Node does not expose O_PATH on every supported release. Linux and Android
// share this flag: traversing /data requires search access, not directory reads.
const directoryPathFlags = (constants.O_PATH ?? 0x200000) | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const serialize = action => { const next = mutations.then(action); mutations = next.catch(() => {}); return next; };
const publicJob = job => ({ id: job.id, repository: job.repository, revision: job.revision, directory: job.directory,
  status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt, error: job.error || null,
  downloaded: job.files.reduce((sum, file) => sum + file.downloaded, 0), total: job.files.reduce((sum, file) => sum + file.size, 0),
  files: job.files.map(file => ({ path: file.path, outputPath: file.outputPath, size: file.size, downloaded: file.downloaded, status: file.status })) });

// Atomic private manifests, synced after the partial data they describe. Progress
// changes stay in memory between checkpoints; no per-chunk JSON rewrites.
async function persist(job) {
  job.updatedAt = new Date().toISOString();
  const value = JSON.stringify(job) + '\n';
  const file = path.join(recordsDir, job.id + '.json'), temp = file + '.' + randomUUID() + '.tmp';
  let output;
  try {
    output = await fs.open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await output.writeFile(value); await output.sync(); await output.close(); output = null;
    await fs.rename(temp, file);
    const dir = await fs.open(recordsDir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await dir.sync(); } finally { await dir.close(); }
  } finally { await output?.close(); await fs.unlink(temp).catch(() => {}); }
}
async function load() {
  return loaded ||= (async () => {
    await privateDir(recordsDir);
    const names = (await fs.readdir(recordsDir)).filter(name => uuid.test(name.slice(0, -5)) && name.endsWith('.json'));
    for (const name of names) {
      const handle = await fs.open(path.join(recordsDir, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      let job;
      try {
        if (!(await handle.stat()).isFile()) throw modelError('Invalid saved download record');
        job = JSON.parse(await handle.readFile('utf8'));
      } finally { await handle.close(); }
      if (job.id + '.json' !== name || !Array.isArray(job.files) || !job.files.length || !path.isAbsolute(job.directory)) throw modelError('Invalid saved download record');
      repositoryId(job.repository); revisionId(job.revision);
      for (const file of job.files) {
        repositoryPath(file.path); repositoryPath(file.outputPath);
        if (!Number.isSafeInteger(file.size) || file.size < 0 || !Number.isSafeInteger(file.downloaded) || file.downloaded < 0 || file.downloaded > file.size || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(file.hash)) throw modelError('Invalid saved download file');
      }
      if (['downloading', 'queued'].includes(job.status)) { job.status = 'interrupted'; job.error = 'The server stopped; resume to continue'; await persist(job); }
      jobs.set(job.id, job);
    }
  })();
}

// Hold each directory open and traverse through that descriptor. O_NOFOLLOW on
// the leaf alone would still allow a replaced parent to redirect a later write.
// /proc/self/fd is available on native Linux and Android/Termux.
async function outputDirectory(job, file, create = true) {
  const canonical = (await pickerDirectory(job.directory)).path;
  if (canonical !== job.directory) throw modelError('The models folder has moved; choose its current location');
  let parent = await fs.open('/', directoryPathFlags);
  const pieces = file.outputPath.split('/');
  const filename = pieces.pop();
  try {
    // A canonical absolute path can acquire a symlink in an ancestor between
    // validation and open. Pin every component, including the selected root.
    for (const component of canonical.split('/').filter(Boolean)) {
      const child = await fs.open(`/proc/self/fd/${parent.fd}/${component}`, directoryPathFlags);
      await parent.close(); parent = child;
    }
    // Reopen the pinned writable root for fsync; an O_PATH handle cannot sync.
    const writableRoot = await fs.open(`/proc/self/fd/${parent.fd}/.`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    await parent.close(); parent = writableRoot;
    for (const component of pieces) {
      const target = `/proc/self/fd/${parent.fd}/${component}`;
      if (create) await fs.mkdir(target, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      const child = await fs.open(target, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await parent.close(); parent = child;
    }
    return { parent, final: `/proc/self/fd/${parent.fd}/${filename}`, partial: `/proc/self/fd/${parent.fd}/.bashkitten-${job.id}-${job.files.indexOf(file)}.part` };
  } catch (error) { await parent.close(); throw error; }
}
const statOrNull = file => fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
const sameFile = (stat, identity) => stat?.isFile() && identity && stat.dev === identity.dev && stat.ino === identity.ino;

async function publish(destination) {
  if (process.platform !== 'android') return fs.link(destination.partial, destination.final);
  // Android app SELinux denies hard links. Termux coreutils uses native
  // renameat2(RENAME_NOREPLACE); inherit the pinned directory, not its pathname.
  await new Promise((resolve, reject) => {
    const child = spawn('mv', ['--no-clobber', '--no-target-directory', '--',
      '/proc/self/fd/3/' + path.basename(destination.partial), '/proc/self/fd/3/' + path.basename(destination.final)],
    { stdio: ['ignore', 'ignore', 'ignore', destination.parent.fd] });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(modelError('Could not publish the completed model')); });
  });
}

async function checkpoint(job, file, output) {
  await output.sync();
  file.checkpoint = file.downloaded;
  await persist(job);
}
async function hashPrefix(output, hash, length, signal) {
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  for (let position = 0; position < length;) {
    signal.throwIfAborted();
    const { bytesRead } = await output.read(buffer, 0, Math.min(buffer.length, length - position), position);
    if (!bytesRead) throw modelError('The partial download changed; cancel it and start again');
    hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
  }
}
async function downloadFile(job, file, signal) {
  const destination = await outputDirectory(job, file);
  let output, request;
  try {
    const final = await statOrNull(destination.final);
    if (final) {
      // A crash may have published the verified inode but not its final manifest.
      // Recover only our own inode and recheck its content, never an unrelated file.
      const identity = file.identity || file.partialIdentity;
      if (sameFile(final, identity) && final.size === file.size && file.checkpoint === file.size) {
        const input = await fs.open(destination.final, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          if (!sameFile(await input.stat(), identity)) throw modelError('The downloaded file changed before verification');
          const hash = createHash(file.hash.length === 64 ? 'sha256' : 'sha1');
          if (file.hash.length === 40) hash.update(`blob ${file.size}\0`);
          await hashPrefix(input, hash, file.size, signal);
          if (hash.digest('hex') !== file.hash) throw modelError('The completed model was changed; choose another folder before downloading it again');
        } finally { await input.close(); }
        const partial = await statOrNull(destination.partial);
        if (sameFile(partial, identity)) await fs.unlink(destination.partial);
        file.identity = identity; delete file.partialIdentity;
        file.downloaded = file.size; file.status = 'complete'; await persist(job); return;
      }
      throw modelError('A selected destination file already exists; choose another folder or remove that file first');
    }
    const partial = await statOrNull(destination.partial);
    if (partial) {
      if (!sameFile(partial, file.partialIdentity) || partial.nlink !== 1 || partial.size < (file.checkpoint || 0)) throw modelError('The partial download changed; cancel it and start again');
      output = await fs.open(destination.partial, constants.O_RDWR | constants.O_NOFOLLOW);
      if (!sameFile(await output.stat(), file.partialIdentity)) throw modelError('The partial download changed; cancel it and start again');
      file.downloaded = file.checkpoint || 0;
      await output.truncate(file.downloaded);
    } else {
      output = await fs.open(destination.partial, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const stat = await output.stat(); file.partialIdentity = { dev: stat.dev, ino: stat.ino };
      file.downloaded = file.checkpoint = 0; await persist(job);
    }
    signal.throwIfAborted();
    file.status = 'downloading';
    const hash = createHash(file.hash.length === 64 ? 'sha256' : 'sha1');
    if (file.hash.length === 40) hash.update(`blob ${file.size}\0`);
    await hashPrefix(output, hash, file.downloaded, signal);
    if (file.downloaded < file.size) {
      const offset = file.downloaded;
      request = await hfRequest(resolvePath(job.repository, job.revision, file.path), { signal, range: `bytes=${offset}-${file.size - 1}` });
      const response = request.response;
      const contentEncoding = response.headers.get('content-encoding');
      if (contentEncoding && contentEncoding !== 'identity') throw modelError('Hugging Face returned an encoded download instead of original bytes');
      if (response.status === 206) {
        if (response.headers.get('content-range') !== `bytes ${offset}-${file.size - 1}/${file.size}`) throw modelError('Hugging Face returned a different byte range');
      } else if (response.status !== 200 || offset !== 0) {
        throw modelError('The download server ignored the resume byte range; cancel and restart this file');
      }
      const length = response.headers.get('content-length');
      if (length !== null && Number(length) !== file.size - offset) throw modelError('Hugging Face returned a different file size');
      let lastCheckpoint = Date.now();
      for await (const chunk of response.body) {
        request.resetTimeout(); signal.throwIfAborted();
        if (file.downloaded + chunk.length > file.size) throw modelError('The download exceeded its expected size');
        let written = 0;
        while (written < chunk.length) {
          const { bytesWritten } = await output.write(chunk, written, chunk.length - written, file.downloaded + written);
          if (!bytesWritten) throw modelError('Could not write model bytes');
          written += bytesWritten;
        }
        hash.update(chunk); file.downloaded += chunk.length;
        if (Date.now() - lastCheckpoint >= 2000) { await checkpoint(job, file, output); lastCheckpoint = Date.now(); }
      }
    }
    signal.throwIfAborted();
    if (file.downloaded !== file.size) throw modelError('The download ended before all bytes arrived; resume to continue');
    if (hash.digest('hex') !== file.hash) {
      await output.truncate(0); file.downloaded = file.checkpoint = 0;
      throw modelError('The downloaded bytes did not match Hugging Face; resume to retry');
    }
    await checkpoint(job, file, output);
    // Publish without replacing an existing name; plain rename() would clobber.
    // Check that no outside writer replaced/hard-linked the partial meanwhile.
    const stat = await fs.lstat(destination.partial);
    if (!sameFile(stat, file.partialIdentity) || stat.nlink !== 1 || stat.size !== file.size) throw modelError('The partial download changed before completion');
    await publish(destination).catch(error => { if (error.code === 'EEXIST') throw modelError('A destination file appeared during download; it was not replaced'); throw error; });
    if (!sameFile(await fs.lstat(destination.final), file.partialIdentity)) {
      throw modelError('A destination file appeared during download; it was not replaced');
    }
    const remaining = await statOrNull(destination.partial);
    if (sameFile(remaining, file.partialIdentity)) await fs.unlink(destination.partial);
    await destination.parent.sync();
    file.identity = file.partialIdentity; delete file.partialIdentity;
    file.status = 'complete'; await persist(job);
  } finally {
    request?.close();
    try {
      if (output) {
        // An abort/error preserves only a fully flushed prefix for a later resume.
        try { if (file.status !== 'complete') await checkpoint(job, file, output); }
        finally { await output.close(); }
      }
    } finally { await destination.parent.close(); }
  }
}
async function run(job, controller) {
  try {
    job.status = 'downloading'; job.error = null; await persist(job);
    for (const file of job.files) { controller.signal.throwIfAborted(); await downloadFile(job, file, controller.signal); }
    job.status = 'complete';
  } catch (error) {
    if (job.status === 'downloading') { job.status = 'error'; job.error = publicModelError(error); }
  } finally { await persist(job); }
  if (job.status === 'complete' && !closing) {
    // Refresh only after the complete job is published and durable. A stopped
    // or unavailable inference service cannot turn a successful download into
    // a failed transfer; reopening the router also reads the models directory.
    try { await downloadCompleteHandler?.(); } catch {}
  }
}
function pump() {
  if (closing) return;
  for (const job of jobs.values()) {
    if (running.size >= 2) break;
    if (job.status !== 'queued' || running.has(job.id)) continue;
    const controller = new AbortController();
    const state = { controller, promise: null }; running.set(job.id, state);
    state.promise = run(job, controller).catch(() => { job.status = 'error'; job.error = 'Could not save download progress; check available disk space'; })
      .finally(() => { running.delete(job.id); pump(); });
  }
}
export async function downloadsStatus() {
  await load();
  return { ...await modelSettings(), jobs: [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicJob) };
}
function selectedFiles(repository, files, entries) {
  const family = file => file.replace(/\.gguf$/i, '').replace(/-\d{5}-of-\d{5}$/, '');
  const projector = file => /mmproj/i.test(path.basename(file));
  const models = files.filter(file => /\.gguf$/i.test(file) && !projector(file));
  const families = [...new Set(models.map(family))];
  const folder = key => {
    const label = (repository.replace('/', '--') + '--' + path.basename(key)).replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 160);
    return label + '--' + createHash('sha256').update(repository + '/' + key).digest('hex').slice(0, 12);
  };
  const projectors = files.filter(file => /\.gguf$/i.test(file) && projector(file));
  if (projectors.length && (families.length !== 1 || projectors.length > 1)) throw modelError('Download one model family together with one selected mmproj file at a time');
  for (const file of models) {
    const split = file.match(/-(\d{5})-of-(\d{5})\.gguf$/i);
    if (!split) continue;
    const count = Number(split[2]), stem = family(file);
    if (count < 1) throw modelError('The model has an invalid number of split files');
    for (let index = 1; index <= count; index++) {
      const shard = stem + '-' + String(index).padStart(5, '0') + '-of-' + split[2] + file.slice(-5);
      if (!entries.has(shard) || !files.includes(shard)) throw modelError(`Select all ${count} split GGUF files for this model before downloading`);
    }
  }
  return files.map(file => {
    const entry = entries.get(file);
    if (!entry) throw modelError('A selected file is not part of this repository revision');
    const outputPath = /\.gguf$/i.test(file)
      ? folder(projector(file) ? families[0] : family(file)) + '/' + path.basename(file)
      : folder('repository-files') + '/' + file;
    return { path: entry.path, outputPath, size: entry.size, hash: entry.hash, downloaded: 0, checkpoint: 0, status: 'pending' };
  // Publish the first shard after its remaining selected parts/projector. Native
  // llama discovers the first shard and must not see an unfinished model family.
  }).sort((a, b) => {
    const order = file => projector(file) ? 0 : /-00001-of-\d{5}\.gguf$/i.test(file) ? 3 : /-\d{5}-of-\d{5}\.gguf$/i.test(file) ? 1 : 2;
    return order(a.path) - order(b.path);
  });
}
export async function startDownload({ id, revision, files } = {}) {
  repositoryId(id); revisionId(revision);
  if (!Array.isArray(files) || !files.length || new Set(files).size !== files.length) throw modelError('Choose distinct repository files');
  files.forEach(repositoryPath);
  await load();
  if (closing) throw modelError('Agent is stopping');
  const directory = await getModelsDirectory({ create: true });
  const listing = await repositoryFiles(id, revision);
  const entries = new Map(listing.files.map(file => [file.path, file]));
  const selected = selectedFiles(id, files, entries);
  if (!Number.isSafeInteger(selected.reduce((sum, file) => sum + file.size, 0))) throw modelError('The selected download is too large');
  return serialize(async () => {
    if (closing) throw modelError('Agent is stopping');
    for (const job of jobs.values()) {
      if (terminal.has(job.status) || job.directory !== directory) continue;
      if (job.files.some(file => selected.some(selection => selection.outputPath === file.outputPath))) throw modelError('A download already owns one of these files; resume or cancel it first');
    }
    const now = new Date().toISOString();
    const job = { id: randomUUID(), repository: id, revision, directory, createdAt: now, updatedAt: now, status: 'queued', error: null, files: selected };
    await persist(job); jobs.set(job.id, job); pump(); return publicJob(job);
  });
}
async function removePartials(job) {
  for (const file of job.files) {
    if (file.status === 'complete' || !file.partialIdentity) continue;
    let target;
    try {
      target = await outputDirectory(job, file, false);
      const stat = await statOrNull(target.partial);
      if (stat && !sameFile(stat, file.partialIdentity)) throw modelError('A partial file was replaced; it was not deleted');
      if (stat) await fs.unlink(target.partial);
      file.downloaded = file.checkpoint = 0; file.status = 'pending'; delete file.partialIdentity;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { await target?.parent.close(); }
  }
}
export async function controlDownload(id, action) {
  if (!uuid.test(id) || !['pause', 'resume', 'cancel'].includes(action)) throw modelError('Invalid download action');
  await load();
  return serialize(async () => {
    const job = jobs.get(id);
    if (!job) throw Object.assign(modelError('Download was not found'), { status: 404 });
    if (terminal.has(job.status)) return publicJob(job);
    if (action === 'resume') {
      if (closing) throw modelError('Agent is stopping');
      if (!running.has(id) && job.status !== 'queued') { job.status = 'queued'; job.error = null; await persist(job); pump(); }
    } else {
      job.status = action === 'pause' ? 'paused' : 'cancelled'; job.error = null;
      const active = running.get(id); active?.controller.abort(); await active?.promise;
      if (action === 'cancel') {
        try { await removePartials(job); }
        catch (error) { job.status = 'error'; job.error = publicModelError(error); }
      }
      await persist(job);
    }
    return publicJob(job);
  });
}
export async function shutdownDownloads() {
  closing = true;
  if (!loaded) return;
  await load(); await mutations;
  const pending = [];
  for (const job of jobs.values()) {
    if (!['queued', 'downloading'].includes(job.status)) continue;
    job.status = 'paused'; job.error = null;
    const active = running.get(job.id); active?.controller.abort();
    pending.push((async () => { await active?.promise; await persist(job); })());
  }
  await Promise.all(pending);
}
