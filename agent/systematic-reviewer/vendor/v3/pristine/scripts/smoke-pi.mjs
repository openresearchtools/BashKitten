// Load through Pi's real resource/extension loader without a model, auth or session.
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const sdk = await import(process.env.PI_SDK_ENTRY ? pathToFileURL(resolve(process.env.PI_SDK_ENTRY)).href : '@earendil-works/pi-coding-agent').catch(error => {
  throw new Error('Pi SDK not found. Run with an installed SDK peer or set PI_SDK_ENTRY to the installed pi-coding-agent/dist/index.js. No global installs are needed.', { cause: error });
});
const temporary = await mkdtemp(join(tmpdir(), 'sr-pi-smoke-'));
try {
  const loader = new sdk.DefaultResourceLoader({
    cwd: temporary,
    agentDir: join(temporary, 'agent'),
    settingsManager: sdk.SettingsManager.inMemory({ packages: [root] }),
    noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, [], 'Extension loading errors');
  assert.deepEqual(loaded.warnings ?? [], [], 'Extension loading warnings');
  assert.equal(loaded.extensions.length, 1);
  const skills = loader.getSkills();
  assert.deepEqual(skills.diagnostics, []);
  assert.deepEqual(skills.skills.map(skill => skill.name), ['systematic-review']);
  const tools = loaded.extensions[0].tools;
  assert.deepEqual([...tools.keys()].sort(), ['review_citation', 'review_export_docx', 'review_render_citations', 'review_zotero']);
  const context = { cwd: root };
  const signal = new AbortController().signal;
  const execute = (name, input) => tools.get(name).definition.execute('smoke-test', input, signal, undefined, context);
  const marker = await execute('review_citation', { items: [{ id: 'users/123/items/ABCD2345', locator: '12' }] });
  assert.match(marker.structuredContent.marker, /sr-cite:/);
  const params = { input: 'examples/manuscript.md', references: 'examples/references.json' };
  const rendered = await execute('review_render_citations', { ...params, output: join(temporary, 'rendered.md') });
  assert.equal(rendered.structuredContent.citations, 3);
  assert.match(await readFile(rendered.details.path, 'utf8'), /Smith, 2024/);
  await assert.rejects(() => execute('review_render_citations', { ...params, output: rendered.details.path }), { code: 'EEXIST' });
  const exported = await execute('review_export_docx', { ...params, output: join(temporary, 'report.docx') });
  assert.equal((await readFile(exported.details.path)).subarray(0, 2).toString(), 'PK');
  await assert.rejects(() => execute('review_export_docx', { ...params, output: params.input }), /must not replace/);
  const cancelled = AbortSignal.abort(new Error('cancelled'));
  await assert.rejects(() => tools.get('review_render_citations').definition.execute('cancel', { ...params, output: join(temporary, 'cancelled.md') }, cancelled, undefined, context), /cancelled/);
  console.log('Pi smoke passed: package manifest, one umbrella skill, four native tools, Markdown render, live DOCX export, overwrite protection and cancellation. No model/network calls.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
