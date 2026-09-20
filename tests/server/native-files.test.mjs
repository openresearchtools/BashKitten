import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

test('Native file actions preserve Unicode paths and reject escaped project files', async t => {
  const dir = await fs.mkdtemp(path.join(os.homedir(), '.bk-files-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  process.env.BASHKITTEN_DATA_DIR = path.join(dir, 'data');
  const { nativeFile } = await import('../../src/server/platform/linux/files.mjs');
  const project = path.join(dir, 'project'); await fs.mkdir(project);
  const file = path.join(project, 'flower 🌸 note.txt'); await fs.writeFile(file, 'A flower');
  const url = '/api/files/content?root=' + encodeURIComponent(project) + '&path=';
  assert.equal((await nativeFile({ url: url + encodeURIComponent(path.basename(file)) })).path, file);
  assert.equal((await nativeFile({ folder: project })).path, project);
  await fs.symlink(os.homedir(), path.join(project, 'escape'));
  await assert.rejects(nativeFile({ url: url + 'escape' }), /leaves this working folder/);
  await assert.rejects(nativeFile({ url: 'https://example.org/file.txt' }), /Only local artifacts/);
  const image = await fs.readFile(new URL('../fixtures/images/small.png', import.meta.url));
  const inline = 'data:image/png;base64,' + image.toString('base64');
  const first = await nativeFile({ url: inline }), second = await nativeFile({ url: inline });
  assert.equal(first.path, second.path);
  assert.deepEqual(await fs.readFile(first.path), image);
});
