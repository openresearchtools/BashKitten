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
  const reservations = new Set();
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
  function availablePath(filename, coordinator = false) {
    if (!coordinator && [...reservations].some(paths => paths.some(root => inside(root, filename)))) throw failure(409, 'A native file operation is in progress; reopen after it completes');
  }
  async function historicalPath(scope, filename) {
    const scopeRoot = await fs.realpath(scope.root);
    let parent = path.resolve(filename); const missing = [];
    for (;;) { try { parent = await fs.realpath(parent); break; } catch (error) { if (error.code !== 'ENOENT') throw error; const next = path.dirname(parent); if (next === parent) throw error; missing.unshift(path.basename(parent)); parent = next; } }
    const canonical = path.join(parent, ...missing);
    if (!inside(scopeRoot, canonical) || inside(await fs.realpath(dataRoot), canonical)) throw failure(403, 'Historical document is outside this source');
    await authorizePath(canonical); return canonical;
  }
  async function saveManifest(m) { await writeJSON(manifestFile(m.id), m); }
  async function retain(m, source, reason, { force = false, digest } = {}) {
    const now = Date.now(); digest ||= await digestFile(source);
    if (m.versions.at(-1)?.sha256 === digest) return;
    if (!force && now - (m.lastSnapshot || 0) < snapshotIntervalMs) return;
    const id = randomUUID(); const filename = path.join(directory(m.id), 'versions', id + path.extname(m.path));
    await fs.copyFile(source, filename, constants.COPYFILE_EXCL); await fs.chmod(filename, 0o400);
    const fd = await fs.open(filename, 'r'); try { await fd.sync(); } finally { await fd.close(); }
    await syncDir(path.dirname(filename));
    m.versions.push({ id, name: path.basename(filename), savedAt: new Date(now).toISOString(), sourceVersion: m.version, sha256: digest, reason }); m.lastSnapshot = now;
    const removed = m.versions.splice(0, Math.max(0, m.versions.length - (m.maxVersions ?? maxVersions)));
    await saveManifest(m); // Make retained set durable before removing pruned files.
    for (const entry of removed) await fs.unlink(path.join(directory(m.id), 'versions', entry.name)).catch(() => {});
  }
  async function register({ grantId, documentId, relativePath, create, participantId, participantName, restoreCoordinator = false, historyOnly = false, snapshot }) {
    return authorizeOperation(grantId, create ? 'create' : 'view', async (scope, signal) => serialized('registry', async () => {
      if (scope.permissions?.[create ? 'create' : 'view'] !== true) throw failure(403, 'This operation is no longer allowed');
      if (typeof participantId !== 'string' || !participantId || typeof participantName !== 'string') throw failure(400, 'An authenticated participant is required');
      await fs.mkdir(path.join(root, 'documents'), { recursive: true, mode: 0o700 });
      let filename, known;
      if (create) {
        const format = String(create.format || '').toLowerCase(); if (!officeFormats.has(format)) throw failure(415, 'Unsupported Office format');
        const name = validName(create.name); if (path.extname(name).slice(1).toLowerCase() !== format) throw failure(400, 'File name and format differ');
        filename = await permitted(scope, path.join(scope.root, name), { create: true });
        availablePath(filename, restoreCoordinator); signal?.throwIfAborted(); const file = await fs.open(filename, 'wx', 0o600); await file.close(); await syncDir(path.dirname(filename));
      } else {
        if (documentId) { known = await load(documentId); relativePath = path.relative(scope.root, known.path); if ((known.retired || known.recovery) && !historyOnly && !snapshot) throw failure(409, 'This live document identity was retired or needs recovery; its snapshots remain available'); }
        if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) throw failure(400, 'A relative source path is required');
        filename = historyOnly || snapshot ? await historicalPath(scope, path.resolve(scope.root, relativePath)) : await permitted(scope, path.resolve(scope.root, relativePath));
        availablePath(filename, restoreCoordinator);
      }
      const registryFile = path.join(root, 'documents.json'); const registry = await json(registryFile, { environmentId, paths: {} });
      if (!historyOnly && !snapshot && Object.values(registry.pending || {}).some(entry => entry.paths.some(root => inside(root, filename)))) throw failure(409, 'A previous native file operation requires recovery', 'NATIVE_FILES_UNCERTAIN');
      let m; const existing = registry.paths[filename];
      if (known && (historyOnly || snapshot)) m = known;
      else if (documentId && existing !== documentId) throw failure(409, 'The file now belongs to another document identity');
      else if (existing) { if (restoring.has(existing) && !restoreCoordinator) throw failure(409, 'This document is being restored; reopen it after restoration'); m = await load(existing); }
      else {
        const id = randomUUID(); const stat = await fs.stat(filename, { bigint: true });
        m = { id, environmentId, path: filename, generation: 1, version: '1', fingerprint: fingerprint(stat), lastWrite: null, versions: [], grants: {} };
        await fs.mkdir(path.join(directory(id), 'versions'), { recursive: true, mode: 0o700 }); await saveManifest(m);
        // Native Collabora initializes new files from an exclusive empty
        // placeholder. Its first complete PutFile is the first valid version;
        // do not retain an unopenable placeholder or start the interval early.
        if (!create || stat.size > 0n) await retain(m, filename, 'initial', { force: true });
        registry.paths[filename] = id; await writeJSON(registryFile, registry);
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
      if (claims.snapshot || claims.historyOnly) await historicalPath(scope, m.path);
      else { if (m.retired || m.recovery) throw failure(409, 'This live document identity was retired or needs recovery'); await permitted(scope, m.path); }
      signal?.throwIfAborted();
      if (!claims.snapshot && !claims.historyOnly && claims.generation && claims.generation !== m.generation) throw failure(409, 'Document was restored; reopen it', 'STALE_GENERATION');
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
    const name = claims.snapshot ? path.basename(m.path, path.extname(m.path)) + path.extname(m.versions.find(version => version.id === claims.snapshot).name) : path.basename(m.path);
    return { documentId: m.id, name, size: Number(stat.size), version: claims.snapshot || `${m.version}:${fingerprint(stat)}`, lastModified: timestamp(stat), lastWrite: m.lastWrite, generation: claims.snapshot ? 1 : m.generation, participantId: claims.participant, participantName,
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
    return serialized('registry', async () => {
      await authorize(claims, 'modify', m => availablePath(m.path));
      return serialized(claims.fid, () => authorize(claims, 'modify', async (m, scope, signal) => {
      const base = validName(wopiName(request.headers['x-wopi-requestedname'])); const name = base + path.extname(m.path);
      const target = await permitted(scope, path.join(path.dirname(m.path), name), { create: true });
      availablePath(m.path); availablePath(target);
      if (target === m.path) return { Name: base };
      await fs.mkdir(path.join(root, 'recovery'), { recursive: true, mode: 0o700 });
      const receipt = path.join(root, 'recovery', 'rename-' + randomUUID() + '.json');
      await writeJSON(receipt, { operation: 'rename', documentId: m.id, generation: m.generation, original: m.path, target, phase: 'prepared' });
      signal?.throwIfAborted(); await fs.link(m.path, target); // atomic no-replace, same directory/filesystem
      try { signal?.throwIfAborted(); await fs.unlink(m.path); } catch (error) { await fs.unlink(target).catch(() => {}); throw error; }
      const old = m.path; m.path = target; await saveManifest(m);
      const registryFile = path.join(root, 'documents.json'); const registry = await json(registryFile, { environmentId, paths: {} }); delete registry.paths[old]; registry.paths[target] = m.id; await writeJSON(registryFile, registry); await syncDir(path.dirname(target)); await fs.unlink(receipt); return { Name: base };
    })); });
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
      const id = randomUUID(); const receipt = recovery + '.json';
      const record = { operation: 'save-as', documentId: id, sourceDocumentId: m.id, generation: m.generation, bytes: received.size, sha256: await digestFile(recovery), phase: 'received' };
      await writeJSON(receipt, { ...record, target });
      const staging = path.join(path.dirname(m.path), `.bashkitten-save-${randomUUID()}`);
      let published = false;
      try {
        await fs.copyFile(recovery, staging, constants.COPYFILE_EXCL); const file = await fs.open(staging, 'r'); try { await file.sync(); } finally { await file.close(); }
        for (let index = 0; index < 1000; index++) {
          await permitted(scope, target, { create: true }); availablePath(target); signal?.throwIfAborted();
          await writeJSON(receipt, { ...record, target });
          try { await fs.link(staging, target); published = true; break; }
          catch (error) { if (error.code !== 'EEXIST' || !suggested) throw failure(error.code === 'EEXIST' ? 409 : 500, 'Save As target is unavailable'); name = path.basename(name, extension).replace(/ \(\d+\)$/, '') + ` (${index + 1})` + extension; target = path.join(path.dirname(m.path), name); }
        }
        if (!published) throw failure(409, 'No unused Save As name is available');
      } finally { await fs.unlink(staging).catch(() => {}); }
      await permitted(scope, target); signal?.throwIfAborted();
      const stat = await fs.stat(target, { bigint: true });
      const created = { id, environmentId, path: target, generation: 1, version: '1', fingerprint: fingerprint(stat), lastWrite: new Date().toISOString(), versions: [], grants: { [claims.grant]: { projectId: scope.id, participants: { [claims.participant]: participantName } } } };
      await fs.mkdir(path.join(directory(id), 'versions'), { recursive: true, mode: 0o700 }); await saveManifest(created); await retain(created, target, 'initial', { force: true });
      const registryFile = path.join(root, 'documents.json'); const registry = await json(registryFile, { environmentId, paths: {} }); registry.paths[target] = id; await writeJSON(registryFile, registry); await syncDir(path.dirname(target));
      await fs.unlink(recovery); await fs.unlink(receipt); return { Name: name, documentId: id, generation: 1 };
    }));
  }
  async function finalize(claims) { return serialized(claims.fid, () => authorize(claims, 'view', async m => { if (!claims.snapshot) await retain(m, m.path, 'final', { force: true }); return { finalized: true }; })); }
  async function list(claims) { return authorize({ ...claims, historyOnly: true }, 'view', m => ({ documentId: m.id, generation: m.generation, maxVersions: m.maxVersions ?? maxVersions, versions: [...m.versions].reverse() })); }
  async function configureHistory(claims, count) {
    if (claims.snapshot) throw failure(403, 'A snapshot view is immutable');
    if (!Number.isSafeInteger(count) || count < 1 || count > 10000) throw failure(400, 'Retained version count must be an integer from 1 to 10000');
    return serialized(claims.fid, () => authorize(claims, 'modify', async (m, _scope, signal) => {
      signal?.throwIfAborted(); m.maxVersions = count;
      const removed = m.versions.splice(0, Math.max(0, m.versions.length - count));
      await saveManifest(m); // Same durable retained-set publication as a native save.
      for (const entry of removed) await fs.unlink(path.join(directory(m.id), 'versions', entry.name)).catch(() => {});
      return { documentId: m.id, generation: m.generation, maxVersions: count, versions: [...m.versions].reverse() };
    }));
  }
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
    return authorize({ ...claims, snapshot: versionId }, 'view', async (m, scope, signal) => {
      if (scope.permissions?.download !== true) throw failure(403, 'Snapshot comparison requires download permission');
      signal?.throwIfAborted(); callerSignal?.throwIfAborted();
      const version = m.versions.find(entry => entry.id === versionId); if (!version) throw failure(404, 'Version unavailable');
      const filename = path.join(directory(m.id), 'versions', version.name);
      const stat = await fs.lstat(filename); if (!stat.isFile() || stat.nlink !== 1) throw failure(409, 'Immutable snapshot is unavailable');
      return { documentId: m.id, versionId, format: path.extname(version.name).slice(1).toLowerCase(), path: filename, sha256: version.sha256 };
    });
  }
  // Quantum performs filesystem mutations. This transaction only reserves the
  // existing document owner, retains recovery snapshots and consumes exact
  // native completion receipts. It never infers moves from inode/hash scans.
  async function withNativeMove({ grantId, source, action, items, rename: autoRename }, perform, coordinate) {
    if (!['copy', 'move', 'rename'].includes(action) || !Array.isArray(items) || !items.length || typeof perform !== 'function') throw failure(400, 'Invalid native file operation');
    return authorizeOperation(grantId, action === 'copy' ? 'create' : 'modify', (scope, signal) => serialized('native-files', async () => {
      if (scope.permissions?.view !== true || scope.permissions?.[action === 'copy' ? 'create' : 'modify'] !== true) throw failure(403, 'This native file operation is no longer allowed');
      const scopeRoot = await fs.realpath(scope.root), registryFile = path.join(root, 'documents.json');
      const operationId = randomUUID(), reserved = [], affected = new Set(), destinations = new Set();
      const scoped = value => {
        if (typeof value !== 'string' || !value.startsWith('/') || /[\\\x00-\x1f]/.test(value) || value.split('/').some(part => part === '.' || part === '..')) throw failure(400, 'Invalid native scoped path');
        return path.resolve(scopeRoot, '.' + value);
      };
      const paths = [];
      for (const item of items) {
        if (item.fromSource !== source || item.toSource !== source) throw failure(403, 'Native operation leaves this source');
        const from = await historicalPath(scope, scoped(item.fromPath)), to = await historicalPath(scope, scoped(item.toPath));
        if (from === scopeRoot || to === scopeRoot) throw failure(403, 'The source root cannot be replaced');
        await authorizePath(from, { tree: true }); await authorizePath(to, { tree: true });
        paths.push({ from, to }); reserved.push(from, autoRename ? path.dirname(to) : to);
      }
      let registry, receipt;
      await serialized('registry', async () => {
        registry = await json(registryFile, { environmentId, paths: {} });
        if (Object.values(registry.pending || {}).some(entry => entry.paths.some(root => reserved.some(candidate => inside(root, candidate) || inside(candidate, root))))) throw failure(409, 'A previous native file operation requires recovery', 'NATIVE_FILES_UNCERTAIN');
        for (const [filename, id] of Object.entries(registry.paths)) {
          if (reserved.some(root => inside(root, filename))) affected.add(id);
          if (!autoRename && paths.some(({ to }) => inside(to, filename))) destinations.add(filename);
        }
        for (const id of affected) if (restoring.has(id)) throw failure(409, 'An affected document is already changing');
        reservations.add(reserved); for (const id of affected) restoring.add(id);
      });
      const lock = (ids, work, index = 0) => index === ids.length ? work() : serialized(ids[index], () => lock(ids, work, index + 1));
      try {
        // A native broker may save while acknowledging closure. Do not hold its
        // document queue or registry mutex while waiting for that acknowledgement.
        for (const id of affected) {
          const m = await load(id), movingSource = action !== 'copy' && paths.some(({ from }) => inside(from, m.path));
          if (movingSource || destinations.has(m.path)) await coordinate?.(id, signal);
        }
        return await lock([...affected].sort(), async () => {
          const manifests = new Map();
          for (const id of affected) {
            const m = await load(id); manifests.set(id, m);
            try { await permitted(scope, m.path); if (destinations.has(m.path) || (action !== 'copy' && paths.some(({ from }) => inside(from, m.path)))) await retain(m, m.path, 'pre-files-operation', { force: true }); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
          }
          await fs.mkdir(path.join(root, 'recovery'), { recursive: true, mode: 0o700 });
          receipt = path.join(root, 'recovery', 'files-' + operationId + '.json');
          await writeJSON(receipt, { operationId, action, paths, documents: [...manifests.values()].map(m => ({ id: m.id, path: m.path, generation: m.generation })), phase: 'prepared' });
          signal?.throwIfAborted();
          const observe = [...manifests.values()].map(m => '/' + path.relative(scopeRoot, m.path).split(path.sep).join('/'));
          if (Buffer.byteLength(JSON.stringify(observe)) > 3 << 20) throw failure(413, 'This native operation includes too many registered document paths');
          await serialized('registry', async () => {
            registry = await json(registryFile, { environmentId, paths: {} });
            registry.pending ||= {}; registry.pending[operationId] = { paths: reserved, documents: [...affected] };
            await writeJSON(registryFile, registry);
          });
          let native;
          try {
            native = await perform({ observe });
            if (![200, 207, 500].includes(native?.status) || !Array.isArray(native.body?.succeeded) || !Array.isArray(native.body?.failed) || !Array.isArray(native.body?.changed)) throw failure(502, 'Native completion receipt is unavailable');
            const completed = [...native.body.succeeded, ...native.body.failed];
            if (completed.length !== items.length || new Set(completed.map(item => item.position)).size !== items.length || completed.some(item => !Number.isInteger(item.position) || item.position < 0 || item.position >= items.length)) throw failure(502, 'Native completion receipt does not match the operation');
            for (const changed of native.body.changed) if (!Number.isInteger(changed.position) || changed.position < 0 || changed.position >= items.length || !inside(autoRename ? path.dirname(paths[changed.position].to) : paths[changed.position].to, scoped(changed.toPath))) throw failure(502, 'Native completion leaves the authorized target scope');
            for (const item of native.body.succeeded) if (item.fromSource !== source || item.toSource !== source || scoped(item.fromPath) !== paths[item.position].from || !(autoRename ? path.dirname(scoped(item.toPath)) === path.dirname(paths[item.position].to) : scoped(item.toPath) === paths[item.position].to)) throw failure(502, 'Native completed path differs from its authorized request');
          } catch (error) {
            // A lost receipt is not proof that a mutation failed. Keep recovery
            // and reject stale live participants rather than retrying a move.
            for (const m of manifests.values()) { m.generation++; m.recovery = { operationId, reason: 'native-completion-unavailable' }; await saveManifest(m); }
            error.code = 'NATIVE_FILES_UNCERTAIN'; error.details = { operationId }; error.message = 'Native Files completion is uncertain; do not retry this operation. Recovery receipt: ' + operationId; throw error;
          }
          await writeJSON(receipt, { operationId, action, paths, phase: 'completed', native });
          const retired = new Set(), carried = new Set();
          await serialized('registry', async () => {
          registry = await json(registryFile, { environmentId, paths: {} });
          const retire = async (id, reason) => { const m = manifests.get(id) || await load(id); m.generation++; m.retired = { operationId, reason, path: m.path }; await saveManifest(m); manifests.set(id, m); if (registry.paths[m.path] === id) delete registry.paths[m.path]; registry.retired ||= {}; registry.retired[id] = m.path; retired.add(id); carried.delete(id); };
          for (let position = 0; position < items.length; position++) {
            const success = native.body.succeeded.find(item => item.position === position), failed = native.body.failed.find(item => item.position === position);
            const from = success && scoped(success.fromPath), to = success && scoped(success.toPath);
            const moving = success && action !== 'copy' ? Object.entries(registry.paths).filter(([filename]) => inside(from, filename)) : [];
            const sourceIds = new Set(moving.map(([, id]) => id));
            for (const changed of native.body.changed.filter(item => item.position === position)) {
              const id = registry.paths[scoped(changed.toPath)]; if (id && !sourceIds.has(id)) await retire(id, 'native-overwrite');
            }
            for (const [filename, id] of moving) {
              const target = path.join(to, path.relative(from, filename));
              const prior = registry.paths[target]; if (prior && prior !== id && !sourceIds.has(prior)) await retire(prior, 'native-overwrite');
              const m = manifests.get(id) || await load(id);
              delete registry.paths[filename]; m.path = target; m.generation++; m.grants = {};
              await saveManifest(m); registry.paths[target] = id; manifests.set(id, m); carried.add(id);
            }
            if (failed?.phase === 'remove-source') for (const [filename, id] of Object.entries(registry.paths)) if (inside(paths[position].from, filename)) {
              const m = manifests.get(id) || await load(id); m.generation++; m.recovery = { operationId, reason: 'native-source-removal-incomplete' }; await saveManifest(m);
            }
          }
          delete registry.pending[operationId];
          await writeJSON(registryFile, registry);
          await fs.unlink(receipt);
          });
          return { ...native, body: { ...native.body, office: { movedDocumentIds: [...carried], retiredDocumentIds: [...retired] } } };
        });
      } finally { reservations.delete(reserved); for (const id of affected) restoring.delete(id); }
    }));
  }
  async function relinkRoot({ previousRoot, newRoot, signal }, commit) {
    previousRoot = path.resolve(previousRoot); newRoot = await fs.realpath(newRoot);
    await authorizePath(newRoot);
    if (inside(await fs.realpath(dataRoot), newRoot)) throw failure(403, 'Private application state cannot be a project source');
    return serialized('native-files', () => serialized('registry', async () => {
      const registryFile = path.join(root, 'documents.json'), registry = await json(registryFile, { environmentId, paths: {} });
      if (Object.values(registry.pending || {}).some(entry => entry.paths.some(root => inside(previousRoot, root) || inside(root, previousRoot)))) throw failure(409, 'Resolve the previous native file operation before relinking', 'NATIVE_FILES_UNCERTAIN');
      const ids = [...new Set([...Object.entries(registry.paths).filter(([filename]) => inside(previousRoot, filename)).map(([, id]) => id), ...Object.entries(registry.retired || {}).filter(([, filename]) => inside(previousRoot, filename)).map(([id]) => id)])].sort();
      const execute = async () => {
      const updates = [], issues = [];
      for (const [filename, id] of Object.entries(registry.paths)) if (inside(previousRoot, filename)) {
        signal?.throwIfAborted(); const m = await load(id), target = path.join(newRoot, path.relative(previousRoot, filename));
        try {
          await permitted({ root: newRoot }, target);
          if (registry.paths[target] && registry.paths[target] !== id) throw Error('Destination has another registered document identity');
          let expected = m.lastDigest || m.versions.at(-1)?.sha256;
          try { expected = await digestFile(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (!expected || await digestFile(target) !== expected) throw Error('Destination does not match the last known document bytes');
          updates.push({ m, filename, target });
        } catch (error) { if (issues.length < 100) issues.push({ documentId: id, relativePath: path.relative(previousRoot, filename), reason: error.message }); }
      }
      if (issues.length) throw Object.assign(failure(409, 'The new folder does not contain the matching Office documents'), { details: { officeReconciliation: { canRelink: false, verified: updates.length, issues } } });
      const retired = [];
      for (const [id, filename] of Object.entries(registry.retired || {})) if (inside(previousRoot, filename)) retired.push({ m: await load(id), target: path.join(newRoot, path.relative(previousRoot, filename)) });
      signal?.throwIfAborted();
      const operationId = randomUUID(); registry.pending ||= {}; registry.pending[operationId] = { paths: [previousRoot, newRoot], documents: [...updates, ...retired].map(({ m }) => m.id) };
      await fs.mkdir(root, { recursive: true, mode: 0o700 }); await writeJSON(registryFile, registry);
      let project;
      try { project = await commit(); } catch (error) { delete registry.pending[operationId]; await writeJSON(registryFile, registry); throw error; }
      for (const { m, filename, target } of updates) {
        m.path = target; m.generation++; m.grants = {}; m.fingerprint = fingerprint(await fs.stat(target, { bigint: true }));
        await saveManifest(m); await retain(m, target, 'project-relink', { force: true });
        delete registry.paths[filename]; registry.paths[target] = m.id;
      }
      for (const { m, target } of retired) { m.path = target; m.generation++; m.grants = {}; await saveManifest(m); registry.retired[m.id] = target; }
      delete registry.pending[operationId]; await writeJSON(registryFile, registry);
      return { project, officeReconciliation: { canRelink: true, verified: updates.length, retiredHistories: retired.length } };
      };
      const lock = index => index === ids.length ? execute() : serialized(ids[index], () => lock(index + 1));
      return lock(0);
    }));
  }
  async function settings(claims, update) { return authorize(claims, 'view', async (_m, _scope, signal) => {
    const key = createHash('sha256').update(claims.participant).digest('hex'); const dir = path.join(root, 'settings'); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    return serialized('settings:' + key, async () => { const filename = path.join(dir, key + '.json'); const current = await json(filename, {}); const next = lightSettings({ ...current, ...update }); if (update) { signal?.throwIfAborted(); await writeJSON(filename, next); } return next; });
  }); }
  return { register, metadata, read, write, rename, relative, finalize, list, configureHistory, restore, snapshot, settings, withNativeMove, relinkRoot, isRestoring: documentId => restoring.has(documentId) };
}
