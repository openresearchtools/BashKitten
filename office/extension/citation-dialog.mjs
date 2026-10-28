// SPDX-License-Identifier: AGPL-3.0-only
// Native cool.dialog owns the outer modal; References owns the shared chooser.
import { connectReferencesHost } from './host-api.mjs';
import { nativeOperation } from './kit.mjs';
import { runCitationCommand } from './citations.mjs';
import { chooseCitation } from './shared/shared-citation-dialog.js';
const status = document.querySelector('#status');
try {
  const key = new URLSearchParams(location.search).get('invocation');
  if (!/^references-citation-[a-f0-9-]+$/.test(key || '')) throw Error('Citation dialog invocation is missing');
  const invocation = JSON.parse(sessionStorage.getItem(key)); sessionStorage.removeItem(key);
  const { api, context } = await connectReferencesHost();
  if (context.projectId !== invocation?.projectId) throw Error('The document project changed');
  const invoke = request => window.cool.callRemote(nativeOperation, request);
  const renderDocument = (state, { signal } = {}) => api.project(context.projectId).request('citations/render', { method: 'POST', body: state, signal });
  status.hidden = true;
  const cluster = await chooseCitation({ api, projectId: context.projectId, initial: invocation.initial, style: invocation.style, preview: async (cluster, { signal } = {}) => {
    const { operation, id, target, documentType } = invocation;
    const result = await runCitationCommand({ invoke, renderDocument, documentType, projectId: context.projectId, request: { operation, id, target, cluster }, signal, preview: true });
    const citation = id ? result.state.citations.find(c => c.id === id) : result.state.citations.find(c => c.target);
    return { html: citation?.html || '', text: citation?.text || '', sortedItems: citation?.sortedItems || citation?.items, sortable: result.rendered.style.sortable };
  } });
  if (cluster) window.cool.dialog.close(cluster); else window.cool.dialog.cancel();
} catch (error) { status.hidden = false; status.textContent = error.message; }
