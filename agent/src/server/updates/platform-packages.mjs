import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// npm can retain foreign optional binaries below Pi's nested shrinkwrap.
// Honor their published platform constraints without changing Pi or its graph.
export async function selectPlatformPackages(root, os = process.platform, cpu = process.arch) {
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const accepts = (list, value) => !list || (!list.includes('!' + value) && (list.every(item => item.startsWith('!')) || list.includes(value)));
  let removed = 0;
  for (const [name, item] of Object.entries(lock.packages)) {
    if (!item.optional || (accepts(item.os, os) && accepts(item.cpu, cpu))) continue;
    if (!name.startsWith('node_modules/') || name.split('/').includes('..')) throw Error('Invalid optional package path');
    await fs.rm(path.join(root, name), { recursive: true, force: true });
    removed++;
  }
  // Pi's TUI tarball also contains native helpers for every desktop OS/CPU.
  // Its stock loader selects native/<os>/prebuilds/<os>-<arch>; Android never
  // loads these desktop helpers. Keep the selected bytes and all source/notices.
  for (const location of Object.keys(lock.packages)) {
    if (!location.endsWith('/@earendil-works/pi-tui')) continue;
    if (!location.startsWith('node_modules/') || location.split('/').includes('..')) throw Error('Invalid Pi package path');
    const native = path.join(root, location, 'native');
    const platforms = await fs.readdir(native, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const platform of platforms) {
      if (!platform.isDirectory()) continue;
      const prebuilds = path.join(native, platform.name, 'prebuilds');
      const targets = await fs.readdir(prebuilds).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      for (const target of targets) {
        if (platform.name !== os || target !== `${os}-${cpu}`) await fs.rm(path.join(prebuilds, target), { recursive: true, force: true });
      }
    }
  }
  return removed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('Omitted', await selectPlatformPackages(...process.argv.slice(2)), 'optional packages for other platforms');
}
