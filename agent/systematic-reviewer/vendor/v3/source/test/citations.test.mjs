import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderDocument } from '../lib/citations.mjs';
import { citationMarker, scanDocument, BIB_START, BIB_END } from '../lib/markdown.mjs';
import { normalizeId, validateSnapshot, zoteroUri } from '../lib/references.mjs';
const snapshot = JSON.parse(readFileSync(new URL('../examples/references.json', import.meta.url), 'utf8'));
const [a, b] = snapshot.items.map(item => item.id);
const bibliography = `\n\n${BIB_START}\n\n${BIB_END}\n`;
const render = text => renderDocument(text, snapshot);

test('scoped IDs normalize URLs but reject database keys, routing aliases and ambiguous bare keys', () => {
  assert.equal(normalizeId(`https://www.zotero.org/${a}`), a);
  assert.equal(zoteroUri(a), `http://zotero.org/${a}`);
  assert.equal(normalizeId('users/local/abc123/items/ABCD2345'), 'users/local/abc123/items/ABCD2345');
  for (const value of ['ABCD2345', '1:ABCD2345', 'users/0/items/ABCD2345', `${a}?extra=1`, 'users/123/items/../x']) assert.throws(() => normalizeId(value));
});

test('ordinary Markdown citations stay readable and rendering is idempotent', () => {
  const output = render(`Text ${citationMarker([{ id: a }])}.${bibliography}`);
  assert.match(output.markdown, /\[\(Smith, 2024\)\]\(sr-cite:users\/123\/items\/ABCD2345\)/);
  assert.match(output.markdown, /Synthetic study/);
  assert.equal(render(output.markdown).markdown, output.markdown);
  assert.equal(output.citations[0].citationItems[0].uris[0], zoteroUri(a));
  assert.equal(output.citations[0].citationItems[0].itemData.title, snapshot.items[0].itemData.title);
});

test('cluster metadata, Unicode locators, affixes and author suppression survive repeated rendering', () => {
  const marker = citationMarker([{ id: a, locator: '12–14', label: 'page', prefix: 'see ', suffix: ', emphasis added' }, { id: b, 'suppress-author': true }]);
  const output = render(marker);
  assert.equal(output.citations[0].cluster.items[0].locator, '12–14');
  assert.equal(output.citations[0].cluster.items[1]['suppress-author'], true);
  assert.match(output.citations[0].text, /12/);
  assert.equal(render(output.markdown).markdown, output.markdown);
});

test('repeated citations have unique occurrence IDs; canonical items stay shared', () => {
  const marker = citationMarker([{ id: a }]);
  const output = render(`${marker} and ${marker}${bibliography}`);
  assert.equal(output.citations.length, 2);
  assert.notEqual(output.citations[0].citationID, output.citations[1].citationID);
  assert.equal(output.bibliography.entries.length, 1);
  assert.equal(output.citations[0].citationItems[0].id, output.citations[1].citationItems[0].id);
});

test('disambiguation includes retroactive updates to earlier citations', () => {
  const changed = structuredClone(snapshot);
  changed.items[1].itemData.author = changed.items[0].itemData.author;
  changed.items[1].itemData.issued = changed.items[0].itemData.issued;
  const output = renderDocument(`${citationMarker([{ id: a }])} and ${citationMarker([{ id: b }])}`, changed);
  assert.match(output.citations[0].text, /2024[a-z]/);
  assert.match(output.citations[1].text, /2024[a-z]/);
  assert.notEqual(output.citations[0].text, output.citations[1].text);
});

test('metadata edits replace labels and bibliography without changing identity', () => {
  const text = render(`${citationMarker([{ id: a }])}${bibliography}`).markdown;
  const changed = structuredClone(snapshot);
  changed.items[0].itemData.author[0].family = 'Renamed';
  const output = renderDocument(text, changed);
  assert.match(output.markdown, /Renamed/);
  assert.doesNotMatch(output.markdown, /Smith/);
  assert.equal(output.citations[0].cluster.items[0].id, a);
});

test('code blocks, inline code and unrelated links are not citations', () => {
  const marker = citationMarker([{ id: a }]);
  const input = '# Example\n\n```md\n' + marker + '\n' + BIB_START + '\n```\n\n`' + marker + '` [ordinary](https://example.org)\n\n' + marker;
  assert.equal(scanDocument(input).citations.length, 1);
  const output = render(input);
  assert.equal(output.citations.length, 1);
  assert.ok(output.markdown.includes('```md\n' + marker));
  assert.ok(output.markdown.includes('`' + marker + '`'));
});

