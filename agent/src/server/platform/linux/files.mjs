import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir, digest, privateDir, readMeta, withinRoot } from '../../common.mjs';
import { pickerDirectory } from '../../files/folders.mjs';

// Used only through the private, same-user control socket by the native host.
export async function nativeFile(value) {
  if (value.folder) return { path: (await pickerDirectory(value.folder)).path };
  const input = String(value.url || '');
  if (input.startsWith('data:image/')) {
    const match = input.match(/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match || match[2].length > 24 * 1024 * 1024) throw Error('Unsupported inline image');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.toString('base64') !== match[2]) throw Error('Invalid inline image');
    const directory = path.join(dataDir, 'attachments', 'native'); await privateDir(directory);
    const file = path.join(directory, digest(bytes) + '.' + match[1]);
    await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    return { path: file };
  }
  const url = new URL(input, 'http://127.0.0.1');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw Error('Only local artifacts can be opened as files');
  if (url.pathname === '/api/files/content') {
    const root = (await pickerDirectory(url.searchParams.get('root'))).path;
    return { path: await withinRoot(root, url.searchParams.get('path') || '') };
  }
  const match = url.pathname.match(/^\/api\/sessions\/([a-f0-9-]{36})\/attachments\/([^/]+)\/([^/]+)$/);
  if (match) {
    const meta = await readMeta(match[1]);
    const suffix = '/attachments/' + match.slice(2).map(decodeURIComponent).join('/');
    const file = (meta.messages || []).flatMap(m => m.attachments).find(a => a.path.endsWith(suffix));
    if (file) return { path: await withinRoot(path.join(dataDir, 'attachments'), path.relative(path.join(dataDir, 'attachments'), file.path)) };
  }
  throw Error('This link is not a local project file or saved attachment');
}
