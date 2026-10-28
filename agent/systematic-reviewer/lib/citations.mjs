// SPDX-License-Identifier: AGPL-3.0-or-later
// Markdown span/marker behavior retained from Systematic Reviewer; CSL belongs
// to the shared References renderer used by all three native Office adapters.
import { createHash } from 'node:crypto';
import { ReferencesClient } from './client.mjs';
import { validateSnapshot, splitIdentity } from './references.mjs';
import { scanDocument, replaceSpans, citationMarker, escapeMarkdown, BIB_START, BIB_END } from './markdown.mjs';

export async function renderDocument(markdown, snapshot, { projectId, style, locale = 'en-US', signal, request } = {}) {
  if (typeof markdown !== 'string') throw Error('Markdown must be a string');
  const source = scanDocument(markdown);
  const entries = snapshot ? validateSnapshot(snapshot) : undefined;
  const embeddedItems = entries && Object.fromEntries([...entries].map(([id, item]) => {
    if (splitIdentity(id).projectId !== projectId) throw Error('Offline reference belongs to another project; import/map it explicitly');
    return [id, item.itemData];
  }));
  const citations = source.citations.map((citation, index) => ({
    id: `sr${createHash('sha256').update(`${index}:${JSON.stringify(citation.cluster)}`).digest('hex').slice(0, 20)}`,
    items: citation.cluster.items.map(({ 'suppress-author': suppressAuthor, ...item }) => ({ ...item, ...(suppressAuthor === undefined ? {} : { suppressAuthor }) })),
    noteIndex: index + 1,
  }));
  const { body: rendered } = await new ReferencesClient({ projectId, request }).call('POST', '/citations/render', {
    version: 1, style: { ...(style ? { id: style } : {}), locale }, citations, ...(embeddedItems ? { embeddedItems, metadataSource: 'snapshot' } : {}),
  }, { signal });
  if (!Array.isArray(rendered?.citations) || rendered.citations.length !== citations.length) throw Error('References did not render the complete citation state');
  const labels = new Map(rendered.citations.map(item => [item.id, item]));
  const replacements = source.citations.map((citation, index) => {
    const item = labels.get(citations[index].id);
    if (!item || typeof item.text !== 'string') throw Error('References omitted a citation result');
    return { ...citation, text: citationMarker(citation.cluster.items, item.text) };
  });
  const bibliographyEntries = rendered.bibliography?.textEntries;
  if (source.bibliography) {
    if (!rendered.bibliography) throw Error('The selected style did not provide the requested bibliography');
    if (!Array.isArray(bibliographyEntries) || bibliographyEntries.some(entry => typeof entry !== 'string')) throw Error('References omitted a plain-text bibliography');
    replacements.push({ ...source.bibliography, text: `${BIB_START}\n\n${bibliographyEntries.map(escapeMarkdown).join('\n\n')}\n\n${BIB_END}` });
  }
  return { markdown: replaceSpans(markdown, replacements), citations: rendered.citations,
    bibliography: source.bibliography ? rendered.bibliography : null, style: rendered.style };
}
