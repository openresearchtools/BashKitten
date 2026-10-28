import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
async function files(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await files(path));
    else output.push(path);
  }
  return output;
}
let count = 0;
for (const directory of ['lib', 'extensions', 'scripts', 'test']) {
  for (const file of await files(join(root, directory))) {
    if (!/\.m?js$/.test(file)) continue;
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(checked.status, 0, `${file}: ${checked.stderr}`);
    count++;
  }
}
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
assert.deepEqual(manifest.pi.skills, ['./skills/systematic-review/SKILL.md']);
assert.deepEqual(manifest.pi.extensions, ['./extensions/index.js']);
for (const peer of ['@earendil-works/pi-coding-agent', 'typebox']) {
  assert.equal(manifest.peerDependencies[peer], '*');
  assert.ok(!manifest.dependencies[peer]);
}
const skills = (await files(join(root, 'skills'))).filter(file => file.endsWith('/SKILL.md'));
for (const skill of skills) {
  const content = await readFile(skill, 'utf8');
  const name = content.match(/^name: (.+)$/m)?.[1];
  const description = content.match(/^description: (.+)$/m)?.[1];
  assert.ok(name && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64, `Invalid skill name: ${skill}`);
  assert.ok(description && description.length <= 1024, `Invalid skill description: ${skill}`);
  assert.ok(content.startsWith('---\n') && content.indexOf('\n---', 4) > 0, `Missing frontmatter: ${skill}`);
}
// Verify local Markdown links across skills/docs/README; URL and fragment links
// are intentionally excluded. This is a syntax/resource check, not a typecheck.
for (const file of [...await files(join(root, 'skills')), ...await files(join(root, 'docs')), join(root, 'README.md'), join(root, 'AGENTS.md')]) {
  if (!file.endsWith('.md')) continue;
  const content = await readFile(file, 'utf8');
  for (const match of content.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    await access(resolve(dirname(file), target));
  }
}
console.log(`Checks passed: ${count} JS modules, ${skills.length} skill files, package resources and local documentation links.`);
