/* Populate npm's own cache solely from verified locked source archives. AGPL-3.0-or-later. */
const fs = require('node:fs/promises');
const path = require('node:path');
const {createRequire} = require('node:module');
(async () => {
  const [npmPath, cachePath, sourcePath] = process.argv.slice(2);
  const npmRequire = createRequire(await fs.realpath(npmPath));
  const cacache = npmRequire('cacache');
  const manifest = JSON.parse(await fs.readFile(path.join(sourcePath, 'SOURCES.json'), 'utf8'));
  for (const entry of manifest.archives) {
    await cacache.put(path.join(cachePath, '_cacache'), `make-fetch-happen:request-cache:${entry.url}`,
      await fs.readFile(path.join(sourcePath, entry.archive)), {integrity:entry.integrity,algorithms:[entry.integrity.split('-')[0]],metadata:{time:Date.now(),url:entry.url,reqHeaders:{},resHeaders:{'content-type':'application/octet-stream'},options:{compress:true}}});
  }
})().catch(error => {console.error(error.message);process.exitCode = 1;});
