// SPDX-License-Identifier: AGPL-3.0-only
// Backend app boundary. Native components retain their APIs and process owners;
// this module resolves existing project/session authority and starts them lazily.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { dataDir, readJson, json, body as readBody } from '../common.mjs';
import { paths } from '../access/paths.mjs';
import { controlRequest } from '../control.mjs';
import { dispatchReferenceResolver } from '../access/browser-channel.mjs';
import { projects, createProject, renameProject, removeProject, archiveProject, relinkProject, withProjectOperation, withProjectTransition } from '../projects.mjs';
import { fileDirectory, sendFile } from '../files/files.mjs';
import { authorizeApplicationPath, privateManagerPaths, managerAllowed, runManagerOperation } from '../files/access.mjs';
import { ApplicationGateway } from './gateway.mjs';
import { applicationModules as modules, referencesWebRoot } from './locations.mjs';
const unavailable = (name, detail = '') => Object.assign(Error(`${name} is unavailable${detail ? ': ' + detail : '. Install the matching component package.'}`), { status: 503, code: 'APP_UNAVAILABLE' });
const connectorMethods = new Set(['ping', 'getTranslators', 'getTranslatorCode', 'getSelectedCollection', 'saveItems', 'saveSnapshot', 'saveSingleFile',
  'saveAttachment', 'saveStandaloneAttachment', 'getRecognizedItem', 'getResolverRequest', 'hasAttachmentResolvers', 'saveAttachmentFromResolver', 'updateSession', 'import', 'installStyle',
  'upload-begin', 'upload-chunk', 'upload-commit', 'upload-cancel']);
const requestHeaders = new Set(['content-type', 'x-metadata', 'zotero-api-version', 'x-zotero-connector-api-version', 'if-match', 'if-none-match', 'if-unmodified-since-version']);
const applicationBody = async req => JSON.parse((await readBody(req, 16 * 1024 * 1024)).toString('utf8') || '{}');

