// SPDX-License-Identifier: AGPL-3.0-only
// One native lifecycle frame owns commands and the existing modified listener.
import { connectReferencesHost } from './host-api.mjs';
import { nativeOperation } from './kit.mjs';
import { promoteCitationCodes } from './code-promotion.mjs';
import { commandDialog } from './command-dialogs.mjs';
const lifetime = new AbortController();
const invoke = request => window.cool.callRemote(nativeOperation, request);
let changedRegionTimer, active = null, dirty = false, pendingCommand = null;
const commandsReady = fetch('./ui.json', { signal: lifetime.signal }).then(response => {
  if (!response.ok) throw Error('References commands could not be loaded');
  return response.json();
}).then(value => value.commands);
const ready = (async () => {
  const { api } = await connectReferencesHost({ signal: lifetime.signal });
  const { documentType } = await invoke({ operation: 'capabilities' });
  const renderDocument = (state, { signal, projectId } = {}) => api.project(projectId).request('citations/render', { method: 'POST', body: state, signal });
  return { api, documentType, renderDocument };
})();
async function openCommand(id) {
  if (lifetime.signal.aborted) return;
  if (active === 'promotion') { pendingCommand ||= id; return; }
  if (active) return;
  active = 'dialog';
  try {
    const commands = await commandsReady, command = commands.find(command => command.id === id);
    if (!command) throw Error('Unknown References command');
    await window.cool.dialog.open({ url: 'index.html?command=' + encodeURIComponent(id), title: command.title, titlebar: false, ...commandDialog(id) });
  } finally { active = null; drain(); }
}
function drain() {
  if (lifetime.signal.aborted) return;
  if (pendingCommand) { const id = pendingCommand; pendingCommand = null; window.cool.onCommand(id); }
  else if (dirty) { clearTimeout(changedRegionTimer); changedRegionTimer = setTimeout(promote, 500); }
}
async function promote() {
  if (active || lifetime.signal.aborted) return;
  active = 'promotion'; dirty = false;
  try {
    const { api, documentType, renderDocument } = await ready;
    await promoteCitationCodes({ invoke, parse: (text, { signal, projectId } = {}) => api.project(projectId).request('citations/parse', { method: 'POST', body: { text }, signal }), renderDocument, documentType, signal: lifetime.signal });
  } catch (error) {
    if (error.code === 'binding_required') pendingCommand ||= 'codes';
    else if (!lifetime.signal.aborted) console.warn('References citation-code conversion:', error);
  } finally { active = null; drain(); }
}
window.cool.onCommand = id => openCommand(id).catch(error => { if (!lifetime.signal.aborted) console.warn('References command:', error); });
ready.then(() => {
  if (!lifetime.signal.aborted) window.cool.document.onModified = () => { dirty = true; clearTimeout(changedRegionTimer); changedRegionTimer = setTimeout(promote, 500); };
}).catch(error => { if (!lifetime.signal.aborted) console.warn('References initialization:', error); });
window.addEventListener('pagehide', () => { lifetime.abort(); clearTimeout(changedRegionTimer); window.cool.document.onModified = null; }, { once: true });
