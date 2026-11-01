/* BashKitten adaptations, 2026. AGPL-3.0-or-later. Donor capture remains in its original modules. */
'use strict';
globalThis.References = new function () {
  const HOST = 'references-host@bashkitten.org';
  const destinations = new Map(), sessions = new Map(), choices = new Map(), actionSurfaces = new Map();
  const transport = async (message) => {
    const response = await browser.runtime.sendMessage(HOST, {apiVersion: 1, ...message});
    if (!response || response.apiVersion !== 1) throw new Error('References host unavailable or incompatible');
    if (response.status >= 400) {
      const message = typeof response.body?.error === 'string' && response.body.error
        ? response.body.error.slice(0, 500) : 'References request failed';
      const error = new Zotero.Connector.CommunicationError(message, response.status, response.body);
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
  this.openManager = async tab => {
    const context = await this.context(), projects = context.projects || [];
    const previous = destinations.get(tab?.id);
    const project = projects.find(project => project.id === context.selectedProjectId)
      || (previous?.backendId === context.backendId && projects.find(project => project.id === previous.projectId))
      || projects[0];
    return transport({operation:'open',backendId:context.backendId,...(project ? {projectId:project.id} : {})});
  };
  this.rpc = (destination, method, data, options={}) => transport({operation: 'request',
    backendId: destination.backendId, projectId: destination.projectId, method, data,
    headers: options.headers || {}, queryString: options.queryString || '', bodyEncoding: options.bodyEncoding || 'json'});
  const choiceFor = tab => [...choices.values()].find(choice =>
    !choice.claimed && choice.source.id === tab.id && choice.source.url === tab.url);
  const createChoice = tab => {
    const choice = {id:crypto.randomUUID(),source:tab,destination:destinations.get(tab.id),claimed:false,captureStarted:false};
    choice.result = new Promise(resolve => { choice.finish = value => {
      if (choice.settled) return;
      choice.settled = true;
      resolve(value);
    }; });
    choices.set(choice.id, choice);
    return choice;
  };
  this.select = async tab => {
    if (!tab || tab.id < 0 || !/^https?:/.test(tab.url || '')) throw new Error('References requires an ordinary webpage or PDF');
    const choice = choiceFor(tab) || createChoice(tab);
    choice.claimed = true;
    const close = tabId => {
      if (tabId === tab.id) choice.finish(null);
    };
    try {
      browser.tabs.onRemoved.addListener(close);
      // Toolbar clicks use Gecko's action popup. Context-menu saves enter here
      // directly and show the same native popup over their original source tab.
      if (!choice.captureStarted) {
        choice.captureStarted = true;
        await browser.tabs.update(tab.id, {active:true});
        await browser.browserAction.openPopup({windowId:tab.windowId});
      }
      const destination = await choice.result;
      if (!destination) return false;
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
      return captureID;
    } catch (error) {
      await browser.browserAction.setTitle({tabId:tab.id,title:'References: '+error.message}).catch(() => {});
      throw error;
    } finally {
      choices.delete(choice.id);
      browser.tabs.onRemoved.removeListener(close);
    }
  };
  const resolverJobs = new Map();
  this.waitForResolverTab = async (binding, pending, source, capture={}) => {
    // Keep the browser's authenticated response and normal tab navigation.
    // Cancelling it and fetching again from the background loses its session.
    const properties = {url:'about:blank', active:false, windowId:source.windowId};
    const tab = await browser.tabs.create(properties);
    if (source.incognito && !tab.incognito) {
      await browser.tabs.remove(tab.id);
      throw new Error('References cannot open a private tab in this browser.');
    }
    const state = capture.state ? status => capture.state(status, tab)
      : status => this.rpc(binding, 'getResolverRequest', {requestId:binding.requestId,
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
    // Match the existing native resolver response limit in references/resolvers.mjs.
    const byteLimit = 32 * 1024 * 1024, streams = new Map();
    let timer, removed, beforeRequest, selected, settled = false, challengeSeen = false;
    const release = stream => {
      stream.active = false;
      stream.chunks.length = 0;
      if (streams.get(stream.id) === stream) streams.delete(stream.id);
      // Gecko cannot disconnect a filter until its native onstart event.
      if (stream.filter.status === 'uninitialized') return;
      try { stream.filter.disconnect(); } catch (_) { /* Already closed/failed. */ }
    };
    try {
      const detected = new Promise((resolve, reject) => {
        const finish = (error, result) => {
          if (settled) return;
          settled = true;
          for (const stream of streams.values()) release(stream);
          if (error) reject(error); else resolve(result);
        };
        removed = id => {
          if (id === tab.id) finish(new Error('Resolver tab was closed'));
          else if (capture.sourceSessionID && id === source.id) finish(new Error('Capture source tab was closed'));
        };
        browser.tabs.onRemoved.addListener(removed);
        beforeRequest = details => {
          if (settled) return;
          const previous = streams.get(details.requestId);
          if (previous) release(previous);
          // Only document responses in this one pending resolver tab are observed.
          let filter;
          try { filter = browser.webRequest.filterResponseData(details.requestId); }
          catch (error) { finish(error); return; }
          const stream = {id:details.requestId, filter, active:true, chunks:[], size:0, response:null};
          streams.set(stream.id, stream);
          filter.onstart = () => { if (!stream.active) release(stream); };
          filter.ondata = event => {
            if (!stream.active) return;
            try {
              // Forward unchanged bytes before doing any attachment work.
              filter.write(event.data);
              if (settled || stream !== selected) return;
              stream.size += event.data.byteLength;
              if (stream.size > byteLimit) throw new Error('Resolver attachment exceeds 32 MiB');
              stream.chunks.push(new Uint8Array(event.data));
            } catch (error) { finish(error); }
          };
          filter.onstop = () => {
            if (!stream.active) return;
            try {
              filter.close();
              if (!settled && stream === selected) {
                if (!stream.size) throw new Error('Resolver attachment is empty');
                const bytes = new Uint8Array(stream.size);
                let offset = 0;
                for (const chunk of stream.chunks) { bytes.set(chunk, offset); offset += chunk.length; }
                finish(null, {url:stream.response.responseURL, tab, challengeSeen,
                  response:{...stream.response, response:bytes.buffer}});
              }
            } catch (error) { finish(error); }
            finally { release(stream); }
          };
          filter.onerror = () => {
            if (!stream.active) return;
            release(stream);
            // A failed/blocked page subframe is not an attachment failure.
            // Keep the existing wait while the native page/challenge continues.
            if (stream === selected) finish(new Error('Resolver response stream failed: ' + filter.error));
          };
        };
        const captured = details => {
          const stream = streams.get(details.requestId);
          if (!stream || settled) return;
          // Redirects and challenge/ordinary HTML continue without retaining data.
          if (details.statusCode < 200 || details.statusCode >= 300
              || !monitor._isAttachmentResponse(details) || selected) {
            if ((details.statusCode < 300 || details.statusCode >= 400)
                && details.responseHeaders?.some(header => header.name.toLowerCase() === 'content-type'
                  && /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(header.value || ''))) challengeSeen = true;
            release(stream);
            return;
          }
          selected = stream;
          // Keep only validation headers, never cookies or authorization headers.
          const headers = new Map((details.responseHeaders || [])
            .filter(header => ['content-type','content-length','content-range'].includes(header.name.toLowerCase()))
            .map(header => [header.name.toLowerCase(), header.value || '']));
          stream.response = {status:details.statusCode, responseURL:details.url,
            getResponseHeader:name => headers.get(name.toLowerCase()) ?? null};
          if (details.statusCode === 206 || headers.has('content-range')) {
            finish(new Error('Resolver returned a partial attachment'));
          } else if (Number(headers.get('content-length')) > byteLimit) {
            finish(new Error('Resolver attachment exceeds 32 MiB'));
          }
          // Gecko retargets attachment-disposition loads from an existing tab
          // into a new foreground tab. Keep this response in its background tab
          // through the native header API, retaining the filename and all bytes.
          const responseHeaders = details.responseHeaders.map(header =>
            header.name.toLowerCase() === 'content-disposition' && typeof header.value === 'string' ? {...header,
              value:header.value.replace(/^(\s*)attachment(?=\s*(?:;|$))/i, '$1inline')} : header);
          if (responseHeaders.some((header, index) => header.value !== details.responseHeaders[index].value)) {
            return {responseHeaders};
          }
        };
        // Attach before headers: attaching to cached responses later can race Gecko.
        browser.webRequest.onBeforeRequest.addListener(beforeRequest,
          {urls:['<all_urls>'],tabId:tab.id,types:['main_frame','sub_frame']}, ['blocking']);
        browser.webRequest.onHeadersReceived.addListener(captured,
          {urls:['<all_urls>'],tabId:tab.id,types:['main_frame','sub_frame']}, ['blocking','responseHeaders']);
        monitor._addWebRequestListener(ruleId, captured);
        timer = setTimeout(() => finish(new Error('Resolver tab is waiting for a file; open the background tab to continue')),
          Math.max(1, Math.min(600000, pending.expiresAt - Date.now())));
        browser.tabs.update(tab.id, {url:pending.attachment.url}).catch(error => finish(error));
      });
      const result = await detected;
      await state('file-found');
      return result;
    } catch (error) {
      await state('waiting').catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
      if (removed) browser.tabs.onRemoved.removeListener(removed);
      if (beforeRequest) browser.webRequest.onBeforeRequest.removeListener(beforeRequest);
      for (const stream of streams.values()) release(stream);
      await monitor._cleanup(ruleId);
    }
  };
  this.fetchSourceAttachment = async (attachment, sessionID, source) => {
    const binding = this.bind(sessionID, source), sourceURL = source.url;
    const state = async () => {
      const current = await browser.tabs.get(source.id);
      if (current.url !== sourceURL) throw new Error('Capture source tab changed');
      await this.call('getSelectedCollection', {sessionID}, source);
    };
    await state();
    const resolved = await this.waitForResolverTab(binding,
      {attachment,expiresAt:Date.now() + 600000}, source, {state,sourceSessionID:sessionID});
    const validationError = Zotero.ItemSaver._validateResponse(attachment, resolved.response);
    if (validationError) throw new Error('Attachment download failed: ' + validationError);
    attachment.url = resolved.url;
    // Routine direct-PDF capture already has its source viewer. Human challenge
    // tabs stay visible; all uploads still use the donor's existing session path.
    if (!resolved.challengeSeen) await browser.tabs.remove(resolved.tab.id).catch(() => {});
    return resolved.response.response;
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
    const resolved = await this.waitForResolverTab(binding, pending, source);
    attachment.url = resolved.url;
    const validationError = Zotero.ItemSaver._validateResponse(attachment, resolved.response);
    if (validationError) throw new Error('Attachment download failed: ' + validationError);
    const bytes = new Uint8Array(resolved.response.response);
    // Validate the same pending job again after interactive browsing, before any write.
    const current = await this.rpc(binding, 'getResolverRequest', {requestId:binding.requestId});
    if (current.status !== 'challenge-required' || current.sessionID !== pending.sessionID || current.expiresAt <= Date.now()) throw new Error('Resolver authorization changed');
    const metadata = {id:attachment.id,url:attachment.url,contentType:attachment.mimeType,
      parentItemID:attachment.parentItemID,title:Zotero.ItemSaver._rfc2047Encode(attachment.title),resolverRequestId:binding.requestId};
    const receipt = await this.upload(binding, 'saveAttachment', bytes, {
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
    if (data && typeof data === 'object' && !(data instanceof ArrayBuffer)
        && ['saveItems', 'saveSnapshot', 'getSelectedCollection', 'updateSession'].includes(options.method)) {
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
    if (options.method === 'hasAttachmentResolvers' && typeof result !== 'boolean') throw new Error('Incompatible References resolver response');
    if (options.method === 'saveAttachmentFromResolver' && (typeof result !== 'string' || !result)) throw new Error('References did not confirm a saved attachment');
    if (options.method === 'getSelectedCollection') {
      // Retain the donor method name and native note/tag progress controls.
      // A References project has one root destination and no collections.
      const root = {id:'L'+destination.projectId,name:result.libraryName,kind:'library',level:0,filesEditable:result.filesEditable};
      result = {...result,id:root.id,name:root.name,kind:'library',target:root.id,
        collectionID:null,collectionName:null,targets:[root]};
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
  const closeActionSurface = async surface => {
    if (surface.closed) return;
    surface.closed = true;
    actionSurfaces.delete(surface.url);
    surface.port?.disconnect();
    try {
      if (await browser.browserAction.getPopup({tabId:surface.source.id}) === surface.url) {
        await browser.browserAction.setPopup({tabId:surface.source.id,popup:surface.previous});
      }
    } catch { /* The source tab may have closed. */ }
    surface.onClose?.();
  };
  this.openTabSurface = async (url, options={}, source=null) => {
    if (url.startsWith(browser.runtime.getURL('itemSelector/itemSelector.html') + '#')) {
      if (!source) throw new Error('References selector requires its source tab');
      for (const surface of actionSurfaces.values()) {
        if (surface.source.id === source.id) await closeActionSurface(surface);
      }
      const surface = {url,source,onClose:options.onClose,
        previous:await browser.browserAction.getPopup({tabId:source.id})};
      actionSurfaces.set(url,surface);
      try {
        await browser.tabs.update(source.id,{active:true});
        await browser.browserAction.setPopup({tabId:source.id,popup:url});
        await browser.browserAction.openPopup({windowId:source.windowId});
        return {id:source.windowId,tabs:[source]};
      } catch (error) { await closeActionSurface(surface); throw error; }
    }
    // Let the native browser choose the ordinary user store. An application
    // tab's isolated service context is not a public Firefox container.
    const properties = {url:source?.incognito ? 'about:blank' : url, active:true};
    if (Number.isInteger(source?.windowId)) properties.windowId = source.windowId;
    const tab = await browser.tabs.create(properties);
    if (source?.incognito) {
      if (!tab.incognito) {
        await browser.tabs.remove(tab.id).catch(() => {});
        throw new Error('References cannot open a private tab in this browser.');
      }
      try { await browser.tabs.update(tab.id, {url}); }
      catch (error) { await browser.tabs.remove(tab.id).catch(() => {}); throw error; }
    }
    if (options.onClose) {
      const closed = id => { if (id === tab.id) { browser.tabs.onRemoved.removeListener(closed); options.onClose(); } };
      browser.tabs.onRemoved.addListener(closed);
    }
    return {id: tab.windowId, tabs:[tab]};
  };
  browser.tabs.onRemoved.addListener(id => {
    destinations.delete(id);
    for (const surface of actionSurfaces.values()) {
      if (surface.source.id === id) void closeActionSurface(surface);
    }
    // Keep session bindings until completed requests settle; do not redirect them on tab reuse.
    for (const [key, binding] of sessions) if (binding.sourceTab === id) sessions.delete(key);
  });
  browser.runtime.onConnect.addListener(port => {
    if (port.name === 'references-selector') {
      const surface = actionSurfaces.get(port.sender?.url);
      if (port.sender?.id !== browser.runtime.id || !surface) { port.disconnect(); return; }
      surface.port = port;
      port.onDisconnect.addListener(() => void closeActionSurface(surface));
      return;
    }
    if (port.name !== 'references-destination') return;
    const sender = port.sender;
    const chooserURL = browser.runtime.getURL('references/destination.html');
    if (sender?.id !== browser.runtime.id || sender.url?.split(/[?#]/)[0] !== chooserURL) {
      port.disconnect();
      return;
    }
    let choice, disconnected = false;
    port.onDisconnect.addListener(() => {
      disconnected = true;
      // Start the native save after the chooser has actually closed, so a
      // translator's native multi-item popup never competes with this popup.
      choice?.finish(choice.confirmed || null);
      if (choice && !choice.captureStarted) choices.delete(choice.id);
    });
    port.onMessage.addListener(message => {
      (async () => {
        if (message.action === 'context') {
          if (choice) throw new Error('References chooser is already initialized');
          await Zotero.initDeferred.promise;
          const [tab] = await browser.tabs.query({active:true,currentWindow:true});
          if (!tab || tab.id < 0) throw new Error('References requires an active browsing tab');
          choice = choiceFor(tab) || [...choices.values()].find(value =>
            value.source.id === tab.id && value.source.url === tab.url && !value.settled) || createChoice(tab);
          const context = await this.context();
          if (disconnected) { choice.finish(null); return; }
          if (!/^https?:/.test(tab.url || '')) {
            choice.captureError = 'This page cannot be captured. Open an ordinary webpage or PDF.';
            return {...context, previous:choice.destination, captureError:choice.captureError};
          }
          if (!choice.captureStarted) {
            choice.captureStarted = true;
            // Keep the released Connector's translator/PDF selection and save flow.
            Promise.resolve(Zotero.Connector_Browser.onZoteroButtonElementClick(tab)).catch(error => {
              choice.captureError = error.message;
              choice.finish(null);
              if (!disconnected) port.postMessage({error:error.message,captureUnavailable:true});
            }).finally(() => {
              choice.captureFinished = true;
              if (!choice.claimed) {
                choice.finish(null);
                choices.delete(choice.id);
                if (!disconnected && !choice.captureError) {
                  port.postMessage({error:'This page cannot be captured. Open an ordinary webpage or PDF.',captureUnavailable:true});
                }
              }
            });
          }
          return {...context, previous:choice.destination};
        }
        if (!choice || disconnected) throw new Error('References destination choice expired');
        const current = await browser.tabs.get(choice.source.id);
        if (current.url !== choice.source.url) throw new Error('Capture source tab changed');
        if (message.action === 'confirm') {
          if (message.openManager === true) {
            choice.confirmed = null;
            const destination = message.destination;
            await transport({operation:'open',backendId:destination.backendId,
              ...(destination.projectId ? {projectId:destination.projectId} : {})});
            choice.finish(null);
          } else {
            if (choice.captureError) throw new Error(choice.captureError);
            if (choice.captureFinished && !choice.claimed) throw new Error(choice.captureError || 'This page cannot be captured');
            choice.confirmed = {...message.destination,target:''};
          }
          return true;
        }
        if (message.action === 'cancel') { choice.finish(null); return true; }
        throw new Error('Unknown References chooser operation');
      })().then(result => {
        if (!disconnected) port.postMessage({requestId:message.requestId,result});
      }, error => {
        if (choice && !choice.captureStarted) { choice.finish(null); choices.delete(choice.id); }
        if (!disconnected) port.postMessage({requestId:message.requestId,error:error.message});
      });
    });
  });
};
