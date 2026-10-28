// SPDX-License-Identifier: AGPL-3.0-only
// Read-only package comparison. No extraction, macros, external XML or relationships.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import yauzl from 'yauzl';
import { SaxesParser } from 'saxes';
import { diffArrays } from 'diff';
const maxArchive = 256 * 1024 * 1024, maxPart = 16 * 1024 * 1024, maxExpanded = 96 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const namespaces = {
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main': new Set(['p', 'tbl', 'style', 'footnote', 'endnote', 'comment', 'ins', 'del', 'fldSimple', 'bookmarkStart']),
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main': new Set(['sheet', 'c', 'mergeCell', 'definedName', 'xf', 'comment']),
  'http://schemas.openxmlformats.org/presentationml/2006/main': new Set(['sp', 'pic', 'graphicFrame', 'notes', 'sldLayout', 'cSld']),
  'http://schemas.openxmlformats.org/drawingml/2006/main': new Set(['p', 'theme', 'clrScheme', 'fontScheme']),
  'urn:oasis:names:tc:opendocument:xmlns:text:1.0': new Set(['p', 'h', 'note', 'tracked-changes', 'bookmark-start', 'bibliography-mark']),
  'urn:oasis:names:tc:opendocument:xmlns:table:1.0': new Set(['table', 'table-row', 'table-cell', 'named-range', 'named-expression']),
  'urn:oasis:names:tc:opendocument:xmlns:style:1.0': new Set(['style', 'default-style', 'page-layout', 'master-page']),
  'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0': new Set(['page', 'frame', 'custom-shape']),
  'urn:oasis:names:tc:opendocument:xmlns:office:1.0': new Set(['annotation']),
  'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0': new Set(['notes']),
};
// Whitespace inside Office text/value containers is data, even when it is the
// entire text node. ODF paragraphs are mixed content, so their descendants inherit it.
const significantText = {
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main': new Set(['t', 'delText', 'instrText', 'delInstrText']),
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main': new Set(['t', 'v', 'f', 'definedName']),
  'http://schemas.openxmlformats.org/drawingml/2006/main': new Set(['t']),
  'urn:oasis:names:tc:opendocument:xmlns:text:1.0': new Set(['p', 'h', 'span', 'a', 'ruby-base', 'ruby-text']),
};
function xml(bytes) {
  const source = bytes[0] === 255 && bytes[1] === 254 ? new TextDecoder('utf-16le').decode(bytes) : bytes[0] === 254 && bytes[1] === 255 ? new TextDecoder('utf-16be').decode(bytes) : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const tokens = [], records = [], active = [], contexts = []; let depth = 0, count = 0;
  let pendingText = [], pendingCDATA = false;
  const parser = new SaxesParser({ xmlns: true });
  const push = value => { tokens.push(value); for (const record of active) { if (record.bytes + value.length > 262144) record.truncated = true; else { record.values.push(value); record.bytes += value.length; } } };
  const flushText = () => {
    if (!pendingText.length) return;
    const value = pendingText.join(''), context = contexts.at(-1);
    // Only XML's four whitespace characters can be indentation. NBSP and other
    // Unicode spacing remain text. CDATA is explicit character data as before.
    if (value && (pendingCDATA || context?.preserve || context?.significant || /[^\t\n\r ]/.test(value)))
      push(JSON.stringify(['text', value]));
    pendingText = []; pendingCDATA = false;
  };
  parser.on('doctype', () => { throw Error('DTD-bearing XML is reported as an uninterpreted part'); });
  parser.on('opentag', node => {
    flushText();
    const parent = contexts.at(-1);
    const space = Object.values(node.attributes).find(a => a.uri === 'http://www.w3.org/XML/1998/namespace' && a.local === 'space')?.value;
    contexts.push({ preserve: space === 'preserve' || (space !== 'default' && !!parent?.preserve),
      significant: !!parent?.significant || !!significantText[node.uri]?.has(node.local) });
    if (++depth > 128 || ++count > 250000) throw Error('XML structure exceeds the work bound');
    const attrs = Object.values(node.attributes).filter(a => a.uri !== 'http://www.w3.org/2000/xmlns/' && !(a.uri === 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' && /^rsid/.test(a.local))).map(a => ['{' + a.uri + '}' + a.local, a.value]).sort((a, b) => a[0].localeCompare(b[0]));
    const kind = '{' + node.uri + '}' + node.local;
    if (namespaces[node.uri]?.has(node.local) && records.length + active.length < 20000) active.push({ depth, kind, index: count, values: [], bytes: 0 });
    push(JSON.stringify(['open', kind, attrs]));
  });
  parser.on('closetag', node => { flushText(); push(JSON.stringify(['close', '{' + node.uri + '}' + node.local])); if (active.at(-1)?.depth === depth) { const record = active.pop(); records.push({ kind: record.kind, index: record.index, value: record.values.join('\n'), truncated: !!record.truncated }); } depth--; contexts.pop(); });
  // SAX may split one logical text run across input writes, entities or CDATA.
  // Flush only at element boundaries, while its namespace/space context is active.
  parser.on('text', value => pendingText.push(value));
  parser.on('cdata', value => { pendingText.push(value); pendingCDATA = true; });
  // Feed bounded chunks; SAX preserves namespace identities and text, never resolves URLs.
  for (let offset = 0; offset < source.length; offset += 65536) parser.write(source.slice(offset, offset + 65536)); parser.close(); flushText();
  return { tokens, records };
}
async function archive(snapshot) {
  const stat = await fs.promises.stat(snapshot.path);
  if (!stat.isFile() || stat.size > maxArchive) throw Error('Snapshot exceeds the archive bound');
  const hash = createHash('sha256'); for await (const bytes of fs.createReadStream(snapshot.path)) hash.update(bytes);
  if (hash.digest('hex') !== snapshot.sha256) throw Error('Immutable snapshot checksum changed');
  return new Promise((resolve, reject) => yauzl.open(snapshot.path, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
    if (error) { reject(error); return; }
    const parts = new Map(); let expanded = 0, entries = 0, failed = false;
    const fail = error => { if (!failed) { failed = true; zip.close(); reject(error); } };
    zip.on('error', fail); zip.on('end', () => { if (!failed) resolve(parts); });
    zip.on('entry', entry => {
      if (++entries > 20000 || entry.uncompressedSize > maxPart || (expanded += entry.uncompressedSize) > maxExpanded) { fail(Error('Snapshot package exceeds the bounded comparison size')); return; }
      if (parts.has(entry.fileName) || entry.isEncrypted()) { fail(Error('Duplicate or encrypted snapshot part')); return; }
      if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
      zip.openReadStream(entry, (error, stream) => {
        if (error) { fail(error); return; }
        const chunks = []; let size = 0;
        stream.on('error', fail); stream.on('data', bytes => { size += bytes.length; if (size > maxPart) { stream.destroy(); fail(Error('Expanded part exceeds its bound')); } else chunks.push(bytes); });
        stream.on('end', () => {
          if (failed) return;
          const bytes = Buffer.concat(chunks), part = { size, sha256: digest(bytes) };
          if (/\.(xml|rels)$/i.test(entry.fileName)) { try { part.xml = xml(bytes); } catch (error) { part.unsupported = error.message; } }
          else part.unsupported = 'Binary or non-XML package entry; checksum comparison only';
          parts.set(entry.fileName, part); zip.readEntry();
        });
      });
    }); zip.readEntry();
  }));
}
function delta(left, right, limit = 80) {
  const changes = diffArrays(left, right, { timeout: 150, maxEditLength: 10000 });
  if (!changes) return { truncated: true, reason: 'Structural change exceeds the per-part diff budget' };
  let remaining = limit, omitted = 0;
  const chunks = [];
  for (const chunk of changes) {
    if (!chunk.added && !chunk.removed) continue;
    const selected = chunk.value.slice(0, Math.max(0, remaining)); omitted += chunk.value.length - selected.length; remaining -= selected.length;
    if (selected.length) chunks.push({ change: chunk.added ? 'added' : 'removed', values: selected.map(value => value.length > 1200 ? value.slice(0, 1200) + '…' : value) });
  }
  return { chunks, truncated: omitted > 0, omitted };
}
async function compare({ before, after, format }) {
  const left = await archive(before), right = await archive(after), parts = []; let omitted = 0, outputBytes = 0;
  for (const name of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const a = left.get(name), b = right.get(name); if (a?.sha256 === b?.sha256) continue;
    if (parts.length >= 256) { omitted++; continue; }
    const part = { name, change: !a ? 'added' : !b ? 'removed' : 'changed', before: a && { size: a.size, sha256: a.sha256 }, after: b && { size: b.size, sha256: b.sha256 } };
    if (a?.xml || b?.xml) {
      const oldXML = a?.xml || { tokens: [], records: [] }, newXML = b?.xml || { tokens: [], records: [] };
      part.semantic = delta(oldXML.records.map(r => r.kind + '\n' + r.value), newXML.records.map(r => r.kind + '\n' + r.value), 30);
      part.namespaceXML = delta(oldXML.tokens, newXML.tokens);
      part.semanticRecordsTruncated = [...oldXML.records, ...newXML.records].some(record => record.truncated);
      part.normalizedEqual = oldXML.tokens.join('\n') === newXML.tokens.join('\n');
    }
    if (a?.unsupported || b?.unsupported) part.uninterpreted = a?.unsupported || b?.unsupported;
    const bytes = Buffer.byteLength(JSON.stringify(part));
    if (outputBytes + bytes > 2 * 1024 * 1024) { delete part.semantic; delete part.namespaceXML; part.detailsOmitted = 'Combined diff output limit'; }
    outputBytes += Buffer.byteLength(JSON.stringify(part)); parts.push(part);
  }
  const result = { documentId: before.documentId, from: before.versionId, to: after.versionId, equalPackages: before.sha256 === after.sha256, parts, omittedParts: omitted,
    interpretation: 'Namespace-aware XML and semantic elements for Office paragraphs, tables, fields, notes, cells/formulas, styles, slides/shapes and relationships. Binary assets use checksums. ZIP ordering, XML prefixes and Writer generated revision IDs do not create semantic changes; raw changed parts remain reported. This is not a rendering-equivalence claim.' };
  if (format === 'text') return ['Office snapshots ' + result.from + ' → ' + result.to, ...parts.map(part => part.change + ': ' + part.name + (part.normalizedEqual ? ' (normalized XML equal)' : '') + (part.uninterpreted ? ' — ' + part.uninterpreted : '') + '\n' + JSON.stringify(part.semantic || part.namespaceXML || {}, null, 2)), omitted ? omitted + ' further changed parts omitted' : '', result.interpretation].filter(Boolean).join('\n');
  return result;
}
try { parentPort.postMessage({ value: await compare(workerData) }); } catch (error) { parentPort.postMessage({ error: error.message }); }
