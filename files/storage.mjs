// Missing WOPI host responsibilities only. Collabora owns editing, save timing,
// locks and restore coordination; this owner stores complete native saves.
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream, constants } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

const failure = (status, message, code) => Object.assign(Error(message), { status, code });
const inside = (root, name) => name === root || name.startsWith(root + path.sep);
const uuid = value => /^[a-f0-9-]{36}$/.test(value || '');
const officeFormats = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']);
const lightSettings = value => ({ ...value, darkTheme: 'false', darkBackgroundForTheme: { ...value?.darkBackgroundForTheme, light: 'false', dark: 'false' } });
const timestamp = stat => new Date(Number(stat.mtimeMs)).toISOString().replace(/(\.\d{3})Z$/, '$1000Z');
const fingerprint = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs].join(':');
async function json(filename, fallback) { try { return JSON.parse(await fs.readFile(filename, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
async function syncDir(dir) { const fd = await fs.open(dir, 'r'); try { await fd.sync(); } finally { await fd.close(); } }
async function writeJSON(filename, value) { const temporary = filename + '.' + randomUUID(); const fd = await fs.open(temporary, 'wx', 0o600); try { await fd.writeFile(JSON.stringify(value) + '\n'); await fd.sync(); } finally { await fd.close(); } await fs.rename(temporary, filename); await syncDir(path.dirname(filename)); }
async function digestFile(filename) { const hash = createHash('sha256'); for await (const chunk of createReadStream(filename)) hash.update(chunk); return hash.digest('hex'); }
function validName(name) { if (typeof name !== 'string' || !name || name !== path.basename(name) || /[\x00-\x1f/\\]/.test(name) || name === '.' || name === '..' || Buffer.byteLength(name) > 240) throw failure(400, 'A plain file name is required'); return name; }

export function createDocumentOwner({ dataRoot, environmentId, authorizeOperation, authorizePath, maxVersions = 50, snapshotIntervalMs = 300000 }) {
  if (!path.isAbsolute(dataRoot) || !environmentId || typeof authorizeOperation !== 'function' || typeof authorizePath !== 'function') throw Error('An existing backend authority and private data root are required');
  const root = path.join(dataRoot, 'office-sessions');
  const queue = new Map();
  const restoring = new Set();
  const serialized = (key, action) => { const previous = queue.get(key) || Promise.resolve(); const next = previous.catch(() => {}).then(action); queue.set(key, next); return next.finally(() => { if (queue.get(key) === next) queue.delete(key); }); };
  const directory = id => { if (!uuid(id)) throw failure(400, 'Invalid document identity'); return path.join(root, 'documents', id); };
  const manifestFile = id => path.join(directory(id), 'manifest.json');
  const load = async id => { const entry = await json(manifestFile(id), null); if (!entry || entry.environmentId !== environmentId) throw failure(404, 'Document is unavailable'); return entry; };
  async function permitted(scope, filename, { create = false } = {}) {
    const scopeRoot = await fs.realpath(scope.root);
    const canonical = create ? path.join(await fs.realpath(path.dirname(filename)), path.basename(filename)) : await fs.realpath(filename);
    if (!inside(scopeRoot, canonical)) throw failure(403, 'Document is outside this project');
    await authorizePath(canonical);
    if (inside(await fs.realpath(dataRoot), canonical)) throw failure(403, 'Private application state is not a document source');
    if (!create) { const st = await fs.lstat(canonical); if (!st.isFile() || st.nlink !== 1) throw failure(403, 'Document must be a regular file without hard-link aliases'); }
    return canonical;
  }
  async function saveManifest(m) { await writeJSON(manifestFile(m.id), m); }
  async function retain(m, source, reason, { force = false, digest } = {}) {
    const now = Date.now(); digest ||= await digestFile(source);
    if (m.versions.at(-1)?.sha256 === digest) return;
    if (!force && now - (m.lastSnapshot || 0) < snapshotIntervalMs) return;
    const id = randomUUID(); const filename = path.join(directory(m.id), 'versions', id + path.extname(m.path));
    await fs.copyFile(source, filename, constants.COPYFILE_EXCL); await fs.chmod(filename, 0o400);
    const fd = await fs.open(filename, 'r'); try { await fd.sync(); } finally { await fd.close(); }
    m.versions.push({ id, name: path.basename(filename), savedAt: new Date(now).toISOString(), sourceVersion: m.version, sha256: digest, reason }); m.lastSnapshot = now;
    const removed = m.versions.splice(0, Math.max(0, m.versions.length - Math.max(1, maxVersions)));
    await saveManifest(m); // Make retained set durable before removing pruned files.
    for (const entry of removed) await fs.unlink(path.join(directory(m.id), 'versions', entry.name)).catch(() => {});
  }
  async function register({ grantId, documentId, relativePath, create, participantId, participantName, restoreCoordinator = false }) {
    return authorizeOperation(grantId, create ? 'create' : 'view', async (scope, signal) => serialized('registry', async () => {
      if (scope.permissions?.[create ? 'create' : 'view'] !== true) throw failure(403, 'This operation is no longer allowed');
      if (typeof participantId !== 'string' || !participantId || typeof participantName !== 'string') throw failure(400, 'An authenticated participant is required');
      await fs.mkdir(path.join(root, 'documents'), { recursive: true, mode: 0o700 });
      let filename;
      if (create) {
        const format = String(create.format || '').toLowerCase(); if (!officeFormats.has(format)) throw failure(415, 'Unsupported Office format');
        const name = validName(create.name); if (path.extname(name).slice(1).toLowerCase() !== format) throw failure(400, 'File name and format differ');
        filename = await permitted(scope, path.join(scope.root, name), { create: true });
        signal?.throwIfAborted(); const file = await fs.open(filename, 'wx', 0o600); await file.close(); await syncDir(path.dirname(filename));
      } else {
        if (documentId) { const known = await load(documentId); relativePath = path.relative(scope.root, known.path); }
        if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) throw failure(400, 'A relative source path is required');
        filename = await permitted(scope, path.resolve(scope.root, relativePath));
      }
      const registryFile = path.join(root, 'documents.json'); const registry = await json(registryFile, { environmentId, paths: {} });
      let m; const existing = registry.paths[filename];
      if (existing) { if (restoring.has(existing) && !restoreCoordinator) throw failure(409, 'This document is being restored; reopen it after restoration'); m = await load(existing); }
      else {
        const id = randomUUID(); const stat = await fs.stat(filename, { bigint: true });
        m = { id, environmentId, path: filename, generation: 1, version: '1', fingerprint: fingerprint(stat), lastWrite: null, versions: [], grants: {} };
        await fs.mkdir(path.join(directory(id), 'versions'), { recursive: true, mode: 0o700 }); await saveManifest(m); await retain(m, filename, 'initial', { force: true }); registry.paths[filename] = id; await writeJSON(registryFile, registry);
      }
      // Use the same document transaction as native saves; adding another
      // project grant must not replace a newer save manifest.
      return serialized(m.id, async () => {
        m = await load(m.id);
        m.grants[grantId] = { projectId: scope.id, participants: { ...m.grants[grantId]?.participants, [participantId]: participantName } };
        await saveManifest(m); return { documentId: m.id, grantId, participantId };
      });
    }));
  }
  function authorize(claims, operation, action) {
    if (claims.env !== environmentId) throw failure(401, 'Wrong owning environment');
    const id = String(claims.fid || '').split('~')[0];
    return authorizeOperation(claims.grant, operation, async (scope, signal) => {
      const required = { view: 'view', modify: 'modify', create: 'create', delete: 'delete' }[operation];
      if (!required || scope.permissions?.[required] !== true) throw failure(403, 'This operation is no longer allowed');
      const m = await load(id); const binding = m.grants[claims.grant];
      if (!binding || binding.projectId !== scope.id || !binding.participants[claims.participant]) throw failure(403, 'Document grant was revoked');
      await permitted(scope, m.path); signal?.throwIfAborted();
      if (!claims.snapshot && claims.generation && claims.generation !== m.generation) throw failure(409, 'Document was restored; reopen it', 'STALE_GENERATION');
      return action(m, scope, signal, binding.participants[claims.participant]);
    });
  }
  async function selectedFile(m, claims) {
    if (!claims.snapshot) return m.path;
    const entry = m.versions.find(v => v.id === claims.snapshot); if (!entry) throw failure(404, 'Version is unavailable');
    return path.join(directory(m.id), 'versions', entry.name);
  }
  async function metadata(claims) { return authorize(claims, 'view', async (m, scope, _signal, participantName) => {
    const stat = await fs.stat(await selectedFile(m, claims), { bigint: true }); const p = scope.permissions || {};
    return { documentId: m.id, name: path.basename(m.path), size: Number(stat.size), version: claims.snapshot || `${m.version}:${fingerprint(stat)}`, lastModified: timestamp(stat), lastWrite: m.lastWrite, generation: claims.snapshot ? 1 : m.generation, participantId: claims.participant, participantName,
      permissions: { write: !claims.snapshot && p.modify === true, copy: p.download === true, print: p.download === true, export: p.download === true, create: !claims.snapshot && p.create === true, rename: !claims.snapshot && p.modify === true, extensions: !claims.snapshot && p.modify === true && p.download === true } };
  }); }
  async function read(claims, response) { return authorize(claims, 'view', async (m, scope, signal) => {
    const filename = await selectedFile(m, claims); const fd = await fs.open(filename, 'r');
    try { const opened = `/proc/self/fd/${fd.fd}`; if (claims.snapshot) { if (await fs.realpath(opened) !== filename) throw failure(409, 'Snapshot changed while opening'); } else await permitted(scope, opened); const stat = await fd.stat(); response.setHeader('Content-Length', stat.size); response.setHeader('Content-Type', 'application/octet-stream'); await pipeline(fd.createReadStream({ autoClose: false }), response, { signal }); } finally { await fd.close(); }
  }); }
  async function write(claims, request) {
    if (claims.snapshot) throw failure(403, 'A snapshot is immutable');
    return serialized(claims.fid, () => authorize(claims, 'modify', async (m, scope, signal) => {
      const original = await fs.stat(m.path, { bigint: true }); const seen = request.headers['x-cool-wopi-timestamp'];
      const staleVersion = seen && seen !== timestamp(original);
      await fs.mkdir(path.join(root, 'recovery'), { recursive: true, mode: 0o700 });
      const recovery = path.join(root, 'recovery', `${m.id}-${randomUUID()}`); const hash = createHash('sha256'); let bytes = 0;
      const checksum = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; hash.update(chunk); callback(null, chunk); } });
      await pipeline(request, checksum, createWriteStream(recovery, { flags: 'wx', mode: 0o600 }), { signal });
      const expected = request.headers['content-length']; if (expected !== undefined && BigInt(expected) !== BigInt(bytes)) throw failure(400, 'Incomplete native save retained for recovery');
      const digest = hash.digest('hex'); const fd = await fs.open(recovery, 'r'); try { await fd.sync(); } finally { await fd.close(); }
      const receipt = recovery + '.json'; await writeJSON(receipt, { documentId: m.id, generation: m.generation, sha256: digest, bytes, phase: 'received', receivedAt: new Date().toISOString() });
      // Revalidate after receiving the entire stream. Revocation drains this same
      // owner operation; a revoked/aborted request retains its recovery file.
      await permitted(scope, m.path); const current = await fs.stat(m.path, { bigint: true });
      const reconciledRetry = digest === m.lastDigest && fingerprint(current) === m.fingerprint;
      if ((staleVersion || fingerprint(original) !== fingerprint(current)) && !reconciledRetry) throw failure(409, 'Document changed during native save', 'STORAGE_CHANGED');
      signal?.throwIfAborted();
      if (!reconciledRetry) {
        const staged = path.join(path.dirname(m.path), `.bashkitten-save-${randomUUID()}`);
        try { await fs.copyFile(recovery, staged, constants.COPYFILE_EXCL); await fs.chmod(staged, Number(original.mode & 0o777n)); const out = await fs.open(staged, 'r'); try { await out.sync(); } finally { await out.close(); }
          await permitted(scope, m.path); signal?.throwIfAborted(); await fs.rename(staged, m.path); await syncDir(path.dirname(m.path));
        } finally { await fs.unlink(staged).catch(() => {}); }
        m.version = String(BigInt(m.version) + 1n); m.lastDigest = digest; m.lastWrite = new Date().toISOString(); m.fingerprint = fingerprint(await fs.stat(m.path, { bigint: true })); await saveManifest(m);
      }
      await retain(m, recovery, request.headers['x-cool-wopi-isexitsave'] === 'true' ? 'final' : 'native-save', { force: request.headers['x-cool-wopi-isexitsave'] === 'true', digest });
      await fs.unlink(recovery); await fs.unlink(receipt);
      const stat = await fs.stat(m.path, { bigint: true }); return { LastModifiedTime: timestamp(stat), version: `${m.version}:${fingerprint(stat)}` };
    }));
  }
  function wopiName(value) {
    // MS-WOPI encodes file-name headers using modified UTF-7, not URL decoding.
    return String(value || '').replace(/\+([A-Za-z0-9+,/]*)-/g, (_all, encoded) => {
      if (!encoded) return '+';
      const bytes = Buffer.from(encoded.replace(/,/g, '/'), 'base64'); if (bytes.length % 2) throw failure(400, 'Invalid WOPI file name');
      for (let i = 0; i < bytes.length; i += 2) { const first = bytes[i]; bytes[i] = bytes[i + 1]; bytes[i + 1] = first; }
      return bytes.toString('utf16le');
    });
  }
  async function rename(claims, request) {
    return serialized('registry', () => serialized(claims.fid, () => authorize(claims, 'modify', async (m, scope, signal) => {
      const base = validName(wopiName(request.headers['x-wopi-requestedname'])); const name = base + path.extname(m.path);
      const target = await permitted(scope, path.join(path.dirname(m.path), name), { create: true });
      if (target === m.path) return { Name: base };
      signal?.throwIfAborted(); await fs.link(m.path, target); // atomic no-replace, same directory/filesystem
      try { signal?.throwIfAborted(); await fs.unlink(m.path); } catch (error) { await fs.unlink(target).catch(() => {}); throw error; }
      const old = m.path; m.path = target; await saveManifest(m);
      const registryFile = path.join(root, 'documents.json'); const registry = await json(registryFile, { environmentId, paths: {} }); delete registry.paths[old]; registry.paths[target] = m.id; await writeJSON(registryFile, registry); await syncDir(path.dirname(target)); return { Name: base };
    })));
  }
  async function relative(claims, request) {
    return serialized('registry', () => authorize(claims, 'create', async (m, scope, signal, participantName) => {
      const suggested = request.headers['x-wopi-suggestedtarget']; const requested = request.headers['x-wopi-relativetarget'];
      if ((!suggested && !requested) || (suggested && requested)) throw failure(400, 'One native Save As target is required');
      let name = wopiName(suggested || requested); if (name.startsWith('.')) name = path.basename(m.path, path.extname(m.path)) + name;
      name = validName(name); const extension = path.extname(name); if (!officeFormats.has(extension.slice(1).toLowerCase()) && extension.toLowerCase() !== '.pdf') throw failure(415, 'Unsupported native Save As format');
      let target = await permitted(scope, path.join(path.dirname(m.path), name), { create: true });
      await fs.mkdir(path.join(root, 'recovery'), { recursive: true, mode: 0o700 });
      const recovery = path.join(root, 'recovery', `save-as-${randomUUID()}`);
      await pipeline(request, createWriteStream(recovery, { flags: 'wx', mode: 0o600 }), { signal });
      const incoming = await fs.open(recovery, 'r'); try { await incoming.sync(); } finally { await incoming.close(); }
      const received = await fs.stat(recovery);
      if (request.headers['content-length'] !== undefined && BigInt(request.headers['content-length']) !== BigInt(received.size)) throw failure(400, 'Incomplete native Save As retained for recovery');
      const staging = path.join(path.dirname(m.path), `.bashkitten-save-${randomUUID()}`);
      let published = false;
      try {
        await fs.copyFile(recovery, staging, constants.COPYFILE_EXCL); const file = await fs.open(staging, 'r'); try { await file.sync(); } finally { await file.close(); }
        for (let index = 0; index < 1000; index++) {
          await permitted(scope, target, { create: true }); signal?.throwIfAborted();
          try { await fs.link(staging, target); published = true; break; }
          catch (error) { if (error.code !== 'EEXIST' || !suggested) throw failure(error.code === 'EEXIST' ? 409 : 500, 'Save As target is unavailable'); name = path.basename(name, extension).replace(/ \(\d+\)$/, '') + ` (${index + 1})` + extension; target = path.join(path.dirname(m.path), name); }
        }
        if (!published) throw failure(409, 'No unused Save As name is available');
      } finally { await fs.unlink(staging).catch(() => {}); }
      await permitted(scope, target); signal?.throwIfAborted();
      const id = randomUUID(); const stat = await fs.stat(target, { bigint: true });
      const created = { id, environmentId, path: target, generation: 1, version: '1', fingerprint: fingerprint(stat), lastWrite: new Date().toISOString(), versions: [], grants: { [claims.grant]: { projectId: scope.id, participants: { [claims.participant]: participantName } } } };
      await fs.mkdir(path.join(directory(id), 'versions'), { recursive: true, mode: 0o700 }); await saveManifest(created); await retain(created, target, 'initial', { force: true });
      const registryFile = path.join(root, 'documents.json'); const registry = await json(registryFile, { environmentId, paths: {} }); registry.paths[target] = id; await writeJSON(registryFile, registry); await syncDir(path.dirname(target));
      await fs.unlink(recovery); return { Name: name, documentId: id, generation: 1 };
    }));
  }
  async function finalize(claims) { return serialized(claims.fid, () => authorize(claims, 'view', async m => { if (!claims.snapshot) await retain(m, m.path, 'final', { force: true }); return { finalized: true }; })); }
  async function list(claims) { return authorize(claims, 'view', m => ({ documentId: m.id, generation: m.generation, versions: [...m.versions].reverse() })); }
  // Caller must first obtain the real native Pre_Restore_Ack and close all views,
  // including Pi. There is no boolean/browser assertion that bypasses this step.
  async function restore(claims, versionId, coordinateNativeRestore) {
    if (claims.snapshot) throw failure(403, 'A snapshot view is immutable');
    if (typeof coordinateNativeRestore !== 'function') throw failure(409, 'Native restore coordination is required');
    if (restoring.has(claims.fid)) throw failure(409, 'This document is already being restored');
    restoring.add(claims.fid);
    try {
    await authorize(claims, 'modify', async m => { if (!m.versions.some(v => v.id === versionId)) throw failure(404, 'Version unavailable'); });
    await coordinateNativeRestore(claims.fid);
    return await serialized(claims.fid, () => authorize(claims, 'modify', async (m, scope, signal) => {
      const old = m.versions.find(v => v.id === versionId); if (!old) throw failure(404, 'Version unavailable');
      const source = path.join(directory(m.id), 'versions', old.name); const target = path.join(path.dirname(m.path), `.bashkitten-restore-${randomUUID()}`);
      try { await fs.copyFile(source, target, constants.COPYFILE_EXCL); await retain(m, m.path, 'pre-restore', { force: true }); const original = await fs.stat(m.path); await fs.chmod(target, original.mode & 0o777); const fd = await fs.open(target, 'r'); try { await fd.sync(); } finally { await fd.close(); }
        await permitted(scope, m.path); signal?.throwIfAborted(); m.generation++; m.version = String(BigInt(m.version) + 1n); await saveManifest(m); // Invalidate old participants before replacement.
        await fs.rename(target, m.path); await syncDir(path.dirname(m.path)); m.lastDigest = old.sha256; m.lastWrite = new Date().toISOString(); m.fingerprint = fingerprint(await fs.stat(m.path, { bigint: true })); await saveManifest(m); await retain(m, m.path, 'restore', { force: true });
      } finally { await fs.unlink(target).catch(() => {}); }
      return { documentId: m.id, generation: m.generation, version: m.version };
    }));
    } finally { restoring.delete(claims.fid); }
  }
  async function snapshot(claims, versionId, { signal: callerSignal } = {}) {
    return authorize(claims, 'view', async (m, scope, signal) => {
      if (scope.permissions?.download !== true) throw failure(403, 'Snapshot comparison requires download permission');
      signal?.throwIfAborted(); callerSignal?.throwIfAborted();
      const version = m.versions.find(entry => entry.id === versionId); if (!version) throw failure(404, 'Version unavailable');
      const filename = path.join(directory(m.id), 'versions', version.name);
      const stat = await fs.lstat(filename); if (!stat.isFile() || stat.nlink !== 1) throw failure(409, 'Immutable snapshot is unavailable');
      return { documentId: m.id, versionId, format: path.extname(m.path).slice(1).toLowerCase(), path: filename, sha256: version.sha256 };
    });
  }
  async function settings(claims, update) { return authorize(claims, 'view', async (_m, _scope, signal) => {
    const key = createHash('sha256').update(claims.participant).digest('hex'); const dir = path.join(root, 'settings'); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    return serialized('settings:' + key, async () => { const filename = path.join(dir, key + '.json'); const current = await json(filename, {}); const next = lightSettings({ ...current, ...update }); if (update) { signal?.throwIfAborted(); await writeJSON(filename, next); } return next; });
  }); }
  return { register, metadata, read, write, rename, relative, finalize, list, restore, snapshot, settings, isRestoring: documentId => restoring.has(documentId) };
}
