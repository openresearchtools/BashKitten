import fs from 'node:fs/promises';
import { createReadStream, constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { dataDir, privateDir, safeName } from '../common.mjs';
import { platform, projectLocations } from '../platform/index.mjs';

const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/plain', '.json': 'application/json', '.html': 'text/html', '.js': 'text/plain', '.ts': 'text/plain', '.css': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4' };
export const mimeType = filename => types[path.extname(filename).toLowerCase()] || 'application/octet-stream';
export const disposition = (name, download) => `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, '%27')}`;
export const containsPath = (root, target) => target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
const canonicalPath = value => platform === 'termux' && containsPath('/data/user/0/com.termux', value) ? '/data/data/com.termux' + value.slice('/data/user/0/com.termux'.length) : value;
// File browsing has a wider, read-only entry policy than the working-folder picker.
// Resolve links and normalize Android's bind-mounted /data/user/0 alias first.
export async function fileDirectory(input) {
  const requested = input || os.homedir();
  if (typeof requested !== 'string' || !path.isAbsolute(requested) || requested.includes('\0')) throw Error('Use an absolute folder path');
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
  if (!containsPath(directory.scopeRoot, target)) throw Object.assign(Error('Path leaves the available files'), { status: 403 });
  return target;
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
      if (!containsPath(location.scopeRoot, real)) throw Error('Outside available files');
      const stat = await fs.stat(real);
      entries.push({ name: file.name, path: rel, directory: stat.isDirectory(), symlink: file.isSymbolicLink(), size: stat.size });
    } catch { entries.push({ name: file.name, path: rel, blocked: true, symlink: file.isSymbolicLink() }); }
  }
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  return { root, path: path.relative(root, dir), currentPath: dir, parent: dir === location.scopeRoot ? null : path.dirname(dir), scopeRoot: location.scopeRoot, entries };
}
export async function sendFile(req, res, file, download = false, name = path.basename(file)) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw Error('Choose a regular file');
  const headers = { 'Content-Type': mimeType(file), 'Content-Length': stat.size,
    'Content-Disposition': disposition(name, download), 'X-Content-Type-Options': 'nosniff',
    // Opening a repository HTML/SVG file must not give it the app's origin privileges.
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:", 'Cache-Control': 'no-store' };
  res.writeHead(200, headers);
  await pipeline(createReadStream(file), res);
}
export async function uploadFiles(root, relative, files) {
  const dir = await filePath(root, relative), saved = [];
  if (!(await fs.stat(dir)).isDirectory()) throw Error('Upload destination is not a folder');
  for (const file of files) {
    const target = path.join(dir, safeName(file.name));
    await fs.writeFile(target, Buffer.from(await file.arrayBuffer()), { flag: 'wx', mode: 0o600 });
    saved.push(path.relative(root, target));
  }
  return saved;
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
    await fs.writeFile(target, Buffer.from(await file.arrayBuffer()), { mode: 0o600, flag: 'wx' });
    attachments.push({ type: 'attachment', path: target, name, mimeType: mimeType(name), size: file.size });
  }
  return attachments;
}
export function inlineAttachments(values) {
  return values.map(value => {
    const file = JSON.parse(value);
    if (typeof file.name !== 'string' || typeof file.data !== 'string' || file.data.length % 4 || /[^A-Za-z0-9+/=]/.test(file.data)) throw Error('Invalid pasted file');
    const bytes = Buffer.from(file.data, 'base64');
    if (bytes.toString('base64') !== file.data) throw Error('Invalid pasted file');
    return new File([bytes], safeName(file.name));
  });
}
export async function promptWithAttachments(text, attachments) {
  const images = [];
  for (const file of attachments) {
    if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.mimeType)) images.push({ type: 'image', data: (await fs.readFile(file.path)).toString('base64'), mimeType: file.mimeType });
  }
  const references = attachments.map(a => `${a.name}: ${a.path}`).join('\n');
  return { text, attachments, images, wire: text + (references ? `\n\nAttached files:\n${references}` : '') };
}
