import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import yazl from 'yazl';
import { dataDir, privateDir, withinRoot, safeName } from '../common.mjs';

const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/plain', '.json': 'application/json', '.html': 'text/html', '.js': 'text/plain', '.ts': 'text/plain', '.css': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4' };
export const mimeType = filename => types[path.extname(filename).toLowerCase()] || 'application/octet-stream';
export const disposition = (name, download) => `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, '%27')}`;
export async function listFiles(root, relative = '') {
  const dir = await withinRoot(root, relative);
  const entries = [];
  for (const file of await fs.readdir(dir, { withFileTypes: true })) {
    // Symlinks are shown but only opened if their real target is within root.
    const rel = path.relative(root, path.join(dir, file.name));
    try {
      const real = await withinRoot(root, rel), stat = await fs.stat(real);
      entries.push({ name: file.name, path: rel, directory: stat.isDirectory(), symlink: file.isSymbolicLink(), size: stat.size });
    } catch { entries.push({ name: file.name, path: rel, blocked: true, symlink: file.isSymbolicLink() }); }
  }
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  return { root, path: path.relative(root, dir), entries };
}
export async function sendFile(req, res, file, download = false) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw Error('Choose a regular file');
  const headers = { 'Content-Type': mimeType(file), 'Content-Length': stat.size,
    'Content-Disposition': disposition(path.basename(file), download), 'X-Content-Type-Options': 'nosniff',
    // Opening a repository HTML/SVG file must not give it the app's origin privileges.
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:", 'Cache-Control': 'no-store' };
  res.writeHead(200, headers);
  await pipeline(createReadStream(file), res);
}
export async function uploadFiles(root, relative, files) {
  const dir = await withinRoot(root, relative), saved = [];
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
export async function sendZip(res, root) {
  const archive = new yazl.ZipFile();
  let cancelled = false;
  res.on('close', () => { cancelled = true; archive.outputStream.destroy(); });
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': disposition((path.basename(root) || 'repository') + '.zip', true), 'Cache-Control': 'no-store' });
  const output = pipeline(archive.outputStream, res);
  // Enumerate on the server; include hidden files and .git, with no frontend ZIP.
  async function walk(dir, relative = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (cancelled) return;
      const full = path.join(dir, entry.name), rel = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await fs.readlink(full);
        // Preserve safe relative links without dereferencing external files.
        const resolved = path.resolve(path.dirname(full), target);
        if (!path.isAbsolute(target) && (resolved === root || resolved.startsWith(root + path.sep))) archive.addBuffer(Buffer.from(target), rel, { mode: 0o120777 });
      } else if (entry.isDirectory()) { archive.addEmptyDirectory(rel); await walk(full, rel); }
      else if (entry.isFile()) archive.addFile(full, rel);
    }
  }
  try { await walk(root); archive.end(); await output; }
  catch (error) { archive.outputStream.destroy(error); await output.catch(() => {}); throw error; }
}
