// SPDX-License-Identifier: AGPL-3.0-only
// Native contributed commands open this short-lived dialog; no sidebar is used.
import { connectReferencesHost } from './host-api.mjs';
import { nativeOperation } from './kit.mjs';
import { runCitationCommand, documentBinding } from './citations.mjs';
import { promoteCitationCodes } from './code-promotion.mjs';
import { chooseDocumentSettings } from './document-settings.mjs';
import { chooseCitation } from './shared/shared-citation-dialog.js';
import { dialog, node, field, button } from './shared/common.js';
import { commandDialog } from './command-dialogs.mjs';

const status = document.querySelector('#status'), closeButton = document.querySelector('#close');
const lifetime = new AbortController();
const invoke = request => window.cool.callRemote(nativeOperation, request);
let api, context, officeCopy, documentType, format, current;
let importRequestId, importFingerprint;
window.addEventListener('pagehide', () => lifetime.abort(), { once: true });
closeButton.addEventListener('click', () => window.cool.dialog.cancel());
const ready = (async () => {
  ({ api, context, officeCopy } = await connectReferencesHost({ signal: lifetime.signal }));
  const capabilities = await invoke({ operation: 'capabilities' });
  documentType = capabilities.documentType; format = capabilities.format;
})();
const renderDocument = (state, { signal, projectId } = {}) => api.project(projectId).request('citations/render', { method: 'POST', body: state, signal });
async function inspect() { return current = await invoke({ operation: 'citations.inspect' }); }
async function command(request, preview = false, signal = lifetime.signal) {
  if (!preview) await invoke({ operation: 'view.finish-edit' });
  return runCitationCommand({ invoke, renderDocument, importSnapshots: (body, options) => api.project(options.projectId).request('citations/import-snapshots', { method: 'POST', body, ...options }), documentType, request, preview, signal });
}
function guards(state = current) { return { expectedRevision: state.revision, expectedNativeSnapshot: state.nativeSnapshot }; }
async function settings() {
  await inspect();
  const previousHeight = document.body.style.minHeight;
  document.body.style.minHeight = '520px';
  let draft;
  try { draft = await chooseDocumentSettings({ api, current, projectHint: context.referenceProjectId || context.defaultProjectId, documentType, signal: lifetime.signal }); }
  finally { document.body.style.minHeight = previousHeight; }
  if (!draft) return false;
  await command(draft); await inspect();
  if (draft.metadataSource && current.metadataSource !== draft.metadataSource) {
    await command({ operation: 'citations.refresh', metadataSource: draft.metadataSource, ...guards() }); await inspect();
  }
  return true;
}
async function ensureBinding() {
  await inspect();
  return !!documentBinding(current) || await settings();
}
async function selected() {
  const selection = await invoke({ operation: 'citations.selection' });
  await inspect();
  if (selection.revision !== current.revision || selection.nativeSnapshot !== current.nativeSnapshot) throw Error('The document changed. Select the citation again.');
  if (selection.ambiguous) throw Error('Select one managed citation to edit or remove.');
  return selection;
}
async function cite(editOnly = false) {
  if (!await ensureBinding()) return;
  const selection = await selected();
  const id = selection.citationId;
  if (editOnly && !id) throw Error('Place the caret in a managed citation, or select part of it, to edit it.');
  const projectId = documentBinding(current).projectId;
  const target = id ? undefined : (await invoke({ operation: 'selection' })).target;
  const operation = id ? 'citations.edit' : 'citations.insert';
  const initial = id ? selection.citation : { items: [] };
  const request = { operation, projectId, id, target, ...guards(), ...(id ? { replaceCluster: true } : {}), metadataSource: current.metadataSource || 'library' };
  const cluster = await chooseCitation({ api, projectId, initial, style: current.style, signal: lifetime.signal, embeddedItems: request.metadataSource === 'snapshot' ? current.embeddedItems : undefined, preview: async (cluster, { signal } = {}) => {
    const result = await command({ ...request, cluster }, true, signal);
    const occurrence = result.state.citations.find(citation => citation.id === result.occurrenceId);
    return { html: occurrence?.html || '', text: occurrence?.text || '', sortedItems: occurrence?.sortedItems || occurrence?.items, sortable: result.rendered.style.sortable };
  } });
  if (cluster) await command({ ...request, cluster });
}
async function remove() {
  if (!await ensureBinding()) return;
  const selection = await selected();
  if (!selection.citationId) throw Error('Place the caret in a managed citation, or select part of it, to remove it.');
  await command({ operation: 'citations.remove', id: selection.citationId, ...guards() });
}
async function bibliography() {
  if (!await ensureBinding()) return;
  const { target } = await invoke({ operation: 'selection' });
  await command({ operation: 'citations.bibliography', target, ...guards() });
}
async function refresh() {
  if (!await ensureBinding()) return;
  await command({ operation: 'citations.refresh', metadataSource: current.metadataSource || 'library', ...guards() });
}
async function codes() {
  if (!await ensureBinding()) return;
  const result = await promoteCitationCodes({ invoke, parse: (text, { signal, projectId } = {}) => api.project(projectId).request('citations/parse', { method: 'POST', body: { text }, signal }), renderDocument, documentType, signal: lifetime.signal });
  if (!result.promoted) return result.skipped || 'No complete citation codes in the current region.';
}
async function importCopied() {
  if (!await ensureBinding()) return;
  const fingerprint = JSON.stringify(current.embeddedItems || {});
  if (fingerprint !== importFingerprint) { importRequestId = null; importFingerprint = fingerprint; }
  importRequestId ||= crypto.randomUUID();
  await command({ operation: 'citations.import-snapshots', requestId: importRequestId, ...guards() });
  return 'Copied references were imported and linked to this document’s library.';
}
async function textCopy() {
  const d = dialog('Save copy with text citations'); d.el.classList.add('document-settings-dialog');
  const name = node('input', { required: true, value: 'Document copy.' + format, 'aria-label': 'Copy filename' });
  const output = node('select', { required: true, 'aria-label': 'Copy format' });
  for (const value of ({ text: ['docx', 'odt'], spreadsheet: ['xlsx', 'ods'], presentation: ['pptx', 'odp'] })[documentType] || []) output.append(new Option(value.toUpperCase(), value));
  output.value = format;
  const form = node('form', { class: 'document-settings' }, node('p', {}, 'Save a separate copy that keeps the current citation and bibliography formatting and removes their live References fields. The original document stays managed.'), field('Filename', name), field('Format', output));
  output.addEventListener('change', () => { name.value = name.value.replace(/\.(docx|odt|xlsx|ods|pptx|odp)$/i, '') + '.' + output.value; });
  let saved = null;
  const save = button('Save copy', () => form.requestSubmit(), { class: 'primary' });
  d.actions.append(button('Cancel', () => d.el.close()), save); d.body.append(form);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (save.disabled) return; save.disabled = true;
    try {
      saved = await officeCopy({ name: name.value, format: output.value }, { signal: lifetime.signal });
      const url = new URL(saved.browserUrl); if (url.protocol !== 'https:') throw Error('The copy did not return an authorized HTTPS view');
      d.el.close();
      status.replaceChildren(node('span', {}, 'Saved a separate copy with formatted text citations. '), node('a', { href: url.href, target: '_blank', rel: 'noopener' }, 'Open the copy'));
    } catch (error) { d.notice.textContent = error.message; save.disabled = false; }
  });
  const closed = new Promise(resolve => d.el.addEventListener('close', resolve, { once: true }));
  d.open(); name.focus(); await closed;
  return saved ? { keepOpen: true } : null;
}
const actions = { citation: () => cite(), edit: () => cite(true), remove, bibliography, refresh, codes, settings, 'text-copy': textCopy, 'import-snapshots': importCopied };
async function run() {
  try {
    const id = new URLSearchParams(location.search).get('command');
    const action = actions[id]; if (!action) throw Error('This References command is unavailable.');
    document.body.style.minHeight = commandDialog(id).height + 'px';
    await ready;
    await invoke({ operation: 'view.finish-edit' });
    status.hidden = true; closeButton.hidden = true;
    const result = await action();
    if (result?.keepOpen) { status.hidden = false; closeButton.hidden = false; }
    else if (typeof result === 'string') { status.textContent = result; status.hidden = false; closeButton.hidden = false; }
    else window.cool.dialog.close();
  } catch (error) {
    if (lifetime.signal.aborted) return;
    status.textContent = error.message; status.hidden = false; status.dataset.error = 'true'; closeButton.hidden = false;
  }
}
run();
