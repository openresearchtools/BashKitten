// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const directoryFlags = (constants.O_PATH ?? 0x200000) | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const sameFile = (a, b) => a?.isFile() && b?.isFile() && a.dev === b.dev && a.ino === b.ino;
const statOrNull = file => fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });

async function parentDirectory(file) {
  if (typeof file !== 'string' || file.includes('\0') || !path.isAbsolute(file) || !path.basename(file)) throw Error('Choose an absolute file path');
  const directory = await fs.realpath(path.dirname(file));
  let handle = await fs.open('/', directoryFlags);
  try {
    // Pin every ancestor; a changed parent cannot redirect publication later.
    for (const component of directory.split('/').filter(Boolean)) {
      const next = await fs.open(`/proc/self/fd/${handle.fd}/${component}`, directoryFlags);
      await handle.close(); handle = next;
    }
    const readable = await fs.open(`/proc/self/fd/${handle.fd}/.`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    await handle.close(); return readable;
  } catch (error) { await handle.close(); throw error; }
}

// Publish a completed sibling temporary file without ever replacing a target.
// The caller owns removal of its temporary file/directory after this returns.
export async function publishNewFile(temporary, output) {
  let sourceParent, targetParent, source;
  try {
    sourceParent = await parentDirectory(temporary); targetParent = await parentDirectory(output);
    const from = `/proc/self/fd/${sourceParent.fd}/${path.basename(temporary)}`;
    const to = `/proc/self/fd/${targetParent.fd}/${path.basename(output)}`;
    source = await fs.open(from, constants.O_RDONLY | constants.O_NOFOLLOW);
    const identity = await source.stat();
    if (!identity.isFile() || identity.dev !== (await targetParent.stat()).dev) throw Error('Create the temporary file on the output filesystem');
    if (await statOrNull(to)) throw Error('The output file already exists; choose another filename');
    await source.sync();
    if (process.platform === 'android' || process.env.BASHKITTEN_TERMUX === '1') {
      // Android app SELinux prohibits link(2). Termux coreutils uses native
      // renameat2(RENAME_NOREPLACE) for this same-filesystem no-clobber move.
      await new Promise((resolve, reject) => {
        const child = spawn('mv', ['--no-clobber', '--no-target-directory', '--',
          '/proc/self/fd/3/' + path.basename(temporary), '/proc/self/fd/4/' + path.basename(output)],
        { stdio: ['ignore', 'ignore', 'ignore', sourceParent.fd, targetParent.fd] });
        const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
        let failure;
        child.once('error', error => { failure = error; });
        child.once('close', code => { clearTimeout(timer); failure || code !== 0 ? reject(failure || Error('Could not publish the completed file')) : resolve(); });
      });
    } else await fs.link(from, to);
    // mv -n exits successfully when it skips an existing target. Verify the
    // inode, not its exit status, before reporting a successful publication.
    if (!sameFile(await statOrNull(to), identity)) throw Error('The output filename became occupied; choose another filename');
    await targetParent.sync();
  } finally {
    await source?.close(); await sourceParent?.close(); await targetParent?.close();
  }
}
