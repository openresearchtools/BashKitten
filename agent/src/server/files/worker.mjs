// Short-lived file operations. The HTTP process never walks/copies/compresses trees.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import yazl from 'yazl';

process.umask(0o077);
const abort = new AbortController();
process.on('SIGTERM', () => abort.abort());
process.on('SIGINT', () => abort.abort());
// IPC closes even if the backend is killed; the runtime guard also owns this child.
process.on('disconnect', () => abort.abort());
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const contains = (root, target) => target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
const canonicalPath = value => process.platform === 'android' && contains('/data/user/0/com.termux', value) ? '/data/data/com.termux' + value.slice('/data/user/0/com.termux'.length) : value;
const fdPath = handle => `/proc/self/fd/${handle.fd}`;
let completed = 0, lastProgress = 0, current = '';
function check() { abort.signal.throwIfAborted(); }
function progress(name, done = true, force = false) {
  check(); current = name; if (done) completed++;
  if (process.connected && (force || Date.now() - lastProgress >= 100)) {
    lastProgress = Date.now(); process.send({ type: 'progress', completed, current: name.slice(0, 1000) });
  }
}
async function openDirectory(filename, scope) {
  const handle = await fs.open(filename, directoryFlags);
  try {
    const real = canonicalPath(await fs.realpath(fdPath(handle)));
    if (!contains(scope, real)) throw Error('Path leaves the available files');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}
async function parentOf(filename, scope) {
  const real = canonicalPath(await fs.realpath(path.dirname(filename)));
  if (!contains(scope, real)) throw Error('Path leaves the available files');
  return openDirectory(real, scope);
}
async function entries(handle) { check(); return fs.readdir(fdPath(handle)); }
async function removeNode(parent, name, display, scope) {
  check(); progress(display, false);
  const target = path.join(fdPath(parent), name), stat = await fs.lstat(target);
  if (stat.isDirectory()) {
    const dir = await openDirectory(target, scope);
    try { for (const child of await entries(dir)) await removeNode(dir, child, path.join(display, child), scope); }
    finally { await dir.close(); }
    check(); await fs.rmdir(target);
  } else { check(); await fs.unlink(target); }
  progress(display);
}
async function copyNode(source, name, destination, display, scope, destinationScope, created = () => {}) {
  check(); progress(display, false);
  const from = path.join(fdPath(source), name), to = path.join(fdPath(destination), name), stat = await fs.lstat(from);
  if (stat.isSymbolicLink()) {
    await fs.symlink(await fs.readlink(from), to);
    created(await fs.lstat(to));
  } else if (stat.isDirectory()) {
    const dir = await openDirectory(from, scope);
    let output;
    try {
      await fs.mkdir(to, { mode: (stat.mode & 0o777) | 0o700 });
      output = await openDirectory(to, destinationScope);
      created(await output.stat());
      for (const child of await entries(dir)) await copyNode(dir, child, output, path.join(display, child), scope, destinationScope);
      await output.chmod(stat.mode & 0o777);
    } finally { await dir.close(); await output?.close(); }
  } else if (stat.isFile()) {
    const input = await fs.open(from, constants.O_RDONLY | constants.O_NOFOLLOW);
    let output;
    try {
      if (!(await input.stat()).isFile()) throw Error('File changed while copying');
      output = await fs.open(to, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, stat.mode & 0o777);
      created(await output.stat());
      await pipeline(input.createReadStream(), output.createWriteStream(), { signal: abort.signal });
    } finally { await input.close(); await output?.close(); }
  } else throw Error(`Cannot copy a socket or device: ${display}`);
  progress(display);
}

async function discardCopy(parent, name, owned, scope) {
  const target = path.join(fdPath(parent), name), now = await fs.lstat(target).catch(() => null);
  if (!owned || !now || now.dev !== owned.dev || now.ino !== owned.ino) return;
  // Only our newly-created copy is touched. Read-only copied directories may
  // need owner write permission to remove an interrupted partial tree.
  async function writable(filename) {
    if (!(await fs.lstat(filename)).isDirectory()) return;
    const dir = await openDirectory(filename, scope);
    try {
      await dir.chmod((await dir.stat()).mode | 0o700);
      for (const child of await fs.readdir(fdPath(dir))) await writable(path.join(fdPath(dir), child));
    } finally { await dir.close(); }
  }
  await writable(target);
  await fs.rm(target, { recursive: true, force: true });
}

async function archiveFiles(job) {
  const archive = new yazl.ZipFile();
  const output = await fs.open(job.output, 'wx', 0o600);
  let written = 0, count = 0, archiveError;
  const limiter = new Transform({ transform(chunk, encoding, callback) {
    written += chunk.length;
    callback(written > job.archiveLimit ? Error('Archive exceeds the 4 GiB temporary download limit') : null, chunk);
  } });
  const stream = pipeline(archive.outputStream, limiter, output.createWriteStream(), { signal: abort.signal });
  stream.catch(error => { archiveError = error; });
  archive.on('error', error => { archiveError = error; archive.outputStream.destroy(error); });
  async function add(parent, name, relative) {
    check(); if (archiveError) throw archiveError;
    if (++count > 250000) throw Error('Archive exceeds the 250,000 entry limit');
    if (relative.includes('\\') || relative.split('/').includes('..')) throw Error('This filename cannot be safely stored in a ZIP');
    const full = path.join(fdPath(parent), name), stat = await fs.lstat(full);
    progress(relative, false);
    if (stat.isSymbolicLink()) {
      const link = await fs.readlink(full);
      // Never produce an archive link that could extract outside its archive.
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), link));
      if (path.isAbsolute(link) || /^[a-z]:/i.test(link) || link.includes('\\') || resolved === '..' || resolved.startsWith('../')) throw Error(`Cannot archive an external symbolic link: ${relative}`);
      archive.addBuffer(Buffer.from(link), relative, { mode: 0o120777, mtime: stat.mtime });
    } else if (stat.isDirectory()) {
      const dir = await openDirectory(full, job.scopeRoot);
      try {
        if (contains(job.scratch, canonicalPath(await fs.realpath(fdPath(dir))))) return;
        archive.addEmptyDirectory(relative, { mode: stat.mode, mtime: stat.mtime });
        for (const child of await entries(dir)) await add(dir, child, path.posix.join(relative, child));
      } finally { await dir.close(); }
    } else if (stat.isFile()) {
      const file = await fs.open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stable = await file.stat();
        if (!stable.isFile()) throw Error('File changed while archiving');
        check();
        // Wait for each source stream before closing its pinned descriptor. This
        // bounds open files and never buffers whole source files in memory.
        const input = file.createReadStream();
        const consumed = new Promise((resolve, reject) => {
          input.once('end', resolve); input.once('error', reject);
          archive.outputStream.once('error', reject);
          const cancel = () => input.destroy(abort.signal.reason);
          abort.signal.addEventListener('abort', cancel, { once: true });
          input.once('close', () => { abort.signal.removeEventListener('abort', cancel); archive.outputStream.off('error', reject); });
        });
        archive.addReadStream(input, relative, { size: stable.size, mode: stable.mode, mtime: stable.mtime });
        await consumed;
      } finally { await file.close(); }
    } else throw Error(`Cannot archive a socket or device: ${relative}`);
    progress(relative);
  }
  try {
    for (const relative of job.paths) {
      check();
      if (!relative) {
        const dir = await openDirectory(job.root, job.scopeRoot);
        try { for (const name of await entries(dir)) await add(dir, name, name); }
        finally { await dir.close(); }
      } else {
        const filename = path.join(job.root, relative), parent = await parentOf(filename, job.scopeRoot);
        try { await add(parent, path.basename(filename), relative.split(path.sep).join('/')); }
        finally { await parent.close(); }
      }
    }
    check(); archive.end(); await stream;
  } catch (error) { archive.outputStream.destroy(error); await stream.catch(() => {}); throw error; }
  finally { await output.close(); }
}

