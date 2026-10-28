import { open, mkdir, link, rename, unlink, copyFile, constants } from 'node:fs/promises';
import { dirname, basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function readText(path, { signal, maxBytes = 32 * 1024 * 1024 } = {}) {
  signal?.throwIfAborted();
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error(`Expected a regular text file no larger than ${maxBytes} bytes: ${path}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of file.createReadStream({ autoClose: false, signal })) {
      size += chunk.length;
      if (size > maxBytes) throw new Error(`File grew beyond the ${maxBytes} byte limit: ${path}`);
      chunks.push(chunk);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { await file.close(); }
}

/** Refuse clobbering by default. Atomic rename/link where supported; Android's
 * SELinux may forbid hardlinks, requiring a create-exclusive copy instead. */
export async function writeOutput(path, data, { overwrite = false, signal } = {}) {
  signal?.throwIfAborted();
  path = resolve(path);
  await mkdir(dirname(path), { recursive: true });
  const temporary = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(data, { signal });
    await file.sync();
  } catch (error) {
    await file.close();
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await file.close();
  try {
    signal?.throwIfAborted();
    if (overwrite) await rename(temporary, path);
    else {
      try { await link(temporary, path); } // atomic EEXIST, unlike check-then-rename
      catch (error) {
        if (!['EACCES', 'EPERM', 'ENOTSUP', 'EXDEV'].includes(error.code)) throw error;
        // COPYFILE_EXCL still protects a racing writer and dangling symlinks.
        // Unlike link, the new file can briefly be visible before copy finishes.
        await copyFile(temporary, path, constants.COPYFILE_EXCL);
      }
    }
  } finally { await unlink(temporary).catch(() => {}); }
  return path;
}
