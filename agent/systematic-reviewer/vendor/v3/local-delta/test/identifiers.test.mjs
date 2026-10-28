// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIdentifier, resolveIdentifiers } from '../lib/identifiers.mjs';
import { importIdentifier } from '../lib/zotero-import.mjs';

const response = value => new Response(JSON.stringify(value));
const selected = { libraryID: 1, libraryName: 'Synthetic', libraryEditable: true, editable: true, id: 1, name: 'Test' };
const pubmed = '<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID Version="1">100</PMID><Article><ArticleTitle>Synthetic article without DOI</ArticleTitle></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>';
const arxiv = '@misc{synthetic,\ntitle={Synthetic preprint},\neprint={1706.03762},\narchivePrefix={arXiv},\nurl={https://arxiv.org/abs/1706.03762}\n}';
function transport({ xml = pubmed, bibtex = arxiv, receipt = [{ key: 'ABCD2345', PMID: '100' }], mapping } = {}) {
  const calls = [];
  return { calls, fetch: async (url, init) => {
    calls.push({ url, init });
    if (url.pathname.endsWith('/getSelectedCollection')) return response(selected);
    if (url.pathname.endsWith('/import')) return response(receipt);
    if (url.hostname === 'pmc.ncbi.nlm.nih.gov') return response(mapping ?? { status: 'ok', records: [{ 'requested-id': 'PMC123', pmcid: 'PMC123', pmid: 100, doi: '10.1234/example' }] });
    if (url.hostname === 'eutils.ncbi.nlm.nih.gov') return new Response(xml);
    if (url.hostname === 'arxiv.org') return new Response(bibtex);
    assert.fail('Unexpected endpoint');
  } };
}

test('normalizer recognizes five legacy identifier types and common URLs without guessing prose', () => {
  for (const [value, type, normalized] of [
    [' DOI:10.1234/EXAMPLE ', 'DOI', '10.1234/example'],
    ['https://doi.org/10.1234/Example', 'DOI', '10.1234/example'],
    ['pmid:100', 'PMID', '100'], ['PMID 100', 'PMID', '100'], ['100', 'PMID', '100'],
    ['https://pubmed.ncbi.nlm.nih.gov/100/', 'PMID', '100'],
    ['pmcid:123', 'PMCID', 'PMC123'], ['PMC123.2', 'PMCID', 'PMC123.2'],
    ['https://pmc.ncbi.nlm.nih.gov/articles/PMC123/', 'PMCID', 'PMC123'],
    ['https://www.ncbi.nlm.nih.gov/pmc/articles/PMC123/', 'PMCID', 'PMC123'],
    ['arxiv:1706.03762v1', 'arXiv', '1706.03762v1'],
    ['https://arxiv.org/pdf/hep-th/9901001.pdf', 'arXiv', 'hep-th/9901001'],
    ['ISBN-13:978-0-14-032872-1', 'ISBN', '9780140328721'],
    ['0-306-40615-2', 'ISBN', '0306406152'],
  ]) assert.deepEqual(normalizeIdentifier(value), { type, value: normalized });
  for (const value of ['some text 123', 'https://example.org/10.1234/example', 'PMID:0', 'PMCID:0', 'arxiv:1713.03762', 'ISBN:9780140328722', '10.1234/a\nb', 'https://doi.org/10.1234/a%0Ab', 'https://user:password@doi.org/10.1234/example']) assert.throws(() => normalizeIdentifier(value));
});

test('native identifiers produce native Zotero payloads without network metadata claims', async () => {
  const result = await resolveIdentifiers({ identifiers: ['10.1234/example', 'PMID:100', 'arxiv:1706.03762v1', 'ISBN:9780140328721'] }, { fetch: () => assert.fail('No lookup needed') });
  assert.deepEqual(result.items.map(item => item.zoteroIdentifier), [{ DOI: '10.1234/example' }, { PMID: '100' }, { arXiv: '1706.03762v1' }, { ISBN: '9780140328721' }]);
  assert.ok(result.items.every(item => item.status === 'native' && !item.provenance));
});

test('PMCID converter batches IDs, preserves PMID/DOI/provenance, and omits contact from output', async () => {
  const mock = transport();
  const result = await resolveIdentifiers({ identifiers: ['PMC123', 'pmcid:123'], mailto: 'private@example.org' }, mock);
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].url.searchParams.get('ids'), 'PMC123');
  assert.equal(mock.calls[0].url.searchParams.get('email'), 'private@example.org');
  assert.deepEqual(result.items[0].zoteroIdentifier, { PMID: '100' });
  assert.deepEqual(result.items[0].identifiers, { PMCID: 'PMC123', PMID: '100', DOI: '10.1234/example' });
  assert.ok(!JSON.stringify(result).includes('private@example.org'));
});

