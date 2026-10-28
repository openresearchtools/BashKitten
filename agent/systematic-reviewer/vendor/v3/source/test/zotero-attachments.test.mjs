// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ZoteroClient } from '../lib/zotero.mjs';
import { listAttachments, attachmentText } from '../lib/zotero-attachments.mjs';
import { main } from '../scripts/zotero.mjs';

const parentId = 'users/local/abc123/items/PARENT01';
const attachmentId = 'users/local/abc123/items/ATTACH01';
const library = { type: 'user', id: 0 };
const parent = { key: 'PARENT01', library, version: 1, data: { key: 'PARENT01', itemType: 'journalArticle' },
  csljson: JSON.stringify([{ id: `http://zotero.org/${parentId}`, type: 'article-journal', title: 'Synthetic paper' }]) };
const attachment = { key: 'ATTACH01', library, version: 2, data: { key: 'ATTACH01', itemType: 'attachment', parentItem: 'PARENT01',
  title: 'Synthetic PDF', filename: 'paper.pdf', contentType: 'application/pdf', linkMode: 'imported_file', url: 'https://example.org/paper.pdf' } };
const cached = { content: 'Full cached text\nSecond page.', indexedPages: 2, totalPages: 2 };
function fixture({ parentItem = parent, attachmentItem = attachment, children = [attachment], text = cached, total = '1', textStatus = 200, responseHeaders = {} } = {}) {
  const calls = [];
  const client = new ZoteroClient({ fetch: async (url, options) => {
    calls.push({ url, options });
    assert.equal(url.origin, 'http://127.0.0.1:23119');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['Zotero-API-Key'], undefined);
    if (calls.length > 1) assert.equal(options.headers['Zotero-Server-ID'], 'synthetic-instance');
    const headers = { 'Zotero-Server-ID': 'synthetic-instance', ...responseHeaders };
    if (url.pathname.endsWith('/children')) return new Response(JSON.stringify(children), { headers: { ...headers, ...(total === null ? {} : { 'Total-Results': total }) } });
    if (url.pathname.endsWith('/fulltext')) return new Response(JSON.stringify(text), { status: textStatus, headers });
    if (url.pathname.endsWith('/PARENT01')) return new Response(JSON.stringify(parentItem), { headers });
    if (url.pathname.endsWith('/ATTACH01')) return new Response(JSON.stringify(attachmentItem), { headers });
    assert.fail('Unexpected API route');
  } });
  return { client, calls };
}

test('attachment manifest verifies a local parent and relationship before qualifying child keys', async () => {
  const mock = fixture({ total: '3' });
  const result = await listAttachments({ id: parentId, limit: 1 }, mock);
  assert.equal(result.items[0].id, attachmentId);
  assert.equal(result.items[0].parentId, parentId);
  assert.equal(result.items[0].filename, 'paper.pdf');
  assert.equal(result.page.nextStart, 1);
  assert.equal(result.page.total, 3);
  assert.equal(mock.calls[0].url.searchParams.get('include'), 'data,csljson');
  assert.equal(mock.calls[1].url.searchParams.get('itemType'), 'attachment');
  assert.equal(mock.calls[1].url.searchParams.get('limit'), '1');
  assert.ok(mock.calls.every(call => !call.url.pathname.includes('/file') && !call.url.pathname.includes('/fulltext')));
});

test('fulltext preserves all cached text and reports page or character coverage honestly', async () => {
  for (const [text, expectedStatus, coverage] of [
    [cached, 'available', 'complete'],
    [{ ...cached, indexedPages: 1 }, 'available', 'partial'],
    [{ content: 'characters', indexedChars: 10, totalChars: 20 }, 'available', 'partial'],
    [{ content: 'coverage unknown' }, 'available', 'unknown'],
    [{ content: '', indexedPages: 0, totalPages: 2 }, 'empty', 'partial'],
  ]) {
    const mock = fixture({ text });
    const result = await attachmentText({ id: attachmentId }, mock);
    assert.equal(result.content, text.content);
    assert.equal(result.status, expectedStatus);
    assert.equal(result.coverage.status, coverage);
    assert.equal(result.item.id, attachmentId);
    assert.match(result.provenance.source, /ATTACH01\/fulltext$/);
    assert.match(result.note, /not proof/);
    assert.equal(mock.calls.length, 3);
    assert.ok(mock.calls.every(call => !call.url.pathname.includes('/file')));
  }
});

test('missing cached text is distinct from successful empty or partial extraction', async () => {
  const result = await attachmentText({ id: attachmentId }, fixture({ text: { secret: 'DO_NOT_ECHO' }, textStatus: 404 }));
  assert.equal(result.status, 'missing');
  assert.equal(result.content, null);
  assert.equal(result.coverage.status, 'unknown');
  assert.match(result.provenance.source, /\/fulltext$/);
  assert.ok(!JSON.stringify(result).includes('DO_NOT_ECHO'));
  await assert.rejects(attachmentText({ id: attachmentId }, fixture({ textStatus: 403 })), /403/);
});