export class ApplicationModules {
  constructor({ auth, resolveSession }) {
    this.auth = auth; this.resolveSession = resolveSession;
    this.loaded = new Map(); this.instances = new Map(); this.closed = false;
    this.gateway = new ApplicationGateway({ authorize: (record, work, options) => this.authorize(record, work, options),
      handle: (component, req, res, context) => this.webRequest(component, req, res, context),
      upgrade: (component, req, socket, head, context) => this.upgrade(component, req, socket, head, context),
      resolveEditor: (req, candidateGrantIds) => {
        if (!this.officeProvider) throw Object.assign(Error('Open the Office document from Files or Pi first'), { status: 401 });
        return this.officeProvider.resolveEditorGrant(req, { candidateGrantIds });
      },
      validateGrant: grant => this.validateGrant(grant),
      register: service => this.ensureRunning(service, false),
      ensureTLS: () => controlRequest('application-gateway', {}), validateProxy: req => auth.origin(req) });
  }
  async module(component) {
    if (!modules[component]) throw Error('Unknown application');
    if (this.closed) throw unavailable(component, 'the backend is stopping');
    if (!this.loaded.has(component)) {
      const pending = fs.access(fileURLToPath(modules[component])).then(() => import(modules[component].href))
        .catch(error => { this.loaded.delete(component); throw unavailable(component, error.code === 'ENOENT' ? 'the component package is not installed' : error.message); });
      this.loaded.set(component, pending);
    }
    return this.loaded.get(component);
  }
  async identity() {
    const identity = await readJson(paths.identity, null);
    if (!identity?.instanceId) throw unavailable('Applications', 'the backend identity is unavailable');
    return identity.instanceId;
  }
  async authorize(record, work, options = {}) {
    if (this.closed || !await this.auth.valid(record)) throw Object.assign(Error('The application session expired. Open it again from BashKitten.'), { status: 401 });
    return runManagerOperation(record, work, { ...options, watch: abort => {
      const stopRequest = options.watch?.(abort);
      const stopAuth = this.auth.watch(record, () => { abort(); options.cancel?.(); });
      return () => { stopRequest?.(); stopAuth(); };
    } });
  }
  async project(record, id, { includeArchived = false } = {}) {
    if (!await this.auth.valid(record) || !await managerAllowed(record)) throw Object.assign(Error('This project is not authorized'), { status: 403 });
    const project = (await projects({ includeArchived })).projects.find(project => project.id === id);
    if (!project) throw Object.assign(Error('Project not found'), { status: 404 });
    const cwd = (await fileDirectory(project.cwd)).path;
    await authorizeApplicationPath(cwd);
    return { ...project, cwd, runAuthorized: work => withProjectOperation(id, projectSignal => this.authorize(record, async operation => {
      const current = (await projects({ includeArchived })).projects.find(item => item.id === id);
      if (!current || current.cwd !== project.cwd) throw Object.assign(Error('The project changed during this operation'), { status: 409 });
      if (current.archived) throw Object.assign(Error('Unarchive this library before changing it'), { status: 409 });
      const signal = AbortSignal.any([projectSignal, operation.signal]); signal.throwIfAborted();
      return work(signal);
    })) };
  }
  async ensureRunning(service, start = true, restart = false) {
    if (this.closed) throw unavailable('Applications', 'the backend is stopping');
    try { return await controlRequest('application-service', { service, start, restart }); }
    catch (error) { if (error.code === 'ENOENT') throw unavailable(service.name, 'the matching native component artifact is not installed'); throw error; }
  }
  async references() {
    if (!this.instances.has('references')) {
      const pending = (async () => {
        const module = await this.module('references');
        if (typeof module.createReferencesService !== 'function') throw unavailable('References', 'incompatible component API');
        const endpoint = await this.gateway.endpoint();
        await this.ensureRunning({ id: 'references', name: 'References', kind: 'web', scheme: 'https',
          target: { network: 'unix', address: endpoint.socketPath }, openPath: '/', enabled: false, startup: false, command: null }, false);
        return module.createReferencesService({ dataDir, backendId: await this.identity(), authorizeProject: (authority, id) => this.project(authority, id, { includeArchived: true }),
          authorizeLibraryLifecycle: (authority, id, options) => this.libraryAuthority(authority, id, options),
          listProjects: async authority => { if (!await this.auth.valid(authority) || !await managerAllowed(authority)) throw Object.assign(Error('Project access is not authorized'), { status: 403 }); return (await projects()).projects.map(({ id, name }) => ({ id, name })); } });
      })().catch(error => { this.instances.delete('references'); throw error; });
      this.instances.set('references', pending);
    }
    return this.instances.get('references');
  }
  async lifecycle(component, action) {
    if (component !== 'references' || !['start', 'stop'].includes(action)) throw Object.assign(Error('Unknown application lifecycle operation'), { status: 400 });
    if (action === 'start') { await this.references(); return { running: true }; }
    const pending = this.instances.get('references');
    if (pending) {
      const service = await pending.catch(() => null);
      await service?.close?.();
      if (this.instances.get('references') === pending) this.instances.delete('references');
    }
    return { running: false };
  }
  async libraryAuthority(record, id, options = {}) {
    if (!await this.auth.valid(record) || !await managerAllowed(record)) throw Object.assign(Error('This library is not authorized'), { status: 403 });
    const project = (await projects({ includeArchived: true })).projects.find(item => item.id === id);
    if (!project) throw Object.assign(Error('Project not found'), { status: 404 });
    await authorizeApplicationPath(project.cwd);
    if (options.operation === 'relink') {
      if (options.previousRoot !== project.cwd) throw Object.assign(Error('The project folder changed'), { status: 409 });
      await authorizeApplicationPath((await fileDirectory(options.newRoot)).path);
    }
    return { ...project, runAuthorized: work => this.authorize(record, async operation => {
      const current = (await projects({ includeArchived: true })).projects.find(item => item.id === id);
      if (!current || current.cwd !== project.cwd) throw Object.assign(Error('The project changed during this operation'), { status: 409 });
      operation.signal.throwIfAborted(); return work(operation.signal);
    }) };
  }
  async projectLifecycle(id, action, method, input, record, { signal, response } = {}) {
    const project = await this.libraryAuthority(record, id);
    if ((action === 'library' && method !== 'DELETE') || (action !== 'library' && method !== 'POST')) throw Object.assign(Error('Method not allowed'), { status: 405 });
    const allowed = { archive: ['archived'], relink: ['cwd', 'expectedCwd'], library: ['confirmProjectId', 'attachments'] }[action];
    if (Object.keys(input).some(key => !allowed.includes(key))) throw Object.assign(Error('Invalid library lifecycle request'), { status: 400 });
    return withProjectTransition(id, async () => {
      signal?.throwIfAborted();
      if (action === 'archive') {
        if (typeof input.archived !== 'boolean') throw Error('Choose whether to archive this project');
        await this.revokeProject(id, { response });
        return { status: 200, body: { project: await archiveProject(id, input.archived) } };
      }
      const references = await this.references();
      if (action === 'relink') {
        if (input.expectedCwd !== project.cwd) throw Object.assign(Error('The project folder changed; refresh before relinking'), { status: 409 });
        const cwd = (await fileDirectory(input.cwd)).path; await authorizeApplicationPath(cwd);
        await this.revokeProject(id, { response });
        const reconciliation = await references.validateLibraryRelink({ projectId: id, previousRoot: project.cwd, newRoot: cwd, authority: record, signal });
        if (!reconciliation.canRelink) return { status: 409, body: { error: 'The new folder does not contain the matching library attachments', reconciliation } };
        signal?.throwIfAborted();
        return { status: 200, body: { project: await relinkProject(id, cwd, { expectedCwd: project.cwd }), reconciliation } };
      }
      if (input.confirmProjectId !== id || !['keep', 'delete'].includes(input.attachments)) throw Object.assign(Error('Confirm this exact library and choose whether to keep its attachments'), { status: 400 });
      await this.revokeProject(id, { response });
      return { status: 200, body: await references.deleteLibrary({ projectId: id, ...input, authority: record, signal }) };
    });
  }
  async office() {
    if (!this.instances.has('office')) {
      const pending = (async () => {
        const [module, files, runtime] = await Promise.all([this.module('office'), this.module('officeProvider'), this.module('officePrepare')]);
        if (typeof module.createOfficeService !== 'function' || typeof files.createOfficeProvider !== 'function' || typeof runtime.prepareOffice !== 'function') throw unavailable('Office', 'incompatible native provider API');
        let preparing;
        const prepareNative = () => {
          if (!preparing) preparing = (async () => {
            await this.gateway.endpoint();
            const layout = await controlRequest('application-office-layout', {});
            // Native frame policy uses the validated connection/WOPI hosts;
            // mapped client ports do not change the shared configuration.
            return runtime.prepareOffice({ dataRoot: dataDir, ...layout, publicOrigins: [] });
          })().catch(error => { preparing = undefined; throw error; });
          return preparing;
        };
        this.prepareOfficeRuntime = prepareNative;
        let service;
        const provider = files.createOfficeProvider({ dataRoot: dataDir, environmentId: await this.identity(),
          authorizePath: authorizeApplicationPath,
          ensureRunning: async (name, definition) => {
            // A saved autostart may have loaded the previous package's config.
            // Reconcile once before this backend has issued any document views.
            if (name === 'office') {
              const prepared = await prepareNative();
              provider.configure(prepared);
              return this.ensureRunning(prepared.service, true, true);
            }
            if (name === 'office-addon' && definition?.id === name) return this.ensureRunning(definition);
            throw unavailable('Office', 'invalid native dependency');
          },
          authorizeOperation: (grantId, operation, work) => this.gateway.authorizeOperation(grantId, operation, async context => {
            await this.validateGrant(context.grant);
            return work(context.grant.scope, context.signal);
          }),
          coordinateNativeRestore: (documentId, options) => {
            if (typeof service?.coordinateNativeRestore !== 'function') throw unavailable('Office', 'native restore coordination is unavailable');
            return service.coordinateNativeRestore(documentId, options);
          },
          officeCopy: ({ grantId, viewId, documentId, name, format, signal: callerSignal, origin }) => this.gateway.authorizeOperation(grantId, 'office-copy', async context => {
            await this.validateGrant(context.grant);
            const signal = callerSignal ? AbortSignal.any([callerSignal, context.signal]) : context.signal;
            const identity = { kind: 'browser', backendId: await this.identity(), viewId, operationId: randomUUID(), grantId, projectId: context.grant.scope.projectId, origin };
            const sessions = new Set();
            try {
              const opened = await service.dispatch({ method: 'POST', path: '/sessions', body: { documentId, projectId: identity.projectId }, identity, signal });
              sessions.add(opened.sessionId);
              const copied = await service.dispatch({ method: 'POST', path: `/sessions/${opened.sessionId}/commands`, body: { operation: 'export.copy', name, format }, identity, signal });
              sessions.add(copied.sessionId);
              // The normal copied-document view opens its own human session.
              // Do not expose a download/session that this action will close.
              return { browserUrl: copied.browserUrl, documentId: copied.documentId, sourceDocumentId: copied.sourceDocumentId, citations: copied.citations };
            } catch (error) { if (error.details?.copySessionId) sessions.add(error.details.copySessionId); throw error; }
            finally { await Promise.allSettled([...sessions].map(id => service.dispatch({ method: 'DELETE', path: `/sessions/${id}`, identity }))); }
          }),
          referenceContext: ({ grantId }) => this.gateway.authorizeOperation(grantId, 'references-context', async ({ grant }) => {
            await this.validateGrant(grant);
            if (!grant.scope.projectId) return null;
            await this.project(grant.record, grant.scope.projectId);
            return { projectId: grant.scope.projectId };
          }),
          referenceRequest: ({ grantId, method, path: requestPath, body, signal: callerSignal }) => this.gateway.authorizeOperation(grantId, 'references-request', async ({ grant, signal }) => {
            await this.validateGrant(grant);
            const projectId = /^\/api\/references\/projects\/([^/]+)(?:\/|$)/.exec(requestPath)?.[1];
            if (!projectId || projectId !== grant.scope.projectId) throw Object.assign(Error('References request leaves the document project'), { status: 403 });
            return this.request({ component: 'references', method, path: requestPath.slice('/api/references'.length), body }, grant.record,
              { signal: callerSignal ? AbortSignal.any([callerSignal, signal]) : signal });
          }) });
        this.officeProvider = provider;
        const referenceOperation = name => (value, { identity, projectId, signal } = {}) => this.gateway.authorizeOperation(identity?.grantId, 'references-' + name, async context => {
          await this.validateGrant(context.grant);
          const ownedProject = context.grant.scope.projectId;
          if (!ownedProject || (projectId && projectId !== ownedProject)) throw Object.assign(Error('References request leaves the document project'), { status: 403 });
          const references = await this.references();
          if (typeof references[name] !== 'function') throw unavailable('References', 'the native citation operation is unavailable');
          return references[name](value, { authority: context.grant.record, projectId: ownedProject, signal: signal ? AbortSignal.any([signal, context.signal]) : context.signal });
        });
        service = module.createOfficeService({ resolveOpen: (body, identity, options) => this.resolveOfficeDocument(body, identity, options),
          authorizeOpen: (body, identity, options) => this.openOffice(body, identity, options),
          authorizeSession: identity => this.gateway.authorizeOperation(identity?.grantId, 'office-session', ({ grant }) => this.validateGrant(grant)),
          authorizeRenew: (session, identity, { signal } = {}) => this.gateway.authorizeOperation(identity?.grantId, 'office-renew', async context => {
            await this.validateGrant(context.grant);
            return provider.renew({ grantId: identity.grantId, documentId: session.documentId, participantId: session.participantId, accessToken: session.accessToken },
              { signal: signal ? AbortSignal.any([signal, context.signal]) : context.signal });
          }),
          registerExport: (exported, { signal } = {}) => this.gateway.authorizeOperation(exported.grantId, 'office-export', async context => {
            await this.validateGrant(context.grant);
            return provider.registerExport(exported, { signal: signal ? AbortSignal.any([signal, context.signal]) : context.signal });
          }),
          authorizeSnapshot: async ({ documentId, versionId }, identity, { signal } = {}) => {
            const participantId = 'agent:' + identity.backendId + ':' + identity.workerId;
            await provider.owner.register({ grantId: identity.grantId, documentId, participantId, participantName: 'Pi' });
            return provider.snapshot({ grantId: identity.grantId, documentId, participantId, versionId }, { signal });
          },
          references: { renderDocument: referenceOperation('renderDocument'), parseDocument: referenceOperation('parseDocument'), importSnapshots: referenceOperation('importSnapshots') } });
        this.officeService = service;
        return service;
      })().catch(error => { this.instances.delete('office'); throw error; });
      this.instances.set('office', pending);
    }
    return this.instances.get('office');
  }
  async validateGrant(grant) {
    if (grant.scope.projectId) {
      const current = await this.project(grant.record, grant.scope.projectId, { includeArchived: grant.component === 'references' });
      if (grant.scope.projectRoot && current.cwd !== grant.scope.projectRoot) throw Object.assign(Error('The document project folder changed'), { status: 409 });
    }
    await authorizeApplicationPath(grant.scope.root);
  }
  async resolveOfficeDocument(body, identity, { signal } = {}) {
    return this.gateway.authorizeOperation(identity.grantId, 'office-document', async ({ grant }) => {
      await this.validateGrant(grant); signal?.throwIfAborted();
      if (!body || Object.keys(body).some(key => !['projectId', 'documentId', 'relativePath', 'create', 'locale'].includes(key)) ||
          [body.documentId, body.relativePath, body.create].filter(Boolean).length !== 1 || (body.projectId ?? null) !== (grant.scope.projectId ?? null)) throw Object.assign(Error('Choose one document in the authorized project'), { status: 400 });
      // Resolve through the existing storage authority before the native-view
      // cache. Repeated opens need no unused tokens or browser bootstrap grants.
      await this.prepareOfficeRuntime(); signal?.throwIfAborted();
      const document = await this.officeProvider.owner.register({ grantId: grant.id, documentId: body.documentId, relativePath: body.relativePath, create: body.create,
        participantId: identity.kind === 'browser' ? 'browser-control:' + identity.backendId + ':' + identity.viewId + ':' + identity.operationId : 'agent:' + identity.backendId + ':' + identity.workerId,
        participantName: identity.kind === 'browser' ? 'Office export' : 'Pi' });
      return { documentId: document.documentId, projectId: grant.scope.projectId, ...(body.locale ? { locale: body.locale } : {}) };
    });
  }
  async openOffice(body, identity, { signal } = {}) {
    return this.gateway.authorizeOperation(identity.grantId, 'office-open', async ({ grant }) => {
      await this.validateGrant(grant); signal?.throwIfAborted();
      if (!body || Object.keys(body).some(key => !['projectId', 'documentId', 'relativePath', 'create', 'locale'].includes(key)) ||
          [body.documentId, body.relativePath, body.create].filter(Boolean).length !== 1 || (body.projectId ?? null) !== (grant.scope.projectId ?? null)) throw Object.assign(Error('Choose one document in the authorized project'), { status: 400 });
      // Verify installed native artifacts before creating a new project file.
      await this.prepareOfficeRuntime(); signal?.throwIfAborted();
      const endpoint = await this.gateway.endpoint();
      const origin = identity.kind === 'browser' ? identity.origin : endpoint.origin;
      const view = await this.gateway.open('files', grant.record, { ...grant.scope, workerId: undefined, id: randomUUID(), identity: 'bk_' + randomUUID().replaceAll('-', ''), openPath: '/' });
      const human = this.gateway.resolve(view.url).grant;
      try {
        const opened = await this.officeProvider.open({ ...body, grantId: grant.id,
          participantId: identity.kind === 'browser' ? 'browser-control:' + identity.backendId + ':' + identity.viewId + ':' + identity.operationId : 'agent:' + identity.backendId + ':' + identity.workerId,
          participantName: identity.kind === 'browser' ? 'Office export' : 'Pi', participantKind: 'agent', origin, editorBaseUrl: origin + '/apps/office', basePath: human.basePath,
          browserView: { grantId: human.id, basePath: human.basePath, origin, editorBaseUrl: origin + '/apps/office', bootstrapQuery: '?launch=' + human.nonce } });
        return { ...opened, projectId: grant.scope.projectId };
      } catch (error) { this.gateway.grants.delete(human.id); throw error; }
    });
  }
  async open(component, input, record) {
    return this.authorize(record, async () => {
      const project = input.projectId ? await this.project(record, input.projectId, { includeArchived: component === 'references' }) : null;
      const root = input.cwd ? (await fileDirectory(input.cwd)).path : project?.cwd || (await fileDirectory()).path;
      await authorizeApplicationPath(root);
      const scope = { id: randomUUID(), projectId: project?.id || null, projectRoot: project?.cwd, root, identity: 'bk_' + randomUUID().replaceAll('-', ''),
        permissions: { view: true, download: true, modify: true, create: true, delete: true }, backendId: await this.identity() };
      if (component === 'files') {
        const module = await this.module('files');
        if (typeof module.prepareFiles !== 'function' || typeof module.handleFiles !== 'function') throw unavailable('Files', 'incompatible native provider API');
        await this.gateway.configure('files', async () => {
          const prepared = await module.prepareFiles({ dataRoot: dataDir, scope, privatePaths: await privateManagerPaths(),
            endpoint: await this.gateway.endpoint(), authorizePath: authorizeApplicationPath });
          if (prepared?.service?.id !== 'quantum') throw unavailable('Files', 'invalid shared Quantum service definition');
          scope.endpoint = await this.ensureRunning(prepared.service, true, prepared.needsRestart === true);
          scope.openPath = '/' + (prepared.openPath || '/').replace(/^\//, '');
        });
      } else if (component === 'references') {
        if (!project) throw Error('Choose a project for References');
        await this.references();
      } else throw Error('Unknown web application');
      return this.gateway.open(component, record, scope);
    });
  }
  async resolve(input, record) {
    return this.authorize(record, async () => {
      const { grant, path: openPath } = this.gateway.resolve(input.url);
      const project = grant.scope.projectId ? await this.project(record, grant.scope.projectId, { includeArchived: grant.component === 'references' }) : null;
      if (project && grant.scope.projectRoot && project.cwd !== grant.scope.projectRoot) throw Object.assign(Error('The application project folder changed'), { status: 409 });
      const root = (await fileDirectory(grant.scope.root)).path;
      if (root !== grant.scope.root) throw Object.assign(Error('The application project folder changed'), { status: 409 });
      await authorizeApplicationPath(root);
      // A newly opened ordinary context receives a fresh one-use bootstrap.
      // Never reuse a local Pi view's authority for a remote human viewer.
      const scope = { ...grant.scope, id: randomUUID(), identity: 'bk_' + randomUUID().replaceAll('-', ''), openPath };
      if (openPath.startsWith('/office/')) {
        await this.office();
        if (typeof this.officeProvider.reopenBrowser !== 'function') throw unavailable('Office', 'the native human-view launch adapter is not connected');
        const descriptor = await this.gateway.open(grant.component, record, { ...scope, openPath: '/' });
        const next = this.gateway.resolve(descriptor.url).grant;
        const view = await this.officeProvider.reopenBrowser(input.url, { grantId: next.id, participantId: 'human:' + record.key + ':' + next.id,
          participantName: 'User', basePath: next.basePath, origin: new URL(descriptor.url).origin, editorBaseUrl: new URL(descriptor.url).origin + '/apps/office' });
        const target = new URL(view.browserUrl);
        if (target.origin !== new URL(descriptor.url).origin || !target.pathname.startsWith(next.basePath)) throw unavailable('Office', 'invalid native browser launch');
        target.searchParams.set('launch', next.nonce);
        return { ...descriptor, url: target.href, openPath: target.pathname + target.search };
      }
      return this.gateway.open(grant.component, record, scope);
    });
  }
  async request(input, record, { signal, workerId, response } = {}) {
    if (!input || !['files', 'references', 'office'].includes(input.component) || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(input.method || 'GET') ||
        typeof input.path !== 'string' || !input.path.startsWith('/') || input.path.startsWith('//') || /[\x00-\x20\x7f\\#]/.test(input.path)) throw Error('Invalid application request');
    return this.authorize(record, async operation => {
      const activeSignal = signal ? AbortSignal.any([signal, operation.signal]) : operation.signal;
      activeSignal.throwIfAborted();
      const url = new URL(input.path, 'http://application.invalid');
      if (['files', 'references'].includes(input.component) && url.pathname === '/open' && input.method === 'POST') return { status: 200, body: await this.open(input.component, input.body || {}, record) };
      if (input.component === 'references') {
        if (url.pathname === '/resolve') {
          if (input.method !== 'POST') throw Object.assign(Error('Method not allowed'), { status: 405 });
          return this.resolveReferences(input.body, record, { signal: activeSignal });
        }
        const lifecycle = /^\/projects\/([a-f0-9-]{36})\/(archive|relink|library)$/.exec(url.pathname);
        if (lifecycle && ['POST', 'DELETE'].includes(input.method)) return this.projectLifecycle(lifecycle[1], lifecycle[2], input.method, input.body || {}, record, { signal: activeSignal, response });
        const projectRoute = /^\/projects(?:\/([a-f0-9-]{36}))?$/.exec(url.pathname);
        if (projectRoute) {
          const id = projectRoute[1], method = input.method || 'GET';
          if (!id && method === 'GET') return { status: 200, body: (await projects({ includeArchived: url.searchParams.get('includeArchived') === 'true' })).projects.map(({ id, name, cwd, archived }) => ({ id, name, cwd, archived: Boolean(archived) })) };
          if (!id && method === 'POST') {
            const folder = (await fileDirectory(input.body?.cwd)).path;
            await authorizeApplicationPath(folder);
            return { status: 201, body: await createProject({ ...input.body, cwd: folder }) };
          }
          if (id) {
            const project = await this.project(record, id, { includeArchived: true });
            if (method === 'GET') return { status: 200, body: { id, name: project.name, cwd: project.cwd } };
            if (method === 'PATCH') return { status: 200, body: await renameProject(id, input.body?.name) };
            if (method === 'DELETE') return withProjectTransition(id, async () => { await this.revokeProject(id, { response }); return { status: 200, body: await removeProject(id) }; });
          }
          throw Object.assign(Error('Method not allowed'), { status: 405 });
        }
        const projectId = /^\/projects\/([^/]+)/.exec(url.pathname)?.[1];
        if (projectId) await this.project(record, projectId, { includeArchived: true });
        const result = await (await this.references()).handle({ method: input.method || 'GET', path: url.pathname, query: url.searchParams,
          body: input.body, headers: {}, signal: activeSignal, authority: record });
        if (result.filePath && workerId && projectId && (input.method || 'GET') === 'GET') {
          // Pi runs on the owning backend and can use the authorized file path.
          // Its optional ordinary browser view uses the same scoped gateway and
          // native service mapping as the References manager, including PDFs.
          const descriptor = await this.open('references', { projectId }, record), target = new URL(descriptor.url);
          target.pathname += 'api' + url.pathname;
          for (const [key, value] of url.searchParams) if (key !== 'launch') target.searchParams.append(key, value);
          result.body = { filePath: result.filePath, url: target.href };
        }
        return result;
      }
      if (input.component === 'office') {
        if (!workerId) throw Object.assign(Error('Office operations require an owned Pi session'), { status: 403 });
        await this.resolveSession(workerId);
        const projectRequest = ['/sessions', '/snapshots/diff'].includes(url.pathname);
        const projectId = projectRequest ? input.body?.projectId : null;
        const project = projectId ? await this.project(record, projectId) : null;
        if (projectRequest && !project) throw Object.assign(Error('Choose the document project'), { status: 400 });
        let grant, createdGrant = false;
        if (project) {
          await authorizeApplicationPath(project.cwd);
          const scope = { id: randomUUID(), root: project.cwd, projectRoot: project.cwd, projectId: project.id,
            workerId: url.pathname === '/snapshots/diff' ? undefined : workerId,
            identity: 'bk_' + randomUUID().replaceAll('-', ''), permissions: { view: true, download: true, modify: true, create: true, delete: true }, backendId: await this.identity() };
          grant = this.gateway.grant(record, scope); createdGrant = grant.scope === scope;
        }
        // Commands keep the session's original captured grant. They must not
        // mint a new folder authority on every edit or follow a regrouped chat.
        try {
          return { status: 200, body: await (await this.office()).dispatch({ method: input.method || 'GET', path: url.pathname, body: input.body,
            identity: { backendId: await this.identity(), workerId, sessionId: workerId, grantId: grant?.id, projectId: project?.id }, signal: activeSignal }) };
        } catch (error) { if (createdGrant) this.gateway.grants.delete(grant.id); throw error; }
        finally { if (grant && url.pathname === '/snapshots/diff') this.gateway.grants.delete(grant.id); }
      }
      throw Object.assign(Error('Application route not found'), { status: 404 });
    }, { watch: abort => { signal?.addEventListener('abort', abort, { once: true }); return () => signal?.removeEventListener('abort', abort); } });
  }
  async resolveReferences(input, record, { signal } = {}) {
    if (!input || Object.keys(input).some(key => !['projectId', 'requestId'].includes(key)) || typeof input.requestId !== 'string' || !input.requestId || input.requestId.length > 128) throw Object.assign(Error('Choose a pending resolver request'), { status: 400 });
    await this.project(record, input.projectId);
    const pending = await (await this.references()).handle({ method: 'POST', path: `/projects/${input.projectId}/connector/getResolverRequest`,
      query: new URLSearchParams(), body: { requestId: input.requestId }, headers: {}, authority: record, signal });
    if (pending.status !== 200 || pending.body?.status === 'complete') return pending;
    if (pending.body?.status !== 'challenge-required') throw Object.assign(Error('This resolver request does not need a browser'), { status: 409 });
    return { status: 200, body: await dispatchReferenceResolver(record, input, { signal }) };
  }
  async connector(input, record, { signal } = {}) {
    const backendId = await this.identity();
    // backendId here is the native host's pinned connection handle (local,
    // remote or machine), not the durable References library identity. The
    // authenticated HTTP session determines the actual owning backend.
    if (input.operation === 'context') {
      return this.authorize(record, async () => ({ backendId, projects: (await projects()).projects.map(({ id, name }) => ({ id, name })) }));
    }
    if (input.operation !== 'request' || !connectorMethods.has(input.method)) throw Error('Unsupported References capture method');
    await this.project(record, input.projectId);
    const headers = {};
    for (const [name, value] of Object.entries(input.headers || {})) {
      if (!requestHeaders.has(name.toLowerCase()) || typeof value !== 'string' || /[\r\n]/.test(value)) throw Error('Invalid References capture header');
      headers[name.toLowerCase()] = value;
    }
    let body = input.data;
    if (input.bodyEncoding === 'base64') {
      if (typeof body !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body)) throw Error('Invalid attachment encoding');
      body = Buffer.from(body, 'base64');
    } else if (input.bodyEncoding === 'json' && typeof body === 'string') body = JSON.parse(body);
    else if (input.bodyEncoding && !['json', 'text'].includes(input.bodyEncoding)) throw Error('Unsupported capture encoding');
    return this.authorize(record, async operation => (await this.references()).handle({ method: 'POST',
      path: `/projects/${input.projectId}/connector/${input.method}`, query: new URLSearchParams(input.queryString || ''), headers, body, authority: record,
      signal: signal ? AbortSignal.any([signal, operation.signal]) : operation.signal }));
  }
  async webRequest(component, req, res, context) {
    if (component === 'office') return this.officeProvider.handleEditor(req, res, context);
    if (component === 'files' && context.url.pathname.slice(context.basePath.length).startsWith('office/')) {
      await this.office();
      return this.officeProvider.handle(req, res, { grantId: context.grant.id, basePath: context.basePath, origin: context.origin, signal: context.signal });
    }
    if (component === 'files') return (await this.module('files')).handleFiles(req, res, { ...context, dataRoot: dataDir,
      scope: context.grant.scope, endpoint: context.grant.scope.endpoint, authorizePath: authorizeApplicationPath,
      openOffice: async value => {
        await this.office();
        return this.officeProvider.open({ ...value, grantId: context.grant.id, participantId: 'human:' + context.grant.id,
          participantName: 'User', participantKind: 'human', basePath: context.basePath, origin: context.origin, editorBaseUrl: context.origin + '/apps/office' });
      } });
    const route = context.url.pathname.slice(context.basePath.length);
    if (route === 'api/context') {
      if (req.method !== 'GET') throw Object.assign(Error('Method not allowed'), { status: 405 });
      return json(res, { backendId: await this.identity(), projectId: context.grant.scope.projectId, projects: (await projects()).projects.map(({ id, name }) => ({ id, name })) });
    }
    if (route.startsWith('api/')) {
      let result;
      try {
        result = await this.request({ component: 'references', method: req.method, path: '/' + route.slice(4) + context.url.search,
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : await applicationBody(req) }, context.grant.record, { signal: context.signal, response: res });
      } catch (error) {
        if (!context.grant.revoked) throw error;
        result = { status: error.status || 400, body: { error: error.message, code: error.code } };
      }
      if (context.grant.revoked && /^api\/projects\/[a-f0-9-]{36}\/(?:archive|relink|library)$/.test(route)) {
        // The old captured root is revoked, but the explicit lifecycle result
        // must remain readable. Renew the manager under the same authority;
        // the web UI keeps its current exact HTTPS forwarding origin.
        try {
          const descriptor = route.endsWith('/library') && result.status < 300
            ? await this.gateway.open('references', context.grant.record, { ...context.grant.scope, id: randomUUID(), identity: 'bk_' + randomUUID().replaceAll('-', ''), projectId: null, projectRoot: undefined, workerId: undefined, openPath: '/' })
            : await this.open('references', { projectId: context.grant.scope.projectId }, context.grant.record);
          result.body = { ...result.body, reopen: { component: descriptor.component, serviceId: descriptor.serviceId, openPath: descriptor.openPath } };
        } catch (error) { result.body = { ...result.body, reopenError: error.message }; }
      }
      return this.sendResult(req, res, result);
    }
    if (!['GET', 'HEAD'].includes(req.method)) throw Object.assign(Error('Method not allowed'), { status: 405 });
    const root = fileURLToPath(referencesWebRoot);
    const filename = path.resolve(root, route || 'index.html');
    if (!filename.startsWith(root) || !['.html', '.js', '.mjs', '.css', '.svg', '.png', '.ico'].includes(path.extname(filename))) throw Object.assign(Error('Not found'), { status: 404 });
    const bytes = await fs.readFile(filename);
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }[path.extname(filename)];
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': bytes.length, 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  }
  async sendResult(req, res, result, authority) {
    if (result.filePath) {
      const send = async () => { await authorizeApplicationPath(result.filePath); return sendFile(req, res, result.filePath, false); };
      return authority ? this.authorize(authority, send, { cancel: () => { req.destroy(); res.destroy(); },
        watch: abort => { res.once('close', abort); return () => res.off('close', abort); } }) : send();
    }
    res.writeHead(result.status || 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...result.headers });
    res.end(JSON.stringify(result.body ?? null));
  }
  async upgrade(component, req, socket, head, context) {
    if (component === 'office') return this.officeProvider.upgradeEditor(req, socket, head, context);
    const module = await this.module(component);
    if (typeof module.upgradeFiles !== 'function') throw unavailable('Files', 'this component does not expose a native socket adapter');
    return module.upgradeFiles(req, socket, head, { ...context, scope: context.grant.scope, endpoint: context.grant.scope.endpoint });
  }
  async revokeRemote() {
    for (const grant of this.gateway.grants.values()) if (!grant.record.local) this.officeService?.revoke({ grantId: grant.id });
    await this.gateway.revokeRemote();
  }
  async revokeProject(projectId, options) {
    await this.gateway.revokeWhere(grant => {
      if (grant.scope.projectId !== projectId) return false;
      this.officeService?.revoke({ grantId: grant.id }); return true;
    }, options);
  }
  async close() {
    this.closed = true;
    await this.gateway.close();
    await Promise.allSettled([...this.instances.values()].map(async instance => (await instance).close?.()));
    await this.officeProvider?.close?.();
  }
}
