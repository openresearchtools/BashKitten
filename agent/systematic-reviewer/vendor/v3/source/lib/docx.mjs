// SPDX-License-Identifier: AGPL-3.0-or-later
// Fresh OOXML serializer. No office application, Zotero process, network or file I/O.
import { randomBytes } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { scanDocument, walk } from './markdown.mjs';
import { zoteroUri } from './references.mjs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_R = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CUSTOM = 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties';
const VT = 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes';
const SCHEMA = 'https://github.com/citation-style-language/schema/raw/master/csl-citation.json';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const OPTIONS = ['locator', 'label', 'prefix', 'suffix', 'suppress-author'];
const BIB_CODE = 'BIBL {"uncited":[],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY';

function xml(value) {
  const text = String(value);
  for (const character of text) {
    const n = character.codePointAt(0);
    if (!(n === 9 || n === 10 || n === 13 || (n >= 32 && n <= 0xd7ff)
      || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff))) {
      throw new Error(`DOCX contains an invalid XML character U+${n.toString(16).toUpperCase()}`);
    }
  }
  return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]);
}

function requireString(value, description, nonempty = true) {
  if (typeof value !== 'string' || (nonempty && !value.trim())) throw new Error(`DOCX ${description} must be a ${nonempty ? 'nonempty ' : ''}string`);
  xml(value);
  return value;
}

function unsupported(node, detail = node.type) {
  const location = node.position?.start;
  throw new Error(`Unsupported DOCX Markdown ${detail}${location ? ` at line ${location.line}, column ${location.column}` : ''}`);
}

function chunks(text) {
  const result = [];
  let chunk = '';
  // for-of preserves surrogate pairs; Word's property limit counts UTF-16 units.
  for (const character of text) {
    if (chunk.length + character.length > 255) {
      result.push(chunk);
      chunk = '';
    }
    chunk += character;
  }
  if (chunk || !result.length) result.push(chunk);
  return result;
}

function runProperties(format) {
  const properties = [
    format.code ? '<w:rStyle w:val="InlineCode"/>' : '',
    format.bold ? '<w:b/>' : '',
    format.italic ? '<w:i/>' : '',
    format.link ? '<w:color w:val="0563C1"/><w:u w:val="single"/>' : '',
  ].join('');
  return properties ? `<w:rPr>${properties}</w:rPr>` : '';
}

function textRuns(text, format = {}) {
  // Validate even characters split into structural OOXML below.
  xml(text);
  const props = runProperties(format);
  return String(text).split(/(\r\n|[\r\n\t])/).filter((part, i, all) => part || all.length === 1).map(part => {
    const content = part === '\t' ? '<w:tab/>' : /^(?:\r\n|[\r\n])$/.test(part)
      ? '<w:br/>' : `<w:t xml:space="preserve">${xml(part)}</w:t>`;
    return `<w:r>${props}${content}</w:r>`;
  }).join('');
}

