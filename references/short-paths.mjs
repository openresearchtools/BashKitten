// SPDX-License-Identifier: AGPL-3.0-or-later
// Filesystem tokens are independent of public project/item identities.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const marker = '.reference-owner';
const reservations = new Map();
export const isShortToken = value => /^[A-Za-z0-9_-]{4}$/.test(value || '');
export const shortPathToken = (identity, attempt = 0) => {
  const value = (createHash('sha256').update(identity).digest().readUIntBE(0, 3) + attempt) % 0x1000000;
  const bytes = Buffer.allocUnsafe(3);
  bytes.writeUIntBE(value, 0, 3);
  return bytes.toString('base64url');
};
export async function ownsShortDirectory(folder, identity) {
  const info = await fs.lstat(folder).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (!info?.isDirectory() || info.isSymbolicLink()) return false;
  const ownership = path.join(folder, marker);
  const record = await fs.lstat(ownership).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (!record?.isFile() || record.isSymbolicLink()) return false;
  return await fs.readFile(ownership, 'utf8').then(value => value === identity, error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
}
export async function reserveShortDirectory(root, identity, preferred) {
  const key = root + '\0' + identity;
  const prior = reservations.get(key) || Promise.resolve();
  const work = prior.catch(() => {}).then(() => reserve(root, identity, preferred));
  reservations.set(key, work);
  try { return await work; }
  finally { if (reservations.get(key) === work) reservations.delete(key); }
}
async function reserve(root, identity, preferred) {
  for (let attempt = 0; attempt <= 0x1000000; attempt++) {
    const token = attempt === 0 && isShortToken(preferred) ? preferred : shortPathToken(identity, preferred ? attempt + 1 : attempt);
    const folder = path.join(root, token);
    let created = false;
    try { await fs.mkdir(folder, { mode: 0o700 }); created = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (created) {
      try { await fs.writeFile(path.join(folder, marker), identity, { flag: 'wx', mode: 0o600 }); }
      catch (error) { await fs.rmdir(folder).catch(() => {}); throw error; }
      return { token, folder };
    }
    if (await ownsShortDirectory(folder, identity)) return { token, folder };
  }
  throw Error('All four-character References folder names are already in use');
}
export async function compactDatabaseDirectory(root, identity, preferred) {
  const legacy = path.join(root, createHash('sha256').update(identity).digest('hex'));
  const info = await fs.lstat(legacy).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (info && (!info.isDirectory() || info.isSymbolicLink())) throw Error('References database directory must be a normal directory');
  // A crash after removing the empty destination's marker, before the atomic
  // rename, must reclaim that same private database slot. The marked legacy
  // directory proves this is our interrupted migration, not an attachment or
  // user-selected directory that happens to be empty.
  if (info && await ownsShortDirectory(legacy, identity)) {
    const candidate = path.join(root, isShortToken(preferred) ? preferred : shortPathToken(identity));
    const target = await fs.lstat(candidate).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (target?.isDirectory() && !target.isSymbolicLink() && !(await fs.readdir(candidate)).length)
      await fs.writeFile(path.join(candidate, marker), identity, { flag: 'wx', mode: 0o600 });
  }
  const reserved = await reserveShortDirectory(root, identity, preferred);
  if (!info) return reserved.folder;
  const target = await fs.readdir(reserved.folder);
  if (target.some(name => name !== marker)) throw Error('Both old and short References database directories contain data');
  await fs.writeFile(path.join(legacy, marker), identity, { mode: 0o600 });
  await fs.unlink(path.join(reserved.folder, marker));
  await fs.rename(legacy, reserved.folder);
  return reserved.folder;
}
