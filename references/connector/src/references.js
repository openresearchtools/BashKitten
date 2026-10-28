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
  this.select = async (tab, mode='capture', sessionID=null) => {
    if (!tab || tab.id < 0) throw new Error('References requires an ordinary source tab');
    const binding = mode === 'retarget' ? this.bind(sessionID, tab) : null;
    if (binding && binding.sourceTab !== tab.id) throw new Error('Capture session belongs to another source tab');
    const id = crypto.randomUUID();
    let finish;
    const result = new Promise(resolve => { finish = resolve; });
    choices.set(id, {source: tab, finish, mode, destination: binding || destinations.get(tab.id)});
    const choiceTab = (await this.openTabSurface(browser.runtime.getURL('references/destination.html') + '#' + id, {}, tab)).tabs[0];
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
      if (mode === 'open' || destination.openManager) {
        await transport({operation:'open',backendId:destination.backendId,projectId:destination.projectId});
        return false; // Opening the manager never becomes a capture session.
      }
      if (binding) {
        if (destination.backendId !== binding.backendId || destination.projectId !== binding.projectId) throw new Error('A capture cannot move to another backend or project');
        this.bind(sessionID, tab);
        const selected = await this.rpc(binding, 'getSelectedCollection', {target: destination.target});
        await browser.tabs.update(tab.id, {active:true});
        return {id:selected.id, name:selected.name, filesEditable:selected.filesEditable, kind:selected.kind || (destination.target ? 'collection' : 'library')};
      }
      // Validate once more immediately before any capture operation; grants remain backend-owned.
      const readiness = await this.rpc(destination, 'ping', {});
      destination.prefs = Object.freeze({...readiness.prefs});
      Zotero.Connector._processPreferences(readiness.prefs || {});
      await this.rpc(destination, 'getSelectedCollection', {target: destination.target});
      const current = await browser.tabs.get(tab.id);
      if (current.url !== tab.url) throw new Error('Source tab changed while choosing a destination');
      destinations.set(tab.id, Object.freeze({...destination}));
      const captureID = crypto.randomUUID();
      sessions.set(captureID, Object.freeze({...destination, sourceTab:tab.id}));
      await browser.tabs.update(tab.id, {active: true});
      return captureID;
    } catch (error) {
      await browser.browserAction.setTitle({tabId:tab.id,title:'References: '+error.message}).catch(() => {});
      throw error;
    } finally {
      choices.delete(id); browser.tabs.onRemoved.removeListener(close);
      await browser.tabs.remove(choiceTab.id).catch(() => {});
    }
  };
  const resolverJobs = new Map();
  this.waitForResolverTab = async (binding, pending, source) => {
    // The donor monitor's response detector works on ordinary tabs. Its popup
    // and monitor-page redirects are deliberately not used for automatic jobs.
    const properties = {url:'about:blank', active:false, windowId:source.windowId};
    if (source.cookieStoreId) properties.cookieStoreId = source.cookieStoreId;
    const tab = await browser.tabs.create(properties);
    const state = status => this.rpc(binding, 'getResolverRequest', {requestId:binding.requestId,
      browser:{tabId:tab.id,windowId:tab.windowId,url:pending.attachment.url,status}});
    try { await state('waiting'); }
    catch (error) {
      // Authorization can expire between creation and the durable tab locator.
      // Only this unused blank tab is removed; source/challenge tabs stay open.
      const current = await browser.tabs.get(tab.id).catch(() => null);
      if (current?.url === 'about:blank') await browser.tabs.remove(tab.id).catch(() => {});
      throw error;
    }
    const monitor = Zotero.BrowserAttachmentMonitor, ruleId = monitor._nextRuleId++;
    let timer, removed;
    try {
      const detected = new Promise((resolve, reject) => {
        removed = id => { if (id === tab.id) reject(new Error('Resolver tab was closed')); };
        browser.tabs.onRemoved.addListener(removed);
        monitor._addAttachmentDetectionListener(ruleId, tab.id, resolve);
        timer = setTimeout(() => reject(new Error('Resolver tab is waiting for a file; open the background tab to continue')),
          Math.max(1, Math.min(600000, pending.expiresAt - Date.now())));
        browser.tabs.update(tab.id, {url:pending.attachment.url}).catch(reject);
      });
      const url = await detected;
      await state('file-found');
      return {url, tab};
    } catch (error) {
      await state('waiting').catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
      if (removed) browser.tabs.onRemoved.removeListener(removed);
      await monitor._cleanup(ruleId);
    }
  };
  this.resolveRequest = async (binding, sourceTab) => {
    await Zotero.initDeferred.promise;
    const pending = await this.rpc(binding, 'getResolverRequest', {requestId:binding.requestId});
    if (pending.status === 'complete') return {status:'complete',requestId:binding.requestId,receipt:pending.receipt};
    if (pending.status !== 'challenge-required' || pending.requestId !== binding.requestId
        || typeof pending.sessionID !== 'string' || !pending.attachment || pending.expiresAt <= Date.now()) {
      throw new Error('Resolver request is unavailable or expired');
    }
    const url = new URL(pending.attachment.url);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid resolver URL');
    const source = sourceTab || (await browser.tabs.query({active:true,lastFocusedWindow:true}))[0];
    if (!source) throw new Error('Open an ordinary browser tab for this resolver request');
    const attachment = {...pending.attachment,mimeType:pending.attachment.contentType || 'application/pdf',parentItem:pending.attachment.parentItemID};
    let bytes;
    try {
      bytes = await Zotero.ItemSaver._fetchAttachment(attachment, source, false);
    } catch (_) {
      const resolved = await this.waitForResolverTab(binding, pending, source);
      attachment.url = resolved.url;
      bytes = await Zotero.ItemSaver._fetchAttachment(attachment, resolved.tab, false);
    }
    // Validate the same pending job again after interactive browsing, before any write.
    const current = await this.rpc(binding, 'getResolverRequest', {requestId:binding.requestId});
    if (current.status !== 'challenge-required' || current.sessionID !== pending.sessionID || current.expiresAt <= Date.now()) throw new Error('Resolver authorization changed');
    const metadata = {id:attachment.id,url:attachment.url,contentType:attachment.mimeType,
      parentItemID:attachment.parentItemID,title:Zotero.ItemSaver._rfc2047Encode(attachment.title),resolverRequestId:binding.requestId};
    const receipt = await this.upload(binding, 'saveAttachment', new Uint8Array(bytes), {
      bodyEncoding:'binary',queryString:new URLSearchParams({sessionID:pending.sessionID}).toString(),
      headers:{'Content-Type':attachment.mimeType,'X-Metadata':JSON.stringify(metadata)}});
    return {status:'complete',requestId:binding.requestId,receipt};
  };
  browser.runtime.onMessageExternal.addListener((message, sender) => {
    if (sender.id !== HOST || sender.tab || message?.apiVersion !== 1 || message.operation !== 'resolver') return undefined;
    const binding = {backendId:message.backendId,projectId:message.projectId,requestId:message.requestId};
    if (Object.values(binding).some(value => typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,256}$/.test(value))) throw new Error('Invalid resolver identity');
    const key = JSON.stringify(binding);
    if (!resolverJobs.has(key)) {
      if (resolverJobs.size >= 8) throw new Error('Wait for an existing References resolver request to finish');
      const task = this.resolveRequest(Object.freeze(binding)).finally(() => resolverJobs.delete(key));
      resolverJobs.set(key, task);
    }
    return resolverJobs.get(key);
  });
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
    if (options.method === 'chooseTarget') return this.select(tab, 'retarget', sessionID);
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
    let result;
    try { result = await this.rpc(destination, options.method, data, requestOptions); }
    catch (error) {
      if (options.method !== 'saveAttachmentFromResolver' || error.status !== 409 || error.value?.code !== 'BROWSER_REQUIRED') throw error;
      const requestId = error.value.details?.requestId;
      if (typeof requestId !== 'string' || !/^[A-Za-z0-9_.:-]{1,256}$/.test(requestId)) throw error;
      const resolved = await this.resolveRequest(Object.freeze({backendId:destination.backendId,projectId:destination.projectId,requestId}), tab);
      const title = resolved.receipt?.data?.title;
      if (resolved.status !== 'complete' || typeof title !== 'string' || !title) throw new Error('References did not confirm a saved attachment');
      return title;
    }
    if (options.method === 'updateSession' && sessionID && data.target !== undefined) {
      sessions.set(sessionID, Object.freeze({...destination,target:data.target}));
    }
    if (options.method === 'hasAttachmentResolvers' && typeof result !== 'boolean') throw new Error('Incompatible References resolver response');
    if (options.method === 'saveAttachmentFromResolver' && (typeof result !== 'string' || !result)) throw new Error('References did not confirm a saved attachment');
    if (options.method === 'getSelectedCollection') {
      // The donor progress tree expects the entire hierarchy. Keep its current
      // target presentation, but use the bounded chooser for exploration.
      const root = {id:'L'+destination.projectId,name:result.libraryName,kind:'library',level:0,filesEditable:result.filesEditable};
      const selected = {id:result.id,name:result.name,kind:result.kind || (result.id === root.id ? 'library' : 'collection'),level:1,filesEditable:result.filesEditable};
      result = {...result,kind:selected.kind,targets: selected.id === root.id ? [root] : [root,selected]};
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
    const properties = {url, active:true};
    if (Number.isInteger(source?.windowId)) properties.windowId = source.windowId;
    if (source?.cookieStoreId) properties.cookieStoreId = source.cookieStoreId;
    const tab = await browser.tabs.create(properties);
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
    if (message.action === 'context') {
      const context = await this.context();
      if (pending.mode !== 'retarget') return {...context, previous:pending.destination, mode:pending.mode};
      const binding = pending.destination;
      if (context.backendId !== binding.backendId) throw new Error('The capture backend is no longer selected');
      return {...context, projects:context.projects.filter(project => project.id === binding.projectId), selectedProjectId:binding.projectId, previous:binding, mode:pending.mode};
    }
    if (pending.mode === 'retarget' && ['collections','confirm'].includes(message.action) && (message.destination?.backendId !== pending.destination.backendId || message.destination?.projectId !== pending.destination.projectId || message.openManager)) throw new Error('A capture cannot move to another backend or project');
    if (message.action === 'collections') return this.rpc(message.destination, 'getSelectedCollection', {
      target:message.destination.target, parent:message.parent || null, q:String(message.q || '').slice(0,200), start:Math.max(0,Number(message.start)||0), limit:100});
    if (message.action === 'confirm') { pending.finish({...message.destination,openManager:message.openManager === true}); return true; }
    if (message.action === 'cancel') { pending.finish(null); return true; }
    throw new Error('Unknown References chooser operation');
    })();
  });
};
