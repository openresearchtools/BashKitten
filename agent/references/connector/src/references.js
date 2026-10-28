/* BashKitten adaptations, 2026. AGPL-3.0-or-later. Donor capture remains in its original modules. */
'use strict';
globalThis.References = new function () {
  const HOST = 'references-host@bashkitten.org';
  const destinations = new Map(), sessions = new Map(), choices = new Map();
  const transport = async (message) => {
    const response = await browser.runtime.sendMessage(HOST, {apiVersion: 1, ...message});
    if (!response || response.apiVersion !== 1) throw new Error('References host unavailable or incompatible');
    if (response.status >= 400) {
      const error = new Zotero.Connector.CommunicationError('References request failed', response.status, response.body);
      if (Zotero.Connector) Zotero.Connector.isOnline = false;
      throw error;
    }
    if (message.operation === 'request' && Zotero.Connector) {
      Zotero.Connector.isOnline = true;
      Zotero.Connector.clientVersion = response.headers?.['X-Zotero-Version'] || response.headers?.['x-zotero-version'] || Zotero.Connector.clientVersion;
    }
    return response.body ?? response;
  };
  this.init = async () => {
    const version = browser.runtime.getManifest().version;
    const stored = await browser.storage.local.get('referencesComponentVersion');
    if (stored.referencesComponentVersion !== version) {
      await Zotero.Prefs.removeAllCachedTranslators();
      await Zotero.Prefs.set('translatorMetadata', await Zotero.Repo.getTranslatorMetadataFromZotero());
      await browser.storage.local.set({referencesComponentVersion:version});
    }
  };
  this.context = () => transport({operation: 'context'});
  this.rpc = (destination, method, data, options={}) => transport({operation: 'request',
    backendId: destination.backendId, projectId: destination.projectId, method, data,
    headers: options.headers || {}, queryString: options.queryString || '', bodyEncoding: options.bodyEncoding || 'json'});
  this.select = async (tab) => {
    if (!tab || tab.id < 0) throw new Error('References requires an ordinary source tab');
    const id = crypto.randomUUID();
    let finish;
    const result = new Promise(resolve => { finish = resolve; });
    choices.set(id, {source: tab, finish, destination: destinations.get(tab.id)});
    const choiceTab = await browser.tabs.create({url: browser.runtime.getURL('references/destination.html') + '#' + id, active: true});
    const close = tabId => {
      if (tabId !== choiceTab.id && tabId !== tab.id) return;
      browser.tabs.onRemoved.removeListener(close);
      const pending = choices.get(id);
      choices.delete(id);
      if (pending) pending.finish(null);
    };
    browser.tabs.onRemoved.addListener(close);
    try {
      const destination = await result;
      if (!destination) return false;
      // Validate once more immediately before any capture operation; grants remain backend-owned.
      const readiness = await this.rpc(destination, 'ping', {});
      destination.prefs = Object.freeze({...readiness.prefs});
      Zotero.Connector._processPreferences(readiness.prefs || {});
      await this.rpc(destination, 'getSelectedCollection', {target: destination.target});
      const current = await browser.tabs.get(tab.id);
      if (current.url !== tab.url) throw new Error('Source tab changed while choosing a destination');
      destinations.set(tab.id, Object.freeze({...destination}));
      const sessionID = crypto.randomUUID();
      sessions.set(sessionID, Object.freeze({...destination, sourceTab:tab.id}));
      await browser.tabs.update(tab.id, {active: true});
      return sessionID;
    } catch (error) {
      await browser.browserAction.setTitle({tabId:tab.id,title:'References: '+error.message}).catch(() => {});
      throw error;
    } finally {
      choices.delete(id); browser.tabs.onRemoved.removeListener(close);
      await browser.tabs.remove(choiceTab.id).catch(() => {});
    }
  };
  this.getPref = (name, sessionID, tab) => {
    const binding = sessionID ? sessions.get(sessionID) : destinations.get(tab?.id);
    return binding?.prefs?.[name] ?? Zotero.Connector.prefs[name];
  };
  this.bind = (sessionID, tab) => {
    if (sessions.has(sessionID)) return sessions.get(sessionID);
    throw new Error('References capture session is not authorized');
  };
  this.call = async (options, data=null, tab=null) => {
    if (typeof options === 'string') options = {method: options};
    if (options.method === 'delaySync') return {};
    const query = new URLSearchParams(options.queryString || '');
    const sessionID = data?.sessionID || query.get('sessionID') || query.get('session');
    const destination = sessionID ? this.bind(sessionID, tab) : destinations.get(tab?.id);
    if (!destination) {
      // Passive detection is entirely local and does not start a backend service.
      if (options.method === 'ping') return {prefs: {automaticSnapshots:true, downloadAssociatedFiles:true, reportActiveURL:false, supportsTagsAutocomplete:false, canUserAddNote:true}};
      throw new Error('Choose a References project before saving');
    }
    if (sessionID && sessions.get(sessionID)?.sourceTab !== tab?.id && tab) {
      throw new Error('Capture session belongs to another source tab');
    }
    if (data && typeof data === 'object' && !(data instanceof ArrayBuffer)
        && ['saveItems', 'saveSnapshot', 'getSelectedCollection'].includes(options.method)) {
      data = {...data, target: destination.target};
    }
    if (['saveStandaloneAttachment','import'].includes(options.method) && destination.target) query.set('target', destination.target);
    const requestOptions = {...options, queryString:query.toString()};
    const binary = data instanceof ArrayBuffer || ArrayBuffer.isView(data);
    const serialized = binary ? null : JSON.stringify(data);
    if (binary || serialized.length > 393216) {
      return this.upload(destination, options.method,
        binary ? new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength) : new TextEncoder().encode(serialized),
        {...requestOptions, bodyEncoding: binary ? 'binary' : 'json'});
    }
    const result = await this.rpc(destination, options.method, data, requestOptions);
    if (options.method === 'updateSession' && sessionID && data.target !== undefined) {
      sessions.set(sessionID, Object.freeze({...destination,target:data.target}));
    }
    return result;
  };
  this.upload = async (destination, method, bytes, options) => {
    const {uploadId} = await this.rpc(destination, 'upload-begin', {
      method, headers:options.headers || {}, queryString:options.queryString || '',
      bodyEncoding:options.bodyEncoding, byteLength:bytes.byteLength, requestId:crypto.randomUUID()});
    let committing = false;
    try {
      for (let offset = 0; offset < bytes.length; offset += 262144) {
        let text = '';
        const part = bytes.subarray(offset, offset + 262144);
        for (let i = 0; i < part.length; i += 8192) text += String.fromCharCode(...part.subarray(i, i + 8192));
        await this.rpc(destination, 'upload-chunk', {uploadId, offset, data:btoa(text)});
      }
      committing = true;
      return await this.rpc(destination, 'upload-commit', {uploadId});
    } catch (error) {
      // A lost commit response is ambiguous. Preserve its server receipt; never blindly replay.
      if (!committing) await this.rpc(destination, 'upload-cancel', {uploadId}).catch(() => {});
      error.uploadId = uploadId;
      throw error;
    }
  };
  this.openTabSurface = async (url, options={}, source=null) => {
    const tab = await browser.tabs.create({url, active:true});
    if (options.onClose) {
      const closed = id => { if (id === tab.id) { browser.tabs.onRemoved.removeListener(closed); options.onClose(); } };
      browser.tabs.onRemoved.addListener(closed);
    }
    return {id: tab.windowId, tabs:[tab]};
  };
  browser.tabs.onRemoved.addListener(id => {
    destinations.delete(id);
    // Keep session bindings until completed requests settle; do not redirect them on tab reuse.
    for (const [key, binding] of sessions) if (binding.sourceTab === id) sessions.delete(key);
  });
  browser.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.references !== true) return undefined;
    return (async () => {
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('references/destination.html'))) {
      throw new Error('References chooser caller rejected');
    }
    const pending = choices.get(message.id);
    if (!pending) throw new Error('References destination choice expired');
    if (message.action === 'context') return {...await this.context(), previous:pending.destination};
    if (message.action === 'collections') return this.rpc(message.destination, 'getSelectedCollection', {
      target:message.destination.target, parent:message.parent || null, q:String(message.q || '').slice(0,200), start:Math.max(0,Number(message.start)||0), limit:100});
    if (message.action === 'confirm') { pending.finish(message.destination); return true; }
    if (message.action === 'cancel') { pending.finish(null); return true; }
    throw new Error('Unknown References chooser operation');
    })();
  });
};
