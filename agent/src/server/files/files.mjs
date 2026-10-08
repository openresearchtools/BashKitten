import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { randomUUID, createHash } from 'node:crypto';
import { authorizeManagerPath, managerContext } from './access.mjs';
import { fileURLToPath } from 'node:url';
import { dataDir, privateDir, safeName } from '../common.mjs';
import { platform, projectLocations } from '../platform/index.mjs';
import { previewKind } from './preview-types.mjs';

const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/plain', '.json': 'application/json', '.html': 'text/html', '.js': 'text/plain', '.ts': 'text/plain', '.css': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4' };
export const mimeType = filename => types[path.extname(filename).toLowerCase()] || 'application/octet-stream';
export const disposition = (name, download) => `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, '%27')}`;
export const containsPath = (root, target) => target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
const canonicalPath = value => platform === 'termux' && containsPath('/data/user/0/com.termux', value) ? '/data/data/com.termux' + value.slice('/data/user/0/com.termux'.length) : value;
// File browsing has a wider, read-only entry policy than the working-folder picker.
// Resolve links and normalize Android's bind-mounted /data/user/0 alias first.
export async function fileDirectory(input) {
  const requested = input || os.homedir();
  if (typeof requested !== 'string' || !path.isAbsolute(requested) || requested.includes('\0')) throw Error('Use an absolute folder path');
  await authorizeManagerPath(requested);
  const scopes = platform === 'termux' ? [canonicalPath(await fs.realpath('/data/data/com.termux'))] : (await projectLocations()).map(item => item.path);
  const directory = canonicalPath(await fs.realpath(requested));
  const scopeRoot = scopes.filter(root => containsPath(root, directory)).sort((a, b) => a.length - b.length)[0];
  if (!scopeRoot) throw Object.assign(Error('Path leaves the available files'), { status: 403 });
  if (!(await fs.stat(directory)).isDirectory()) throw Error('Choose a folder');
  await fs.access(directory, constants.R_OK | constants.X_OK);
  return { path: directory, parent: directory === scopeRoot ? null : path.dirname(directory), scopeRoot };
}
export function relativePath(value, allowRoot = true) {
  if (typeof value !== 'string' || path.isAbsolute(value) || value.includes('\0') || value.split(/[\\/]/).includes('..')) throw Error('Use a relative file path inside this folder');
  const relative = path.normalize(value || '.');
  if (!allowRoot && relative === '.') throw Error('The browsing root cannot be selected for this operation');
  return relative === '.' ? '' : relative;
}
export async function filePath(root, relative = '') {
  const directory = await fileDirectory(root);
  const target = canonicalPath(await fs.realpath(path.join(directory.path, relativePath(relative))));
  await authorizeManagerPath(target);
  if (!containsPath(directory.scopeRoot, target)) throw Object.assign(Error('Path leaves the available files'), { status: 403 });
  return target;
}
export async function sessionImage(meta, reference, view) {
  if (typeof reference !== 'string' || !reference || reference.includes('\0')) throw Object.assign(Error('Choose an image path'), { status: 400 });
  // The chat route is not a second arbitrary-path file manager. Authorize only
  // image destinations returned by Pi. A client-authored Markdown link must
  // not grant itself access to an arbitrary host image through this route.
  const messages = [...(view.entries || []).filter(e => e.type === 'message').map(e => e.message),
    ...(view.events || []).filter(e => e.type === 'message').map(e => e.message)];
  const texts = messages.filter(message => ['assistant', 'toolResult'].includes(message?.role)).map(message => typeof message.content === 'string' ? message.content
    : (message.content || []).filter(block => block.type === 'text').map(block => block.text || '').join('\n'));
  let partial = '';
  for (const event of view.events || []) {
    if (event.type === 'assistant_delta') partial += event.delta || '';
    else if (event.type === 'message' || event.type === 'agent_start') { texts.push(partial); partial = ''; }
  }
  texts.push(partial);
  const tokens = /`([^`]+)`|(!?)\[([^\]\n]*)\]\(\s*(<[^>\n]+>|(?:\\.|[^\\\s()]|\((?:\\.|[^\\\s()])*\))+)(?:\s+"[^"\n]*")?\s*\)|\*\*([^*]+)\*\*/g;
  let authorized = false;
  for (const text of texts) for (const [index, piece] of text.split(/```/).entries()) {
    if (index % 2) continue;
    for (const match of piece.matchAll(tokens)) {
      if (match[2] !== '!') continue;
      let target = match[4].replace(/^<|>$/g, '').replace(/\\([\\()])/g, '$1');
      if (!target.startsWith('file:')) { try { target = decodeURIComponent(target); } catch {} }
      if (target === reference) authorized = true;
    }
  }
  if (!authorized) throw Object.assign(Error('Image is not referenced by this chat'), { status: 404 });
  let requested = reference.startsWith('file:') ? fileURLToPath(reference) : reference;
  if (requested.startsWith('~/')) requested = path.join(os.homedir(), requested.slice(2));
  const absolute = path.resolve(meta.cwd, requested);
  const file = await filePath(path.dirname(absolute), path.basename(absolute));
  if (!mimeType(file).startsWith('image/')) throw Object.assign(Error('This file is not a supported image'), { status: 415 });
  return file;
}
export async function listFiles(root, relative = '') {
  const location = await fileDirectory(root);
  root = location.path;
  const dir = await filePath(root, relative);
  if (!(await fs.stat(dir)).isDirectory()) throw Error('Choose a folder');
  // Following a directory link can change the canonical root; clients use the
  // returned root/currentPath rather than manufacture parent-traversal paths.
  if (!containsPath(root, dir)) root = dir;
  const entries = [];
  for (const file of await fs.readdir(dir, { withFileTypes: true })) {
    // External/dangling links remain selectable for copying/deleting the link itself.
    const rel = path.relative(root, path.join(dir, file.name));
    try {
      const real = canonicalPath(await fs.realpath(path.join(dir, file.name)));
      await authorizeManagerPath(real);
      if (!containsPath(location.scopeRoot, real)) throw Error('Outside available files');
      const stat = await fs.stat(real);
      const kind = stat.isFile() ? await previewKind(real, file.name).catch(error => {
        if (error.status === 403 || managerContext()?.signal.aborted) throw error;
        return null;
      }) : null;
      entries.push({ name: file.name, path: rel, directory: stat.isDirectory(), symlink: file.isSymbolicLink(), size: stat.size, previewKind: kind });
    } catch (error) { if (error.status === 403) continue; entries.push({ name: file.name, path: rel, blocked: true, symlink: file.isSymbolicLink() }); }
  }
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  return { root, path: path.relative(root, dir), currentPath: dir, parent: dir === location.scopeRoot ? null : path.dirname(dir), scopeRoot: location.scopeRoot, entries };
}
export async function sendFile(req, res, file, download = false, name = path.basename(file), { artifact = false, generatedPreview = false } = {}) {
  if (!artifact) await authorizeManagerPath(file);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!artifact) await authorizeManagerPath(`/proc/self/fd/${handle.fd}`);
    const stat = await handle.stat();
    if (!stat.isFile()) throw Error('Choose a regular file');
    // Only our generated standalone viewer may run its nonce-authorized code.
    // Its own meta policy further restricts scripts; its document iframe remains
    // opaque. Raw repository HTML/SVG keeps the script-disabled sandbox below.
    const policy = artifact && generatedPreview && mimeType(file) === 'text/html'
      ? "sandbox allow-scripts allow-downloads; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; frame-src 'self' about:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      : "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";
    const headers = { 'Content-Type': mimeType(file), 'Content-Length': stat.size,
      'Content-Disposition': disposition(name, download), 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': policy, 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    await pipeline(handle.createReadStream({ autoClose: false }), res, { signal: managerContext()?.signal });
  } finally { await handle.close(); }
}
export async function uploadFiles(root, relative, files) {
  const dir = await filePath(root, relative), saved = [];
  if (!(await fs.stat(dir)).isDirectory()) throw Error('Upload destination is not a folder');
  for (const file of files) {
    const target = path.join(dir, safeName(file.name));
    await authorizeManagerPath(target);
    await storeUpload(file, target);
    saved.push(path.relative(root, target));
  }
  return saved;
}
const edits = new Map();
const revision = (bytes, stat) => createHash('sha256').update(bytes).update(`\0${stat.dev}:${stat.ino}:${stat.mode}:${stat.mtimeNs}:${stat.ctimeNs}`).digest('hex');
async function textContent(file) {
  await authorizeManagerPath(file);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await authorizeManagerPath(`/proc/self/fd/${handle.fd}`);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw Error('Choose a regular text file');
    const bytes = await handle.readFile(), after = await handle.stat({ bigint: true });
    if (before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.size !== after.size) throw Object.assign(Error('The file changed while opening; reopen it'), { status: 409 });
    if (bytes.includes(0)) throw Error('This is a binary file; use Open or Download');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw Error('The editor requires UTF-8 text; use Open or Download for this file'); }
    return { text, revision: revision(bytes, after), mode: Number(after.mode) & 0o777 };
  } finally { await handle.close(); }
}
export async function editFile(root, relative, value) {
  const file = await filePath(root, relative);
  if (value === undefined) {
    const { text, revision } = await textContent(file);
    return { text, revision };
  }
  if (typeof value.text !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision || '')) throw Error('Open this text file before saving');
  const work = (edits.get(file) || Promise.resolve()).then(async () => {
    const parent = await fs.open(path.dirname(file), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const target = `/proc/self/fd/${parent.fd}/${path.basename(file)}`;
    const temporary = `/proc/self/fd/${parent.fd}/.bashkitten-edit-${randomUUID()}`;
    try {
      const previous = await textContent(target);
      if (previous.revision !== value.revision) throw Object.assign(Error('The file changed since you opened it; reopen it before saving'), { status: 409 });
      await fs.writeFile(temporary, value.text, { flag: 'wx', mode: previous.mode, flush: true });
      await fs.chmod(temporary, previous.mode);
      const current = await textContent(target);
      if (current.revision !== value.revision) throw Object.assign(Error('The file changed while saving; your edit was not applied'), { status: 409 });
      await authorizeManagerPath(target);
      managerContext().signal.throwIfAborted();
      await fs.rename(temporary, target);
      await parent.sync();
      return { saved: true };
    } finally { await fs.rm(temporary, { force: true }); await parent.close(); }
  });
  const settled = work.catch(() => {}); edits.set(file, settled);
  try { return await work; }
  finally { if (edits.get(file) === settled) edits.delete(file); }
}
export async function saveAttachments(files) {
  if (!files.length) return [];
  const dir = path.join(dataDir, 'attachments', randomUUID()); await privateDir(dir);
  const attachments = [];
  for (const [index, file] of files.entries()) {
    let name = path.basename(file.name.replaceAll('\\', '/')).replace(/[\x00-\x1f]/g, '_') || 'attachment';
    name = safeName(name);
    if (attachments.some(a => a.name === name)) name = `${index}-${name}`;
    const target = path.join(dir, name);
    await storeUpload(file, target);
    attachments.push({ type: 'attachment', path: target, name, mimeType: mimeType(name), size: file.size });
  }
  return attachments;
}
async function storeUpload(file, target) {
  if (typeof file.path !== 'string') throw Error('Choose a file to upload');
  const access = managerContext();
  if (access) {
    const parent = await fs.open(path.dirname(target), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    let input, output, owned;
    const pinned = `/proc/self/fd/${parent.fd}/${path.basename(target)}`;
    try {
      await authorizeManagerPath(pinned);
      input = await fs.open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      output = await fs.open(pinned, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      owned = await output.stat();
      await authorizeManagerPath(`/proc/self/fd/${output.fd}`);
      await pipeline(input.createReadStream({ autoClose: false }), output.createWriteStream({ autoClose: false }), { signal: access.signal });
      await output.sync(); access.signal.throwIfAborted();
    } catch (error) {
      const current = await fs.lstat(pinned).catch(() => null);
      if (owned && current?.ino === owned.ino && current?.dev === owned.dev) await fs.unlink(pinned);
      throw error;
    } finally { await input?.close(); await output?.close(); await parent.close(); }
    return;
  }
  // Android app data can forbid hard links even within the same filesystem.
  // Copy without buffering the upload or replacing an existing destination.
  await fs.copyFile(file.path, target, constants.COPYFILE_EXCL);
}
export async function attachmentImages(attachments) {
  const images = [];
  for (const file of attachments) {
    if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.mimeType)) images.push({ type: 'image', data: (await fs.readFile(file.path)).toString('base64'), mimeType: file.mimeType });
  }
  return images;
}
