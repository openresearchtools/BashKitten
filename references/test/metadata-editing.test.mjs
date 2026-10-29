// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { JSDOM } from 'jsdom';
import { Store } from '../store/index.mjs';
import { createAttachmentStorage } from '../attachment-storage.mjs';
import { attachmentExtension } from '../attachment-names.mjs';
import { importReferenceFile } from '../../agent/pi/references-files.mjs';
import { createReferencesService } from '../index.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await tick();
  }
  assert.fail('Expected UI update did not complete');
}

test('native metadata editor exposes every schema field and canonical identifiers through versioned API', async t => {
  const html = await fs.readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const schema = JSON.parse(await fs.readFile(new URL('../vendor/schema/source/schema.json', import.meta.url), 'utf8'));
  const dom = new JSDOM(html, { url: 'https://references.test/manager/' });
  const savedGlobals = new Map();
  function global(name, value) {
    savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  for (const name of ['window', 'document', 'location', 'history', 'navigator', 'Option', 'DOMParser', 'Node']) global(name, dom.window[name]);
  global('ResizeObserver', class { observe() {} disconnect() {} });
  global('confirm', () => true);
  const requests = [];
  let item = { key: 'ITEM1', id: 'bkref:backend/P1/ITEM1', version: 7, data: {
    itemType: 'journalArticle', title: 'Original title', publicationTitle: 'Original journal', DOI: '10.1234/original',
    abstractNote: 'Original abstract', creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Lovelace', ORCID: '0000-0001-2345-6789', OpenAlex: 'A123' }],
    tags: [], provenance: { identifierAliases: { DOI: ['10.1234/alternate'] }, source: 'fixture' },
  } };
  const attachment = { key: 'ATTACH1', id: 'bkref:backend/P1/ATTACH1', version: 3, data: { itemType: 'attachment', title: 'Local document', contentType: 'application/xml', parentItem: item.key, linkMode: 'imported_file' } };
  let children = [attachment], conflict = false;
  global('fetch', async (input, options = {}) => {
    const uri = new URL(input), route = uri.pathname.split('/api/')[1], method = options.method || 'GET';
    const body = options.body && JSON.parse(options.body);
    requests.push({ route, method, body, query: uri.searchParams });
    let value;
    if (route === 'context') value = { backendId: 'backend', projectId: 'P1' };
    else if (route === 'projects?includeArchived=true' || route === 'projects') value = [{ id: 'P1', name: 'Default', isDefault: true }];
    else if (route === 'projects/P1/schema') value = schema;
    else if (route === 'projects/P1/jobs') value = { items: [] };
    else if (route === 'projects/P1/items' && method === 'GET') value = { items: [item], version: item.version, total: 1 };
    else if (route === 'projects/P1/items/ITEM1/children') value = { items: children };
    else if (route === 'projects/P1/items/ITEM1' && method === 'GET') value = item;
    else if (route === 'projects/P1/items/ITEM1' && method === 'PUT') {
      if (conflict) return { ok: false, status: 412, json: async () => ({ error: 'Record changed' }) };
      item = { ...item, version: item.version + 1, data: body.data }; value = item;
    } else if (route === 'projects/P1/items/ATTACH1' && method === 'DELETE') { children = []; value = { deleted: true }; }
    else if (route === 'projects/P1/items/enrich') value = { id: 'JOB1', kind: 'enrich', status: 'complete', completed: 1, total: 1 };
    else throw Error('Unexpected fixture API request: ' + method + ' ' + route);
    return { ok: true, status: 200, json: async () => structuredClone(value) };
  });
  t.after(() => {
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide'));
    dom.window.close();
    for (const [name, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  await import('../web/app.js');
  await until(() => document.querySelector('#items .record-row'));
  document.querySelector('#items .virtual-row').click();
  await until(() => document.querySelector('.detail-form'));
  const input = name => document.querySelector('.detail-form [name="' + name + '"]');
  for (const { field } of schema.itemTypes.find(type => type.itemType === 'journalArticle').fields)
    if (field !== 'abstractNote') assert.ok(input(field), 'Native field ' + field + ' is editable');
  for (const name of ['DOI', 'PMID', 'PMCID', 'OpenAlex', 'arXiv']) assert.ok(input(name));
  assert.equal(input('identifierAliases.DOI').value, '10.1234/alternate');
  assert.ok([...document.querySelectorAll('.detail-form details[open]')].some(section => section.querySelector('summary')?.textContent === 'Abstract'));
  const change = (control, value) => { control.value = value; control.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  change(input('title'), 'Human corrected title');
  change(input('publicationTitle'), 'Corrected journal');
  change(input('PMID'), '12345');
  change(input('DOI'), '10.1234/changed');
  assert.equal(input('identifierAliases.DOI').value, '');
  assert.equal(input('identifierAliases.DOI').disabled, true);
  const submit = () => document.querySelector('.detail-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  submit();
  await until(() => item.version === 8 && !document.querySelector('.detail-form button[type="submit"]').disabled);
  const write = requests.find(request => request.method === 'PUT');
  assert.equal(write.body.version, 7);
  assert.equal(write.body.data.title, 'Human corrected title');
  assert.equal(write.body.data.publicationTitle, 'Corrected journal');
  assert.equal(write.body.data.PMID, '12345');
  assert.equal(write.body.data.creators[0].ORCID, '0000-0001-2345-6789');
  assert.equal(write.body.data.creators[0].OpenAlex, 'A123');
  assert.equal(write.body.data.provenance.source, 'fixture');
  change(input('identifierAliases.PMID'), '456\n789');
  submit();
  await until(() => item.version === 9 && !document.querySelector('.detail-form button[type="submit"]').disabled);
  assert.deepEqual(item.data.provenance.identifierAliases.PMID, ['456', '789']);
  const enrich = [...document.querySelectorAll('.detail-actions button')].find(button => button.textContent === 'Enrich metadata');
  enrich.click();
  await until(() => requests.some(request => request.route === 'projects/P1/items/enrich'));
  assert.deepEqual(requests.find(request => request.route === 'projects/P1/items/enrich').body.keys, ['ITEM1']);
  await until(() => document.querySelector('.attachment-delete'));
  document.querySelector('.attachment-delete').click();
  await until(() => children.length === 0);
  assert.equal(requests.find(request => request.method === 'DELETE').body.version, 3);
  conflict = true;
  change(input('title'), 'Unsent conflict correction');
  submit();
  await until(() => document.querySelector('#details .notice').textContent.includes('changed elsewhere'));
  assert.equal(input('title').value, 'Unsent conflict correction');
  assert.ok(requests.filter(request => request.route === 'projects/P1/items' && request.method === 'GET').every(request => Number(request.query.get('limit')) <= 80));
  assert.equal(document.querySelectorAll('#items .virtual-row').length, 1);
});

test('same-content attachments retain arbitrary extensions and all registered files relocate', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bkref-attachments-'));
  const store = new Store();
  t.after(async () => { await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const project = { id: 'P1', cwd: directory, file: path.join(directory, 'library.sqlite') };
  const storage = createAttachmentStorage({ call: (p, operation, args, signal) => store.call(p.file, operation, args, signal) });
  const parent = await store.call(project.file, 'put', { value: { itemType: 'journalArticle', title: 'Same document' } });
  const bytes = Buffer.from('Identical fixture bytes');
  const saved = [];
  for (const extension of ['.pdf', '.docx', '.xml', '.custom']) {
    assert.equal(attachmentExtension({ filename: 'original' + extension }), extension);
    for (let copy = 1; copy <= 3; copy++) {
      const file = await storage.createFile(project, { parentKey: parent.key, baseName: 'Same document', extension, body: bytes });
      assert.equal(file.filename, 'Same document' + (copy > 1 ? '-' + copy : '') + extension);
      saved.push(await store.call(project.file, 'put', { value: { itemType: 'attachment', parentItem: parent.key, title: 'Same document', filename: file.filename, path: file.path, pathBase: file.pathBase, linkMode: 'imported_file', contentType: 'application/octet-stream' } }));
    }
  }
  assert.equal(attachmentExtension({ contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), '.docx');
  assert.equal(attachmentExtension({ contentType: 'application/xml; charset=utf-8' }), '.xml');
  assert.equal(attachmentExtension({ filename: 'C:\\folder\\paper.custom' }), '.custom');
  const initial = await storage.currentProject(project);
  const moved = await storage.moveBibliography(project, { bibliographyPath: path.join(directory, 'Relocated'), expectedBibliographyPath: initial.bibliographyPath });
  assert.equal(moved.moved, saved.length);
  assert.equal(moved.cleanupPending, false);
  for (const before of saved) {
    const item = await store.call(project.file, 'get', { key: before.key });
    assert.equal(item.data.filename, before.data.filename);
    const file = await storage.attachmentPath(project, item);
    assert.ok(file.startsWith(path.join(directory, 'Relocated') + path.sep));
    assert.deepEqual(await fs.readFile(file), bytes);
    await assert.rejects(fs.stat(path.join(initial.bibliographyPath, before.data.path)), { code: 'ENOENT' });
  }
});

test('Pi streams DOCX/XML files with original filename through the shared upload protocol', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bkref-pi-files-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const [extension, contentType] of [['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ['.xml', 'application/xml'], ['.custom', 'application/octet-stream']]) {
    const file = path.join(directory, 'Evidence' + extension);
    await fs.writeFile(file, 'local fixture bytes');
    const calls = [];
    const reply = await importReferenceFile(file, '/projects/P1/connector/saveAttachment', { parentKey: 'ITEM1', requestId: 'request' + extension }, {
      request: async request => {
        calls.push(request);
        if (request.path.endsWith('/upload-begin')) return { status: 200, body: { uploadId: 'UPLOAD1', offset: 0 } };
        if (request.path.endsWith('/upload-chunk')) return { status: 200, body: { offset: Buffer.from(request.body.data, 'base64').length } };
        if (request.path.endsWith('/upload-commit')) return { status: 201, body: { key: 'ATTACH1' } };
        throw Error('Unexpected upload operation');
      },
    });
    const metadata = JSON.parse(calls[0].body.headers['X-Metadata']);
    assert.equal(metadata.filename, 'Evidence' + extension);
    assert.equal(metadata.contentType, contentType);
    assert.equal(metadata.parentItemID, 'ITEM1');
    assert.equal(reply.body.key, 'ATTACH1');
  }
});

test('actual Pi references tool accepts complete native metadata without a field whitelist', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bkref-pi-api-'));
  const socket = path.join(directory, 'worker.sock'), requests = [];
  const server = http.createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer fixture-private-worker');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const value = JSON.parse(Buffer.concat(chunks));
    requests.push(value);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ status: 200, body: { key: 'CANONICAL1', version: 8, data: value.body.data } }));
  });
  await new Promise(resolve => server.listen(socket, resolve));
  const previous = { socket: process.env.BASHKITTEN_WORKER_SOCKET, key: process.env.BASHKITTEN_WORKER_KEY };
  process.env.BASHKITTEN_WORKER_SOCKET = socket;
  process.env.BASHKITTEN_WORKER_KEY = 'fixture-private-worker';
  t.after(async () => {
    if (previous.socket === undefined) delete process.env.BASHKITTEN_WORKER_SOCKET; else process.env.BASHKITTEN_WORKER_SOCKET = previous.socket;
    if (previous.key === undefined) delete process.env.BASHKITTEN_WORKER_KEY; else process.env.BASHKITTEN_WORKER_KEY = previous.key;
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const { default: register } = await import('../../agent/pi/office-references.mjs');
  const tools = new Map();
  register({ registerTool: tool => tools.set(tool.name, tool) });
  const references = tools.get('references');
  assert.ok(references.parameters.properties.body);
  assert.equal(references.parameters.properties.body.additionalProperties, undefined);
  const data = {
    itemType: 'journalArticle', title: 'Agent correction', publicationTitle: 'Journal', volume: '2', issue: '3', pages: '4-8',
    abstractNote: 'Verified abstract', DOI: '10.1234/a', PMID: '123', PMCID: 'PMC456', OpenAlex: 'W789', arXiv: '2301.12345',
    creators: [{ creatorType: 'author', name: 'Study Consortium', ORCID: '0000-0001-2345-6789', OpenAlex: 'A123' }],
    provenance: { identifierAliases: { PMID: ['789'] } },
  };
  const reply = await references.execute('fixture', { method: 'PATCH', path: '/projects/P1/items/ITEM1', body: { version: 7, data } }, new AbortController().signal, undefined, { cwd: directory });
  assert.equal(reply.isError, undefined);
  assert.deepEqual(requests, [{ component: 'references', method: 'PATCH', path: '/projects/P1/items/ITEM1', body: { version: 7, data } }]);
  assert.deepEqual(reply.details.body.data, data);
  assert.equal(reply.details.body.key, 'CANONICAL1');
});

test('Pi upload reaches native naming and real service storage with DOCX/XML/other suffixes intact', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bkref-upload-service-'));
  const service = await createReferencesService({ dataDir: path.join(directory, 'data'), backendId: 'fixture',
    authorizeProject: async (_authority, id) => ({ id, cwd: directory }) });
  t.after(async () => { await service.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const created = await service.handle({ method: 'POST', path: '/projects/P1/items', body: { data: { itemType: 'journalArticle', title: 'Native filename' } } });
  assert.equal(created.status, 201);
  const parent = created.body[0], keys = new Set();
  for (const extension of ['.docx', '.xml', '.custom']) {
    const local = path.join(directory, 'Evidence' + extension);
    await fs.writeFile(local, 'Same bytes, separate upload identities.');
    for (let copy = 1; copy <= 2; copy++) {
      const reply = await importReferenceFile(local, '/projects/P1/connector/saveAttachment', { parentKey: parent.key, requestId: extension + copy }, {
        request: request => service.handle(request),
      });
      assert.equal(reply.status, 200);
      keys.add(reply.body.key);
      assert.equal(reply.body.data.filename, 'Native filename' + (copy === 2 ? '-2' : '') + extension);
      const file = await service.handle({ method: 'GET', path: '/projects/P1/items/' + reply.body.key + '/file' });
      assert.equal(file.status, 200);
      assert.equal(path.extname(file.filePath), extension);
      assert.equal(await fs.readFile(file.filePath, 'utf8'), 'Same bytes, separate upload identities.');
    }
  }
  assert.equal(keys.size, 6);
});
