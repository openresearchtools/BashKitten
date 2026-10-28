// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared browser/Pi citation grammar adapted from frozen Systematic Reviewer V3.
// No Node imports, document parser, service calls or mutable global state.
const ID = /^bkref:([A-Za-z0-9._~-]+)\/([A-Za-z0-9._~-]+)\/([A-Za-z0-9._~-]+)$/;
const LEGACY = /^(?:users\/[1-9]\d*|groups\/[1-9]\d*|users\/local\/[A-Za-z0-9]+)\/items\/[A-Z0-9]{8}$/;
export function normalizeId(value) {
  if (typeof value !== 'string' || value.length > 512) throw Error('A verified References identity is required');
  const canonical = ID.exec(value);
  if (canonical && canonical.slice(1).every(part => part !== '.' && part !== '..')) return value;
  const legacy = value.replace(/^https?:\/\/(?:www\.)?zotero\.org\//, '');
  if (LEGACY.test(legacy)) return legacy;
  throw Error('Use a verified bkref:<backend>/<project>/<item> identity, or an explicitly mapped legacy identity; never users/0 or a bare key');
}

const LABELS = new Set(['page', 'chapter', 'section', 'paragraph', 'volume', 'issue', 'figure', 'table', 'line', 'note', 'verse', 'book', 'column', 'folio', 'part', 'opus', 'sub verbo']);
const ITEM_FIELDS = new Set(['id', 'locator', 'label', 'prefix', 'suffix', 'suppress-author']);

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
  if (new TextEncoder().encode(marker).byteLength > 32768) throw new Error('Citation marker exceeds 32 KiB; reduce the cluster or affixes');
  return marker;
}
