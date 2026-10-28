import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readText, writeOutput } from '../lib/io.mjs';
async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sr-io-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('atomic writes refuse overwrites, allow explicit replacement and clean up', async t => {
  const dir = await workspace(t);
  const path = join(dir, 'report.md');
  await writeOutput(path, 'original');
  await assert.rejects(() => writeOutput(path, 'replacement'), { code: 'EEXIST' });
  assert.equal(await readText(path), 'original');
  await writeOutput(path, 'replacement', { overwrite: true });
  assert.equal(await readText(path), 'replacement');
  assert.deepEqual(await readdir(dir), ['report.md']);
});

test('racing publishers never clobber the winner', async t => {
  const dir = await workspace(t);
  const path = join(dir, 'report.md');
  const results = await Promise.allSettled([writeOutput(path, 'first'), writeOutput(path, 'second')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(['first', 'second'].includes(await readText(path)));
});

test('read boundaries and invalid UTF-8 fail instead of silently truncating', async t => {
  const dir = await workspace(t);
  const path = join(dir, 'report.md');
  await writeOutput(path, 'a'.repeat(100));
  await assert.rejects(() => readText(path, { maxBytes: 99 }), /larger/);
  await assert.rejects(() => readText(dir), /regular/);
  await writeFile(path, Buffer.from([0xff]));
  await assert.rejects(() => readText(path), /encoded data/);
});

test('cancelled writes do not create output', async t => {
  const dir = await workspace(t);
  await assert.rejects(() => writeOutput(join(dir, 'file'), 'x', { signal: AbortSignal.abort(new Error('cancelled')) }), /cancelled/);
  assert.deepEqual(await readdir(dir), []);
});
