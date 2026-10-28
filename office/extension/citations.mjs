// SPDX-License-Identifier: AGPL-3.0-only
// Shared UI/Pi command preparation. Only the native participant mutates a document.
import { citationRuns } from './rich-text.mjs';
export async function runCitationCommand({ invoke, renderDocument, documentType, projectId, request, signal, preview = false }) {
  const current = await invoke({ operation: 'citations.inspect' }, { signal });
  if (request.expectedRevision !== undefined && request.expectedRevision !== current.revision) throw new Error('Citation state changed; inspect it again');
  let state = structuredClone(current); state.projectId = projectId;
  state.libraryId ||= request.libraryId || projectId;
  state.style ||= { id: 'apa', locale: 'en-US' };
  if (request.noteType !== undefined) { if (!['footnote', 'endnote'].includes(request.noteType)) throw Error('Invalid native note placement'); state.noteType = request.noteType; }
  if (request.operation === 'citations.insert') {
    if (!request.cluster?.items?.length) throw new Error('A citation requires references');
    state.citations.push({ ...request.cluster, id: crypto.randomUUID(), target: request.target });
  } else if (request.operation === 'citations.edit') {
    const index = state.citations.findIndex(c => c.id === request.id);
    if (index < 0) throw new Error('The managed citation no longer exists');
    state.citations[index] = { ...state.citations[index], ...request.cluster, id: request.id };
  } else if (request.operation === 'citations.remove') {
    if (!state.citations.some(c => c.id === request.id)) throw new Error('The managed citation no longer exists');
    state.citations = state.citations.filter(c => c.id !== request.id);
  } else if (request.operation === 'citations.style') {
    if (!request.style?.id) throw new Error('A style identifier is required');
    state.style = { ...state.style, ...request.style };
  } else if (request.operation === 'citations.bibliography') state.bibliography = { ...(state.bibliography || {}), id: 'bibliography', target: request.target };
  else if (request.operation !== 'citations.refresh') throw new Error('Unknown citation operation');
  state = await invoke({ operation: 'citations.prepare', expectedRevision: current.revision, state }, { signal });
  const rendered = await renderDocument(state, { signal, projectId });
  const byId = new Map(rendered.citations.map(citation => [citation.id, citation]));
  state.style = rendered.style;
  state.embeddedItems = rendered.embeddedItems || state.embeddedItems || {};
  state.citations = state.citations.map(citation => {
    const output = byId.get(citation.id);
    if (!output) throw new Error('References did not render every citation');
    const rich = citationRuns(output.html);
    if (rendered.style.class === 'note' && documentType !== 'text') {
      rich.runs.unshift({ text: String(output.noteIndex) + '. ' }); rich.text = rich.runs.map(run => run.text).join('');
    }
    return { ...citation, ...output, ...rich, note: rendered.style.class === 'note' && documentType === 'text' ? (state.noteType || 'footnote') : null };
  });
  if (state.bibliography) {
    if (!rendered.bibliography) throw new Error('The selected CSL style does not define a bibliography');
    state.bibliography = { ...state.bibliography, ...citationRuns(rendered.bibliography.html), entries: rendered.bibliography.entries, parameters: rendered.bibliography.parameters };
  }
  if (preview) return { state, rendered };
  return invoke({ operation: 'citations.apply', expectedRevision: current.revision, state }, { signal, mutation: true });
}
