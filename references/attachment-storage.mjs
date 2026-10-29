// SPDX-License-Identifier: AGPL-3.0-or-later
// The existing References SQLite receipts/transition owner coordinates moves.
// Complete copies precede the single root/path commit; originals survive until
// that commit and remain recoverable after an interrupted cleanup.
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { agentPackageRoot } from './host-paths.mjs';
import { truncateFilename, validFilename } from './attachment-names.mjs';
const { publishNewFile } = await import(new URL('src/server/localai/files.mjs', agentPackageRoot));
const fail = (message, status = 409) => { throw Object.assign(Error(message), { status }); };
const inside = (root, file) => file.startsWith(root + path.sep);
const stat = file => fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
const identity = value => ({ dev: value.dev, ino: value.ino, size: value.size, mtimeMs: value.mtimeMs });
const same = (value, expected) => value?.isFile() && !value.isSymbolicLink() && value.dev === expected?.dev && value.ino === expected?.ino;
const tick = () => new Promise(resolve => setImmediate(resolve));
async function digest(file, signal) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash, { signal });
  return hash.digest('hex');
}
async function authorize(p, file, options = {}) { if (p.authorizePath) await p.authorizePath(file, options); }
async function directory(p, folder) {
  await authorize(p, folder, { write: true, create: true });
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const value = await fs.lstat(folder);
  if (!value.isDirectory() || value.isSymbolicLink()) fail('Bibliography folder must be a normal directory');
  const canonical = await fs.realpath(folder);
  await authorize(p, canonical, { write: true });
  return canonical;
}
async function subdirectory(p, root, relative) {
  const target = path.resolve(root, relative || '.');
  if (target !== root && !inside(root, target)) fail('Attachment folder leaves its Bibliography');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    await fs.mkdir(current, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const value = await fs.lstat(current);
    if (!value.isDirectory() || value.isSymbolicLink()) fail('Attachment folder is not a normal directory');
  }
  await authorize(p, current, { write: true });
  return current;
}
function filename(base, extension, sequence, folder) {
  const budget = Math.min(255, 4095 - Buffer.byteLength(folder, 'utf8') - 1);
  if (budget < Buffer.byteLength(extension, 'utf8') + 8) fail('Bibliography path is too long for an attachment filename');
  const suffix = sequence > 1 ? '-' + sequence : '';
  const stem = truncateFilename(validFilename(base || 'attachment'), budget - Buffer.byteLength(suffix + extension, 'utf8'));
  return stem + suffix + extension;
}
async function removeOwned(file, expected, sha256) {
  const value = await stat(file);
  if (!value) return true;
  if (!same(value, expected) || (sha256 && await digest(file) !== sha256)) return false;
  await fs.unlink(file);
  return true;
}
async function pruneEmpty(folder, root) {
  for (let current = folder; current !== root && inside(root, current); current = path.dirname(current)) {
    try { await fs.rmdir(current); }
    catch (error) { if (['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) break; throw error; }
  }
}

export function createAttachmentStorage({ call, fileBaseName }) {
  if (typeof call !== 'function') throw Error('Attachment storage needs the existing References storage owner');
  async function currentProject(p, signal) {
    const config = await call(p, 'bibliographySettings', {
      initialPath: p.initialBibliographyPath || p.bibliographyPath || path.join(p.cwd, 'Bibliography'),
      legacyCwd: p.legacyCwd || p.cwd,
    }, signal);
    return { ...p, bibliographyPath: config.path, legacyCwd: config.legacyCwd, bibliographyMove: config.move };
  }
  async function attachmentPath(p, item, signal) {
    p = await currentProject(p, signal);
    const data = item.data || item;
    if (data.itemType && data.itemType !== 'attachment') fail('Item is not a file attachment', 404);
    const root = data.pathBase === 'bibliography' ? p.bibliographyPath : path.join(p.legacyCwd, 'Bibliography');
    const candidate = path.resolve(data.pathBase === 'bibliography' ? root : p.legacyCwd, data.path || '');
    const namespace = createHash('sha256').update(p.id).digest('hex').slice(0, 24);
    if (!inside(path.join(path.resolve(root), namespace), candidate)) fail('Attachment is outside this References project', 403);
    await authorize(p, candidate, { write: false });
    const canonicalRoot = await fs.realpath(root), file = await fs.realpath(candidate);
    if (!inside(path.join(canonicalRoot, namespace), file) || !(await fs.stat(file)).isFile()) fail('Attachment is outside this References project', 403);
    await authorize(p, file, { write: false });
    return file;
  }
  async function createFile(p, { parentKey, attachmentKey, baseName, extension = '', body, signal }) {
    p = await currentProject(p, signal);
    if (p.bibliographyMove) fail('Finish the Bibliography folder move before saving attachments');
    if (!/^[A-Z0-9]+$/.test(parentKey || attachmentKey || '')) fail('Attachment needs its stable item identity', 400);
    const root = await directory(p, p.bibliographyPath);
    const namespace = createHash('sha256').update(p.id).digest('hex').slice(0, 24);
    const folder = await subdirectory(p, root, path.join(namespace, parentKey || attachmentKey));
    const temporary = path.join(folder, '.attachment-' + randomUUID() + '.partial');
    let created;
    try {
      if (body?.tempPath) await pipeline(createReadStream(body.tempPath), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal });
      else { signal?.throwIfAborted(); await fs.writeFile(temporary, body, { flag: 'wx', mode: 0o600 }); }
      const source = await fs.stat(temporary);
      for (let sequence = 1; ; sequence++) {
        signal?.throwIfAborted();
        const name = filename(baseName, extension, sequence, folder), destination = path.join(folder, name);
        if (await stat(destination)) { if (sequence % 100 === 0) await tick(); continue; }
        try { await publishNewFile(temporary, destination); }
        catch (error) { if (await stat(destination)) continue; throw error; }
        const published = await fs.stat(destination);
        if (!same(published, identity(source))) fail('Attachment publication identity changed');
        created = { destination, filename: name, path: path.relative(root, destination), pathBase: 'bibliography', identity: identity(published) };
        break;
      }
      return created;
    } finally { await fs.rm(temporary, { force: true }); }
  }
  async function discardFile(file) { return removeOwned(file.destination, file.identity); }
  async function* plans(p, id, signal) {
    let cursor;
    do {
      const page = await call(p, 'recordPage', { prefix: 'bibliography-move:' + id + ':file:', cursor, limit: 100 }, signal);
      for (const value of page.items) yield value;
      cursor = page.next;
      await tick();
    } while (cursor);
  }
  async function moveBibliography(p, { bibliographyPath, expectedBibliographyPath, signal, onProgress = () => {}, officeCommit }) {
    p = await currentProject(p, signal);
    if (!path.isAbsolute(bibliographyPath || '')) fail('Choose an absolute Bibliography folder', 400);
    const requested = path.resolve(bibliographyPath), existingMove = p.bibliographyMove;
    if (existingMove && existingMove.target !== requested) fail('Finish the pending Bibliography move before choosing another folder');
    if (!existingMove && p.bibliographyPath !== expectedBibliographyPath) fail('Bibliography folder changed; reload before moving');
    if (!existingMove && requested === p.bibliographyPath) return { bibliographyPath: p.bibliographyPath, moved: 0, unchanged: true };
    if (p.withAttachmentMove) {
      const paths = (async function* () {
        if (existingMove?.phase === 'cleanup') {
          for await (const entry of plans(p, existingMove.id, signal)) {
            yield entry.sourcePath;
            yield path.resolve(existingMove.target, entry.newPath);
          }
          return;
        }
        let after = '';
        for (;;) {
          const rows = await call(p, 'attachmentPaths', { after, limit: 100 }, signal);
          for (const row of rows) yield await attachmentPath(p, row, signal);
          if (rows.length < 100) return;
          after = rows.at(-1).key;
          await tick();
        }
      })();
      const namespace = createHash('sha256').update(p.id).digest('hex').slice(0, 24);
      const sourceRoots = [...new Set([p.bibliographyPath, path.join(p.legacyCwd, 'Bibliography'), existingMove?.source].filter(Boolean).map(root => path.join(root, namespace)))];
      return p.withAttachmentMove({ paths, sourceRoots, targetRoot: path.join(requested, namespace), signal }, ({ commit }) => moveBibliography({ ...p, withAttachmentMove: undefined }, {
        bibliographyPath, expectedBibliographyPath, signal, onProgress, officeCommit: commit,
      }));
    }
    const target = await directory(p, requested), id = existingMove?.id || randomUUID();
    if (existingMove && target !== existingMove.target) fail('Pending Bibliography target changed');
    const source = existingMove?.source || p.bibliographyPath;
    const settings = await call(p, 'beginBibliographyMove', { id, source, target }, signal);
    let committed = settings.move.phase === 'cleanup', total = settings.move.total || 0;
    const record = (entry, activeSignal = signal) => call(p, 'record', { id: 'bibliography-move:' + id + ':file:' + entry.key, data: entry }, activeSignal);
    try {
      if (!committed) {
        let after = '';
        total = 0;
        for (;;) {
          signal?.throwIfAborted();
          const rows = await call(p, 'attachmentPaths', { after, limit: 100 }, signal);
          for (const row of rows) {
            signal?.throwIfAborted(); total++;
            let entry = await call(p, 'record', { id: 'bibliography-move:' + id + ':file:' + row.key }, signal);
            if (entry?.status === 'published') {
              const file = path.resolve(target, entry.newPath);
              if (!inside(target, file) || !same(await stat(file), entry.identity) || await digest(file, signal) !== entry.sha256) fail('A copied attachment changed; original files were preserved');
              onProgress({ completed: total, phase: 'copying' });
              continue;
            }
            if (!entry) {
              const original = await attachmentPath(p, row, signal), before = await fs.stat(original);
              const sourceRoot = row.pathBase === 'bibliography' ? source : path.join(p.legacyCwd, 'Bibliography');
              const sourceCanonical = await fs.realpath(sourceRoot), relative = path.relative(sourceCanonical, original);
              if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) fail('Attachment path leaves its Bibliography');
              const folder = await subdirectory(p, target, path.dirname(relative));
              const temporary = path.join(folder, '.bibliography-move-' + id + '-' + randomUUID() + '.partial');
              try {
                await pipeline(createReadStream(original), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal });
                const afterCopy = await fs.stat(original), copied = await fs.stat(temporary), hash = await digest(temporary, signal);
                if (before.dev !== afterCopy.dev || before.ino !== afterCopy.ino || before.size !== afterCopy.size || before.mtimeMs !== afterCopy.mtimeMs || before.size !== copied.size) fail('An attachment changed while copying; original files were preserved');
                let originalFilename = row.filename || path.basename(original);
                if (fileBaseName) {
                  const item = await call(p, 'get', { key: row.key }, signal);
                  originalFilename = validFilename(await fileBaseName(p, item, signal)) + path.extname(originalFilename);
                }
                entry = { key: row.key, version: row.version, oldPath: row.path, oldPathBase: row.pathBase || null, sourcePath: original, sourceRoot: sourceCanonical, sourceIdentity: identity(before), temporary, identity: identity(copied), sha256: hash, byteLength: copied.size, relativeDirectory: path.dirname(relative), originalFilename, status: 'prepared' };
                await record(entry);
              } catch (error) { await fs.rm(temporary, { force: true }); throw error; }
            }
            const folder = await subdirectory(p, target, entry.relativeDirectory);
            const ext = path.extname(entry.originalFilename), base = path.basename(entry.originalFilename, ext);
            for (let sequence = entry.sequence || 1; ; sequence++) {
              signal?.throwIfAborted();
              const name = filename(base, ext, sequence, folder), destination = path.join(folder, name), found = await stat(destination);
              if (found && !same(found, entry.identity)) continue;
              entry = { ...entry, sequence, filename: name, newPath: path.relative(target, destination) };
              await record(entry);
              if (!found) {
                if (!same(await stat(entry.temporary), entry.identity)) fail('A staged attachment is unavailable; original files were preserved');
                try { await publishNewFile(entry.temporary, destination); }
                catch (error) { if (await stat(destination)) continue; throw error; }
              }
              if (await digest(destination, signal) !== entry.sha256) fail('Copied attachment verification failed; original files were preserved');
              entry.status = 'published';
              await record(entry);
              await fs.rm(entry.temporary, { force: true });
              break;
            }
            onProgress({ completed: total, phase: 'copying' });
          }
          if (rows.length < 100) break;
          after = rows.at(-1).key;
          await tick();
        }
        signal?.throwIfAborted();
        await call(p, 'commitBibliographyMove', { id, total }, signal);
        committed = true;
      }
      if (officeCommit) {
        const moves = (async function* () {
          for await (const entry of plans(p, id, signal)) yield { from: entry.sourcePath, to: path.resolve(target, entry.newPath) };
        })();
        await officeCommit({ moves });
      }
      let cleaned = 0;
      for await (const entry of plans(p, id, signal)) {
        signal?.throwIfAborted();
        const destination = path.resolve(target, entry.newPath);
        if (!inside(target, destination) || await digest(destination, signal) !== entry.sha256) fail('The new attachment copy is unavailable; the old file was retained');
        await authorize(p, entry.sourcePath, { write: true });
        if (!await removeOwned(entry.sourcePath, entry.sourceIdentity, entry.sha256)) fail('An original attachment changed after copying; both copies were retained');
        await fs.rm(entry.temporary, { force: true });
        await pruneEmpty(path.dirname(entry.sourcePath), entry.sourceRoot);
        cleaned++; onProgress({ completed: cleaned, total, phase: 'cleaning' });
      }
      await call(p, 'finishBibliographyMove', { id }, signal);
      return { bibliographyPath: target, moved: total, cleanupPending: false };
    } catch (error) {
      // A cancelled worker request may have committed before its reply. Read the
      // single DB authority without the cancelled signal before considering undo.
      const latest = await currentProject(p).catch(() => null);
      committed ||= latest?.bibliographyMove?.id === id && latest.bibliographyMove.phase === 'cleanup';
      if (!committed) {
        for await (const entry of plans(p, id)) {
          if (entry.newPath) await removeOwned(path.resolve(target, entry.newPath), entry.identity, entry.sha256).catch(() => false);
          if (entry.temporary) await removeOwned(entry.temporary, entry.identity, entry.sha256).catch(() => false);
        }
        await call(p, 'abortBibliographyMove', { id });
        throw error;
      }
      return { bibliographyPath: target, moved: total, cleanupPending: true, warning: error.message };
    }
  }
  return { currentProject, attachmentPath, createFile, discardFile, moveBibliography };
}
