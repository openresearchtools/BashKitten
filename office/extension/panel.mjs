// SPDX-License-Identifier: AGPL-3.0-only
import { connectReferencesHost } from './host-api.mjs';
import { nativeOperation } from './kit.mjs';
import { runCitationCommand, documentBinding } from './citations.mjs';
import { promoteCitationCodes } from './code-promotion.mjs';
import { chooseDocumentSettings } from './document-settings.mjs';
import { chooseCitation } from './shared/shared-citation-dialog.js';
const status = document.querySelector('#status'), controls = [...document.querySelectorAll('button')];
const invoke = (request) => window.cool.callRemote(nativeOperation, request);
const projectNames = new Map();
let api, context, officeCopy, documentType, current, busy = false, importRequestId, importFingerprint;
function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
async function run(work) {
  if (busy) return; busy = true; controls.forEach(control => control.disabled = true);
  try { await work(); } catch (error) { message(error.message, true); }
  finally { busy = false; controls.forEach(control => control.disabled = false); }
}
const renderDocument = (state, { signal, projectId } = {}) => api.project(projectId).request('citations/render', { method: 'POST', body: state, signal });
async function command(request, preview = false, signal) {
  if (!preview) await invoke({ operation: 'view.finish-edit' });
  return runCitationCommand({ invoke, renderDocument, importSnapshots: (body, options) => api.project(options.projectId).request('citations/import-snapshots', { method: 'POST', body, ...options }), documentType, request, preview, signal });
}
async function update() {
  current = await invoke({ operation: 'citations.inspect' });
  const select = document.querySelector('#occurrence'), selected = select.value;
  select.replaceChildren(new Option('Insert at selection', ''));
  for (const citation of current.citations) select.append(new Option((citation.rendered || citation.text || citation.id) + (citation.missing ? ' — anchor missing' : ''), citation.id));
  select.value = selected;
  const binding = documentBinding(current);
  document.querySelector('#binding-summary').textContent = binding ? 'Library: ' + (projectNames.get(binding.projectId) || 'Selected project') + ' · Style: ' + binding.style.id + ' · ' + binding.style.locale : 'Choose a project library and citation style to use citations.';
  document.querySelector('#metadata-source').value = current.metadataSource || 'library';
  message(current.citations.length + ' managed citation' + (current.citations.length === 1 ? '' : 's') + (current.metadataSource === 'snapshot' ? '. Using embedded reference snapshots.' : '') + (current.unlinkedItems?.length ? ' ' + current.unlinkedItems.length + ' reference(s) are not linked to this project.' : ''));
}
async function cite() {
  if (!await ensureBinding()) return;
  const projectId = documentBinding(current).projectId;
  const id = document.querySelector('#occurrence').value;
  const selection = id ? null : await invoke({ operation: 'selection' });
  const initial = current.citations.find(citation => citation.id === id) || { items: [] };
  const operation = id ? 'citations.edit' : 'citations.insert';
  const target = selection?.target;
  const metadataSource = document.querySelector('#metadata-source').value;
  const expectedRevision = current.revision;
  let cluster;
  if (new URLSearchParams(location.search).get('coolRole') !== 'dialog') {
    const key = 'references-citation-' + crypto.randomUUID();
    sessionStorage.setItem(key, JSON.stringify({ documentId: context.documentId, projectId, initial, style: current.style, metadataSource, embeddedItems: metadataSource === 'snapshot' ? current.embeddedItems : undefined, operation, id, target, documentType, expectedRevision }));
    try { const result = await window.cool.dialog.open({ url: 'citation.html?invocation=' + encodeURIComponent(key), title: 'Add/Edit Citation', width: 760, height: 500 }); cluster = result.cancelled ? null : result.value; }
    finally { sessionStorage.removeItem(key); }
  } else cluster = await chooseCitation({ api, projectId, initial, style: current.style, embeddedItems: metadataSource === 'snapshot' ? current.embeddedItems : undefined, preview: async (cluster, { style, signal } = {}) => {
    const result = await command({ operation, projectId, expectedRevision, id, cluster, target, metadataSource }, true, signal);
    const occurrence = result.state.citations.find(citation => citation.id === result.occurrenceId);
    return { html: occurrence?.html || '', text: occurrence?.text || '', sortedItems: occurrence?.sortedItems || occurrence?.items, sortable: result.rendered.style.sortable };
  } });
  if (!cluster) { message('Citation cancelled'); return; }
  await command({ operation, projectId, id, cluster, target, expectedRevision, metadataSource }); await update();
}
async function settings() {
  await update();
  const invocation = { current, projectHint: context.projectId, documentId: context.documentId, documentType };
  let draft;
  if (new URLSearchParams(location.search).get('coolRole') !== 'dialog') {
    const key = 'references-settings-' + crypto.randomUUID();
    sessionStorage.setItem(key, JSON.stringify(invocation));
    try { const result = await window.cool.dialog.open({ url: 'settings.html?invocation=' + encodeURIComponent(key), title: 'Document settings', width: 580, height: 520 }); draft = result.cancelled ? null : result.value; }
    finally { sessionStorage.removeItem(key); }
  } else draft = await chooseDocumentSettings({ api, ...invocation });
  if (!draft) return false;
  await command(draft); await update(); return true;
}
async function ensureBinding() {
  await update();
  return !!documentBinding(current) || await settings();
}
try {
  ({ api, context, officeCopy } = await connectReferencesHost());
  const projects = await api.request('/api/references/projects');
  for (const project of projects) projectNames.set(project.id, project.name);
  const capabilities = await invoke({ operation: 'capabilities' }); documentType = capabilities.documentType;
  const formats = ({ text: ['docx', 'odt'], spreadsheet: ['xlsx', 'ods'], presentation: ['pptx', 'odp'] })[documentType] || [];
  for (const format of formats) document.querySelector('#copy-format').append(new Option(format.toUpperCase(), format));
  document.querySelector('#copy-format').value = capabilities.format;
  document.querySelector('#copy-name').value = 'Document copy.' + capabilities.format;
  await update();
  const actions = {
    citation: cite,
    bibliography: async () => { if (!await ensureBinding()) return; const { target } = await invoke({ operation: 'selection' }); await command({ operation: 'citations.bibliography', target }); await update(); },
    refresh: async () => { if (!await ensureBinding()) return; await command({ operation: 'citations.refresh', metadataSource: document.querySelector('#metadata-source').value }); await update(); },
    style: settings,
    settings,
    codes: async () => {
      if (!await ensureBinding()) return;
      const result = await promoteCitationCodes({ invoke, parse: (text, { signal, projectId } = {}) => api.project(projectId).request('citations/parse', { method: 'POST', body: { text }, signal }), renderDocument, documentType });
      await update(); message(result.promoted ? 'Promoted ' + result.promoted + ' citation code(s)' : result.skipped || 'No complete citation codes in the current region');
    },
  };
  for (const [id, action] of Object.entries(actions)) document.querySelector('#' + id)?.addEventListener('click', () => run(action));
  document.querySelector('#remove-citation').addEventListener('click', () => run(async () => { const id = document.querySelector('#occurrence').value; if (!id) throw Error('Choose the citation to remove'); await command({ operation: 'citations.remove', id, expectedRevision: current.revision }); await update(); }));
  document.querySelector('#import-snapshots').addEventListener('click', () => run(async () => {
    if (!await ensureBinding()) return;
    const fingerprint = JSON.stringify(current.embeddedItems || {});
    if (fingerprint !== importFingerprint) { importRequestId = null; importFingerprint = fingerprint; }
    importRequestId ||= crypto.randomUUID();
    try { await command({ operation: 'citations.import-snapshots', requestId: importRequestId, expectedRevision: current.revision }); }
    catch (error) { await update(); throw error; }
    importRequestId = null; await update(); message('Copied references imported and linked to this project library');
  }));
  document.querySelector('#copy-format').addEventListener('change', () => { const name = document.querySelector('#copy-name'); name.value = name.value.replace(/\.(docx|odt|xlsx|ods|pptx|odp)$/i, '') + '.' + document.querySelector('#copy-format').value; });
  document.querySelector('#text-copy').addEventListener('click', () => run(async () => {
    const result = await officeCopy({ name: document.querySelector('#copy-name').value, format: document.querySelector('#copy-format').value });
    const url = new URL(result.browserUrl); if (url.protocol !== 'https:') throw Error('The copy did not return an authorized HTTPS view');
    const link = document.querySelector('#copy-result'); link.href = url.href; link.hidden = false;
    message('Saved a separate copy with formatted text citations.');
  }));
  let changedRegionTimer;
  window.cool.document.onModified = () => { clearTimeout(changedRegionTimer); changedRegionTimer = setTimeout(() => { if (!busy && documentBinding(current)) run(actions.codes); }, 500); };
  window.addEventListener('pagehide', () => { clearTimeout(changedRegionTimer); window.cool.document.onModified = null; }, { once: true });
  if (!documentBinding(current)) await run(settings);
  window.cool.onCommand = id => run(actions[id] || (() => { throw new Error('Unknown References action'); }));
} catch (error) { message(error.message, true); controls.forEach(control => control.disabled = true); }
