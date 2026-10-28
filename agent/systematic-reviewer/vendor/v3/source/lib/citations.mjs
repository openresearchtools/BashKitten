import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import CSL from 'citeproc';
import { validateSnapshot } from './references.mjs';
import { scanDocument, replaceSpans, citationMarker, escapeMarkdown, BIB_START, BIB_END } from './markdown.mjs';

const defaultStyle = readFileSync(new URL('../assets/author-date.csl', import.meta.url), 'utf8');
const defaultLocale = readFileSync(new URL('../assets/locales-en-US.xml', import.meta.url), 'utf8');

/** Pure offline rendering. No metadata retrieval, file writes or model calls. */
export function renderDocument(markdown, snapshot, options = {}) {
  if (typeof markdown !== 'string') throw new Error('Markdown must be a string');
  const references = validateSnapshot(snapshot);
  const source = scanDocument(markdown);
  const locale = options.locale ?? 'en-US';
  const locales = { 'en-US': defaultLocale, ...options.locales };
  const styleXml = options.styleXml ?? defaultStyle;
  if (!locales[locale]) throw new Error(`Supply CSL locale XML for ${locale}; only en-US is bundled`);
  if (/<!DOCTYPE|<!ENTITY/i.test(styleXml)) throw new Error('CSL external entities and DTDs are not supported');
  for (const xml of Object.values(locales)) {
    if (typeof xml !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Invalid CSL locale XML');
  }
  const byUri = new Map([...references.values()].map(item => [item.uri, item]));
  const engine = new CSL.Engine({
    retrieveLocale: lang => {
      const xml = locales[lang] ?? (lang === 'en' ? locales['en-US'] : undefined);
      if (!xml) throw new Error(`Missing CSL locale XML: ${lang}`);
      return xml;
    },
    retrieveItem: uri => {
      const entry = byUri.get(String(uri));
      if (!entry) throw new Error(`Missing reference: ${uri}`);
      return structuredClone(entry.itemData);
    },
  }, styleXml, locale, true);
  if (engine.opt.xclass !== 'in-text') throw new Error('Only independent in-text CSL styles are supported; footnote/endnote styles require a different document model');
  const styleId = engine.opt.styleID;
  if (typeof styleId !== 'string' || !/^https?:\/\//.test(styleId)) throw new Error('CSL style must have an HTTP(S) style ID');
  engine.setOutputFormat('text');

  const prepared = source.citations.map((citation, index) => {
    const citationItems = citation.cluster.items.map(({ id, ...properties }) => {
      const reference = references.get(id);
      if (!reference) throw new Error(`Missing reference: ${id}. Fetch it from Zotero or add verified CSL metadata to the snapshot.`);
      return { ...properties, id: reference.uri, uris: [reference.uri], itemData: structuredClone(reference.itemData) };
    });
    const citationID = `sr${createHash('sha256').update(`${index}:${JSON.stringify(citation.cluster)}`).digest('hex').slice(0, 20)}`;
    return { ...citation, citationItems, citationID };
  });
  engine.updateItems([...new Set(prepared.flatMap(c => c.citationItems.map(item => item.id)))]);
  const labels = [];
  const previous = [];
  for (const citation of prepared) {
    const [status, updates] = engine.processCitationCluster({
      citationID: citation.citationID,
      citationItems: citation.citationItems.map(({ uris, itemData, ...item }) => item),
      properties: { noteIndex: 0 },
    }, previous, []);
    if (status.citation_errors?.length) throw new Error(`CSL citation errors: ${JSON.stringify(status.citation_errors)}`);
    // A later citation can disambiguate earlier ones; never ignore retroactive
    // updates returned by the processor.
    for (const [index, text] of updates) labels[index] = text;
    previous.push([citation.citationID, 0]);
  }
  const hasBibliography = Boolean(engine.bibliography?.tokens.length);
  const bibliography = engine.makeBibliography();
  if (source.bibliography && !hasBibliography) throw new Error('This CSL style has no bibliography');
  const entries = bibliography ? bibliography[1].map(entry => entry.trim()) : [];
  const replacements = prepared.map((citation, index) => {
    if (!labels[index]) throw new Error(`CSL produced no label for citation ${index + 1}`);
    return { ...citation, text: citationMarker(citation.cluster.items, labels[index]) };
  });
  if (source.bibliography) replacements.push({
    ...source.bibliography,
    text: `${BIB_START}\n\n${entries.map(escapeMarkdown).join('\n\n')}${entries.length ? '\n\n' : ''}${BIB_END}`,
  });
  const rendered = replaceSpans(markdown, replacements);
  const rescanned = scanDocument(rendered);
  return {
    markdown: rendered,
    citations: rescanned.citations.map((citation, index) => ({
      start: citation.start, end: citation.end, cluster: citation.cluster,
      text: labels[index], citationID: prepared[index].citationID,
      citationItems: prepared[index].citationItems,
    })),
    bibliography: rescanned.bibliography ? { ...rescanned.bibliography, entries } : null,
    style: { id: styleId, locale, hasBibliography },
  };
}
