// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { exportDocx } from '../lib/docx.mjs';
import { renderDocument } from '../lib/citations.mjs';
import { BIB_START, BIB_END, citationMarker, scanDocument } from '../lib/markdown.mjs';
import { zoteroUri } from '../lib/references.mjs';

const USER = 'users/123/items/ABCD2345';
const GROUP = 'groups/456/items/EFGH2345';
const LOCAL = 'users/local/RealLocalKey/items/IJKL2345';
const STYLE = { id: 'http://www.zotero.org/styles/apa', locale: 'en-US', hasBibliography: true };
const itemData = id => ({ id: zoteroUri(id), type: 'article-journal', title: `Synthetic study ${id}`, author: [{ family: 'Smith', given: 'Jane' }], issued: { 'date-parts': [[2024]] }, DOI: '10.example/synthetic' });

// Construct the documented renderDocument contract independently of citeproc.
function rendered(markdown, entries = ['Smith, J. (2024). First synthetic study.', 'Jones, A. (2023). Second synthetic study.']) {
  const scan = scanDocument(markdown);
  return {
    markdown,
    citations: scan.citations.map((citation, index) => ({
      start: citation.start, end: citation.end, cluster: citation.cluster,
      text: citation.node.children.map(node => node.value ?? '').join(''),
      citationID: `synthetic-occurrence-${index}`,
      citationItems: citation.cluster.items.map(({ id, ...options }) => ({ id: zoteroUri(id), uris: [zoteroUri(id)], itemData: itemData(id), ...options })),
    })),
    bibliography: scan.bibliography ? { ...scan.bibliography, entries } : null,
    style: { ...STYLE },
  };
}

function fixture() {
  const first = citationMarker([{ id: USER, locator: '12–14', prefix: 'see', suffix: 'for details' }], '(Smith, 2024, pp. 12–14)');
  const multi = citationMarker([{ id: GROUP }, { id: LOCAL, locator: '2', label: 'chapter', 'suppress-author': true }], '(Jones, 2023; 2022, chap. 2)');
  const repeated = citationMarker([{ id: USER }], '(Smith, 2024)');
  return rendered(`# Synthetic review\n\nEvidence ${first}, then ${multi}. Again ${repeated}.\n\n## References\n\n${BIB_START}\n\nOld generated content.\n\n${BIB_END}\n`);
}

function decode(text) {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity]);
}

function unzip(bytes) {
  assert.ok(bytes instanceof Uint8Array);
  const parts = Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name, value]) => [name, strFromU8(value)]));
  for (const [name, value] of Object.entries(parts)) assertXmlStructure(value, name);
  return parts;
}

// A strict structural check for our generated XML subset, not an OOXML schema
// validator. No external binary or application is needed by this test suite.
function assertXmlStructure(text, name) {
  const stack = [];
  let offset = 0;
  let rootCount = 0;
  for (const match of text.matchAll(/<\?xml\s[^?]*\?>|<\/?[A-Za-z_][\w:.-]*(?:\s+[A-Za-z_][\w:.-]*="[^"<>]*")*\s*\/?>/g)) {
    assert.equal(match.index >= offset, true);
    const between = text.slice(offset, match.index);
    assert.doesNotMatch(between, /[<>]|&(?!(?:amp|lt|gt|quot|apos);)/, `${name}: unescaped XML text`);
    const tag = match[0];
    if (!tag.startsWith('<?')) {
      const tagName = /^<\/?([^\s/>]+)/.exec(tag)[1];
      if (tag.startsWith('</')) assert.equal(stack.pop(), tagName, `${name}: mismatched closing tag`);
      else {
        if (!stack.length) rootCount++;
        if (!tag.endsWith('/>')) stack.push(tagName);
      }
      assert.doesNotMatch(tag, /&(?!(?:amp|lt|gt|quot|apos);)/, `${name}: unescaped attribute`);
    }
    offset = match.index + tag.length;
  }
  assert.equal(text.slice(offset).trim(), '', `${name}: invalid trailing XML`);
  assert.deepEqual(stack, [], `${name}: unclosed tags`);
  assert.equal(rootCount, 1, `${name}: expected one XML root`);
}

function properties(parts) {
  const result = new Map();
  const pids = new Set();
  for (const match of parts['docProps/custom.xml'].matchAll(/<property fmtid="\{D5CDD505-2E9C-101B-9397-08002B2CF9AE\}" pid="(\d+)" name="([^"]+)"><vt:lpwstr>([^<]*)<\/vt:lpwstr><\/property>/g)) {
    const [, pid, name, raw] = match;
    assert.ok(Number(pid) >= 2);
    assert.equal(pids.has(pid), false);
    pids.add(pid);
    const value = decode(raw);
    assert.ok(value.length <= 255, `${name} exceeds Word property limit`);
    assert.equal(result.has(name), false);
    assert.doesNotMatch(value, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u, 'surrogate pair was split');
    result.set(decode(name), value);
  }
  assert.equal(pids.size, [...parts['docProps/custom.xml'].matchAll(/<property\b/g)].length);
  return result;
}

