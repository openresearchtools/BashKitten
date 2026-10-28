import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { randomUUID, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDocumentOwner } from './storage.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const fail = (status, message) => Object.assign(Error(message), { status });
const send = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
async function body(req, max = 1024 * 1024) { const values = []; let bytes = 0; for await (const part of req) { bytes += part.length; if (bytes > max) throw fail(413, 'Request exceeds its bound'); values.push(part); } return bytes ? JSON.parse(Buffer.concat(values).toString('utf8')) : undefined; }
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const jsonHTML = value => JSON.stringify(value).replace(/</g, '\\u003c');
function call(socketPath, token, target, value, signal) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, method: 'POST', path: target, signal, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }, async res => { try { const answer = await body(res, 2 << 20); if (res.statusCode !== 200) throw fail(res.statusCode, answer?.error || 'Office operation unavailable'); resolve(answer); } catch (e) { reject(e); } });
    req.once('error', reject); req.setTimeout(120000, () => req.destroy(fail(504, 'Office did not respond'))); req.end(JSON.stringify(value));
  });
}
export function createOfficeProvider({ dataRoot, environmentId, authorizeOperation, authorizePath, ensureRunning, collaboraInternalURL, wopiURL, extension, coordinateNativeRestore, referenceContext, referenceRequest, officeCopy, addonBinary = path.join(root, 'bin', 'files-office-addon'), socketRoot = path.join(dataRoot, 'run') }) {
  const owner = createDocumentOwner({ dataRoot, environmentId, authorizeOperation, authorizePath });
  const launches = new Map(), issued = new Map(); let starting; let callback; let callbackToken; let config;
  function configure(value) {
    const changed = value.collaboraInternalURL !== collaboraInternalURL || value.wopiURL !== wopiURL || JSON.stringify(value.extension) !== JSON.stringify(extension);
    if (changed && (starting || issued.size)) throw fail(409, 'A running Office owner cannot be retargeted');
    collaboraInternalURL = value.collaboraInternalURL; wopiURL = value.wopiURL; extension = value.extension;
  }
  async function extensionBytes(claims) {
    const metadata = await owner.metadata(claims);
    if (!extension || !metadata.permissions.extensions) return null;
    if (!path.isAbsolute(extension.path) || !/^[a-f0-9]{64}$/.test(extension.sha256)) throw fail(503, 'Invalid native References extension artifact');
    const file = await fs.open(extension.path, 'r');
    try { const stat = await file.stat(); if (!stat.isFile() || stat.size > 8 << 20) throw fail(503, 'Native References extension exceeds its bound'); const bytes = await file.readFile(); if (createHash('sha256').update(bytes).digest('hex') !== extension.sha256) throw fail(503, 'Native References extension does not match its manifest'); return bytes; } finally { await file.close(); }
  }
  async function registerDerivedSession(claims, value) {
    const parent = issued.get(value.parentToken);
    if (!parent || parent.grantId !== claims.grant || parent.session.documentId !== claims.fid || parent.session.participantId !== claims.participant) throw fail(403, 'Native Save As has no issuing session');
    const metadata = await owner.metadata({ ...claims, fid: value.documentId, generation: value.generation });
    const expectedSource = wopiURL.replace(/\/$/, '') + '/wopi/files/' + encodeURIComponent(value.documentId);
    if (value.wopiSrc !== expectedSource || typeof value.accessToken !== 'string' || !Number.isSafeInteger(value.accessTokenTtl)) throw fail(502, 'Invalid native derived session');
    const action = new URL(parent.session.actionUrl); action.searchParams.set('WOPISrc', expectedSource);
    const session = { ...parent.session, ...metadata, accessToken: value.accessToken, accessTokenTtl: value.accessTokenTtl, actionUrl: action.href, editorUrl: action.href, wopiSrc: expectedSource };
    const ws = new URL(session.editorBaseUrl); ws.protocol = 'wss:'; ws.pathname = ws.pathname.replace(/\/$/, '') + '/cool/' + encodeURIComponent(expectedSource) + '/ws'; ws.search = new URLSearchParams({ WOPISrc: expectedSource, access_token: value.accessToken }).toString(); session.websocketUrl = ws.href;
    issued.set(value.accessToken, { ...parent, session, input: { ...parent.input, documentId: value.documentId, snapshot: '' }, issuedAt: Date.now() });
    for (const launch of launches.values()) if (launch.session.accessToken === value.parentToken && launch.input.participantKind !== 'agent') {
      launch.session = session; launch.expires = value.accessTokenTtl; launch.claims = { ...launch.claims, fid: value.documentId, generation: value.generation };
      launch.input = { ...launch.input, documentId: value.documentId, create: undefined, relativePath: undefined };
    }
    return { registered: true };
  }
  async function prepare() {
    if (starting) return starting;
    if (!collaboraInternalURL || !wopiURL) throw fail(503, 'Native Office runtime has not been configured');
    starting = (async () => {
      const dir = path.join(dataRoot, 'services', 'office'); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      await fs.mkdir(socketRoot, { recursive: true, mode: 0o700 });
      const callbackSocket = path.join(socketRoot, 'office-owner.sock');
      if (Buffer.byteLength(callbackSocket) > 107) throw fail(503, 'The backend runtime directory is too long for a native Unix socket'); const tokenFile = path.join(dir, 'owner-token'); callbackToken = randomBytes(48).toString('base64url'); await fs.writeFile(tokenFile, callbackToken, { mode: 0o600 });
      callback = http.createServer(async (req, res) => {
        try {
          const supplied = String(req.headers.authorization || '').replace(/^Bearer /, ''); if (supplied.length !== callbackToken.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(callbackToken))) throw fail(401, 'Unauthorized callback');
          const claims = JSON.parse(req.headers['x-bashkitten-grant'] || '{}');
          if (req.method !== 'POST') throw fail(405, 'Unsupported method');
          switch (req.url) {
            case '/v1/owner/extension-info': { const bytes = await extensionBytes(claims); send(res, 200, bytes ? { available: true, stamp: extension.sha256 } : { available: false }); break; }
            case '/v1/owner/extension': { const bytes = await extensionBytes(claims); if (!bytes) throw fail(404, 'References extension unavailable'); res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' }); res.end(bytes); break; }
            case '/v1/owner/issued': send(res, 200, await registerDerivedSession(claims, await body(req, 16384))); break;
            case '/v1/owner/metadata': send(res, 200, await owner.metadata(claims)); break;
            case '/v1/owner/read': await owner.read(claims, res); break;
            case '/v1/owner/write': { const saved = await owner.write(claims, req); res.setHeader('X-WOPI-ItemVersion', saved.version); send(res, 200, { LastModifiedTime: saved.LastModifiedTime }); break; }
            case '/v1/owner/finalize': send(res, 200, await owner.finalize(claims)); break;
            case '/v1/owner/settings': send(res, 200, await owner.settings(claims, await body(req))); break;
            case '/v1/owner/relative': send(res, 200, await owner.relative(claims, req)); break;
            case '/v1/owner/rename': send(res, 200, await owner.rename(claims, req)); break;
            default: throw fail(501, 'This native operation is not yet available');
          }
        } catch (error) { if (res.headersSent) res.destroy(error); else send(res, error.status || 500, error.code === 'STORAGE_CHANGED' ? { COOLStatusCode: 1010 } : { error: error.message }); }
      });
      callback.requestTimeout = 0; callback.headersTimeout = 120000; callback.timeout = 180000;
      // Only remove a stale socket after proving no live owner accepts it.
      try { await fs.lstat(callbackSocket); const net = await import('node:net'); await new Promise((resolve, reject) => { const socket = net.connect(callbackSocket); socket.once('connect', () => { socket.destroy(); reject(fail(409, 'Office callback owner already exists')); }); socket.once('error', e => e.code === 'ECONNREFUSED' ? resolve() : reject(e)); }); await fs.unlink(callbackSocket); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await new Promise((resolve, reject) => { callback.once('error', reject); callback.listen(callbackSocket, resolve); }); await fs.chmod(callbackSocket, 0o600);
      config = { socket: path.join(socketRoot, 'office-addon.sock'), callbackSocket, callbackTokenFile: tokenFile, signingKeyFile: path.join(dir, 'wopi-signing-key'), collaboraUrl: collaboraInternalURL, wopiUrl: wopiURL, environmentId, tokenHours: 2, requireProof: true };
      const filename = path.join(dir, 'addon.json'); await fs.writeFile(filename, JSON.stringify(config) + '\n', { mode: 0o600 });
      return { id: 'office-addon', name: 'Office storage', target: { network: 'unix', address: config.socket }, scheme: 'http', kind: 'web', openPath: '/', enabled: false, startup: false, command: { argv: [addonBinary, '--config', filename], cwd: dir, env: {} } };
    })().catch(e => { starting = undefined; throw e; }); return starting;
  }
  async function createSession(input) {
    await authorizeOperation(input.grantId, input.create ? 'create' : 'view', async (scope, signal) => { if (scope.permissions?.[input.create ? 'create' : 'view'] !== true) throw fail(403, 'This operation is not allowed'); signal?.throwIfAborted(); });
    await ensureRunning('office'); const definition = await prepare(); await ensureRunning('office-addon', definition);
    const registered = await owner.register(input);
    const session = await call(config.socket, callbackToken, '/v1/session', { ...registered, origin: input.origin, editorBaseUrl: input.editorBaseUrl, locale: input.locale || 'en-GB', snapshot: input.snapshot || '' });
    issued.set(session.accessToken, { session, input: { ...registered, origin: input.origin, editorBaseUrl: input.editorBaseUrl, locale: input.locale || 'en-GB', snapshot: input.snapshot || '' }, grantId: input.grantId, origin: input.origin, issuedAt: Date.now() });
    return session;
  }
  async function renew({ grantId, documentId, participantId, accessToken }, { signal } = {}) {
    signal?.throwIfAborted();
    for (const [token, entry] of issued) if (entry.session.accessTokenTtl <= Date.now()) issued.delete(token);
    const matches = entry => entry.grantId === grantId && entry.session.documentId === documentId && entry.session.participantId === participantId && entry.session.accessTokenTtl > Date.now();
    const previous = accessToken ? issued.get(accessToken) : [...issued.values()].reverse().find(matches);
    if (!previous || !matches(previous)) throw fail(401, 'The existing Office participant has expired');
    await owner.metadata({ env: environmentId, grant: grantId, fid: documentId, participant: participantId, generation: previous.session.generation, snapshot: previous.input.snapshot });
    const session = await call(config.socket, callbackToken, '/v1/session', previous.input, signal);
    if (session.wopiSrc !== previous.session.wopiSrc || session.generation !== previous.session.generation) throw fail(409, 'The native document changed while renewing its participant');
    issued.set(session.accessToken, { ...previous, session, issuedAt: Date.now() });
    for (const launch of launches.values()) if (launch.session.accessToken === previous.session.accessToken) { launch.session = session; launch.expires = session.accessTokenTtl; }
    return { accessToken: session.accessToken, accessTokenTtl: session.accessTokenTtl };
  }
  async function open(input) {
    const session = await createSession(input);
    const id = randomUUID(); const claims = { env: environmentId, fid: session.documentId, grant: input.grantId, generation: session.generation, participant: input.participantId, snapshot: input.snapshot || '' };
    const browser = { ...input, ...input.browserView };
    const browserUrl = new URL(browser.basePath + 'office/' + id, browser.origin).href + (browser.bootstrapQuery || '');
    launches.set(id, { session, claims, input, browser, browserGrantId: browser.grantId, browserUrl, expires: session.accessTokenTtl });
    return { ...session, editorInternalURL: collaboraInternalURL, browserUrl };
  }
  async function status({ grantId, documentId, participantId }) { return owner.metadata({ env: environmentId, grant: grantId, fid: documentId, participant: participantId }); }
  async function snapshot({ grantId, documentId, participantId, versionId }, options) { return owner.snapshot({ env: environmentId, grant: grantId, fid: documentId, participant: participantId }, versionId, options); }
  async function handle(req, res, { grantId, basePath, origin, signal }) {
    let mapped;
    try { mapped = new URL(origin); } catch { throw fail(403, 'An authenticated Office origin is required'); }
    if (mapped.protocol !== 'https:' || mapped.origin !== origin) throw fail(403, 'Invalid authenticated Office origin');
    const url = new URL(req.url, 'http://office'); const suffix = url.pathname.slice((basePath + 'office/').length); const [id, action] = suffix.split('/'); const launch = launches.get(id);
    if (!launch || launch.browserGrantId !== grantId || launch.expires <= Date.now()) throw fail(401, 'Office launch expired; open the document again');
    if (launch.input.participantKind === 'agent') {
      if (!launch.humanReady) launch.humanReady = (async () => {
        const human = { ...launch.browser, origin, editorBaseUrl: new URL('/apps/office', origin).href, create: undefined, relativePath: launch.input.relativePath || launch.input.create?.name, participantId: launch.browser.browserParticipantId || `human:${environmentId}:${grantId}`, participantName: launch.browser.browserParticipantName || 'You', participantKind: 'human' };
        launch.session = await createSession(human); launch.claims = { env: environmentId, fid: launch.session.documentId, grant: grantId, generation: launch.session.generation, participant: human.participantId, snapshot: human.snapshot || '' }; launch.input = human;
      })().catch(error => { launch.humanReady = undefined; throw error; });
      await launch.humanReady;
    }
    // Each request, including wrapper/assets/history, rechecks the original grant.
    await owner.metadata(launch.claims);
    // The existing gateway validates this HTTPS Host, including the exact local
    // Chisel/container mapping. It is never taken from request JSON or a header
    // supplied directly to the provider. Bind the native form/postMessage origin
    // when the human wrapper first arrives through that mapping.
    if (new URL(launch.session.actionUrl).origin !== origin) {
      launch.input = { ...launch.input, create: undefined, relativePath: undefined, documentId: launch.session.documentId, origin, editorBaseUrl: new URL('/apps/office', origin).href };
      launch.session = await createSession(launch.input); launch.expires = launch.session.accessTokenTtl;
      launch.browserUrl = new URL(new URL(launch.browserUrl).pathname, origin).href;
    }
    if (action === 'renew' && req.method === 'POST') return send(res, 200, await renew({ grantId, documentId: launch.session.documentId, participantId: launch.claims.participant, accessToken: launch.session.accessToken }, { signal }));
    if (action === 'copy' && req.method === 'POST') {
      if (typeof officeCopy !== 'function') throw fail(503, 'Native document copy is unavailable');
      const value = await body(req, 4096);
      if (!['docx', 'odt', 'xlsx', 'ods', 'pptx', 'odp'].includes(value?.format) || typeof value.name !== 'string' || !value.name || value.name.length > 240 || /[\x00-\x1f/\\]/.test(value.name) || !value.name.toLowerCase().endsWith('.' + value.format)) throw fail(400, 'A matching plain Office filename is required');
      const abort = new AbortController(); const cancel = () => abort.abort();
      signal?.addEventListener('abort', cancel, { once: true }); res.once('close', cancel);
      try {
        if (signal?.aborted) cancel();
        const result = await officeCopy({ grantId, documentId: launch.session.documentId, viewId: id, name: value.name, format: value.format, signal: abort.signal, origin });
        return send(res, 200, result);
      } finally { signal?.removeEventListener('abort', cancel); res.off('close', cancel); }
    }
    if (action === 'references' && req.method === 'POST') {
      if (typeof referenceRequest !== 'function') throw fail(503, 'References is unavailable');
      const request = await body(req, 1 << 20);
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request?.method) || typeof request?.path !== 'string' || !request.path.startsWith('/api/references/')) throw fail(400, 'Invalid References request');
      const abort = new AbortController(); const cancel = () => abort.abort();
      signal?.addEventListener('abort', cancel, { once: true }); res.once('close', cancel);
      try {
        if (signal?.aborted) cancel();
        const result = await referenceRequest({ grantId, documentId: launch.session.documentId, participantId: launch.claims.participant, method: request.method, path: request.path, body: request.body, signal: abort.signal });
        return result && Number.isInteger(result.status) && Object.hasOwn(result, 'body') ? send(res, result.status, result.body) : send(res, 200, result);
      } finally { signal?.removeEventListener('abort', cancel); res.off('close', cancel); }
    }
    if (action === 'context' && req.method === 'GET') return send(res, 200, { documentId: launch.session.documentId });
    if (action === 'history' && req.method === 'GET') return send(res, 200, await owner.list(launch.claims));
    if (action === 'restore' && req.method === 'POST') { const value = await body(req, 4096); const result = await owner.restore(launch.claims, value.versionId, typeof coordinateNativeRestore === 'function' ? async documentId => { const grant = { ...await createSession({ ...launch.input, create: undefined, documentId, relativePath: undefined, participantId: 'restore:' + randomUUID(), participantName: 'Office history', restoreCoordinator: true }), editorInternalURL: collaboraInternalURL }; return coordinateNativeRestore(documentId, { grant, signal }); } : undefined); return send(res, 200, { ...result, reopen: (await open(launch.input)).browserUrl }); }
    if (action === 'version' && req.method === 'POST') { const value = await body(req, 4096); const result = await open({ ...launch.input, snapshot: value.versionId }); return send(res, 200, { url: result.browserUrl }); }
    if (action === 'host.js' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); res.end(await fs.readFile(path.join(root, 'web', 'office-host.js'))); return; }
    if (action || req.method !== 'GET') throw fail(404, 'Unknown Office route');
    const references = referenceContext ? await referenceContext({ grantId, documentId: launch.session.documentId, participantId: launch.claims.participant }) : undefined;
    const s = launch.session; const editorOrigin = new URL(s.actionUrl).origin;
    const fields = { access_token: s.accessToken, access_token_ttl: s.accessTokenTtl, ...s.launchParameters };
    const host = { origin: editorOrigin, documentId: s.documentId, accessTokenTtl: s.accessTokenTtl, writable: s.mode === 'edit', referenceContext: references ? { projectId: references.projectId, documentId: launch.session.documentId } : null };
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': `default-src 'self'; frame-src ${editorOrigin}; form-action ${editorOrigin}; script-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none'` });
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Office</title><style>html,body{height:100%;margin:0;background:#fff;color:#222;font:16px system-ui}iframe{width:100%;height:100%;border:0}form{display:none}dialog{max-width:min(90vw,38rem);max-height:80vh}li{display:flex;gap:1rem;margin:1rem 0;align-items:center}button{font:inherit}#error{position:fixed;inset:auto 1rem 1rem;background:white}</style></head><body><iframe id="editor" name="editor" title="Office document" allow="clipboard-read; clipboard-write; fullscreen"></iframe><form id="launch" method="post" target="editor" action="${escapeHTML(s.actionUrl)}">${Object.entries(fields).map(([name,value]) => `<input type="hidden" name="${escapeHTML(name)}" value="${escapeHTML(value)}">`).join('')}</form><dialog id="history"><h2>Version history</h2><ol></ol><button id="close-history">Close</button></dialog><p id="error" role="alert" hidden></p><script id="host-context" type="application/json">${jsonHTML(host)}</script><script src="${escapeHTML(new URL(launch.browserUrl).pathname + '/host.js')}"></script></body></html>`);
  }
  async function resolveEditorGrant(req, { candidateGrantIds = [] } = {}) {
    const candidates = new Set(candidateGrantIds); const uri = new URL(req.url, 'https://office.invalid');
    if (!uri.pathname.startsWith('/apps/office/')) throw fail(404, 'Unknown Office route');
    for (const [token, entry] of issued) if (entry.session.accessTokenTtl <= Date.now()) issued.delete(token);
    let token = uri.searchParams.get('access_token');
    if (!token && uri.pathname.endsWith('/ws')) {
      const encoded = uri.pathname.slice('/apps/office/cool/'.length, -'/ws'.length);
      try { token = new URL(decodeURIComponent(encoded)).searchParams.get('access_token'); } catch { throw fail(400, 'Invalid native document session'); }
    }
    if (req.method === 'POST' && /\/browser\/[^/]+\/cool\.html$/.test(uri.pathname)) {
      if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) throw fail(400, 'Native launch form required');
      const parts = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 65536) throw fail(413, 'Office launch form is too large'); parts.push(chunk); }
      req.officeLaunchBody = Buffer.concat(parts); token = new URLSearchParams(req.officeLaunchBody.toString('utf8')).get('access_token');
    }
    let found;
    if (token) found = issued.get(token);
    else if (uri.searchParams.has('WOPISrc')) {
      const source = uri.searchParams.get('WOPISrc');
      found = [...issued.values()].find(entry => candidates.has(entry.grantId) && entry.session.wopiSrc === source);
    } else if (req.method === 'GET' && (/^\/apps\/office\/browser\//.test(uri.pathname) || /^\/apps\/office\/hosting\/(discovery|capabilities)$/.test(uri.pathname))) {
      found = [...issued.values()].find(entry => candidates.has(entry.grantId));
    }
    if (!found || !candidates.has(found.grantId)) throw fail(403, 'This Office request has no current document grant');
    if (owner.isRestoring(found.session.documentId)) throw fail(409, 'This document is being restored; reopen it after restoration');
    if (uri.searchParams.has('WOPISrc') && uri.searchParams.get('WOPISrc') !== found.session.wopiSrc) throw fail(403, 'The Office source does not match its session');
    // Document operations need their native WOPI identity; only immutable web
    // assets may use another live session belonging to the same captured grant.
    if (uri.pathname.startsWith('/apps/office/cool/') && !token && !uri.searchParams.has('WOPISrc')) throw fail(403, 'Native document identity is required');
    req.officeIssuedSession = found;
    return found.grantId;
  }
  function editorRequest(req, { origin, signal }) {
    const external = new URL(origin); if (external.protocol !== 'https:') throw fail(403, 'Office requires the authenticated HTTPS gateway');
    const internal = new URL(collaboraInternalURL);
    if (!['http:', 'https:'].includes(internal.protocol)) throw fail(503, 'Invalid internal Office endpoint');
    const headers = { ...req.headers };
    for (const key of Object.keys(headers)) if (key.startsWith('x-bashkitten-') || ['authorization', 'cookie', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip'].includes(key)) delete headers[key];
    headers.host = external.host; headers['x-forwarded-host'] = external.host; headers['x-forwarded-proto'] = 'https';
    const publicPath = req.url.slice('/apps/office'.length); const targetPath = internal.pathname.replace(/\/$/, '') + publicPath;
    return { internal, options: { protocol: internal.protocol, hostname: internal.hostname, port: internal.port, method: req.method, path: targetPath, headers, signal } };
  }
  async function handleEditor(req, res, context) {
    if (!req.officeIssuedSession || req.officeIssuedSession.grantId !== context.grant.id) throw fail(403, 'Office grant mismatch');
    const { internal, options } = editorRequest(req, context); const transport = internal.protocol === 'https:' ? await import('node:https') : http;
    await new Promise((resolve, reject) => {
      const upstream = transport.request(options, response => { const headers = { ...response.headers }; delete headers['set-cookie']; res.writeHead(response.statusCode, headers); response.pipe(res); response.once('error', reject); res.once('finish', resolve); res.once('close', () => { upstream.destroy(); resolve(); }); });
      upstream.once('error', reject); upstream.setTimeout(180000, () => upstream.destroy(fail(504, 'Office transfer stalled')));
      if (req.officeLaunchBody) upstream.end(req.officeLaunchBody); else req.pipe(upstream);
    });
  }
  async function upgradeEditor(req, socket, head, context) {
    if (!req.officeIssuedSession || req.officeIssuedSession.grantId !== context.grant.id || !req.url.split('?')[0].endsWith('/ws')) throw fail(403, 'Office socket grant mismatch');
    const { internal, options } = editorRequest(req, context); const transport = internal.protocol === 'https:' ? await import('node:https') : http;
    await new Promise((resolve, reject) => {
      const request = transport.request(options); request.once('error', reject); request.once('response', response => { response.resume(); reject(fail(502, 'Native Office refused the WebSocket')); });
      request.once('upgrade', (response, upstream, upstreamHead) => {
        socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n` + Object.entries(response.headers).filter(([key]) => key !== 'set-cookie').flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map(entry => `${key}: ${entry}\r\n`)).join('') + '\r\n');
        if (upstreamHead.length) socket.write(upstreamHead); if (head.length) upstream.write(head);
        upstream.pipe(socket); socket.pipe(upstream);
        const stop = () => { upstream.destroy(); socket.destroy(); resolve(); }; socket.once('close', stop); upstream.once('close', stop); socket.once('error', stop); upstream.once('error', stop); context.signal?.addEventListener('abort', stop, { once: true });
      }); request.end();
    });
  }
  async function reopenBrowser(url, input) {
    const parsed = new URL(url); const match = /\/office\/([a-f0-9-]{36})$/.exec(parsed.pathname); const old = match && launches.get(match[1]);
    if (!old) throw fail(404, 'Office document launch is unavailable; open it from Files again');
    // Resolve only our known document identity. New authority/root, participant
    // and mapped HTTPS origin come from the caller's existing gateway session.
    return open({ ...input, editorBaseUrl: input.editorBaseUrl || new URL('/apps/office', input.origin).href, documentId: old.session.documentId, create: undefined, relativePath: undefined, participantKind: 'human' });
  }
  async function close() { launches.clear(); issued.clear(); if (callback) await new Promise(resolve => { const timer = setTimeout(() => { callback.closeAllConnections(); resolve(); }, 2000); timer.unref(); callback.close(() => { clearTimeout(timer); resolve(); }); }); if (config) await fs.unlink(config.callbackSocket).catch(() => {}); }
  return { configure, prepare, open, renew, status, snapshot, handle, owner, resolveEditorGrant, handleEditor, upgradeEditor, reopenBrowser, close };
}
