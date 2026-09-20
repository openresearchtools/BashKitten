import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pruneRuntimes } from '../../src/server/updates/runtime.mjs';

test('Runtime cleanup retains active, previous, terminal, unowned and symlinked directories', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-runtime-cleanup-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const roots = [];
  for (let n = 0; n < 6; n++) {
    const root = path.join(parent, `0.${n}.0-aaaaaaaaaaaa`); roots.push(root); await fs.mkdir(root);
    if (n < 5) await fs.writeFile(path.join(root, 'managed.json'), JSON.stringify({ owner: 'bashkitten', version: `0.${n}.0`, lockSha256: 'a'.repeat(64) }));
    if (n < 5) { const old = new Date(Date.now() - 8 * 86400000); await fs.utimes(path.join(root, 'managed.json'), old, old); }
    await fs.writeFile(path.join(root, 'retained.txt'), 'runtime fixture');
  }
  const link = path.join(parent, '0.7.0-aaaaaaaaaaaa'); await fs.symlink(roots[5], link);
  await pruneRuntimes(parent, new Set(roots.slice(0, 3)), [['node', path.join(roots[3], 'node_modules/pi/dist/cli.js')]]);
  await assert.rejects(fs.stat(roots[4]), { code: 'ENOENT' });
  for (const root of [...roots.slice(0, 4), roots[5], link]) assert.equal(await fs.readFile(path.join(root, 'retained.txt'), 'utf8'), 'runtime fixture');
});