function propertyValue(values, base) {
  const indices = [...values.keys()].filter(name => name.startsWith(`${base}_`)).map(name => Number(name.slice(base.length + 1))).sort((a, b) => a - b);
  assert.deepEqual(indices, Array.from({ length: indices.length }, (_, i) => i + 1), `gaps in ${base}`);
  return indices.map(index => values.get(`${base}_${index}`)).join('');
}

function bookmarkCodes(parts) {
  const values = properties(parts);
  const ids = new Set();
  const names = new Set();
  const document = parts['word/document.xml'];
  const result = [];
  for (const match of document.matchAll(/<w:bookmarkStart w:id="(\d+)" w:name="([^"]+)"\/>/g)) {
    const [, id, name] = match;
    assert.equal(ids.has(id), false);
    assert.equal(names.has(name), false);
    assert.match(name, /^ZOTERO_BREF_[a-f0-9]{12}$/);
    assert.ok(name.length <= 40);
    ids.add(id); names.add(name);
    const end = `<w:bookmarkEnd w:id="${id}"/>`;
    assert.equal(document.split(end).length, 2);
    const endOffset = document.indexOf(end);
    assert.ok(endOffset > match.index);
    result.push({ code: propertyValue(values, name), start: match.index, end: endOffset });
  }
  assert.equal(ids.size, [...document.matchAll(/<w:bookmarkEnd\b/g)].length);
  return result;
}

function payloads(codes) {
  return codes.filter(code => code.includes('CSL_CITATION ')).map(code => JSON.parse(code.slice(code.indexOf('CSL_CITATION ') + 13).trim()));
}

