import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { decodeCitation } from './citation-code.mjs';
export { validateCluster, decodeCitation, escapeMarkdown, citationMarker } from './citation-code.mjs';

export const BIB_START = '<!-- sr-bibliography -->';
export const BIB_END = '<!-- /sr-bibliography -->';
export function parseMarkdown(markdown) {
  return fromMarkdown(markdown, {
    extensions: [gfmTable()], mdastExtensions: [gfmTableFromMarkdown()],
  });
}

export function walk(node, visitor) {
  visitor(node);
  for (const child of node.children ?? []) walk(child, visitor);
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
