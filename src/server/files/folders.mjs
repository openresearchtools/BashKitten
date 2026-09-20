import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { existingDirectory } from '../common.mjs';

const contains = (root, target) => { const relative = path.relative(root, target); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
export async function folderLocations() {
  const home = await fs.realpath(os.homedir());
  return [{ path: home, label: process.platform === 'android' ? 'Termux home' : 'Home', display: '~' }];
}
export async function pickerDirectory(input, nearest = false) {
  const locations = await folderLocations();
  let requested = input || '~';
  let folder;
  for (;;) {
    try { folder = await existingDirectory(requested); await fs.readdir(folder); await fs.access(folder, constants.R_OK | constants.W_OK | constants.X_OK); break; }
    catch (error) {
      if (!nearest) throw error;
      if (!path.isAbsolute(requested) || requested === path.dirname(requested)) { folder = locations[0].path; break; }
      requested = path.dirname(requested);
    }
  }
  let location = locations.find(l => contains(l.path, folder));
  if (!location) {
    if (!nearest) throw Error('Choose a writable folder inside your home');
    location = locations[0]; folder = location.path;
  }
  return { path: folder, parent: folder === location.path ? null : path.dirname(folder), locations,
    displayPath: location.display === '/' ? folder : location.display + (path.relative(location.path, folder) ? '/' + path.relative(location.path, folder) : '') };
}
export async function listFolders(input, nearest) {
  const result = await pickerDirectory(input, nearest), folders = [];
  for (const entry of await fs.readdir(result.path, { withFileTypes: true })) {
    try {
      const target = path.join(result.path, entry.name), real = await fs.realpath(target);
      if (!result.locations.some(l => contains(l.path, real))) continue;
      if (!(await fs.stat(real)).isDirectory()) continue;
      await fs.access(real, constants.R_OK | constants.W_OK | constants.X_OK);
      await fs.readdir(real); // Do not offer folders this Termux process cannot browse.
      folders.push({ name: entry.name, path: real });
    } catch {}
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  return { ...result, folders };
}
