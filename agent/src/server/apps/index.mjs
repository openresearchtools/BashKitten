// SPDX-License-Identifier: AGPL-3.0-only
// Backend app boundary. Native components retain their APIs and process owners;
// this module resolves existing project/session authority. Files is prepared at
// backend startup; Office and References retain their on-demand owners.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { dataDir, readJson, json, body as readBody } from '../common.mjs';
import { paths } from '../access/paths.mjs';
import { controlRequest } from '../control.mjs';
import { dispatchReferenceResolver } from '../access/browser-channel.mjs';
import { publishNewFile } from '../localai/files.mjs';
import { projects, withProjectOperation, withProjectTransition } from '../projects.mjs';
import { referenceProjects, referenceProject, createReferenceProject, renameReferenceProject, archiveReferenceProject, deleteReferenceProject } from './reference-projects.mjs';
import { containsPath, fileDirectory, filePath, relativePath, referencedFile, referencedPath, storedAttachment, sendFile, sendFileHandle } from '../files/files.mjs';
import { authorizeApplicationPath, canonicalManagerPath, privateManagerPaths, managerAllowed, runManagerOperation } from '../files/access.mjs';
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
    return { ...project, cwd, runAuthorized: (work, { write = true } = {}) => withProjectOperation(id, projectSignal => this.authorize(record, async operation => {
      const current = (await projects({ includeArchived })).projects.find(item => item.id === id);
      if (!current || current.cwd !== project.cwd) throw Object.assign(Error('The project changed during this operation'), { status: 409 });
      if (current.archived && write !== false) throw Object.assign(Error('Unarchive this library before changing it'), { status: 409 });
      const signal = AbortSignal.any([projectSignal, operation.signal]); signal.throwIfAborted();
      return work(signal);
    })) };
  }
  async referenceProject(record, id, { transition = false } = {}) {
    if (!await this.auth.valid(record) || !await managerAllowed(record)) throw Object.assign(Error('This References project is not authorized'), { status: 403 });
    const project = await referenceProject(id);
    const authorized = (work, { write = true } = {}) => this.authorize(record, async operation => {
      const current = await referenceProject(id);
      if (current.archived && write !== false && !transition) throw Object.assign(Error('Unarchive this References project before changing it'), { status: 409 });
      operation.signal.throwIfAborted();
      return work(operation.signal);
    });
    return { ...project, bibliographyPath: project.initialBibliographyPath,
      authorizePath: filename => this.authorize(record, () => this.referencePath(filename)),
      runAuthorized: transition ? authorized : (work, options) => withProjectOperation('references:' + id,
        projectSignal => authorized(signal => work(AbortSignal.any([projectSignal, signal])), options)) };
  }
  async referencePath(filename) {
    if (typeof filename !== 'string' || !path.isAbsolute(filename) || filename.includes('\0')) throw Object.assign(Error('Choose an absolute Bibliography folder'), { status: 400 });
    // Creation may name a new folder. Its nearest existing parent must still
    // belong to the existing owner's available files; no arbitrary-path grant.
    let parent = filename;
    for (;;) {
      const stat = await fs.stat(parent).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
      if (stat) { if (!stat.isDirectory()) parent = path.dirname(parent); break; }
      const next = path.dirname(parent);
      if (next === parent) throw Object.assign(Error('The Bibliography folder is unavailable'), { status: 400 });
      parent = next;
    }
    const directory = await fileDirectory(parent);
    await authorizeApplicationPath(filename);
    return path.resolve(directory.path, path.relative(parent, filename));
  }
  async referenceCatalogue(record, { includeArchived = false, selectedProjectId } = {}) {
    if (!await this.auth.valid(record) || !await managerAllowed(record)) throw Object.assign(Error('References access is not authorized'), { status: 403 });
    const catalogue = await referenceProjects({ includeArchived });
    const selected = catalogue.projects.find(project => project.id === selectedProjectId) ||
      catalogue.projects.find(project => project.id === catalogue.defaultProjectId) || catalogue.projects[0];
    const entries = catalogue.projects.map(project => {
      const { initialBibliographyPath, ...item } = project;
      return item;
    });
    return { ...catalogue, projects: entries, projectId: selected?.id || null,
      referenceProjectId: selected?.id || null };
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
        return module.createReferencesService({ dataDir, backendId: await this.identity(), authorizeProject: (authority, id) => this.referenceProject(authority, id),
          authorizeLibraryLifecycle: (authority, id, options) => this.libraryAuthority(authority, id, options),
          resolveInBrowser: ({ authority, projectId, requestId, signal }) => this.authorize(authority, async operation => {
            await this.referenceProject(authority, projectId);
            const activeSignal = signal ? AbortSignal.any([signal, operation.signal]) : operation.signal;
            activeSignal.throwIfAborted();
            return dispatchReferenceResolver(authority, { projectId, requestId }, { signal: activeSignal });
          }),
          listProjects: async authority => (await this.referenceCatalogue(authority)).projects });
      })().catch(error => { this.instances.delete('references'); throw error; });
      this.instances.set('references', pending);
    }
    return this.instances.get('references');
  }
  async lifecycle(component, action) {
    if (component === 'files' && action === 'start') {
      if (!this.filesStarting) this.filesStarting = (async () => {
        const settings = await readJson(path.join(dataDir, 'settings.json'), {});
        const directory = await fileDirectory(settings.default_cwd || os.homedir());
        await authorizeApplicationPath(directory.path);
        // No browser account/grant is issued by startup. Native sources retain
        // deny-all defaults until an authenticated Files operation supplies scope.
        await this.prepareFilesScope({ id: 'backend-startup', identity: 'backend-startup', root: directory.path, permissions: {} });
        return { running: true };
      })().catch(error => { this.filesStarting = undefined; throw error; });
      return this.filesStarting;
    }
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
    const project = await this.referenceProject(record, id, { transition: true });
    if (options.bibliographyPath) await this.referencePath(options.bibliographyPath);
    return { ...project, withAttachmentMove: async (input, perform) => {
      await this.office(); // Construct the existing document owner; no renderer startup.
      return this.officeProvider.withAttachmentMove(input, perform);
    } };
  }
  async projectLifecycle(id, action, method, input, record, { signal, response } = {}) {
    if ((action === 'library' && method !== 'DELETE') || (action !== 'library' && method !== 'POST')) throw Object.assign(Error('Method not allowed'), { status: 405 });
    const allowed = { archive: ['archived'], relink: ['bibliographyPath', 'expectedBibliographyPath'], library: ['confirmProjectId', 'attachments'] }[action];
    if (!allowed || Object.keys(input).some(key => !allowed.includes(key))) throw Object.assign(Error('Invalid References project operation'), { status: 400 });
    await this.referenceProject(record, id);
    return withProjectTransition('references:' + id, async () => {
      signal?.throwIfAborted();
      await this.libraryAuthority(record, id);
      if (action === 'archive') {
        if (typeof input.archived !== 'boolean') throw Error('Choose whether to archive this project');
        return { status: 200, body: { project: await archiveReferenceProject(id, input.archived) } };
      }
      const references = await this.references();
      if (action === 'relink') {
        const bibliographyPath = await this.referencePath(input.bibliographyPath);
        if (typeof input.expectedBibliographyPath !== 'string') throw Object.assign(Error('Reload the current Bibliography folder before moving it'), { status: 409 });
        return { status: 200, body: await references.moveBibliography({ projectId: id, bibliographyPath,
          expectedBibliographyPath: input.expectedBibliographyPath, authority: record, signal }) };
      }
      if (input.confirmProjectId !== id || !['keep', 'delete'].includes(input.attachments)) throw Object.assign(Error('Confirm this exact project and choose whether to keep its attachments'), { status: 400 });
      const deleted = await references.deleteLibrary({ projectId: id, ...input, authority: record, signal });
      await deleteReferenceProject(id);
      return { status: 200, body: deleted };
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
          authorizePath: (filename, options) => this.authorizeScopedPath(options?.scope, filename, options), publishNewFile,
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
            // The gateway just revalidated this authority with the native local
            // owner or Authelia. Cookies/grants rotate; a user preference does
            // not. Keep local and remote usernames in separate namespaces.
            const record = context.grant.record;
            const officeSettingsIdentity = JSON.stringify(record.local === true ? ['local'] : ['remote', record.username]);
            return work({ ...context.grant.scope, officeSettingsIdentity }, context.signal);
          }),
          hasNativeViews: documentId => service?.hasDocumentViews(documentId) === true,
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
            // File ownership is independent of the one library stored in the
            // native document. This is only a default-selection hint.
            const context = await this.referenceCatalogue(grant.record);
            return { projectId: context.projectId, referenceProjectId: context.referenceProjectId, defaultProjectId: context.defaultProjectId };
          }),
          referenceRequest: ({ grantId, method, path: requestPath, body, signal: callerSignal }) => this.gateway.authorizeOperation(grantId, 'references-request', async ({ grant, signal }) => {
            await this.validateGrant(grant);
            const uri = new URL(requestPath, 'https://references.invalid');
            const catalogue = method === 'GET' && uri.pathname === '/api/references/projects';
            const projectId = /^\/api\/references\/projects\/([^/]+)(?:\/|$)/.exec(uri.pathname)?.[1];
            if (!catalogue) {
              if (!projectId) throw Object.assign(Error('Choose one registered References library'), { status: 403 });
              await this.referenceProject(grant.record, projectId);
            }
            return this.request({ component: 'references', method, path: requestPath.slice('/api/references'.length), body }, grant.record,
              { signal: callerSignal ? AbortSignal.any([callerSignal, signal]) : signal });
          }) });
        this.officeProvider = provider;
        const referenceOperation = name => (value, { identity, projectId, signal } = {}) => this.gateway.authorizeOperation(identity?.grantId, 'references-' + name, async context => {
          await this.validateGrant(context.grant);
          if (typeof projectId !== 'string' || !projectId) throw Object.assign(Error('The native document must choose one References library'), { status: 400 });
          const selected = await this.referenceProject(context.grant.record, projectId);
          const references = await this.references();
          if (typeof references[name] !== 'function') throw unavailable('References', 'the native citation operation is unavailable');
          return references[name](value, { authority: context.grant.record, projectId: selected.id, signal: signal ? AbortSignal.any([signal, context.signal]) : context.signal });
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
          history: (body, identity, { signal } = {}) => this.gateway.authorizeOperation(identity.grantId, 'office-history', async context => {
            await this.validateGrant(context.grant);
            if (body.projectId !== context.grant.scope.projectId) throw Object.assign(Error('History belongs to another project'), { status: 403 });
            const endpoint = body.operation === 'restore' ? await this.gateway.endpoint() : null;
            return provider.history({ grantId: identity.grantId, documentId: body.documentId,
              participantId: 'agent:' + identity.backendId + ':' + identity.workerId, participantName: 'Pi',
              ...(endpoint ? { origin: endpoint.origin, editorBaseUrl: endpoint.origin + '/apps/office' } : {}) }, body,
              { signal: signal ? AbortSignal.any([signal, context.signal]) : context.signal });
          }),
          authorizeSnapshot: async ({ documentId, versionId }, identity, { signal } = {}) => {
            const participantId = 'agent:' + identity.backendId + ':' + identity.workerId;
            await provider.owner.register({ grantId: identity.grantId, documentId, participantId, participantName: 'Pi', historyOnly: true });
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
    if (grant.component === 'references') {
      // The tab can select any database authorized by this backend session.
      // Its initial selection is a navigation hint; each data route authorizes
      // its explicit reference ID independently.
      return;
    }
    if (grant.scope.projectId) {
      const current = await this.project(grant.record, grant.scope.projectId);
      if (grant.scope.projectRoot && current.cwd !== grant.scope.projectRoot) throw Object.assign(Error('The document project folder changed'), { status: 409 });
    }
    if (grant.scope.attachment) await this.authorizeScopedPath(grant.scope, grant.scope.attachment.filename);
    else await authorizeApplicationPath(grant.scope.root);
  }
  async authorizeScopedPath(scope, filename, options = {}) {
    if (!scope?.attachment) return authorizeApplicationPath(filename, options);
    const selection = scope.attachment, session = await this.resolveSession(selection.sessionId);
    const current = await storedAttachment(session.attachments, selection.recordPath);
    const canonical = canonicalManagerPath(await fs.realpath(filename));
    if (current.filename !== selection.filename || current.root !== scope.root || canonical !== current.filename) {
      throw Object.assign(Error('This application can access only its stored chat attachment'), { status: 403 });
    }
    return true; // Exact attachment membership; never a general private-path exemption.
  }
  async resolveOfficeDocument(body, identity, { signal } = {}) {
    return this.gateway.authorizeOperation(identity.grantId, 'office-document', async ({ grant }) => {
      await this.validateGrant(grant); signal?.throwIfAborted();
      if (!body || Object.keys(body).some(key => !['projectId', 'documentId', 'relativePath', 'create', 'locale', 'snapshot'].includes(key)) ||
          [body.documentId, body.relativePath, body.create].filter(Boolean).length !== 1 || (body.snapshot !== undefined && (!body.documentId || !/^[a-f0-9-]{36}$/.test(body.snapshot))) || (body.projectId ?? null) !== (grant.scope.projectId ?? null)) throw Object.assign(Error('Choose one document in the authorized project'), { status: 400 });
      // Resolve through the existing storage authority before the native-view
      // cache. Repeated opens need no unused tokens or browser bootstrap grants.
      await this.prepareOfficeRuntime(); signal?.throwIfAborted();
      const document = await this.officeProvider.owner.register({ grantId: grant.id, documentId: body.documentId, relativePath: body.relativePath, create: body.create, snapshot: body.snapshot,
        participantId: identity.kind === 'browser' ? 'browser-control:' + identity.backendId + ':' + identity.viewId + ':' + identity.operationId : 'agent:' + identity.backendId + ':' + identity.workerId,
        participantName: identity.kind === 'browser' ? 'Office export' : 'Pi' });
      if (body.snapshot) await this.officeProvider.owner.metadata({ env: await this.identity(), grant: grant.id, fid: document.documentId, participant: identity.kind === 'browser' ? 'browser-control:' + identity.backendId + ':' + identity.viewId + ':' + identity.operationId : 'agent:' + identity.backendId + ':' + identity.workerId, snapshot: body.snapshot });
      return { documentId: document.documentId, projectId: grant.scope.projectId, ...(body.snapshot ? { snapshot: body.snapshot } : {}), ...(body.locale ? { locale: body.locale } : {}) };
    });
  }
  async openOffice(body, identity, { signal } = {}) {
    return this.gateway.authorizeOperation(identity.grantId, 'office-open', async ({ grant }) => {
      await this.validateGrant(grant); signal?.throwIfAborted();
      if (!body || Object.keys(body).some(key => !['projectId', 'documentId', 'relativePath', 'create', 'locale', 'snapshot'].includes(key)) ||
          [body.documentId, body.relativePath, body.create].filter(Boolean).length !== 1 || (body.snapshot !== undefined && (!body.documentId || !/^[a-f0-9-]{36}$/.test(body.snapshot))) || (body.projectId ?? null) !== (grant.scope.projectId ?? null)) throw Object.assign(Error('Choose one document in the authorized project'), { status: 400 });
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
  async prepareFilesScope(scope) {
    const module = await this.module('files');
    if (typeof module.prepareFiles !== 'function' || typeof module.handleFiles !== 'function') throw unavailable('Files', 'incompatible native provider API');
    await this.gateway.configure('files', async prepared => {
      if (prepared?.service?.id !== 'quantum') throw unavailable('Files', 'invalid shared Quantum service definition');
      scope.endpoint = await this.ensureRunning(prepared.service, true, this.filesRevision !== prepared.configRevision);
      this.filesRevision = prepared.configRevision;
      scope.source = prepared.source;
      scope.openPath ||= '/' + (prepared.openPath || '/').replace(/^\//, '');
    }, { prepare: async () => module.prepareFiles({ dataRoot: dataDir, scope, privatePaths: await privateManagerPaths(),
      endpoint: await this.gateway.endpoint(), authorizePath: authorizeApplicationPath }),
      // Compare with the last successful owner reconciliation, not just the
      // saved file: a failed cold start/reload must remain safely retryable.
      needsDrain: prepared => this.filesRevision !== prepared?.configRevision });
    return module;
  }
  async resumeFilesScope(scope) {
    const catalogue = await controlRequest('service-status', {});
    const current = catalogue.services?.find(service => service.id === 'quantum' && service.application === 'quantum');
    if (!current) throw unavailable('Files', 'the owning native service is unavailable');
    // Use the owner's current definition, which may include another source's
    // configuration revision. Never restore a stale per-view launch command.
    scope.endpoint = await this.ensureRunning(current);
  }
  async filesSidecar(root, record) {
    if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0')) throw Object.assign(Error('Choose an owning Files folder'), { status: 400 });
    const directory = await fileDirectory(root);
    await authorizeApplicationPath(directory.path);
    const grant = this.gateway.grant(record, { id: randomUUID(), purpose: 'files-sidecar', projectId: null,
      root: directory.path, identity: 'bk_' + randomUUID().replaceAll('-', ''),
      permissions: { view: true, download: true, modify: true, create: true, delete: true }, backendId: await this.identity() });
    grant.component = 'files'; grant.basePath = `/apps/files/${grant.id}/`;
    const cached = Boolean(grant.filesPreparing);
    if (!grant.filesPreparing) grant.filesPreparing = this.prepareFilesScope(grant.scope).catch(error => {
      delete grant.filesPreparing; throw error;
    });
    await grant.filesPreparing;
    if (cached) {
      if (!grant.filesResuming) grant.filesResuming = this.resumeFilesScope(grant.scope).finally(() => { delete grant.filesResuming; });
      await grant.filesResuming;
    }
    return { grant, directory };
  }
  async filesTree(input, record, { signal } = {}) {
    return this.authorize(record, async () => {
      const relative = relativePath(input.path || ''), { grant, directory } = await this.filesSidecar(input.root, record);
      return this.gateway.authorizeOperation(grant.id, 'files-list', context => this.gateway.componentOperation('files', async () => {
        const activeSignal = signal ? AbortSignal.any([signal, context.signal]) : context.signal;
        const module = await this.module('files');
        if (typeof module.listFiles !== 'function') throw unavailable('Files', 'the native list adapter is unavailable');
        const info = await module.listFiles({ dataRoot: dataDir, scope: grant.scope, relative, signal: activeSignal,
          authorizePath: (filename, options) => this.authorizeScopedPath(grant.scope, filename, options) });
        const currentPath = path.join(directory.path, relative), entries = [
          ...(info.folders || []).map(name => ({ name, type: 'directory' })),
          ...(info.files || []).map(name => ({ name, type: 'file' }))].map(entry => {
          const name = String(entry.name || ''), blocked = !name || name === '.' || name === '..' || /[\\/\x00-\x1f\x7f]/.test(name);
          return { name, path: relative ? relative.split(path.sep).join('/') + '/' + name : name,
            directory: entry.type === 'directory', blocked, size: entry.size, type: entry.type };
        });
        return { root: directory.path, currentPath, parent: relative ? path.dirname(currentPath) : directory.parent,
          scopeRoot: directory.scopeRoot, source: grant.scope.source, entries, permissions: grant.scope.permissions };
      }));
    });
  }
  async filesNative(req, res, tail, input, record) {
    const allowed = tail === 'resources' ? ['POST', 'PATCH', 'DELETE']
      : tail === 'resources/download' ? ['GET', 'HEAD'] : tail === 'resources/bulk' ? ['DELETE'] : [];
    if (!allowed.includes(req.method)) throw Object.assign(Error('Unsupported native Files action'), { status: 405 });
    return this.authorize(record, async () => {
      const { grant } = await this.filesSidecar(input.root, record);
      return this.gateway.authorizeOperation(grant.id, 'files-native', context => this.gateway.componentOperation('files', async () => {
        const original = req.url, target = new URL(original, 'https://files.invalid');
        target.searchParams.delete('root');
        if (target.searchParams.has('source') && target.searchParams.get('source') !== grant.scope.source) throw Object.assign(Error('Files source is outside this folder'), { status: 403 });
        target.searchParams.set('source', grant.scope.source);
        req.url = grant.basePath + 'api/' + tail + target.search;
        try { return await this.webRequest('files', req, res, { grant, basePath: grant.basePath,
          url: new URL(req.url, 'https://files.invalid'), origin: this.gateway.origin, signal: context.signal }); }
        finally { req.url = original; }
      }, () => { req.destroy(); res.destroy(); }), { response: res,
        cancel: () => { req.destroy(); res.destroy(); },
        watch: abort => {
          const closed = () => { if (!res.writableFinished) abort(); };
          res.once('close', closed); return () => res.off('close', closed);
        } });
    });
  }
  async open(component, input, record) {
    return this.authorize(record, async () => {
      if (component === 'references') {
        const catalogue = await this.referenceCatalogue(record, { includeArchived: Boolean(input.projectId), selectedProjectId: input.projectId });
        if (input.projectId) await this.referenceProject(record, input.projectId);
        await this.references();
        return this.gateway.open(component, record, { id: randomUUID(), referenceProjectId: input.projectId || catalogue.projectId,
          identity: 'bk_' + randomUUID().replaceAll('-', ''), backendId: await this.identity(), openPath: '/' });
      }
      let selected;
      if (input.file !== undefined) {
        const file = input.file;
        if (component !== 'files' || input.cwd || input.projectId || !file || Object.keys(file).some(key => !['sessionId', 'root', 'path'].includes(key))
            || Boolean(file.sessionId) === Boolean(file.root) || (file.sessionId && !/^[a-f0-9-]{36}$/.test(file.sessionId)) || typeof file.path !== 'string') {
          throw Object.assign(Error('Choose one file from this chat'), { status: 400 });
        }
        if (file.root) {
          const root = (await fileDirectory(file.root)).path, filename = await filePath(root, relativePath(file.path, false));
          if (!containsPath(root, filename) || !(await fs.stat(filename)).isFile()) throw Object.assign(Error('Choose a file in this folder'), { status: 403 });
          selected = { root, path: path.relative(root, filename) };
        } else {
          const session = await this.resolveSession(file.sessionId);
          // Stored cards carry literal paths, including names such as %20.docx;
          // Markdown/file URLs retain the existing URI decoding rules.
          const literal = (session.attachments || []).find(item => typeof item?.path === 'string'
            && canonicalManagerPath(item.path) === canonicalManagerPath(file.path));
          const absolute = literal?.path || referencedPath(session.cwd, file.path);
          const attachment = (session.attachments || []).some(item => typeof item?.path === 'string'
            && canonicalManagerPath(item.path) === canonicalManagerPath(absolute))
            ? await storedAttachment(session.attachments, absolute) : null;
          selected = attachment ? { ...attachment, attachment: { ...attachment, sessionId: file.sessionId } }
            : await referencedFile(session.cwd, file.path);
        }
      }
      const project = input.projectId ? await this.project(record, input.projectId) : null;
      const root = selected?.root || (input.cwd ? (await fileDirectory(input.cwd)).path : project?.cwd || (await fileDirectory()).path);
      if (!selected?.attachment) {
        await authorizeApplicationPath(root);
        if (selected) await authorizeApplicationPath(path.join(root, selected.path));
      }
      const scope = { id: randomUUID(), projectId: project?.id || null, projectRoot: project?.cwd, root, identity: 'bk_' + randomUUID().replaceAll('-', ''),
        ...(selected?.attachment ? { attachment: selected.attachment } : {}),
        permissions: { view: true, download: true, modify: true, create: !selected?.attachment, delete: !selected?.attachment }, backendId: await this.identity() };
      if (component === 'files') {
        const module = await this.module('files');
        if (typeof module.filesLocation !== 'function') throw unavailable('Files', 'incompatible native launch API');
        const location = module.filesLocation(scope);
        scope.source = location.source;
        const selectedPath = selected && !selected.attachment ? selected.path.split(path.sep).map(encodeURIComponent).join('/') : '';
        scope.openPath = '/' + location.openPath + selectedPath;
        // Return the ordinary tab launch without waiting for a cold process or
        // source reload. Its authenticated requests observe the same preparation
        // promise; no second process/queue or alternate file handler is created.
        scope.filesPreparing = this.prepareFilesScope(scope);
        void scope.filesPreparing.catch(() => {}); // The opened tab reports failure.
      } else throw Error('Unknown web application');
      return this.gateway.open(component, record, scope);
    });
  }
  async resolve(input, record) {
    return this.authorize(record, async () => {
      let address = input.url;
      if (typeof address === 'string' && address.startsWith('/')) {
        // Native clients remove only their verified Files mapping's origin.
        // Resolve the scoped path at this owner; the gateway still checks its
        // exact origin and the original grant/project authority below.
        if (!/^\/apps\/(files|references)\/[a-f0-9-]{36}\//.test(address) || /[\x00-\x20\x7f\\#]/.test(address)) {
          throw Object.assign(Error('Invalid application URL'), { status: 400 });
        }
        address = (await this.gateway.endpoint()).origin + address;
      }
      const { grant, path: openPath } = this.gateway.resolve(address);
      if (grant.component === 'references') {
        return this.gateway.open('references', record, { ...grant.scope, id: randomUUID(), identity: 'bk_' + randomUUID().replaceAll('-', ''), openPath });
      }
      const project = grant.scope.projectId ? await this.project(record, grant.scope.projectId) : null;
      if (project && grant.scope.projectRoot && project.cwd !== grant.scope.projectRoot) throw Object.assign(Error('The application project folder changed'), { status: 409 });
      const root = grant.scope.attachment ? grant.scope.root : (await fileDirectory(grant.scope.root)).path;
      if (root !== grant.scope.root) throw Object.assign(Error('The application project folder changed'), { status: 409 });
      if (grant.scope.attachment) await this.authorizeScopedPath(grant.scope, grant.scope.attachment.filename);
      else await authorizeApplicationPath(root);
      // A newly opened ordinary context receives a fresh one-use bootstrap.
      // Never reuse a local Pi view's authority for a remote human viewer.
      const scope = { ...grant.scope, id: randomUUID(), identity: 'bk_' + randomUUID().replaceAll('-', ''), openPath };
      if (openPath.startsWith('/office/')) {
        await this.office();
        if (typeof this.officeProvider.reopenBrowser !== 'function') throw unavailable('Office', 'the native human-view launch adapter is not connected');
        const descriptor = await this.gateway.open(grant.component, record, { ...scope, openPath: '/' });
        const next = this.gateway.resolve(descriptor.url).grant;
        const view = await this.officeProvider.reopenBrowser(address, { grantId: next.id, participantId: 'human:' + record.key + ':' + next.id,
          participantName: 'User', basePath: next.basePath, origin: new URL(descriptor.url).origin, editorBaseUrl: new URL(descriptor.url).origin + '/apps/office' });
        const target = new URL(view.browserUrl);
        if (target.origin !== new URL(descriptor.url).origin || !target.pathname.startsWith(next.basePath)) throw unavailable('Office', 'invalid native browser launch');
        target.searchParams.set('launch', next.nonce);
        return { ...descriptor, url: target.href, openPath: target.pathname + target.search };
      }
      await this.resumeFilesScope(scope);
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
          if (!id && method === 'GET') return { status: 200, body: (await this.referenceCatalogue(record,
            { includeArchived: url.searchParams.get('includeArchived') === 'true' })).projects };
          if (!id && method === 'POST') {
            const value = input.body || {};
            if (Object.keys(value).some(key => !['name', 'cwd', 'bibliographyPath'].includes(key)) || value.cwd && value.bibliographyPath) throw Object.assign(Error('Choose one References project folder'), { status: 400 });
            const cwd = value.cwd ? (await fileDirectory(value.cwd)).path : undefined;
            const bibliographyPath = value.bibliographyPath ? await this.referencePath(value.bibliographyPath)
              : cwd ? await this.referencePath(path.join(cwd, 'Bibliography')) : undefined;
            const references = await this.references();
            const project = await createReferenceProject({ name: value.name, cwd, bibliographyPath });
            const { initialBibliographyPath, ...created } = project;
            return { status: 201, body: { ...created, ...await references.projectInfo({ projectId: project.id, authority: record, signal: activeSignal }) } };
          }
          if (id) {
            const project = await this.referenceProject(record, id);
            if (method === 'GET') {
              const { initialBibliographyPath, authorizePath, runAuthorized, ...value } = project;
              return { status: 200, body: { ...value, ...await (await this.references()).projectInfo({ projectId: id, authority: record, signal: activeSignal }) } };
            }
            if (method === 'PATCH') {
              if (!input.body || Object.keys(input.body).some(key => key !== 'name')) throw Object.assign(Error('Only the References project name can be changed here'), { status: 400 });
              const { initialBibliographyPath, ...updated } = await renameReferenceProject(id, input.body.name);
              return { status: 200, body: { ...updated, ...await (await this.references()).projectInfo({ projectId: id, authority: record, signal: activeSignal }) } };
            }
            if (method === 'DELETE') throw Object.assign(Error('Use the explicit References data deletion action and attachment choice'), { status: 400 });
          }
          throw Object.assign(Error('Method not allowed'), { status: 405 });
        }
        const projectId = /^\/projects\/([^/]+)/.exec(url.pathname)?.[1];
        if (projectId) await this.referenceProject(record, projectId);
        const result = await (await this.references()).handle({ method: input.method || 'GET', path: url.pathname, query: url.searchParams,
          body: input.body, headers: {}, signal: activeSignal, authority: record });
        if (result.filePath && projectId) result.referenceProjectId = projectId;
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
        const projectRequest = ['/sessions', '/snapshots', '/snapshots/diff'].includes(url.pathname);
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
    await this.referenceProject(record, input.projectId);
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
      return this.authorize(record, async () => ({ backendId, ...await this.referenceCatalogue(record) }));
    }
    if (input.operation !== 'request' || !connectorMethods.has(input.method)) throw Error('Unsupported References capture method');
    await this.referenceProject(record, input.projectId);
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
      scope: context.grant.scope, endpoint: context.grant.scope.endpoint,
      authorizePath: (filename, options) => this.authorizeScopedPath(context.grant.scope, filename, options),
      withNativeMove: async (value, perform) => { await this.office(); return this.officeProvider.withNativeMove({ ...value, grantId: context.grant.id }, perform); },
      openOffice: async value => {
        await this.office();
        return this.officeProvider.open({ ...value, grantId: context.grant.id, participantId: 'human:' + context.grant.id,
          participantName: 'User', participantKind: 'human', basePath: context.basePath, origin: context.origin, editorBaseUrl: context.origin + '/apps/office' });
      } });
    const route = context.url.pathname.slice(context.basePath.length);
    if (route === 'api/context') {
      if (req.method !== 'GET') throw Object.assign(Error('Method not allowed'), { status: 405 });
      return json(res, { backendId: await this.identity(), ...await this.referenceCatalogue(context.grant.record,
        { selectedProjectId: context.grant.scope.referenceProjectId }) });
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
      return this.sendResult(req, res, result, context.grant.record, context.signal, /^api\/projects\/([a-f0-9-]{36})\//.exec(route)?.[1]);
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
  async sendResult(req, res, result, authority, signal, projectId) {
    if (result.filePath) {
      projectId ||= result.referenceProjectId;
      if (!authority || !projectId) throw Object.assign(Error('Library file authority is required'), { status: 403 });
      return this.authorize(authority, async operation => {
        const project = await this.referenceProject(authority, projectId);
        // A manager can select another authorized library. Hold that library's
        // existing drain guard through streaming, independently of its tab root.
        return project.runAuthorized(async projectSignal => {
          const activeSignal = AbortSignal.any([projectSignal, operation.signal, ...(signal ? [signal] : [])]);
          if (result.referenceExport) {
            if (result.referenceExport.projectId !== projectId) throw Object.assign(Error('The export belongs to another library'), { status: 403 });
            const references = await this.references();
            if (typeof references.openExport !== 'function') throw unavailable('References', 'the native export receipt is unavailable');
            const opened = await references.openExport({ authority, projectId, exportId: result.referenceExport.exportId, signal: activeSignal });
            return sendFileHandle(req, res, opened.handle, { name: opened.name, contentType: opened.contentType, download: true, signal: activeSignal });
          }
          await authorizeApplicationPath(result.filePath);
          return sendFile(req, res, result.filePath, false, path.basename(result.filePath), activeSignal);
        }, { write: false });
      }, { cancel: () => { req.destroy(); res.destroy(); },
        watch: abort => { res.once('close', abort); return () => res.off('close', abort); } });
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
      if (grant.component === 'references' || grant.scope.projectId !== projectId) return false;
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
