/* Populate npm's own cache solely from verified locked source archives. AGPL-3.0-or-later. */
const fs = require('node:fs/promises');
const path = require('node:path');
const {createRequire} = require('node:module');
(async () => {
  const [npmPath, cachePath, manifestPath] = process.argv.slice(2);
  const npmRequire = createRequire(await fs.realpath(npmPath));
  const cacache = npmRequire('cacache');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const lock = JSON.parse(await fs.readFile(manifest.lockfile, 'utf8'));
  const lockedIntegrity = new Map();
  for (const item of Object.values(lock.packages)) {
    if (!item.resolved || !item.integrity) continue;
    if (!lockedIntegrity.has(item.resolved)) lockedIntegrity.set(item.resolved, new Set());
    lockedIntegrity.get(item.resolved).add(item.integrity);
  }
  for (const entry of manifest.archives) {
    if (!path.isAbsolute(entry.path)) throw Error('Expected a verified absolute source-cache path');
    const data = await fs.readFile(entry.path);
    // A released lock can use different SRI algorithms for the same URL in
    // nested dependencies. Seed and verify every original variant unchanged.
    for (const integrity of new Set([entry.integrity, ...(lockedIntegrity.get(entry.url) || [])])) {
      await cacache.put(path.join(cachePath, '_cacache'), `make-fetch-happen:request-cache:${entry.url}`,
        data, {integrity,algorithms:[integrity.split('-')[0]],metadata:{time:Date.now(),url:entry.url,reqHeaders:{},resHeaders:{'content-type':'application/octet-stream'},options:{compress:true}}});
    }
  }
})().catch(error => {console.error(error.message);process.exitCode = 1;});
