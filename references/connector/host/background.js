/* BashKitten References host, Copyright 2026 BashKitten contributors. AGPL-3.0-or-later. */
'use strict';
const CAPTURE_ID = 'references@bashkitten.org';
const METHODS = new Set(['ping', 'getTranslators', 'getTranslatorCode', 'getSelectedCollection',
  'saveItems', 'saveSnapshot', 'saveSingleFile', 'saveAttachment', 'saveStandaloneAttachment',
  'getRecognizedItem', 'hasAttachmentResolvers', 'saveAttachmentFromResolver', 'updateSession',
  'import', 'installStyle', 'getResolverRequest', 'upload-begin', 'upload-chunk', 'upload-commit', 'upload-cancel']);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
function validate(message, sender) {
  // Content scripts and unrelated extensions cannot exercise native authority.
  if (sender.id !== CAPTURE_ID || sender.tab || !message || message.apiVersion !== 1) {
    throw new Error('References host: unauthorized caller or incompatible API');
  }
  if (message.operation === 'context') return {apiVersion: 1, operation: 'context'};
  if (message.operation === 'open' && identifier(message.backendId) && identifier(message.projectId)) {
    return {apiVersion:1,operation:'open',backendId:message.backendId,projectId:message.projectId};
  }
  if (message.operation !== 'request' || !identifier(message.backendId)
      || !identifier(message.projectId) || !METHODS.has(message.method)) {
    throw new Error('References host: invalid project operation');
  }
  if (JSON.stringify(message.data ?? null).length > 524288) throw new Error('Capture message exceeds chunk limit');
  const headers = {};
  for (const [key, value] of Object.entries(message.headers || {})) {
    if (!['Content-Type', 'X-Metadata'].includes(key) || typeof value !== 'string'
        || value.length > 32768 || /[\r\n]/.test(value)) throw new Error('Invalid capture header');
    headers[key] = value;
  }
  if (typeof (message.queryString || '') !== 'string' || (message.queryString || '').length > 1024) throw new Error('Capture query exceeds limit');
  const query = new URLSearchParams(message.queryString || '');
  const keys = new Set();
  for (const [key, value] of query) {
    if (keys.has(key) || !['sessionID', 'session', 'target'].includes(key) || value.length > 256) {
      throw new Error('Invalid capture query');
    }
    keys.add(key);
  }
  if (!['json', 'text', 'base64'].includes(message.bodyEncoding || 'json')) {
    throw new Error('Invalid capture body encoding');
  }
  return {apiVersion: 1, operation: 'request', backendId: message.backendId,
    projectId: message.projectId, method: message.method, headers,
    queryString: query.toString(), data: message.data,
    bodyEncoding: message.bodyEncoding || 'json'};
}
async function nativeRequest(request) {
  const response = browser.bashkittenReferences
    ? await browser.bashkittenReferences.request(request)
    : await browser.runtime.sendNativeMessage('bashkitten_references', request);
  if (!response || response.apiVersion !== 1) throw new Error('Incompatible References backend host');
  return response;
}
browser.runtime.onMessageExternal.addListener((message, sender) => nativeRequest(validate(message, sender)));

async function resolverEvent(message) {
  if (message?.operation !== 'resolver' || !identifier(message.backendId) || !identifier(message.projectId) || !identifier(message.requestId)) throw new Error('Invalid native resolver event');
  const binding = {backendId:message.backendId,projectId:message.projectId,requestId:message.requestId};
  let completion;
  try {
    const result = await browser.runtime.sendMessage(CAPTURE_ID, {apiVersion:1,operation:'resolver',...binding});
    if (!result || JSON.stringify(result).length > 8192) throw new Error('Invalid resolver receipt');
    completion = {result};
  } catch (error) { completion = {error:String(error.message || error).slice(0,1024)}; }
  return nativeRequest({apiVersion:1,operation:'resolver-result',...binding,...completion});
}
if (browser.bashkittenReferences?.onResolverRequest) {
  browser.bashkittenReferences.onResolverRequest.addListener(message => { resolverEvent({...message,operation:'resolver'}).catch(console.error); });
} else {
  const port = browser.runtime.connectNative('bashkitten_references');
  port.onMessage.addListener(message => { resolverEvent(message).catch(console.error); });
}
