// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeOfficeSession, OfficeError } from './native-session.mjs';
import { nativeOperation } from '../extension/kit.mjs';
import { runCitationCommand } from '../extension/citations.mjs';
import { promoteCitationCodes } from '../extension/code-promotion.mjs';
import { compareSnapshots } from './snapshot-diff.mjs';

const reads = new Set(['inspect', 'codes.region', 'selection', 'capabilities', 'citations.inspect', 'citations.selection', 'citations.prepare']);
const nativeOperations = new Set([...reads, 'text.edit', 'text.append', 'table.insert', 'table.set', 'sheet.set', 'sheet.insert', 'sheet.rows', 'sheet.columns', 'slide.insert', 'slide.remove', 'shape.insert', 'shape.edit', 'format', 'view.finish-edit', 'native.uno']);
const ownerKey = identity => {
  if (identity?.kind === 'browser' && identity.backendId && identity.viewId && identity.grantId && identity.operationId) return identity.backendId + ':browser:' + identity.viewId + ':' + identity.operationId;
  if (!identity?.backendId || !identity?.workerId) throw new OfficeError('unauthorized', 'An active backend worker identity is required');
  return identity.backendId + ':' + identity.workerId;
};

// AuthorizeOpen belongs to the existing backend + WOPI file owner. Caller-supplied
// tokens, origins and paths cannot become a session grant through this module.
export function createOfficeService({ resolveOpen, authorizeOpen, authorizeSession, authorizeRenew, authorizeSnapshot, history, registerExport, references, sessionOptions = {}, Session = NativeOfficeSession } = {}) {
  if (typeof authorizeOpen !== 'function') throw new Error('Office requires the backend authorized-open owner');
  const sessions = new Map(), opening = new Map();
  async function connectNative(grant, signal) {
    const timeoutMs = sessionOptions.timeoutMs ?? 60000, deadline = Date.now() + timeoutMs;
    for (let attempt = 1; ; attempt++) {
      const native = new Session(grant, { ...sessionOptions, timeoutMs: Math.max(1, deadline - Date.now()) });
      try { await native.connect({ signal }); native.timeoutMs = timeoutMs; return native; }
      catch (error) {
        native.close();
        // Match the released client's bounded quadratic retry for the broker's
        // explicit unloading response. No edit, save or permission failure is replayed.
        const pause = 500 * attempt * attempt;
        if (error.code !== 'document_unloading' || attempt >= 10 || Date.now() + pause >= deadline) throw error;
        await delay(pause, undefined, { signal });
      }
    }
  }
  async function open(body, identity, signal) {
    const owner = ownerKey(identity);
    // Resolve file authority through the existing registry before allocating a
    // native token/browser launch. Repeated opens share one participant rather
    // than leaking an unused launch for every cache hit.
    const resolved = resolveOpen ? await resolveOpen(body, identity, { signal }) : null;
    let grant = resolved ? null : await authorizeOpen(body, identity, { signal });
    const documentId = resolved?.documentId || grant?.documentId;
    const projectId = resolved ? resolved.projectId : grant?.projectId || identity.projectId || body.projectId;
    if (!documentId) throw new OfficeError('invalid_grant', 'The Office host did not resolve an authorized document');
    const snapshot = resolved?.snapshot || grant?.snapshot || '';
    const key = owner + ':' + (projectId || '') + ':' + documentId + ':' + snapshot;
    for (const session of sessions.values()) if (session.key === key && !session.native.closed) { await authorizeSession?.(session.identity, { signal }); return describe(session); }
    if (opening.has(key)) return opening.get(key);
    const task = (async () => {
      grant ||= await authorizeOpen(resolved, identity, { signal });
      if (grant?.documentId !== documentId || !grant?.participantId || (resolved && ((grant.projectId || '') !== (projectId || '') || (grant.snapshot || '') !== snapshot))) throw new OfficeError('invalid_grant', 'The Office host did not issue the resolved document participant grant');
      const native = await connectNative(grant, signal);
      try {
        if (authorizeRenew) native.startTokenRenewal((current, options) => authorizeRenew(current, identity, options));
        const canScript = native.scriptingAllowed;
        const capabilities = canScript ? (await native.call(nativeOperation, { operation: 'capabilities' }, { signal })).value : { documentType: native.status?.type, readOnly: true, nativeUno: false, nativeTextInspection: true, citationMetadataAvailable: false };
        const session = { id: native.id, key, owner, projectId: grant.projectId || identity.projectId || body.projectId, grantId: identity.grantId, identity, native, grant, capabilities };
        sessions.set(session.id, session); native.once('closed', () => sessions.delete(session.id));
        return describe(session);
      } catch (error) { native.close(); throw error; }
    })();
    opening.set(key, task);
    try { return await task; } finally { opening.delete(key); }
  }
  function describe(session) {
    return { sessionId: session.id, documentId: session.grant.documentId, snapshot: session.grant.snapshot || null, projectId: session.projectId, participantId: session.grant.participantId, browserUrl: session.grant.browserUrl, documentType: session.native.status?.type, viewId: session.native.status?.viewid, capabilities: session.capabilities };
  }
  function owned(id, identity) {
    const session = sessions.get(id);
    if (!session || session.owner !== ownerKey(identity)) throw new OfficeError('session_not_found', 'No Office participant belongs to this worker under that session ID');
    if (session.projectId && identity.projectId && session.projectId !== identity.projectId) throw new OfficeError('project_mismatch', 'The Office participant belongs to another project');
    return session;
  }
  async function citationCommand(session, request, { signal } = {}) {
    if (typeof references?.renderDocument !== 'function') throw new OfficeError('references_unavailable', 'The References renderer is not available');
    return runCitationCommand({
      invoke: async (operation, options) => (await session.native.call(nativeOperation, operation, options)).value,
      renderDocument: (state, options) => references.renderDocument(state, { ...options, identity: session.identity }),
      importSnapshots: typeof references.importSnapshots === 'function' ? (body, options) => references.importSnapshots(body, { ...options, identity: session.identity }) : undefined,
      documentType: session.native.status?.type, request, signal,
    });
  }
  async function exportDocument(session, request, signal) {
    const result = await session.native.export({ ...request, signal });
    if (!registerExport) return result;
    const registered = await registerExport({ grantId: session.identity.grantId, documentId: session.grant.documentId, participantId: session.grant.participantId, downloadUrl: result.downloadUrl, filename: result.name }, { signal });
    if (typeof registered?.downloadUrl !== 'string' || new URL(registered.downloadUrl).protocol !== 'https:') throw new OfficeError('export_scope', 'The document host did not register an authorized HTTPS export');
    return { ...result, downloadUrl: registered.downloadUrl };
  }

  async function execute(sessionId, request, identity, { signal } = {}) {
    const session = owned(sessionId, identity);
    await authorizeSession?.(session.identity, { signal });
    if (!request || typeof request.operation !== 'string') throw new OfficeError('invalid_operation', 'An Office operation is required');
    if (request.operation === 'capabilities') return session.native.scriptingAllowed ? session.capabilities : { documentType: session.native.status?.type, readOnly: true, nativeUno: false, nativeTextInspection: true, citationMetadataAvailable: false };
    if (request.operation === 'inspect' && !session.native.scriptingAllowed) return session.native.inspectReadOnly({ range: request.range, signal });
    if (request.operation === 'save') return session.native.save({ signal });
    if (request.operation === 'export') {
      if (Object.keys(request).some(key => !['operation', 'format', 'name'].includes(key))) throw new OfficeError('invalid_export', 'Export accepts format and name; unlinking or output paths need an explicit copy operation');
      return exportDocument(session, request, signal);
    }
    if (request.operation === 'export.copy') {
      if (Object.keys(request).some(key => !['operation', 'format', 'name'].includes(key))) throw new OfficeError('invalid_export', 'A static citation copy accepts only format and name');
      const copied = await session.native.saveCopy({ ...request, signal });
      let description;
      try { description = await open({ documentId: copied.documentId, projectId: session.projectId }, session.identity, signal); }
      catch (error) { error.details = { ...error.details, copyDocumentId: copied.documentId, sourceDocumentId: session.grant.documentId }; throw error; }
      const copy = owned(description.sessionId, session.identity);
      try {
        const { value: state } = await copy.native.call(nativeOperation, { operation: 'citations.inspect' }, { signal });
        await copy.native.call(nativeOperation, { operation: 'citations.unlink', expectedRevision: state.revision }, { signal, mutation: true });
        await copy.native.save({ signal });
        if (identity.kind === 'browser') return { ...description, format: request.format, name: copied.name, citations: 'static-text', sourceDocumentId: session.grant.documentId };
        const exported = await exportDocument(copy, { format: request.format, name: copied.name }, signal);
        return { ...description, ...exported, citations: 'static-text', sourceDocumentId: session.grant.documentId };
      } catch (error) { error.details = { ...error.details, copyDocumentId: copied.documentId, copySessionId: copy.id, sourceDocumentId: session.grant.documentId }; throw error; }
    }
    if (request.operation === 'native.script') {
      if (typeof request.source !== 'string' || request.source.length > 262144 || !Array.isArray(request.args || [])) throw new OfficeError('invalid_script', 'Provide a bounded native JavaScript function source and an argument array');
      return session.native.call(function ({ source, args }) { const fn = (0, eval)('(' + source + ')'); if (typeof fn !== 'function') throw Error('Native script source must be a function'); return fn(...args); }, { source: request.source, args: request.args || [] }, { signal, mutation: true });
    }
    if (request.operation === 'reconcile') { await session.native.call(nativeOperation, { operation: 'inspect', limit: 1 }, { signal }); session.native.reconcile(request.operationId); return { reconciled: true }; }
    if (nativeOperations.has(request.operation)) {
      const result = await session.native.call(nativeOperation, request, { signal, mutation: !reads.has(request.operation) });
      return { ...result.value, native: { legacyUnoApi: result.legacyUnoApi, viewId: session.native.status?.viewid } };
    }
    if (request.operation === 'citations.codes') {
      if (typeof references?.parseDocument !== 'function') throw new OfficeError('references_unavailable', 'The References citation parser is unavailable');
      return promoteCitationCodes({ invoke: async (operation, options) => (await session.native.call(nativeOperation, operation, options)).value,
        parse: (text, options) => references.parseDocument(text, { ...options, identity: session.identity }),
        renderDocument: (state, options) => references.renderDocument(state, { ...options, identity: session.identity }),
        documentType: session.native.status?.type, target: request.target, signal });
    }
    if (request.operation.startsWith('citations.')) return citationCommand(session, request, { signal });
    throw new OfficeError('invalid_operation', 'Unknown Office operation');
  }
  return {
    open, execute,
    hasDocumentViews: documentId => [...sessions.values()].some(session => session.grant.documentId === documentId && !session.grant.snapshot && !session.native.closed) || [...opening.keys()].some(key => key.endsWith(':' + documentId + ':')),
    async dispatch({ method, path, body = {}, identity, signal }) {
      if (method === 'POST' && path === '/snapshots') {
        ownerKey(identity);
        const operations = { list: [], open: ['versionId'], restore: ['versionId'], configure: ['maxVersions'] };
        const fields = Object.hasOwn(operations, body.operation) ? operations[body.operation] : null;
        if (!fields || !body.projectId || !/^[a-f0-9-]{36}$/.test(body.documentId || '') ||
            Object.keys(body).some(key => !['projectId', 'documentId', 'operation', ...fields].includes(key)) ||
            (fields.includes('versionId') && !/^[a-f0-9-]{36}$/.test(body.versionId || '')) ||
            (fields.includes('maxVersions') && (!Number.isSafeInteger(body.maxVersions) || body.maxVersions < 1 || body.maxVersions > 10000)))
          throw new OfficeError('invalid_history', 'Choose a document and a valid list, open, restore or configure history operation');
        if (body.operation === 'open') return open({ documentId: body.documentId, projectId: body.projectId, snapshot: body.versionId }, identity, signal);
        if (typeof history !== 'function') throw new OfficeError('snapshots_unavailable', 'The authorized Office history owner is unavailable');
        const result = await history(body, identity, { signal });
        if (body.operation !== 'restore') return result;
        // Native Pre_Restore_Ack has closed the old broker. Retire local handles
        // before resolving a fresh master view; no stale session can be reused.
        for (const session of sessions.values()) if (session.grant.documentId === body.documentId && !session.grant.snapshot) session.native.close();
        return { ...result, ...await open({ documentId: body.documentId, projectId: body.projectId }, identity, signal) };
      }
      if (method === 'POST' && path === '/snapshots/diff') {
        ownerKey(identity);
        if (typeof authorizeSnapshot !== 'function') throw new OfficeError('snapshots_unavailable', 'The authorized Office snapshot owner is unavailable');
        const before = await authorizeSnapshot({ documentId: body.documentId, versionId: body.from }, identity, { signal });
        const after = await authorizeSnapshot({ documentId: body.documentId, versionId: body.to }, identity, { signal });
        return compareSnapshots(before, after, { signal, format: body.format || 'json' });
      }
      if (method === 'POST' && path === '/sessions') return open(body, identity, signal);
      const match = /^\/sessions\/([a-f0-9-]+)(\/commands)?$/.exec(path);
      if (!match) throw new OfficeError('route_not_found', 'Office route not found');
      if (method === 'POST' && match[2]) return execute(match[1], body, identity, { signal });
      if (method === 'DELETE' && !match[2]) { const session = owned(match[1], identity); await authorizeSession?.(session.identity, { signal }); session.native.close(); sessions.delete(session.id); return { closed: true }; }
      throw new OfficeError('route_not_found', 'Office route not found');
    },
    revoke({ backendId, workerId, grantId } = {}) {
      for (const session of sessions.values()) if ((!backendId || session.identity.backendId === backendId) && (!workerId || session.identity.workerId === workerId) && (!grantId || session.grantId === grantId)) session.native.close();
    },
    async coordinateNativeRestore(documentId, { grant, signal } = {}) {
      if (!grant || grant.documentId !== documentId || grant.mode !== 'edit') throw new OfficeError('invalid_grant', 'Native history restore needs an authorized editable document grant');
      await Promise.allSettled([...opening].filter(([key]) => key.endsWith(':' + documentId + ':')).map(([, task]) => task));
      const native = await connectNative(grant, signal);
      try { return await native.prepareRestore({ signal }); }
      finally { native.close(); }
    },
    close() { for (const session of sessions.values()) session.native.close(); sessions.clear(); },
  };
}