test('unresolved and nonexistent PMCID versions remain explicit, never forced to a DOI route', async () => {
  const mock = transport({ mapping: { status: 'ok', records: [{ 'requested-id': 'PMC123', pmid: 100, versions: [{ pmcid: 'PMC123.1' }] }] } });
  const result = await resolveIdentifiers({ identifiers: ['PMC123.1', 'PMC123.2', 'PMC999'] }, mock);
  assert.equal(result.items[0].status, 'resolved');
  assert.equal(result.items[1].status, 'unresolved');
  assert.equal(result.items[2].zoteroIdentifier, null);
  assert.equal(mock.calls[0].url.searchParams.get('ids'), 'PMC123,PMC999');
  await assert.rejects(resolveIdentifiers({ identifiers: ['PMC123'] }, transport({ mapping: { status: 'ok', records: [{ 'requested-id': 'PMC999', pmid: 100 }] } })), /unexpected/);
});

test('PubMed article without DOI imports via native XML and verifies PMID in the receipt', async () => {
  const mock = transport();
  const result = await importIdentifier({ identifier: 'PMID:100', expectedTarget: 'C1' }, mock);
  assert.equal(result.items[0].itemKey, 'ABCD2345');
  assert.deepEqual(result.items[0].zoteroIdentifier, { PMID: '100' });
  assert.equal(mock.calls[1].url.searchParams.get('id'), '100');
  assert.equal(mock.calls[3].init.headers['Content-Type'], 'application/xml');
  assert.equal(mock.calls[3].init.body, pubmed);
  assert.ok(mock.calls.every(call => call.url.hostname !== 'api.crossref.org'));
});

test('PMCID import follows the verified PMID even when a DOI exists', async () => {
  const mock = transport();
  const result = await importIdentifier({ identifier: 'PMC123', expectedTarget: 'C1' }, mock);
  assert.deepEqual(result.items[0].identifiers, { PMCID: 'PMC123', PMID: '100', DOI: '10.1234/example' });
  assert.ok(mock.calls.some(call => call.url.hostname === 'eutils.ncbi.nlm.nih.gov'));
  assert.ok(mock.calls.every(call => call.url.hostname !== 'api.crossref.org'));
});

test('PubMed mismatches, multiple articles, book snapshots, and XML entities fail before writes', async () => {
  for (const xml of [pubmed.replace('>100<', '>101<'),
    ...['<PubmedArticle>', '<PubmedArticle >', '<PubmedArticle\n>', '<PubmedArticle extra="value">', '<PubmedArticle/>', '<PubmedArticle />']
      .map(tag => pubmed.replace('</PubmedArticleSet>', `${tag}${tag.endsWith('/>') ? '' : '</PubmedArticle>'}</PubmedArticleSet>`)),
    pubmed.replaceAll('PubmedArticle>', 'PubmedBookArticle>'), '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]>' + pubmed]) {
    const mock = transport({ xml });
    await assert.rejects(importIdentifier({ identifier: 'PMID:100', expectedTarget: 'C1' }, mock), /nothing imported/i);
    assert.ok(!mock.calls.some(call => call.url.pathname.endsWith('/import')));
  }
  const mock = transport({ xml: '<!DOCTYPE PubmedArticleSet SYSTEM "https://example.org/external.dtd">' + pubmed });
  await importIdentifier({ identifier: 'PMID:100', expectedTarget: 'C1' }, mock);
  assert.equal(mock.calls.at(-1).init.body, pubmed);
});

test('unversioned arXiv BibTeX import preserves its identifier without requiring a DOI', async () => {
  const mock = transport({ receipt: [{ key: 'ABCD2345', extra: 'arXiv: 1706.03762' }] });
  const result = await importIdentifier({ identifier: 'arXiv:1706.03762', expectedTarget: 'C1' }, mock);
  assert.deepEqual(result.items[0].zoteroIdentifier, { arXiv: '1706.03762' });
  assert.match(mock.calls.at(-1).init.body, /eprinttype=\{arXiv\}/);
});

test('unsupported ISBN/versioned arXiv and unsafe arXiv metadata fail before writes', async () => {
  for (const identifier of ['ISBN:9780140328721', 'arXiv:1706.03762v1']) await assert.rejects(importIdentifier({ identifier, expectedTarget: 'C1' }, { fetch: () => assert.fail('No network before refusal') }), /nothing imported/i);
  for (const bibtex of [arxiv.replace('eprint={1706.03762}', 'eprint={1706.03763}'), `${arxiv}\n${arxiv}`,
    ...['file', 'p df', 'p\tdf', 'p\ndf', 'f i l e', 'pa th', 'sente link']
      .map(field => arxiv.replace('title=', `${field}={https://example.org/file.pdf},\ntitle=`))]) {
    const mock = transport({ bibtex });
    await assert.rejects(importIdentifier({ identifier: 'arXiv:1706.03762', expectedTarget: 'C1' }, mock), /nothing imported/i);
    assert.ok(!mock.calls.some(call => call.url.pathname.endsWith('/import')));
  }
});

test('generic import reports uncertain writes without retrying', async () => {
  const mock = transport({ receipt: [{ key: 'ABCD2345', PMID: '101' }] });
  await assert.rejects(importIdentifier({ identifier: 'PMID:100', expectedTarget: 'C1' }, mock), /may have saved/);
  assert.equal(mock.calls.filter(call => call.url.pathname.endsWith('/import')).length, 1);
});