test('bare keys, aliases, traversal, wrong local keys and foreign libraries are refused', async () => {
  for (const id of ['ATTACH01', 'users/0/items/ATTACH01', 'users/local/abc123/items/../file', 'https://example.org/items/ATTACH01']) {
    const mock = fixture();
    await assert.rejects(attachmentText({ id }, mock), /verified library-qualified/);
    assert.equal(mock.calls.length, 0);
  }
  const wrong = fixture();
  await assert.rejects(attachmentText({ id: 'users/local/wrong/items/ATTACH01' }, wrong), /different local parent/);
  assert.ok(wrong.calls.every(call => !call.url.pathname.endsWith('/fulltext')));
  await assert.rejects(listAttachments({ id: parentId }, fixture({ parentItem: { ...parent, library: { type: 'group', id: 2 } } })), /different library/);
});

test('child relationship, duplicate keys and incomplete pages fail rather than omit sources', async () => {
  for (const child of [{ ...attachment, data: { ...attachment.data, parentItem: 'OTHER001' } }, { ...attachment, library: { type: 'group', id: 2 } }, { ...attachment, key: '../WRONG' }]) {
    await assert.rejects(listAttachments({ id: parentId }, fixture({ children: [child] })));
  }
  await assert.rejects(listAttachments({ id: parentId }, fixture({ children: [attachment, attachment], total: '2' })), /duplicate/);
  await assert.rejects(listAttachments({ id: parentId }, fixture({ children: [], total: '1' })), /incomplete/);
  const empty = await listAttachments({ id: parentId }, fixture({ children: [], total: '0' }));
  assert.deepEqual(empty.items, []);
  assert.equal(empty.page.nextStart, null);
});

test('synced group attachments retain their library and do not require local-user heuristics', async () => {
  const group = { type: 'group', id: 456 };
  const mock = fixture({ parentItem: { ...parent, library: group }, attachmentItem: { ...attachment, library: group }, children: [{ ...attachment, library: group }] });
  const groupParent = 'groups/456/items/PARENT01';
  const result = await listAttachments({ id: groupParent }, mock);
  assert.equal(result.items[0].id, 'groups/456/items/ATTACH01');
  assert.equal(mock.calls[0].url.pathname, '/api/groups/456/items/PARENT01');
  const standalone = { ...attachment, library: group, data: { ...attachment.data, parentItem: undefined } };
  assert.equal((await attachmentText({ id: 'groups/456/items/ATTACH01' }, fixture({ attachmentItem: standalone }))).status, 'available');
});

test('standalone unsynced IDs and invalid content/coverage are explicit errors', async () => {
  await assert.rejects(attachmentText({ id: attachmentId }, fixture({ attachmentItem: { ...attachment, data: { ...attachment.data, parentItem: undefined } } })), /standalone unsynced/);
  for (const text of [{}, { content: 123 }, { content: 'text', indexedPages: 3, totalPages: 2 }, { content: 'text', indexedChars: -1 }]) await assert.rejects(attachmentText({ id: attachmentId }, fixture({ text })), /invalid/);
});

test('attachment requests preserve cancellation, response bounds and local-origin restrictions', async () => {
  const mock = fixture();
  await assert.rejects(listAttachments({ id: parentId, signal: AbortSignal.abort() }, mock));
  assert.equal(mock.calls.length, 0);
  await assert.rejects(listAttachments({ id: parentId, localUrl: 'https://example.org/api/' }), /loopback/);
  await assert.rejects(listAttachments({ id: parentId }, fixture({ responseHeaders: { 'content-length': String(11 * 1024 * 1024) } })), /10 MiB/);
});

test('a changed Zotero instance cannot supply text under the previous attachment identity', async () => {
  let calls = 0;
  const client = new ZoteroClient({ fetch: async () => {
    calls++;
    return new Response(JSON.stringify(calls === 1 ? attachment : parent), { headers: { 'Zotero-Server-ID': calls === 1 ? 'first-instance' : 'changed-instance' } });
  } });
  await assert.rejects(attachmentText({ id: attachmentId }, { client }), /instance changed/);
  assert.equal(calls, 2);
});

test('attachment CLI uses the shared client, single IDs and no-clobber JSON outputs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'attachment-cli-test-'));
  const output = join(dir, 'text.json');
  let error = '';
  const streams = { stdout: { write: () => assert.fail('File output requested') }, stderr: { write: value => { error += value; } } };
  try {
    const mock = fixture();
    const dependencies = { ...streams, createClient: () => mock.client };
    assert.equal(await main(['attachment-text', '--id', attachmentId, '--output', output], dependencies), 0);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).content, cached.content);
    const calls = mock.calls.length;
    assert.equal(await main(['attachment-text', '--id', attachmentId, '--output', output], dependencies), 1);
    assert.equal(mock.calls.length, calls);
    assert.match(error, /already exists/);
    await writeFile(output, 'unchanged');
    assert.equal(await main(['attachments', '--id', parentId, '--id', parentId, '--output', output, '--overwrite'], dependencies), 1);
    assert.equal(await readFile(output, 'utf8'), 'unchanged');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
