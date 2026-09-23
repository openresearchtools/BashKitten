import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { dataDir, readMeta, withinRoot } from '../../common.mjs';
import { pickerDirectory } from '../../files/folders.mjs';
import { filePath } from '../../files/files.mjs';

async function readableFile(file) {
  if (!(await fs.stat(file)).isFile()) throw Error('Choose a regular file');
  await fs.access(file, constants.R_OK);
  return { path: file };
}

// Used only through the private, same-user control socket by the native host.
export async function nativeFile(value) {
  if (value.folder) return { path: (await pickerDirectory(value.folder)).path };
  const input = String(value.url || '');
  const url = new URL(input, 'http://127.0.0.1');
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password) throw Error('Only local artifacts can be opened as files');
  if (url.pathname === '/api/files/content') {
    return readableFile(await filePath(url.searchParams.get('root'), url.searchParams.get('path') || ''));
  }
  const match = url.pathname.match(/^\/api\/sessions\/([a-f0-9-]{36})\/attachments\/([^/]+)\/([^/]+)$/);
  if (match) {
    const meta = await readMeta(match[1]);
    const suffix = '/attachments/' + match.slice(2).map(decodeURIComponent).join('/');
    const file = (meta.messages || []).flatMap(m => m.attachments || []).find(a => typeof a?.path === 'string' && a.path.endsWith(suffix));
    if (file) return readableFile(await withinRoot(path.join(dataDir, 'attachments'), path.relative(path.join(dataDir, 'attachments'), file.path)));
  }
  throw Error('This link is not a local project file or saved attachment');
}
