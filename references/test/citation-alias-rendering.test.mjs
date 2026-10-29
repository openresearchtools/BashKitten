// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createReferencesService } from '../index.mjs';

test('merged item identities share native citation numbering while source IDs and snapshots remain intact', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bkref-citation-alias-'));
  const service = await createReferencesService({
    dataDir: path.join(directory, 'data'), backendId: 'fixture',
    authorizeProject: async (_authority, id) => ({ id, cwd: directory }),
  });
  t.after(async () => { await service.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const article = identifiers => ({ itemType: 'journalArticle', title: 'Same title', date: '2024',
    creators: [{ creatorType: 'author', firstName: 'Ann', lastName: 'Author' }], ...identifiers });
  const create = async data => {
    const result = await service.handle({ method: 'POST', path: '/projects/P1/items', body: { data } });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body[0];
  };
  const doi = await create(article({ DOI: '10.1234/citation-alias-fixture' }));
  const pmid = await create(article({ PMID: '12345678' }));
  const distinct = await create(article({}));
  const citations = [
    { id: 'doi-occurrence', items: [{ id: doi.id }] },
    { id: 'pmid-occurrence', items: [{ id: pmid.id }] },
    { id: 'unrelated-same-title', items: [{ id: distinct.id }] },
    { id: 'both-with-locators', items: [
      { id: doi.id, locator: '12', label: 'page', prefix: 'compare ' },
      { id: pmid.id, locator: '24', label: 'page', suffix: ' discussion', 'suppress-author': true },
    ] },
  ];
  const state = { version: 1, style: { id: 'vancouver-nlm', locale: 'en-US' }, citations };
  const before = await service.renderDocument(state, { projectId: 'P1' });
  assert.deepEqual(before.citations.slice(0, 3).map(c => c.text), ['(1)', '(2)', '(3)']);
  assert.equal(before.bibliography.entries.length, 3);

  const joined = await create(article({ DOI: doi.data.DOI, PMID: pmid.data.PMID }));
  assert.ok([doi.key, pmid.key].includes(joined.key));
  const merged = await service.renderDocument({ ...state, metadataSource: 'library' }, { projectId: 'P1' });
  assert.deepEqual(merged.citations.slice(0, 3).map(c => c.text), ['(1)', '(1)', '(2)']);
  assert.equal(merged.bibliography.entries.length, 2);
  assert.deepEqual(merged.bibliography.entryIds, [[joined.id], [distinct.id]]);
  assert.deepEqual(merged.citations.map(c => ({ id: c.id, items: c.items })), citations);
  assert.deepEqual(merged.citations.at(-1).sortedItems, citations.at(-1).items);
  assert.deepEqual(Object.keys(merged.embeddedItems), [doi.id, pmid.id, distinct.id]);
  assert.equal(merged.embeddedItems[doi.id].id, joined.id);
  assert.equal(merged.embeddedItems[pmid.id].id, joined.id);
  assert.ok(!JSON.stringify(merged).includes('_bashkittenSourceId'));

  // Pre-merge snapshots preserve their original identities; refreshed snapshots
  // preserve the canonical identity they captured. Neither asks the live store
  // to replace embedded metadata or rebind its source IDs.
  const oldSnapshot = await service.renderDocument({ ...state, metadataSource: 'snapshot',
    embeddedItems: before.embeddedItems }, { projectId: 'P1' });
  assert.deepEqual(oldSnapshot.citations.slice(0, 3).map(c => c.text), ['(1)', '(2)', '(3)']);
  assert.equal(oldSnapshot.bibliography.entries.length, 3);
  const refreshedSnapshot = await service.renderDocument({ ...state, metadataSource: 'snapshot',
    embeddedItems: merged.embeddedItems }, { projectId: 'P1' });
  assert.deepEqual(refreshedSnapshot.citations.map(c => ({ id: c.id, items: c.items, text: c.text })),
    merged.citations.map(c => ({ id: c.id, items: c.items, text: c.text })));
  assert.deepEqual(refreshedSnapshot.bibliography.entryIds, merged.bibliography.entryIds);
  const missing = await service.handle({ method: 'POST', path: '/projects/P1/citations/render',
    body: { ...state, metadataSource: 'snapshot', embeddedItems: {} } });
  assert.equal(missing.status, 422);
  assert.match(missing.body.error, /Missing embedded CSL snapshot/);
});
