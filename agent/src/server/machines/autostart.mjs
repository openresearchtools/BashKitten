// SPDX-License-Identifier: AGPL-3.0-only
// This path is defined by the packaged guest session and image recipe. Guest
// settings never reuse the host dataDir or traverse guest-created symlinks.
import fs from 'node:fs/promises';
import path from 'node:path';
import { autostartConfig, saveAutostart } from '../autostart.mjs';

const guestData = '/home/user/.local/share/bashkitten-pi';
const pending = record => path.join(record.files.directory, 'autostart.pending.json');
const stoppedStatus = config => ({ ...config, status: config.commands.map(entry => ({ id: entry.id, state: 'stopped', error: '', savedForNextStart: false })) });
async function withGuestFile(record, callback) {
  const descriptors = [];
  try {
    let directory = record.files.rootfs;
    for (const component of ['', ...guestData.slice(1).split('/')]) {
      const handle = await fs.open(component ? path.join(directory, component) : directory,
        fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      descriptors.push(handle); directory = `/proc/self/fd/${handle.fd}`;
    }
    const owner = await descriptors.at(-1).stat();
    if (owner.uid !== process.getuid() || owner.mode & 0o077) throw Error('The guest BashKitten data directory must be private and owned by its mapped user');
    const file = path.join(directory, 'autostart.json');
    const stat = await fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (stat && (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o077)) throw Error('The guest startup configuration must be a private regular file owned by its mapped user');
    return await callback(file);
  } finally { for (const handle of descriptors.reverse()) await handle.close(); }
}
export async function installPendingAutostart(record) {
  try { await fs.access(pending(record)); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  await autostartConfig(pending(record));
  await withGuestFile(record, async file => {
    try { await fs.lstat(file); throw Error('Both pending and installed guest startup configuration exist; preserve and reconcile them before starting'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Same machine storage: atomically transfer the sole authoritative file.
    // Do not copy on EXDEV or discard a failed transfer.
    await fs.rename(pending(record), file);
    const directory = await fs.open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    const source = await fs.open(record.files.directory, 'r');
    try { await source.sync(); } finally { await source.close(); }
  });
}
export async function stoppedAutostart(record, value) {
  const update = async file => stoppedStatus(value ? await saveAutostart(value, file) : await autostartConfig(file));
  const staged = await fs.lstat(pending(record)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
  if (!record.state.provisioned || staged) return update(pending(record));
  const result = await withGuestFile(record, update);
  return { ...result, file: path.join(guestData, 'autostart.json') };
}
