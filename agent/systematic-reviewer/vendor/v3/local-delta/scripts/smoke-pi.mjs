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
const originalEnvironment = Object.fromEntries(['SYSTEMATIC_REVIEW_CONFIG', 'OPENALEX_API_KEY', 'ZOTERO_API_KEY', 'ZOTERO_LOCAL_URL'].map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
try {
  process.env.SYSTEMATIC_REVIEW_CONFIG = join(temporary, 'credentials.json');
  delete process.env.OPENALEX_API_KEY;
  delete process.env.ZOTERO_API_KEY;
  delete process.env.ZOTERO_LOCAL_URL;
  globalThis.fetch = async () => assert.fail('Unexpected network request');
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
  const commands = loaded.extensions[0].commands;
  assert.deepEqual([...commands.keys()], ['review-setup']);
  const setupMessages = [];
  const setupContext = { cwd: root, hasUI: true, mode: 'tui', ui: {
    select: async () => 'Enter or replace saved key',
    input: async () => 'SYNTHETIC-SMOKE-KEY',
    notify: message => setupMessages.push(message),
  } };
  await commands.get('review-setup').handler('openalex', setupContext);
  assert.ok(setupMessages.some(message => message.includes('key saved locally')));
  assert.ok(setupMessages.every(message => !message.includes('SYNTHETIC-SMOKE-KEY')));
  const context = { cwd: root };
  assert.equal(tools.get('review_zotero').definition.parameters.properties.mode, undefined);
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
  // Reject stale cloud requests before fetching; do not silently read another source.
  await assert.rejects(() => execute('review_zotero', { operation: 'search', mode: 'web', library: 'users/123', output: join(temporary, 'rejected.json') }), /only the local HTTP API/);
  // Local Zotero must remain usable even if unrelated OpenAlex setup is invalid.
  process.env.SYSTEMATIC_REVIEW_CONFIG = 'invalid-relative-config-path';
  process.env.ZOTERO_API_KEY = 'SYNTHETIC-IGNORED-KEY';
  globalThis.fetch = async (url, options) => {
    assert.equal(url.origin, 'http://127.0.0.1:23119');
    assert.equal(options.headers['Zotero-API-Key'], undefined);
    return new Response('[]', { headers: { 'Total-Results': '0' } });
  };
  assert.equal((await execute('review_zotero', { operation: 'search', output: join(temporary, 'local-references.json') })).details.count, 0);
  console.log('Pi smoke passed: one umbrella skill, four native tools, OpenAlex setup with isolated credentials, local-only Zotero without keys, Markdown render, live DOCX export, overwrite protection and cancellation. No model/network calls.');
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(temporary, { recursive: true, force: true });
}