function paragraph(content, { style, indent, alignment, numbering } = {}) {
  const properties = [
    style ? `<w:pStyle w:val="${xml(style)}"/>` : '',
    numbering ? `<w:numPr><w:ilvl w:val="${numbering.level}"/><w:numId w:val="${numbering.id}"/></w:numPr>` : '',
    indent ? `<w:ind w:left="${indent}"/>` : '',
    alignment ? `<w:jc w:val="${xml(alignment)}"/>` : '',
  ].join('');
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${content}</w:p>`;
}

function positionKey(value) { return `${value.start}:${value.end}`; }

function validateRendered(rendered) {
  if (!rendered || typeof rendered !== 'object') throw new Error('DOCX requires a renderDocument result');
  requireString(rendered.markdown, 'rendered markdown', false);
  if (!Array.isArray(rendered.citations)) throw new Error('DOCX requires rendered citations');
  const { tree, citations: scanned, bibliography } = scanDocument(rendered.markdown);
  if (scanned.length !== rendered.citations.length) throw new Error('DOCX citation metadata does not match the rendered Markdown');
  const citations = new Map();
  const ids = new Set();
  for (let i = 0; i < scanned.length; i++) {
    const source = scanned[i];
    const citation = rendered.citations[i];
    if (!citation || citation.start !== source.start || citation.end !== source.end
      || JSON.stringify(citation.cluster) !== JSON.stringify(source.cluster)) {
      throw new Error('DOCX citation offsets or cluster metadata are stale; render the document again');
    }
    requireString(citation.text, 'cached citation text');
    requireString(citation.citationID, 'citationID');
    if (ids.has(citation.citationID)) throw new Error('DOCX citationID must be unique for each occurrence');
    ids.add(citation.citationID);
    if (!Array.isArray(citation.citationItems) || citation.citationItems.length !== source.cluster.items.length) {
      throw new Error('DOCX citation item metadata is missing');
    }
    const citationItems = source.cluster.items.map((expected, index) => {
      const item = citation.citationItems[index];
      const uri = zoteroUri(expected.id);
      if (!item || item.id !== uri || !Array.isArray(item.uris) || !item.uris.includes(uri)
        || item.uris.some(value => typeof value !== 'string' || zoteroUri(value) !== value)) {
        throw new Error(`DOCX citation has inconsistent canonical Zotero URIs for ${expected.id}`);
      }
      if (!item.itemData || typeof item.itemData !== 'object' || Array.isArray(item.itemData)
        || typeof item.itemData.type !== 'string' || !item.itemData.type.trim()) {
        throw new Error(`DOCX citation requires embedded CSL itemData for ${expected.id}`);
      }
      if (item.itemData.id !== uri) throw new Error(`DOCX embedded itemData ID does not match ${expected.id}`);
      const value = { id: uri, uris: [...item.uris], itemData: item.itemData };
      for (const key of OPTIONS) {
        if (item[key] !== expected[key]) throw new Error(`DOCX citation ${key} does not match the source marker`);
        if (expected[key] !== undefined) value[key] = expected[key];
      }
      return value;
    });
    const payload = { citationID: citation.citationID, properties: { noteIndex: 0 }, citationItems, schema: SCHEMA };
    citations.set(positionKey(citation), { text: citation.text, code: `ITEM CSL_CITATION ${JSON.stringify(payload)}` });
  }
  const bib = rendered.bibliography;
  if (Boolean(bibliography) !== Boolean(bib)
    || (bib && (bib.start !== bibliography.start || bib.end !== bibliography.end))) {
    throw new Error('DOCX bibliography offsets are stale; render the document again');
  }
  if (bib) {
    if (!Array.isArray(bib.entries)) throw new Error('DOCX requires rendered bibliography entries');
    for (const entry of bib.entries) requireString(entry, 'bibliography entry');
  }
  const style = rendered.style;
  if (!style || typeof style.hasBibliography !== 'boolean') throw new Error('DOCX requires rendered CSL style metadata');
  requireString(style.id, 'CSL style ID');
  requireString(style.locale, 'CSL locale', false);
  if (style.class === 'note' || (style.noteType !== undefined && style.noteType !== 0)) throw new Error('DOCX footnote/endnote citation styles are not supported');
  if (bib && !style.hasBibliography) throw new Error('DOCX bibliography requested for a style without a bibliography');
  return { tree, citations, bibliography: bib, style };
}

class Document {
  constructor(model, mode) {
    Object.assign(this, model);
    this.mode = mode;
    this.bookmarkId = 0;
    this.properties = [];
    this.relationships = [{ id: 'rId1', type: `${R}/styles`, target: 'styles.xml' }];
    this.hyperlinks = new Map();
    this.lists = [];
    this.definitions = new Map();
    this.usedCitations = new Set();
    this.usedBibliography = false;
    walk(this.tree, node => {
      if (node.type === 'definition' && !this.definitions.has(node.identifier)) this.definitions.set(node.identifier, node);
    });
    this.addProperty('ZOTERO_PREF', JSON.stringify({
      style: { styleID: this.style.id, locale: this.style.locale, hasBibliography: this.style.hasBibliography, bibliographyStyleHasBeenSet: false },
      prefs: { fieldType: mode === 'bookmarks' ? 'Bookmark' : 'Field', noteType: 0, automaticJournalAbbreviations: false, delayCitationUpdates: false },
      sessionID: randomBytes(12).toString('hex'),
      dataVersion: 4,
    }));
  }

  addProperty(name, value) {
    chunks(value).forEach((chunk, index) => this.properties.push({ name: `${name}_${index + 1}`, value: chunk }));
  }

  addRelationship(type, target, external = false) {
    const id = `rId${this.relationships.length + 1}`;
    this.relationships.push({ id, type: `${R}/${type}`, target, external });
    return id;
  }

  range(code) {
    if (this.mode === 'bookmarks') {
      const id = ++this.bookmarkId;
      const name = `ZOTERO_BREF_${randomBytes(6).toString('hex')}`;
      this.addProperty(name, `ZOTERO_${code}`);
      return [`<w:bookmarkStart w:id="${id}" w:name="${name}"/>`, `<w:bookmarkEnd w:id="${id}"/>`];
    }
    return [
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${xml(` ADDIN ZOTERO_${code} `)}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`,
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
    ];
  }

  inline(nodes, format = {}, insideLink = false) {
    return nodes.map(node => {
      switch (node.type) {
        case 'text': return textRuns(node.value, format);
        case 'emphasis': return this.inline(node.children, { ...format, italic: true }, insideLink);
        case 'strong': return this.inline(node.children, { ...format, bold: true }, insideLink);
        case 'inlineCode': return textRuns(node.value, { ...format, code: true });
        case 'break': return `<w:r>${runProperties(format)}<w:br/></w:r>`;
        case 'link': {
          const key = positionKey({ start: node.position.start.offset, end: node.position.end.offset });
          const citation = this.citations.get(key);
          if (citation) {
            if (insideLink) unsupported(node, 'nested citation hyperlink');
            this.usedCitations.add(key);
            const [start, end] = this.range(citation.code);
            return start + textRuns(citation.text, format) + end;
          }
          return this.link(node, format, insideLink);
        }
        case 'linkReference': {
          const definition = this.definitions.get(node.identifier);
          if (!definition) unsupported(node, 'unresolved reference link');
          return this.link({ ...node, url: definition.url, title: definition.title }, format, insideLink);
        }
        default: return unsupported(node);
      }
    }).join('');
  }

  link(node, format, insideLink) {
    if (insideLink) unsupported(node, 'nested hyperlink');
    const href = requireString(node.url, 'link destination');
    // Relative links are retained, never read. Executable/data/custom protocols
    // and unresolved document fragments are rejected rather than activated.
    if (href.startsWith('#') || /[\x00-\x20\x7f]/.test(href) || href.includes('\\')
      || (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^(https?:|mailto:)/i.test(href))) {
      unsupported(node, 'link destination (use HTTP(S), mailto, or a relative path; fragment links are unsupported)');
    }
    if (!this.hyperlinks.has(href)) this.hyperlinks.set(href, this.addRelationship('hyperlink', href, true));
    const title = node.title ? ` w:tooltip="${xml(node.title)}"` : '';
    return `<w:hyperlink r:id="${this.hyperlinks.get(href)}"${title}>${this.inline(node.children, { ...format, link: true }, true)}</w:hyperlink>`;
  }

  blocks(nodes, context = {}) {
    return nodes.map(node => this.block(node, context)).join('');
  }

  block(node, context) {
    const indent = context.indent ?? 0;
    switch (node.type) {
      case 'paragraph': return paragraph(this.inline(node.children), { indent });
      case 'heading': return paragraph(this.inline(node.children), { style: `Heading${node.depth}`, indent });
      case 'code': return paragraph(textRuns(node.value, { code: true }), { style: 'CodeBlock', indent });
      case 'blockquote': return this.blocks(node.children, { ...context, indent: indent + 360 });
      case 'list': return this.list(node, context);
      case 'table': return this.table(node);
      case 'thematicBreak': return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr></w:pPr></w:p>';
      case 'definition': return '';
      default: return unsupported(node);
    }
  }

  list(node, context) {
    const level = context.listLevel === undefined ? 0 : context.listLevel + 1;
    if (level > 8) unsupported(node, 'list deeper than nine levels');
    const start = node.ordered ? node.start ?? 1 : 1;
    if (!Number.isSafeInteger(start) || start < 0 || start > 2147483647) unsupported(node, 'ordered-list start');
    const baseIndent = context.listBaseIndent ?? context.indent ?? 0;
    const id = this.lists.length + 1;
    this.lists.push({ id, ordered: Boolean(node.ordered), start, level, baseIndent });
    return node.children.map(item => {
      if (item.type !== 'listItem' || item.checked != null) unsupported(item, 'task or nonstandard list item');
      const children = [...item.children];
      const first = children[0];
      const numbering = { id, level };
      let firstParagraph;
      if (first?.type === 'paragraph' || first?.type === 'heading') {
        children.shift();
        firstParagraph = paragraph(this.inline(first.children), { numbering, style: first.type === 'heading' ? `Heading${first.depth}` : undefined });
      } else {
        firstParagraph = paragraph('', { numbering });
      }
      return firstParagraph + this.blocks(children, { listLevel: level, listBaseIndent: baseIndent, indent: baseIndent + 720 * (level + 1) });
    }).join('');
  }

  table(node) {
    const columns = node.children[0]?.children.length;
    if (!columns) unsupported(node, 'empty table');
    const width = Math.floor(9000 / columns);
    const rows = node.children.map((row, index) => {
      if (row.type !== 'tableRow' || row.children.length > columns) unsupported(row, 'inconsistent table row');
      const cells = Array.from({ length: columns }, (_, column) => {
        const cell = row.children[column];
        if (cell && cell.type !== 'tableCell') unsupported(cell);
        const content = cell ? this.inline(cell.children, { bold: index === 0 }) : textRuns('');
        return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${paragraph(content, { alignment: node.align?.[column] ?? undefined })}</w:tc>`;
      }).join('');
      return `<w:tr>${index === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells}</w:tr>`;
    }).join('');
    const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => `<w:${side} w:val="single" w:sz="4" w:color="B0B0B0"/>`).join('');
    const grid = Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;
  }

  bibliographyBlock() {
    this.usedBibliography = true;
    const [start, end] = this.range(BIB_CODE);
    const entries = this.bibliography.entries.length ? this.bibliography.entries : ['No cited references.'];
    return entries.map((entry, index) => paragraph(
      (index === 0 ? start : '') + textRuns(entry) + (index === entries.length - 1 ? end : ''),
      { style: 'Bibliography' },
    )).join('');
  }

  body() {
    const body = this.tree.children.map(node => {
      const { start, end } = node.position;
      if (this.bibliography && start.offset >= this.bibliography.start && end.offset <= this.bibliography.end) {
        return start.offset === this.bibliography.start ? this.bibliographyBlock() : '';
      }
      if (this.bibliography && start.offset < this.bibliography.end && end.offset > this.bibliography.start) {
        throw new Error('DOCX bibliography overlaps a Markdown block');
      }
      return this.block(node, {});
    }).join('');
    if (this.usedCitations.size !== this.citations.size) throw new Error('DOCX did not serialize every citation');
    if (this.bibliography && !this.usedBibliography) throw new Error('DOCX did not serialize the bibliography');
    return body || paragraph(textRuns(''));
  }

  customProperties() {
    return `${DECL}<Properties xmlns="${CUSTOM}" xmlns:vt="${VT}">${this.properties.map((property, index) =>
      `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${index + 2}" name="${xml(property.name)}"><vt:lpwstr>${xml(property.value)}</vt:lpwstr></property>`).join('')}</Properties>`;
  }

  numbering() {
    return `${DECL}<w:numbering xmlns:w="${W}">${this.lists.map(list => {
      const levels = Array.from({ length: 9 }, (_, level) => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${list.ordered ? 'decimal' : 'bullet'}"/><w:lvlText w:val="${list.ordered ? `%${level + 1}.` : ['•', '◦', '▪'][level % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="${list.baseIndent + 720 * (level + 1)}"/></w:tabs><w:ind w:left="${list.baseIndent + 720 * (level + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('');
      return `<w:abstractNum w:abstractNumId="${list.id}"><w:multiLevelType w:val="multilevel"/>${levels}</w:abstractNum>`;
    }).join('')}${this.lists.map(list => `<w:num w:numId="${list.id}"><w:abstractNumId w:val="${list.id}"/><w:lvlOverride w:ilvl="${list.level}"><w:startOverride w:val="${list.start}"/></w:lvlOverride></w:num>`).join('')}</w:numbering>`;
  }
}

function styles() {
  const headings = Array.from({ length: 6 }, (_, i) => `<w:style w:type="paragraph" w:styleId="Heading${i + 1}"><w:name w:val="heading ${i + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${i}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${[36, 32, 28, 26, 24, 24][i]}"/></w:rPr></w:style>`).join('');
  return `${DECL}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl/><w:spacing w:after="120"/></w:pPr></w:style>${headings}<w:style w:type="character" w:styleId="InlineCode"><w:name w:val="Inline Code"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Bibliography"><w:name w:val="Bibliography"/><w:basedOn w:val="Normal"/><w:pPr><w:keepLines/><w:ind w:left="360" w:hanging="360"/></w:pPr></w:style></w:styles>`;
}

/**
 * Serialize a renderDocument result to a standalone DOCX byte array.
 * Synchronous, with no file/network/application I/O. A fresh session and range
 * names are allocated for each document. Bookmarks interoperate across office
 * applications; fields target Microsoft Word. Live plugin tests are separate.
 */
export function exportDocx(rendered, { mode = 'bookmarks', title = 'Systematic review' } = {}) {
  if (!['bookmarks', 'fields'].includes(mode)) throw new Error('DOCX mode must be bookmarks or fields');
  requireString(title, 'title', false);
  const document = new Document(validateRendered(rendered), mode);
  const body = document.body();
  const parts = {
    'word/document.xml': `${DECL}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    'word/styles.xml': styles(),
    'docProps/custom.xml': document.customProperties(),
    'docProps/core.xml': `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>Systematic Reviewer V3</dc:creator></cp:coreProperties>`,
    'docProps/app.xml': `${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Systematic Reviewer V3</Application></Properties>`,
  };
  if (document.lists.length) {
    parts['word/numbering.xml'] = document.numbering();
    document.addRelationship('numbering', 'numbering.xml');
  }
  parts['word/_rels/document.xml.rels'] = `${DECL}<Relationships xmlns="${PACKAGE_R}">${document.relationships.map(rel => `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${xml(rel.target)}"${rel.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
  const rootRelations = [
    [`${R}/officeDocument`, 'word/document.xml'],
    ['http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
    [`${R}/extended-properties`, 'docProps/app.xml'],
    [`${R}/custom-properties`, 'docProps/custom.xml'],
  ];
  parts['_rels/.rels'] = `${DECL}<Relationships xmlns="${PACKAGE_R}">${rootRelations.map(([type, target], i) => `<Relationship Id="rId${i + 1}" Type="${type}" Target="${target}"/>`).join('')}</Relationships>`;
  const overrides = [
    ['word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],
    ['word/styles.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'],
    ['docProps/custom.xml', 'application/vnd.openxmlformats-officedocument.custom-properties+xml'],
    ['docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ['docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'],
  ];
  if (document.lists.length) overrides.push(['word/numbering.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml']);
  parts['[Content_Types].xml'] = `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.map(([name, type]) => `<Override PartName="/${name}" ContentType="${type}"/>`).join('')}</Types>`;
  // ZIP uses local wall-clock dates, not UTC. A UTC midnight in 1980 becomes
  // 1979 in negative offsets and falls outside ZIP's supported date range.
  const archive = Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, [strToU8(value), { mtime: new Date(1980, 0, 1) }]]));
  return zipSync(archive, { level: 6 });
}
