// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../store/index.mjs';
import { normalizeIdentifier } from '../adapted/identifiers.mjs';
import { workIdentifiers, normalizeWorkMetadata } from '../adapted/work-identity.mjs';

const article = data => ({ itemType: 'journalArticle', title: 'Shared title', ...data });
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bkref-identity-'));
  const stores = [];
  const store = () => { const value = new Store(); stores.push(value); return value; };
  t.after(async () => { await Promise.all(stores.map(value => value.close())); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, file: path.join(directory, 'project.sqlite'), store };
}

test('canonical work identifiers share strict validation and exclude journal identities', () => {
  for (const value of ['http://dx.doi.org/10.1234/Case', 'doi.org/10.1234/CASE', 'dx.doi.org/10.1234/Case', 'DOI: https://doi.org/10.1234/CASE'])
    assert.equal(normalizeIdentifier(value).value, '10.1234/case');
  assert.deepEqual(workIdentifiers(article({ DOI: 'doi:10.1234/CASE', PMID: 'https://pubmed.ncbi.nlm.nih.gov/123/',
    PMCID: 'http://pmc.ncbi.nlm.nih.gov/articles/PMC456/', OpenAlex: 'https://openalex.org/w789',
    arXiv: 'https://arxiv.org/pdf/2301.12345v2.pdf', ISSN: '1234-5678' })),
    { DOI: '10.1234/case', PMID: '123', PMCID: 'PMC456', OpenAlex: 'W789', arXiv: '2301.12345' });
  assert.throws(() => workIdentifiers(article({ DOI: '10.1234/a', provenance: { identifiers: { DOI: '10.1234/b' } } })), /Conflicting DOI/);
  assert.throws(() => normalizeIdentifier('https://doi.org/10.1234/a?x=1'), /without/);
  const prior = article({ DOI: '10.1234/a', extra: 'DOI: 10.1234/a\nPMID: 123', provenance: { identifiers: { DOI: '10.1234/a' } } });
  const changed = normalizeWorkMetadata({ ...prior, DOI: 'https://doi.org/10.1234/B' }, { previous: prior });
  assert.equal(changed.DOI, '10.1234/b');
  assert.equal(changed.PMID, '123');
  assert.equal(changed.provenance.identifiers.DOI, '10.1234/b');
});

test('simultaneous imports use one canonical record and remain project isolated', async t => {
  const { directory, file, store } = await fixture(t);
  const first = store(), second = store();
  const results = await Promise.all(Array.from({ length: 16 }, (_, i) => (i % 2 ? first : second).call(file, 'put', {
    value: article({ DOI: i % 2 ? 'https://doi.org/10.1234/EXAMPLE' : 'doi:10.1234/example', ...(i === 1 ? { PMID: '345' } : {}) }),
  })));
  assert.equal(new Set(results.map(item => item.key)).size, 1);
  const all = await first.call(file, 'list', { count: true });
  assert.equal(all.total, 1);
  assert.equal(all.items[0].data.PMID, '345');
  const independent = await first.call(path.join(directory, 'other.sqlite'), 'put', { value: article({ DOI: '10.1234/example' }) });
  assert.notEqual(independent.key, all.items[0].key);
  const sameTitle = await first.call(file, 'put', { value: article({ ISSN: '1234-5678' }) });
  const another = await first.call(file, 'put', { value: article({ ISSN: '1234-5678' }) });
  assert.notEqual(sameTitle.key, another.key);
});

