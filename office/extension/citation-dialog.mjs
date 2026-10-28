// SPDX-License-Identifier: AGPL-3.0-only
// Native cool.dialog owns the outer modal; References owns the shared chooser.
import { connectReferencesHost } from './host-api.mjs';
import { nativeOperation } from './kit.mjs';
import { runCitationCommand, documentBinding } from './citations.mjs';
import { chooseCitation } from './shared/shared-citation-dialog.js';
const status = document.querySelector('#status');
try {
  const key = new URLSearchParams(location.search).get('invocation');
  if (!/^references-citation-[a-f0-9-]+$/.test(key || '')) throw Error('Citation dialog invocation is missing');
  const invocation = JSON.parse(sessionStorage.getItem(key)); sessionStorage.removeItem(key);
  const { api, context } = await connectReferencesHost();
  if (context.documentId !== invocation?.documentId) throw Error('The document changed');
  const invoke = request => window.cool.callRemote(nativeOperation, request);
  const binding = documentBinding(await invoke({ operation: 'citations.inspect' }));
  if (binding?.projectId !== invocation?.projectId) throw Error('The document library changed');
  const renderDocument = (state, { signal, projectId } = {}) => api.project(projectId).request('citations/render', { method: 'POST', body: state, signal });
  status.hidden = true;
  const cluster = await chooseCitation({ api, projectId: invocation.projectId, initial: invocation.initial, style: invocation.style, embeddedItems: invocation.embeddedItems, preview: async (cluster, { signal } = {}) => {
    const { operation, id, target, documentType, metadataSource } = invocation;
    const result = await runCitationCommand({ invoke, renderDocument, documentType, projectId: invocation.projectId, request: { operation, projectId: invocation.projectId, expectedRevision: invocation.expectedRevision, id, target, cluster, metadataSource }, signal, preview: true });
    const citation = result.state.citations.find(c => c.id === result.occurrenceId);
    return { html: citation?.html || '', text: citation?.text || '', sortedItems: citation?.sortedItems || citation?.items, sortable: result.rendered.style.sortable };
  } });
  if (cluster) window.cool.dialog.close(cluster); else window.cool.dialog.cancel();
} catch (error) { status.hidden = false; status.textContent = error.message; }
