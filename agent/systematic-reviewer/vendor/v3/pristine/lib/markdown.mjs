import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { normalizeId } from './references.mjs';

export const BIB_START = '<!-- sr-bibliography -->';
export const BIB_END = '<!-- /sr-bibliography -->';
const LABELS = new Set(['page', 'chapter', 'section', 'paragraph', 'volume', 'issue', 'figure', 'table', 'line', 'note', 'verse', 'book', 'column', 'folio', 'part', 'opus', 'sub verbo']);
const ITEM_FIELDS = new Set(['id', 'locator', 'label', 'prefix', 'suffix', 'suppress-author']);

export function parseMarkdown(markdown) {
  return fromMarkdown(markdown, {
    extensions: [gfmTable()], mdastExtensions: [gfmTableFromMarkdown()],
  });
}

export function walk(node, visitor) {
  visitor(node);
  for (const child of node.children ?? []) walk(child, visitor);
}

export function validateCluster(value) {
  if (!value || value.v !== 1 || !Array.isArray(value.items) || !value.items.length || value.items.length > 100) {
    throw new Error('Citation must have v:1 and 1–100 items');
  }
  if (Object.keys(value).some(key => !['v', 'items'].includes(key))) throw new Error('Unknown citation property');
  const items = value.items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid citation item');
    for (const key of Object.keys(item)) if (!ITEM_FIELDS.has(key)) throw new Error(`Unknown citation item property: ${key}`);
    const result = { id: normalizeId(item.id) };
    for (const key of ['locator', 'label', 'prefix', 'suffix']) {
      if (item[key] !== undefined) {
        if (typeof item[key] !== 'string' || !item[key].trim() || item[key].length > 2000 || /[\r\n\x00-\x1f]/.test(item[key])) {
          throw new Error(`Invalid citation ${key}`);
        }
        result[key] = item[key];
      }
    }
    if (result.label && !LABELS.has(result.label)) throw new Error(`Unsupported locator label: ${result.label}`);
    if (result.label && !result.locator) throw new Error('A locator label requires a locator');
    if (result.locator && !result.label) result.label = 'page';
    if (item['suppress-author'] !== undefined) {
      if (typeof item['suppress-author'] !== 'boolean') throw new Error('suppress-author must be boolean');
      result['suppress-author'] = item['suppress-author'];
    }
    return result;
  });
  return { v: 1, items };
}

export function decodeCitation(url) {
  if (!url.startsWith('sr-cite:')) throw new Error('Expected an sr-cite: link');
  let data;
  try { data = decodeURIComponent(url.slice(8)); }
  catch { throw new Error('Malformed percent encoding in citation'); }
  if (data.startsWith('{')) {
    try { return validateCluster(JSON.parse(data)); }
    catch (error) { throw new Error(`Invalid citation: ${error.message}`); }
  }
  return validateCluster({ v: 1, items: [{ id: data }] });
}

// Keep ordinary author/date punctuation readable in Markdown source, while
// preventing labels or bibliography titles from becoming links/HTML/formatting.
export function escapeMarkdown(text) {
  return String(text).replace(/([\\`*_[\]<>&])/g, '\\$1')
    .replace(/^(\s*)([#-]|\+)(?=\s)/gm, '$1\\$2')
    .replace(/^(\s*\d+)([.)])(?=\s)/gm, '$1\\$2');
}

export function citationMarker(items, label = 'cite') {
  const cluster = validateCluster({ v: 1, items });
  const simple = cluster.items.length === 1 && Object.keys(cluster.items[0]).length === 1;
  const data = simple ? cluster.items[0].id : encodeURIComponent(JSON.stringify(cluster)).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  const marker = `[${escapeMarkdown(label)}](sr-cite:${data})`;
  if (Buffer.byteLength(marker, 'utf8') > 32768) throw new Error('Citation marker exceeds 32 KiB; reduce the cluster or affixes');
  return marker;
}

export function scanDocument(markdown) {
  const tree = parseMarkdown(markdown);
  const citations = [];
  const definitions = new Map();
  walk(tree, node => { if (node.type === 'definition') definitions.set(node.identifier, node.url); });
  walk(tree, node => {
    if (node.type === 'link' && node.url.startsWith('sr-cite:')) {
      citations.push({ start: node.position.start.offset, end: node.position.end.offset, cluster: decodeCitation(node.url), node });
    } else if ((node.type === 'linkReference' || node.type === 'imageReference') && definitions.get(node.identifier)?.startsWith('sr-cite:')) {
      throw new Error('Citation reference links are not supported; use inline [cite](sr-cite:...) links');
    } else if (node.type === 'image' && node.url.startsWith('sr-cite:')) {
      throw new Error('An image cannot be a citation');
    }
  });
  citations.sort((a, b) => a.start - b.start);
  // Only standalone, top-level bibliography markers are accepted. Code fences
  // and inline code are never interpreted as live citations or bibliography.
  let begin;
  let bibliography;
  for (const node of tree.children) {
    if (node.type !== 'html') continue;
    if (node.value.trim() === BIB_START) {
      if (begin || bibliography) throw new Error('Only one bibliography block is allowed');
      begin = node;
    } else if (node.value.trim() === BIB_END) {
      if (!begin) throw new Error('Bibliography end has no start');
      bibliography = { start: begin.position.start.offset, end: node.position.end.offset };
      begin = undefined;
    }
  }
  if (begin) throw new Error('Bibliography block is missing its end marker');
  if (bibliography && citations.some(c => c.start >= bibliography.start && c.start < bibliography.end)) {
    throw new Error('Citations cannot occur inside the generated bibliography block');
  }
  // Catch unparsed citation-like text (e.g. broken URL delimiters), but ignore
  // code, HTML and unrelated URLs. Do not silently export a broken live marker.
  const topLevel = new Set(tree.children);
  walk(tree, node => {
    if (node.type === 'text' && node.value.includes('sr-cite:')) throw new Error('Malformed citation marker in prose; use [cite](sr-cite:...) or put examples in code');
    if (node.type === 'html' && /<!--\s*\/?sr-bibliography/.test(node.value)
        && (!topLevel.has(node) || ![BIB_START, BIB_END].includes(node.value.trim()))) throw new Error('Bibliography markers must be standalone top-level blocks separated by blank lines');
  });
  return { tree, citations, bibliography };
}

export function replaceSpans(text, spans) {
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, span.start) + span.text + text.slice(span.end);
  }
  return text;
}