test('a new cross-identifier link merges old records and retains every attachment and citation identity', async t => {
  const { directory, file, store } = await fixture(t), db = store();
  const doi = await db.call(file, 'put', { value: article({ DOI: '10.1234/a', title: 'Manual title', abstractNote: 'My deliberate abstract.' }), manual: true });
  const pmid = await db.call(file, 'put', { value: article({ PMID: '123', publicationTitle: 'Full journal name', provenance: { source: 'PubMed' } }) });
  const attachments = [];
  for (const [n, parent, type] of [[1, doi.key, 'application/pdf'], [2, pmid.key, 'application/pdf'], [3, pmid.key, 'text/xml'], [4, pmid.key, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']]) {
    const filename = path.join(directory, `content-${n}`);
    await fs.writeFile(filename, n < 3 ? '%PDF-same bytes\n' : `content ${n}`);
    const saved = await db.call(file, 'put', { value: { itemType: 'attachment', parentItem: parent, title: 'same name', filename: 'same.pdf', path: filename, sha256: 'same-hash', contentType: type, linkMode: 'imported_file' } });
    await db.call(file, 'fulltext', { key: saved.key, data: { text: 'already indexed' } });
    attachments.push({ ...saved, bytes: await fs.readFile(filename) });
  }
  const joined = await db.call(file, 'put', { value: article({ DOI: 'https://doi.org/10.1234/A', PMID: 'pmid:123', PMCID: 'PMC1234', OpenAlex: 'W1234', arXiv: '2301.12345',
    title: 'Machine replacement', abstractNote: 'A much longer machine abstract that must not overwrite the manually edited text.', provenance: { source: 'OpenAlex' } }) });
  assert.equal(joined.key, doi.key);
  assert.equal(joined.data.title, 'Manual title');
  assert.equal(joined.data.abstractNote, 'My deliberate abstract.');
  assert.equal(joined.data.publicationTitle, 'Full journal name');
  assert.equal(joined.data.PMCID, 'PMC1234');
  assert.equal((await db.call(file, 'list', { count: true })).total, 1);
  const oldCitation = await db.call(file, 'get', { key: pmid.key });
  assert.equal(oldCitation.key, doi.key);
  assert.equal(oldCitation.requestedKey, pmid.key);
  const children = await db.call(file, 'list', { top: false, parent: pmid.key });
  assert.equal(children.items.length, 4);
  for (const original of attachments) {
    const child = await db.call(file, 'get', { key: original.key });
    assert.equal(child.data.parentItem, doi.key);
    assert.equal(child.data.path, original.data.path);
    assert.equal(child.data.sha256, original.data.sha256);
    assert.equal((await db.call(file, 'fulltext', { key: child.key })).text, 'already indexed');
    assert.deepEqual(await fs.readFile(child.data.path), original.bytes);
  }
});

test('one matching ID retains competing aliases; batch children follow canonical parents; manual clears persist', async t => {
  const { file, store } = await fixture(t), db = store();
  const a = await db.call(file, 'put', { value: article({ DOI: '10.1234/a', PMID: '123', provenance: { source: 'translator' }, abstractNote: 'short' }) });
  await db.call(file, 'put', { value: article({ DOI: '10.1234/b', PMID: '456' }) });
  const linked = await db.call(file, 'put', { value: article({ DOI: '10.1234/a', PMID: '456' }) });
  assert.equal(linked.key, a.key);
  assert.deepEqual(linked.data.provenance.identifierAliases, { PMID: ['456'], DOI: ['10.1234/b'] });
  assert.equal((await db.call(file, 'find', { identifiers: { DOI: '10.1234/b' } }))[0].key, a.key);
  const batch = await db.call(file, 'batch', { items: [
    { createKey: 'TEMPORARYPARENT', data: article({ DOI: 'http://doi.org/10.1234/A', abstractNote: 'A longer valid automatically imported abstract.' }) },
    { createKey: 'CHILD', data: { itemType: 'attachment', parentItem: 'TEMPORARYPARENT', title: 'PDF', url: 'https://example.invalid/paper.pdf' } },
  ] });
  assert.equal(batch[0].key, a.key);
  assert.equal(batch[1].data.parentItem, a.key);
  assert.equal(batch[0].data.abstractNote, 'A longer valid automatically imported abstract.');
  const edited = await db.call(file, 'put', { value: { key: a.key, data: { title: '' } }, expected: batch[0].version, patch: true, manual: true });
  const enriched = await db.call(file, 'put', { value: article({ DOI: '10.1234/a', title: 'Unwanted refill' }) });
  assert.equal(enriched.data.title, '');
  await assert.rejects(db.call(file, 'put', { value: { key: a.key, data: { title: 'stale' } }, expected: edited.version, patch: true }), { status: 412 });
});

test('manual identity corrections remove active aliases and keep source history', async t => {
  const { file, store } = await fixture(t), db = store();
  await db.call(file, 'put', { value: article({ DOI: '10.1234/original', PMID: '123', provenance: { source: 'translator', raw: { source: 'first' } } }) });
  const merged = await db.call(file, 'put', { value: article({ DOI: '10.1234/original', PMID: '456', provenance: { source: 'OpenAlex', raw: { source: 'second' } } }) });
  assert.deepEqual(merged.data.provenance.identifierAliases.PMID, ['456']);
  const corrected = await db.call(file, 'put', { value: { key: merged.key,
    data: { ...merged.data, DOI: 'DOI: https://doi.org/10.1234/Corrected', PMID: '' } }, expected: merged.version, manual: true });
  assert.equal(corrected.data.DOI, '10.1234/corrected');
  assert.equal(corrected.data.PMID, '');
  assert.equal(corrected.data.provenance.identifierAliases.PMID, undefined);
  for (const identifiers of [{ PMID: '123' }, { PMID: '456' }, { DOI: '10.1234/original' }])
    assert.equal((await db.call(file, 'find', { identifiers })).length, 0);
  assert.equal((await db.call(file, 'find', { identifiers: { DOI: 'doi.org/10.1234/CORRECTED' } }))[0].key, merged.key);
  const history = await db.call(file, 'recordPage', { prefix: corrected.data.provenance.identityHistoryPrefix });
  assert.equal(history.items.length, 2);
  assert.ok(history.items.some(entry => entry.previous.PMID === '123' && entry.previous.provenance.identifierAliases?.PMID?.includes('456')));
  const editedAliases = await db.call(file, 'put', { value: { key: corrected.key, data: {
    ...corrected.data, provenance: { ...corrected.data.provenance, identifierAliases: { DOI: ['dx.doi.org/10.1234/SECOND'] } },
  } }, expected: corrected.version, manual: true });
  assert.deepEqual(editedAliases.data.provenance.identifierAliases.DOI, ['10.1234/second']);
  assert.equal((await db.call(file, 'find', { identifiers: { DOI: '10.1234/second' } }))[0].key, corrected.key);
  const before = await db.call(file, 'libraryVersion');
  await assert.rejects(db.call(file, 'put', { value: { key: corrected.key, data: { DOI: 'not an identifier' } }, expected: editedAliases.version, patch: true, manual: true }));
  assert.equal(await db.call(file, 'libraryVersion'), before);
});

test('legacy identifier indexes migrate once using canonical URL/prefix forms', async t => {
  const { file, store } = await fixture(t), oldStore = store();
  const original = await oldStore.call(file, 'put', { value: article({ DOI: '10.1234/legacy' }) });
  await oldStore.call(file, 'closeLibrary');
  const sqlite = new DatabaseSync(file);
  const data = { ...original.data, DOI: 'HTTPS://DX.DOI.ORG/10.1234/LEGACY' };
  sqlite.prepare('UPDATE items SET data=? WHERE key=?').run(JSON.stringify(data), original.key);
  sqlite.exec('DELETE FROM identifiers; PRAGMA user_version=1');
  sqlite.close();
  const current = store();
  const found = await current.call(file, 'find', { identifiers: { DOI: 'doi:10.1234/legacy' } });
  assert.equal(found.length, 1);
  assert.equal(found[0].key, original.key);
  assert.equal((await current.call(file, 'put', { value: article({ DOI: '10.1234/LEGACY' }) })).key, original.key);
});
