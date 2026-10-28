// SPDX-License-Identifier: AGPL-3.0-only
import { connectReferencesHost } from './host-api.mjs';
import { nativeOperation } from './kit.mjs';
import { runCitationCommand } from './citations.mjs';
import { promoteCitationCodes } from './code-promotion.mjs';
import { chooseCitation } from './shared/shared-citation-dialog.js';
const status = document.querySelector('#status'), controls = [...document.querySelectorAll('button')];
const invoke = (request) => window.cool.callRemote(nativeOperation, request);
let api, context, documentType, current, busy = false, styleAbort, importRequestId, importFingerprint;
function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
async function run(work) {
  if (busy) return; busy = true; controls.forEach(control => control.disabled = true);
  try { await work(); } catch (error) { message(error.message, true); }
  finally { busy = false; controls.forEach(control => control.disabled = false); }
}
const renderDocument = (state, { signal } = {}) => api.project(context.projectId).request('citations/render', { method: 'POST', body: state, signal });
async function command(request, preview = false, signal) {
  return runCitationCommand({ invoke, renderDocument, importSnapshots: (body, options) => api.project(context.projectId).request('citations/import-snapshots', { method: 'POST', body, ...options }), documentType, projectId: context.projectId, request, preview, signal });
}
async function update() {
  current = await invoke({ operation: 'citations.inspect' });
  const select = document.querySelector('#occurrence'), selected = select.value;
  select.replaceChildren(new Option('Insert at selection', ''));
  for (const citation of current.citations) select.append(new Option((citation.rendered || citation.text || citation.id) + (citation.missing ? ' — anchor missing' : ''), citation.id));
  select.value = selected; document.querySelector('#locale').value = current.style?.locale || 'en-US';
  document.querySelector('#note-type').value = current.noteType || 'footnote';
  document.querySelector('#metadata-source').value = current.metadataSource || 'library';
  document.querySelector('#note-placement').hidden = documentType !== 'text';
  message(current.citations.length + ' managed citation' + (current.citations.length === 1 ? '' : 's') + (current.metadataSource === 'snapshot' ? '. Using embedded reference snapshots.' : '') + (current.unlinkedItems?.length ? ' ' + current.unlinkedItems.length + ' reference(s) are not linked to this project.' : ''));
}
async function cite() {
  const selection = await invoke({ operation: 'selection' });
  const id = document.querySelector('#occurrence').value;
  const initial = current.citations.find(citation => citation.id === id) || { items: [] };
  const operation = id ? 'citations.edit' : 'citations.insert';
  const target = selection.target;
  const expectedRevision = current.revision;
  let cluster;
  if (new URLSearchParams(location.search).get('coolRole') !== 'dialog') {
    const key = 'references-citation-' + crypto.randomUUID();
    sessionStorage.setItem(key, JSON.stringify({ projectId: context.projectId, initial, style: current.style, operation, id, target, documentType }));
    try { const result = await window.cool.dialog.open({ url: 'citation.html?invocation=' + encodeURIComponent(key), title: 'Add/Edit Citation', width: 880, height: 650 }); cluster = result.cancelled ? null : result.value; }
    finally { sessionStorage.removeItem(key); }
  } else cluster = await chooseCitation({ api, projectId: context.projectId, initial, style: current.style, preview: async (cluster, { style, signal } = {}) => {
    const result = await command({ operation, id, cluster, target }, true, signal);
    const occurrence = result.state.citations.find(citation => citation.id === result.occurrenceId);
    return { html: occurrence?.html || '', text: occurrence?.text || '', sortedItems: occurrence?.sortedItems || occurrence?.items, sortable: result.rendered.style.sortable };
  } });
  if (!cluster) { message('Citation cancelled'); return; }
  await command({ operation, id, cluster, target, expectedRevision }); await update();
}
async function styles() {
  styleAbort?.abort(); const controller = styleAbort = new AbortController();
  try {
    const result = await api.project(context.projectId).request('styles?query=' + encodeURIComponent(document.querySelector('#style-search').value) + '&limit=80', { signal: controller.signal });
    if (controller !== styleAbort) return;
    const select = document.querySelector('#style'); select.replaceChildren();
    const selected = current?.style?.id || 'apa';
    if (!result.items.some(item => item.id === selected)) select.append(new Option(selected, selected));
    for (const item of result.items) select.append(new Option(item.title, item.id)); select.value = selected;
  } catch (error) { if (error.name !== 'AbortError') message(error.message, true); }
}
try {
  ({ api, context } = await connectReferencesHost());
  ({ documentType } = await invoke({ operation: 'capabilities' }));
  await update(); await styles();
  const options = await api.project(context.projectId).request('citation-options');
  for (const locale of options.locales) document.querySelector('#locales').append(new Option(locale, locale));
  const actions = {
    citation: cite,
    bibliography: async () => { const { target } = await invoke({ operation: 'selection' }); await command({ operation: 'citations.bibliography', target }); await update(); },
    refresh: async () => { await command({ operation: 'citations.refresh', metadataSource: document.querySelector('#metadata-source').value }); await update(); },
    style: async () => document.querySelector('#style-search').focus(),
    codes: async () => {
      const result = await promoteCitationCodes({ invoke, parse: (text, { signal } = {}) => api.project(context.projectId).request('citations/parse', { method: 'POST', body: { text }, signal }), renderDocument, documentType, projectId: context.projectId });
      await update(); message(result.promoted ? 'Promoted ' + result.promoted + ' citation code(s)' : result.skipped || 'No complete citation codes in the current region');
    },
  };
  for (const [id, action] of Object.entries(actions)) document.querySelector('#' + (id === 'style' ? 'style-search' : id))?.addEventListener(id === 'style' ? 'focus' : 'click', () => id !== 'style' && run(action));
  document.querySelector('#apply-style').addEventListener('click', () => run(async () => { await command({ operation: 'citations.style', style: { id: document.querySelector('#style').value, locale: document.querySelector('#locale').value }, metadataSource: document.querySelector('#metadata-source').value, ...(documentType === 'text' ? { noteType: document.querySelector('#note-type').value } : {}) }); await update(); }));
  document.querySelector('#remove-citation').addEventListener('click', () => run(async () => { const id = document.querySelector('#occurrence').value; if (!id) throw Error('Choose the citation to remove'); await command({ operation: 'citations.remove', id, expectedRevision: current.revision }); await update(); }));
  document.querySelector('#import-snapshots').addEventListener('click', () => run(async () => {
    const fingerprint = JSON.stringify(current.embeddedItems || {});
    if (fingerprint !== importFingerprint) { importRequestId = null; importFingerprint = fingerprint; }
    importRequestId ||= crypto.randomUUID();
    try { await command({ operation: 'citations.import-snapshots', requestId: importRequestId, expectedRevision: current.revision }); }
    catch (error) { await update(); throw error; }
    importRequestId = null; await update(); message('Copied references imported and linked to this project library');
  }));
  let debounce; document.querySelector('#style-search').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(styles, 180); });
  let changedRegionTimer;
  window.cool.document.onModified = () => { clearTimeout(changedRegionTimer); changedRegionTimer = setTimeout(() => { if (!busy) run(actions.codes); }, 500); };
  window.addEventListener('pagehide', () => { clearTimeout(changedRegionTimer); window.cool.document.onModified = null; }, { once: true });
  window.cool.onCommand = id => run(actions[id] || (() => { throw new Error('Unknown References action'); }));
} catch (error) { message(error.message, true); controls.forEach(control => control.disabled = true); }
