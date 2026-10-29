// Native Collabora host postMessage bridge, adapted from Quantum WopiEditor.vue.
// Only the missing host history chooser and References context are added.
const context = JSON.parse(document.getElementById('host-context').textContent);
const editor = document.getElementById('editor');
const history = document.getElementById('history');
const errorBox = document.getElementById('error');
const lifetime = new AbortController();
// Embedded windows do not inherit the top visual viewport's keyboard resize.
// Fit the existing editor; its native resize handlers own the inner layout.
const viewport = window.visualViewport;
function fitEditorViewport() {
  if (viewport) editor.style.height = Math.min(innerHeight, viewport.height * viewport.scale) + 'px';
}
viewport?.addEventListener('resize', fitEditorViewport, { signal: lifetime.signal });
window.addEventListener('resize', fitEditorViewport, { signal: lifetime.signal });
fitEditorViewport();
let renewalTimer;
function post(MessageId, Values = {}) { editor.contentWindow.postMessage(JSON.stringify({ MessageId, Values, SendTime: Date.now() }), context.origin); }
function report(error) { errorBox.textContent = error.message || String(error); errorBox.hidden = false; }
async function api(action, body, signal) { const response = await fetch(location.pathname + '/' + action, { method: body ? 'POST' : 'GET', credentials: 'same-origin', signal, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const value = await response.json(); if (!response.ok) throw Error(value.error || 'Office operation failed'); return value; }
function scheduleRenewal(expires, retry = false) {
  clearTimeout(renewalTimer);
  if (lifetime.signal.aborted) return;
  renewalTimer = setTimeout(async () => {
    try {
      const renewed = await api('renew', {}, lifetime.signal);
      post('Reset_Access_Token', { token: renewed.accessToken, ttl: renewed.accessTokenTtl });
      context.accessTokenTtl = renewed.accessTokenTtl;
      scheduleRenewal(renewed.accessTokenTtl);
    } catch (error) {
      if (lifetime.signal.aborted) return;
      report(error);
      if (Date.now() < expires - 60000) scheduleRenewal(expires, true);
    }
  }, retry ? 60000 : Math.max(1000, expires - Date.now() - 300000));
}
async function showHistory() {
  const result = await api('history');
  document.getElementById('max-versions').value = result.maxVersions;
  document.getElementById('history-limit').hidden = !context.writable;
  document.getElementById('save-history-limit').hidden = !context.writable;
  const list = history.querySelector('ol'); list.replaceChildren();
  for (const version of result.versions) {
    const row = document.createElement('li'); const label = document.createElement('span'); label.textContent = new Date(version.savedAt).toLocaleString(); row.append(label);
    const open = document.createElement('button'); open.textContent = 'Open'; open.onclick = () => api('version', { versionId: version.id }).then(value => location.assign(value.url)).catch(report); row.append(open);
    if (context.writable) { const restore = document.createElement('button'); restore.textContent = 'Restore'; restore.onclick = async () => { try { restore.disabled = true; const value = await api('restore', { versionId: version.id }); location.assign(value.reopen); } catch (error) { restore.disabled = false; report(error); } }; row.append(restore); }
    list.append(row);
  }
  if (!history.open) history.showModal();
}
document.getElementById('save-history-limit').onclick = async event => {
  const button = event.currentTarget, input = document.getElementById('max-versions');
  if (!input.reportValidity()) return;
  try { button.disabled = true; await api('history', { maxVersions: input.valueAsNumber }, lifetime.signal); await showHistory(); }
  catch (error) { report(error); } finally { button.disabled = false; }
};
document.getElementById('close-history').onclick = () => history.close();
const extensionFrames = new Map();
function abortFrame(frame) { const entry = extensionFrames.get(frame); if (entry) for (const request of entry.requests.values()) request.abort(); }
window.addEventListener('pagehide', () => { lifetime.abort(); clearTimeout(renewalTimer); for (const frame of extensionFrames.keys()) abortFrame(frame); extensionFrames.clear(); });
window.addEventListener('message', event => {
  if (event.origin !== context.origin) return;
  let message = event.data; if (typeof message === 'string') { try { message = JSON.parse(message); } catch { return; } }
  if (message?.MessageId === 'BashKitten_ReferencesReady') {
    let child = false; try { child = event.source === editor.contentWindow || event.source.parent === editor.contentWindow; } catch { return; }
    if (!child || !context.referenceContext || typeof message.nonce !== 'string' || message.nonce.length > 128) return;
    abortFrame(event.source);
    extensionFrames.set(event.source, { nonce: message.nonce, requests: new Map() });
    event.source.postMessage({ MessageId: 'BashKitten_ReferencesContext', nonce: message.nonce, ...context.referenceContext }, context.origin); return;
  }
  if (message?.MessageId === 'BashKitten_ReferencesClosed') {
    const frame = extensionFrames.get(event.source);
    if (!frame || frame.nonce !== message.nonce) return;
    abortFrame(event.source); extensionFrames.delete(event.source); return;
  }
  if (['BashKitten_ReferencesRequest', 'BashKitten_ReferencesCancel', 'BashKitten_OfficeCopy'].includes(message?.MessageId)) {
    const frame = extensionFrames.get(event.source);
    if (!frame || frame.nonce !== message.nonce || typeof message.requestId !== 'string' || message.requestId.length > 128) return;
    frame.requests.get(message.requestId)?.abort();
    if (message.MessageId === 'BashKitten_ReferencesCancel') { frame.requests.delete(message.requestId); return; }
    if (frame.requests.size >= 32) return;
    const target = event.source, request = new AbortController(); frame.requests.set(message.requestId, request);
    const copying = message.MessageId === 'BashKitten_OfficeCopy';
    api(copying ? 'copy' : 'references', copying ? { name: message.name, format: message.format } : { method: message.method, path: message.path, body: message.body }, request.signal).then(
      result => { if (!request.signal.aborted) target.postMessage({ MessageId: 'BashKitten_ReferencesResult', nonce: message.nonce, requestId: message.requestId, result }, context.origin); },
      error => { if (!request.signal.aborted) target.postMessage({ MessageId: 'BashKitten_ReferencesResult', nonce: message.nonce, requestId: message.requestId, error: error.message }, context.origin); }
    ).finally(() => { if (frame.requests.get(message.requestId) === request) frame.requests.delete(message.requestId); });
    return;
  }
  if (event.source !== editor.contentWindow) return;
  switch (message?.MessageId) {
    case 'Doc_Title': {
      // Native WOPI supplies the plain filename on load and after a rename.
      // Keep the outer tab in sync without copying a product title or URL.
      const name = message.Values?.DocName;
      if (typeof name === 'string' && name && !/[\x00-\x1f\x7f/\\]/.test(name)) document.title = editor.title = name;
      break;
    }
    case 'App_LoadingStatus':
      if (['Frame_Ready', 'Document_Loaded'].includes(message.Values?.Status)) {
        post('Host_PostmessageReady'); post('Hide_Button', { id: 'toggledarktheme' }); post('Hide_Button', { id: 'invertbackground' }); post('Hide_Menu_Item', { id: 'toggledarktheme' }); post('Hide_Menu_Item', { id: 'invertbackground' });
      }
      if (message.Values?.Status === 'Document_Loaded') scheduleRenewal(context.accessTokenTtl);
      break;
    case 'Action_Save_Resp':
      if (message.Values?.success && message.Values?.fileName) api('context').then(value => { if (value.documentId !== context.documentId) location.reload(); }).catch(report);
      break;
    case 'UI_FileVersions': showHistory().catch(report); break;
    case 'UI_Close': window.close(); break;
  }
});
document.getElementById('launch').submit();