async function run(job) {
  if (job.operation === 'archive') return archiveFiles(job);
  const destination = job.operation === 'copy' ? await openDirectory(job.destination, job.destinationScope) : null;
  try {
    // Reject all selection collisions before starting any copy.
    if (destination) {
      const names = new Set();
      for (const relative of job.paths) {
        check(); const filename = path.join(job.root, relative), name = path.basename(filename);
        if (names.has(name)) throw Error(`Selected items have the same filename: ${name}`);
        names.add(name);
        try { await fs.lstat(path.join(fdPath(destination), name)); throw Error(`Destination already contains: ${name}`); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        const stat = await fs.lstat(filename);
        if (stat.isDirectory() && contains(canonicalPath(await fs.realpath(filename)), job.destination)) throw Error('Cannot copy a folder into itself');
      }
    }
    for (const relative of job.paths) {
      check(); const filename = path.join(job.root, relative), parent = await parentOf(filename, job.scopeRoot), name = path.basename(filename);
      try {
        if (!relative || filename === job.scopeRoot || filename === job.root) throw Error('The browsing root cannot be removed or copied');
        if (contains(filename, job.scratch)) throw Error('Cannot change a folder containing active file operations');
        if (destination) {
          const target = path.join(fdPath(destination), name);
          // The source is copied to a newly reserved name only. Cleanup on a
          // failed/cancelled copy never removes a pre-existing destination.
          try { await fs.lstat(target); throw Error(`Destination already contains: ${name}`); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          let owned;
          try { await copyNode(parent, name, destination, relative, job.scopeRoot, job.destinationScope, stat => { owned = stat; }); }
          catch (error) {
            await discardCopy(destination, name, owned, job.destinationScope).catch(() => {});
            throw error;
          }
        }
        else await removeNode(parent, name, relative, job.scopeRoot);
      } finally { await parent.close(); }
    }
  } finally { await destination?.close(); }
}
process.once('message', async job => {
  let result;
  try { await run(job); progress(current, false, true); result = { type: 'result', status: 'done' }; }
  catch (error) {
    const cancelled = abort.signal.aborted;
    result = { type: 'result', status: cancelled ? 'cancelled' : 'failed', error: cancelled ? 'Cancelled. Already completed changes remain.' : String(error.message).slice(0, 1000) };
    await fs.rm(path.dirname(job.output), { recursive: true, force: true }).catch(() => {});
  }
  if (process.connected) process.send(result, () => process.disconnect());
});