test('default DOCX bookmarks retain identities, citation options and one bibliography range', () => {
  const input = fixture();
  const parts = unzip(exportDocx(input, { title: 'Review <test> & "quoted"' }));
  assert.deepEqual(Object.keys(parts).sort(), ['[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml', 'docProps/custom.xml', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml'].sort());
  const prefs = JSON.parse(propertyValue(properties(parts), 'ZOTERO_PREF'));
  assert.equal(prefs.dataVersion, 4);
  assert.equal(prefs.prefs.fieldType, 'Bookmark');
  assert.equal(prefs.prefs.noteType, 0);
  assert.deepEqual(prefs.style, { styleID: STYLE.id, locale: STYLE.locale, hasBibliography: true, bibliographyStyleHasBeenSet: false });
  assert.equal('zoteroVersion' in prefs, false);
  assert.match(prefs.sessionID, /^[a-f0-9]{24}$/);
  const ranges = bookmarkCodes(parts);
  assert.equal(ranges.length, 4);
  const citations = payloads(ranges.map(range => range.code));
  assert.equal(citations.length, 3);
  assert.deepEqual(citations.map(value => value.citationItems), input.citations.map(value => value.citationItems));
  assert.deepEqual(citations.map(value => value.properties), Array(3).fill({ noteIndex: 0 }));
  assert.equal(new Set(citations.map(value => value.citationID)).size, 3);
  assert.equal(citations[0].citationItems[0].id, citations[2].citationItems[0].id);
  assert.equal(citations[0].citationItems[0].label, 'page');
  assert.equal(citations[1].citationItems[1]['suppress-author'], true);
  const bib = ranges.find(range => range.code.startsWith('ZOTERO_BIBL '));
  assert.equal(bib.code, 'ZOTERO_BIBL {"uncited":[],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY');
  assert.ok(bib.start > parts['word/document.xml'].indexOf('References'));
  const bibContents = parts['word/document.xml'].slice(bib.start, bib.end);
  assert.match(bibContents, /First synthetic study/);
  assert.match(bibContents, /Second synthetic study/);
  assert.match(bibContents, /<\/w:p><w:p>/);
  assert.doesNotMatch(parts['word/document.xml'], /Old generated content|instrText|sr-cite:|sr-bibliography/);
  assert.match(parts['docProps/core.xml'], /Review &lt;test&gt; &amp; &quot;quoted&quot;/);
  assert.match(parts['_rels/.rels'], /relationships\/custom-properties" Target="docProps\/custom.xml"/);
  assert.match(parts['[Content_Types].xml'], /PartName="\/docProps\/custom.xml" ContentType="application\/vnd.openxmlformats-officedocument.custom-properties\+xml"/);
});

test('optional Word fields use ADDIN instructions, balanced field runs, and Field preferences', () => {
  const input = fixture();
  const parts = unzip(exportDocx(input, { mode: 'fields' }));
  const document = parts['word/document.xml'];
  const codes = [...document.matchAll(/<w:instrText xml:space="preserve">([^<]*)<\/w:instrText>/g)].map(match => decode(match[1]));
  assert.equal(codes.length, 4);
  assert.ok(codes.every(code => code.startsWith(' ADDIN ZOTERO_') && code.endsWith(' ')));
  assert.deepEqual(payloads(codes).map(value => value.citationItems), input.citations.map(value => value.citationItems));
  const transitions = [...document.matchAll(/<w:fldChar w:fldCharType="([^"]+)"\/>/g)].map(match => match[1]);
  assert.deepEqual(transitions, Array.from({ length: 4 }, () => ['begin', 'separate', 'end']).flat());
  assert.doesNotMatch(document, /bookmarkStart|w:fldLock|w:dirty/);
  const values = properties(parts);
  assert.ok([...values.keys()].every(name => name.startsWith('ZOTERO_PREF_')));
  assert.equal(JSON.parse(propertyValue(values, 'ZOTERO_PREF')).prefs.fieldType, 'Field');
});

test('long metadata crosses ten property chunks and preserves Unicode and XML punctuation', () => {
  const citation = citationMarker([{ id: USER, prefix: '<&> "quoted" \\ curly {x}' }], '研究 🧬 & < > " {x} \\');
  const input = rendered(`${citation}\n\n${BIB_START}\n\n${BIB_END}`, ['研究 🧬 & < > "quoted" {x} \\']);
  input.citations[0].citationItems[0].itemData.title = `${'A'.repeat(254)}🧬${'研究<&>"\\'.repeat(500)}`;
  const parts = unzip(exportDocx(input));
  const values = properties(parts);
  const ranges = bookmarkCodes(parts);
  const first = /w:name="([^"]+)"/.exec(parts['word/document.xml'])[1];
  assert.ok(values.has(`${first}_10`));
  assert.deepEqual(payloads(ranges.map(range => range.code))[0].citationItems, input.citations[0].citationItems);
  assert.match(parts['word/document.xml'], /研究 🧬 &amp; &lt; &gt; &quot;/);
  assert.ok(parts['word/document.xml'].includes('curly') === false); // metadata is not flattened into visible text
});

test('ordinary Markdown formatting, lists, tables, links and code are represented structurally', () => {
  const cite = citationMarker([{ id: GROUP }], '(Jones, 2023)');
  const input = rendered(`# Title\n\nParagraph with **bold**, *italic*, \`code & <x>\`, [web](https://example.org/?a=1&b=2 "A & B") and [reference][source].\n\n3. Ordered\n   - Nested\n4. Next\n\n> A quote.\n\n| Study | Result |\n| :--- | ---: |\n| ${cite} | **Yes** |\n| Other | No |\n\n\`\`\`js\nconst a = '<&>';\n\tconsole.log(a);\n\`\`\`\n\n---\n\n[source]: ./appendix.md\n`);
  const parts = unzip(exportDocx(input));
  const document = parts['word/document.xml'];
  assert.match(document, /w:pStyle w:val="Heading1"/);
  assert.match(document, /<w:b\/>/);
  assert.match(document, /<w:i\/>/);
  assert.match(document, /w:rStyle w:val="InlineCode"/);
  assert.match(document, /w:pStyle w:val="CodeBlock"/);
  assert.match(document, /<w:tab\/>/);
  assert.match(document, /<w:br\/>/);
  assert.equal([...document.matchAll(/<w:tbl>/g)].length, 1);
  assert.equal([...document.matchAll(/<w:tr>/g)].length, 3);
  assert.equal([...document.matchAll(/<w:tc>/g)].length, 6);
  assert.equal([...document.matchAll(/<w:gridCol /g)].length, 2);
  assert.match(document, /w:jc w:val="right"/);
  assert.match(document, /<w:tblHeader\/>/);
  assert.equal(bookmarkCodes(parts).length, 1);
  assert.match(parts['word/numbering.xml'], /w:startOverride w:val="3"/);
  assert.match(parts['word/numbering.xml'], /w:numFmt w:val="bullet"/);
  assert.match(parts['word/numbering.xml'], /w:numFmt w:val="decimal"/);
  assert.match(parts['word/_rels/document.xml.rels'], /Target="https:\/\/example.org\/\?a=1&amp;b=2" TargetMode="External"/);
  assert.match(parts['word/_rels/document.xml.rels'], /Target=".\/appendix.md" TargetMode="External"/);
  assert.match(parts['word/_rels/document.xml.rels'], /relationships\/numbering/);
  assert.match(parts['[Content_Types].xml'], /\/word\/numbering.xml/);
});

test('real CSL rendering exports distinct same-key libraries and final disambiguated labels', () => {
  const sameKey = 'groups/456/items/ABCD2345';
  const snapshot = { version: 1, items: [USER, sameKey].map(id => ({ id, itemData: itemData(id) })) };
  const input = renderDocument(`${citationMarker([{ id: USER }])} then ${citationMarker([{ id: sameKey }])} and ${citationMarker([{ id: USER, locator: '7' }])}.\n\n${BIB_START}\n\n${BIB_END}`, snapshot);
  assert.match(input.citations[0].text, /2024[a-z]/);
  assert.match(input.citations[1].text, /2024[a-z]/);
  for (const mode of ['bookmarks', 'fields']) {
    const parts = unzip(exportDocx(input, { mode }));
    const codes = mode === 'bookmarks' ? bookmarkCodes(parts).map(range => range.code)
      : [...parts['word/document.xml'].matchAll(/<w:instrText xml:space="preserve">([^<]*)<\/w:instrText>/g)].map(match => decode(match[1]));
    assert.deepEqual(payloads(codes).map(citation => citation.citationItems[0].uris[0]), [zoteroUri(USER), zoteroUri(sameKey), zoteroUri(USER)]);
    for (const citation of input.citations) assert.ok(parts['word/document.xml'].includes(citation.text));
    assert.equal(input.bibliography.entries.length, 2);
  }
});

test('citation examples in code remain literal and create no live ranges', () => {
  const marker = citationMarker([{ id: USER }]);
  const input = rendered(`\`${marker}\`\n\n\`\`\`md\n${marker}\n${BIB_START}\n${BIB_END}\n\`\`\``);
  assert.equal(input.citations.length, 0);
  const parts = unzip(exportDocx(input));
  assert.deepEqual(bookmarkCodes(parts), []);
  assert.match(parts['word/document.xml'], /sr-cite:/);
  assert.match(parts['word/document.xml'], /&lt;!-- sr-bibliography --&gt;/);
});

test('empty documents and empty bibliographies have valid visible ranges', () => {
  const empty = unzip(exportDocx(rendered('')));
  assert.match(empty['word/document.xml'], /<w:p>/);
  const input = rendered(`${BIB_START}\n\n${BIB_END}`, []);
  const parts = unzip(exportDocx(input));
  assert.equal(bookmarkCodes(parts).length, 1);
  assert.match(parts['word/document.xml'], /No cited references\./);
  assert.equal(JSON.parse(propertyValue(properties(empty), 'ZOTERO_PREF')).style.hasBibliography, true);
});

test('ZIP timestamps are valid in negative UTC offsets', () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    unzip(exportDocx(rendered('Timezone-independent document.')));
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('metadata is never mutated and each exported document has a fresh session', () => {
  const input = fixture();
  const before = structuredClone(input);
  function freeze(value) {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  }
  freeze(input);
  const first = unzip(exportDocx(input));
  const second = unzip(exportDocx(input));
  assert.deepEqual(input, before);
  const getSession = parts => JSON.parse(propertyValue(properties(parts), 'ZOTERO_PREF')).sessionID;
  assert.notEqual(getSession(first), getSession(second));
});

test('stale metadata, missing identities and duplicate citation IDs fail closed', () => {
  const checks = [
    [value => value.citations.pop(), /does not match/],
    [value => value.citations[0].start++, /stale/],
    [value => value.citations[1].citationID = value.citations[0].citationID, /unique/],
    [value => value.citations[0].citationItems = [], /metadata is missing/],
    [value => value.citations[0].citationItems[0].uris = [], /canonical Zotero URIs/],
    [value => value.citations[0].citationItems[0].uris[0] = value.citations[0].citationItems[0].uris[0].replace('http:', 'https:'), /canonical Zotero URIs/],
    [value => delete value.citations[0].citationItems[0].itemData, /embedded CSL/],
    [value => value.citations[0].citationItems[0].itemData.id = 'wrong', /itemData ID/],
    [value => value.citations[0].citationItems[0].locator = '999', /locator does not match/],
    [value => value.bibliography.start++, /bibliography offsets/],
    [value => value.bibliography = null, /bibliography offsets/],
    [value => value.style.hasBibliography = false, /style without a bibliography/],
    [value => value.style.class = 'note', /footnote\/endnote/],
  ];
  for (const [mutate, error] of checks) {
    const input = fixture();
    mutate(input);
    assert.throws(() => exportDocx(input), error);
  }
});

test('unsupported Markdown and unsafe links fail explicitly', () => {
  for (const source of ['![image](image.png)', '<div>Raw HTML</div>', 'Text <i>raw HTML</i>.', '[jump](#heading)', '[bad](javascript:alert%281%29)', '[bad](data:text/plain,hello)']) {
    assert.throws(() => exportDocx(rendered(source)), /Unsupported DOCX Markdown/);
  }
  assert.throws(() => exportDocx(rendered('Text'), { mode: 'unknown' }), /mode must be/);
  assert.throws(() => exportDocx(rendered('Text'), { title: 'bad\x01title' }), /invalid XML character/);
  assert.throws(() => exportDocx(rendered('bad\ud800text')), /invalid XML character/);
});
