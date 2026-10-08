// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { authorizeManagerPath } from './access.mjs';

const images = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico']);
const sheets = new Set(['xlsx', 'xls', 'xlsb', 'xlsm', 'xltx', 'xltm', 'xlt', 'ods', 'ots', 'fods', 'csv', 'tsv']);
const office = new Set(['doc', 'docx', 'docm', 'dot', 'dotx', 'dotm', 'odt', 'ott', 'odm', 'otm', 'oth', 'fodt', 'rtf',
  'ppt', 'pptx', 'pptm', 'pot', 'potx', 'potm', 'pps', 'ppsx', 'ppsm', 'odp', 'otp', 'fodp', 'odg', 'otg', 'fodg']);
const markdown = new Set(['md', 'markdown', 'mdown', 'mkd']);

export function decodePreviewText(bytes, { sample = false } = {}) {
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: sample });
    if (/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text)) return null;
    return text;
  } catch { return null; }
}

// The server decides whether View is available. Unknown extensions are accepted
// only when their actual bytes look like text; document rendering never executes
// a repository's HTML, JavaScript, SVG scripts, macros or spreadsheet formulas.
export async function previewKind(file, name = file) {
  const extension = path.extname(name).slice(1).toLowerCase();
  if (images.has(extension)) return 'image';
  if (extension === 'pdf') return 'pdf';
  if (sheets.has(extension)) return 'sheet';
  if (office.has(extension)) return 'office';
  await authorizeManagerPath(file);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    await authorizeManagerPath('/proc/self/fd/' + handle.fd);
    if (!(await handle.stat()).isFile()) return null;
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (decodePreviewText(buffer.subarray(0, bytesRead), { sample: true }) === null) return null;
    return markdown.has(extension) ? 'markdown' : 'text';
  } finally { await handle.close(); }
}
