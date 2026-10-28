// SPDX-License-Identifier: AGPL-3.0-only
// Shared UI/Pi command preparation. Only the native participant mutates a document.
import { citationRuns, bibliographyRuns } from './rich-text.mjs';
export async function runCitationCommand({ invoke, renderDocument, importSnapshots, documentType, projectId, request, signal, preview = false }) {
  const current = await invoke({ operation: 'citations.inspect' }, { signal });
  if (request.expectedRevision !== undefined && request.expectedRevision !== current.revision) throw new Error('Citation state changed; inspect it again');
  let state = structuredClone(current); state.projectId = projectId;
  state.libraryId ||= request.libraryId || projectId;
  state.style ||= { id: 'apa', locale: 'en-US' };
  if (request.metadataSource !== undefined && !['library', 'snapshot'].includes(request.metadataSource)) throw Error('Choose library metadata or embedded snapshots');
  state.metadataSource = request.metadataSource || state.metadataSource || 'library';
  let occurrenceId = request.id, imported;
  if (request.noteType !== undefined) { if (!['footnote', 'endnote'].includes(request.noteType)) throw Error('Invalid native note placement'); state.noteType = request.noteType; }
  if (request.operation === 'citations.insert') {
    if (!request.cluster?.items?.length) throw new Error('A citation requires references');
    occurrenceId = crypto.randomUUID();
    state.citations.push({ ...request.cluster, id: occurrenceId, target: request.target });
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
  } else if (request.operation === 'citations.import-snapshots') {
    if (preview || typeof importSnapshots !== 'function') throw Error('Explicit snapshot import is unavailable');
    const ids = [...new Set(state.citations.flatMap(citation => citation.items.map(item => item.id)))].sort();
    if (!ids.length) throw Error('This document has no references to import');
    if (ids.some(id => !state.embeddedItems?.[id])) throw Error('A cited reference has no embedded snapshot');
    imported = { requestId: request.requestId || crypto.randomUUID(), mapping: {} };
    try {
      for (let offset = 0; offset < ids.length; offset += 100) {
        signal?.throwIfAborted();
        const batch = ids.slice(offset, offset + 100);
        const result = await importSnapshots({ items: Object.fromEntries(batch.map(id => [id, state.embeddedItems[id]])), requestId: imported.requestId + ':' + offset, ...(request.collection ? { target: request.collection } : {}) }, { signal, projectId });
        for (const id of batch) {
          if (typeof result.mapping?.[id] !== 'string' || !result.mapping[id].startsWith('bkref:')) throw Error('References did not return every imported identity');
          imported.mapping[id] = result.mapping[id];
        }
      }
      for (const citation of state.citations) citation.items = citation.items.map(item => ({ ...item, id: imported.mapping[item.id] }));
      state.embeddedItems = Object.fromEntries(ids.map(id => [imported.mapping[id], { ...state.embeddedItems[id], id: imported.mapping[id] }]));
      state.libraryId = projectId; state.metadataSource = 'library';
    } catch (error) { error.details = { ...error.details, imported }; throw error; }
  } else if (request.operation === 'citations.bibliography') state.bibliography = { ...(state.bibliography?.missing ? {} : state.bibliography || {}), id: 'bibliography', target: request.target };
  else if (request.operation !== 'citations.refresh') throw new Error('Unknown citation operation');
  // A native user deletion removes the occurrence. Refresh reconciles the
  // metadata with those actual anchors instead of resurrecting deleted text.
  if (['citations.refresh', 'citations.style', 'citations.bibliography'].includes(request.operation)) {
    state.citations = state.citations.filter(citation => !citation.missing);
    if (state.bibliography?.missing && request.operation !== 'citations.bibliography') state.bibliography = null;
  }
  try {
    state = await invoke({ operation: 'citations.prepare', expectedRevision: current.revision, state }, { signal });
    const rendered = await renderDocument(state, { signal, projectId });
    const byId = new Map(rendered.citations.map(citation => [citation.id, citation]));
    state.style = rendered.style;
    state.embeddedItems = rendered.embeddedItems || state.embeddedItems || {};
    state.unlinkedItems = rendered.unlinkedItems || [];
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
      state.bibliography = { ...state.bibliography, ...bibliographyRuns(rendered.bibliography.entries), html: rendered.bibliography.html, entries: rendered.bibliography.entries, entryIds: rendered.bibliography.entryIds, parameters: rendered.bibliography.parameters, format: rendered.bibliography.format, layoutStyle: JSON.stringify([rendered.style.id, rendered.style.version, rendered.bibliography.format]) };
    }
    if (preview) return { state, rendered, occurrenceId };
    const result = await invoke({ operation: 'citations.apply', expectedRevision: current.revision, state }, { signal, mutation: true });
    return imported ? { ...result, imported } : result;
  } catch (error) { if (imported) error.details = { ...error.details, imported }; throw error; }
}