test('source offsets remain correct in nested lists, quotes, tables and Unicode prose', () => {
  const marker = citationMarker([{ id: a }]);
  const text = `Ω **Résumé**\n\n- A ${marker}\n  - B ${marker}\n\n> C ${marker}\n\n| Source |\n| --- |\n| ${marker} |\n`;
  const output = render(text);
  assert.equal(output.citations.length, 4);
  assert.ok(output.markdown.startsWith('Ω **Résumé**'));
  for (const cite of output.citations) assert.equal(scanDocument(output.markdown.slice(cite.start, cite.end)).citations.length, 1);
});

test('special characters in metadata cannot inject Markdown/HTML', () => {
  const changed = structuredClone(snapshot);
  changed.items[0].itemData.author[0].family = 'A [B] <script> & C';
  const out = renderDocument(citationMarker([{ id: a }]) + bibliography, changed);
  assert.equal(scanDocument(out.markdown).citations.length, 1);
  assert.equal(renderDocument(out.markdown, changed).markdown, out.markdown);
});

test('missing references, duplicate entries and malformed markers fail closed', () => {
  assert.throws(() => render(citationMarker([{ id: 'users/123/items/ZZZZ9999' }])), /Missing reference/);
  assert.throws(() => validateSnapshot({ version: 1, items: [snapshot.items[0], snapshot.items[0]] }), /Duplicate/);
  assert.throws(() => render('[bad](sr-cite:%ZZ)'), /encoding/);
  assert.throws(() => render('[bad](sr-cite:ABCD2345)'), /identity/);
  assert.throws(() => render('[bad](sr-cite:{not-json})'), /Invalid citation/);
  assert.throws(() => render('broken [cite](sr-cite:users/123/items/ABCD2345'), /Malformed/);
  assert.throws(() => citationMarker([{ id: a, label: 'page' }]), /locator/);
  assert.throws(() => citationMarker([{ id: a, 'author-only': true }]), /Unknown/);
  assert.throws(() => citationMarker(Array.from({ length: 100 }, () => ({ id: a, prefix: 'a'.repeat(2000) }))), /32 KiB/);
});

test('bibliography markers validate balance, multiplicity and nested citations', () => {
  assert.throws(() => render(BIB_START), /missing its end/);
  assert.throws(() => render(BIB_END), /no start/);
  assert.throws(() => render(bibliography + bibliography), /Only one/);
  assert.throws(() => render(`${BIB_START}\n\n${citationMarker([{ id: a }])}\n\n${BIB_END}`), /inside/);
  assert.equal(render(bibliography).bibliography.entries.length, 0);
  assert.equal(render(bibliography).style.hasBibliography, true);
  assert.throws(() => render(`> ${BIB_START}\n>\n> ${BIB_END}`), /top-level/);
  assert.throws(() => render(`Prose ${BIB_START}`), /top-level/);
});

test('reference-style citations and citation images fail rather than flattening', () => {
  assert.throws(() => render(`[cite][ref]\n\n[ref]: sr-cite:${a}`), /reference links/);
  assert.throws(() => render(`![cite](sr-cite:${a})`), /image/);
});

test('numeric CSL style respects document citation order', () => {
  const styleXml = `<?xml version="1.0"?><style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text"><info><title>Test</title><id>https://example.org/test</id></info><citation><layout prefix="[" suffix="]" delimiter=", "><text variable="citation-number"/></layout></citation><bibliography><layout><text variable="citation-number" suffix=". "/><text variable="title"/></layout></bibliography></style>`;
  const out = renderDocument(`${citationMarker([{ id: b }])} ${citationMarker([{ id: a }])} ${citationMarker([{ id: b }])}${bibliography}`, snapshot, { styleXml });
  assert.deepEqual(out.citations.map(c => c.text), ['[1]', '[2]', '[1]']);
  assert.equal(renderDocument(out.markdown, snapshot, { styleXml }).markdown, out.markdown);
});

test('missing locale, note styles and entity declarations are rejected explicitly', () => {
  const marker = citationMarker([{ id: a }]);
  assert.throws(() => renderDocument(marker, snapshot, { locale: 'fr-FR' }), /locale XML/);
  assert.throws(() => renderDocument(marker, snapshot, { styleXml: '<!DOCTYPE style><style/>' }), /entities/);
  const styleXml = '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="note"><info><title>Note test</title><id>https://example.org/note</id></info><citation><layout><text variable="title"/></layout></citation></style>';
  assert.throws(() => renderDocument(marker, snapshot, { styleXml }), /in-text/);
});
