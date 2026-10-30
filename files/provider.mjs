// Native Quantum configuration/proxy boundary. This module never starts a
// process; the existing HostedServices owner starts/reuses the returned service.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const queues = new Map();
const reconciledRules = new Map();
const failure = (status, message) => Object.assign(Error(message), { status });
const digest = value => createHash('sha256').update(value).digest('hex');
async function load(filename, fallback) { try { return JSON.parse(await fs.readFile(filename, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } }
async function atomic(filename, value) { const tmp = filename + '.' + randomUUID(); await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); await fs.rename(tmp, filename); }
function serial(key, action) { const previous = queues.get(key) || Promise.resolve(); const next = previous.catch(() => {}).then(action); queues.set(key, next); return next.finally(() => { if (queues.get(key) === next) queues.delete(key); }); }
function permissions(scope) { const p = scope.permissions || {}; return { view: p.view === true, download: p.download === true, modify: p.modify === true, create: p.create === true, delete: p.delete === true, configured: true }; }
const userName = scope => 'bk_' + digest(String(scope.identity) + '\0' + scope.id + '\0' + scope.root).slice(0, 40);
const sourceName = scope => 'source_' + digest(scope.root).slice(0, 24);
export const filesLocation = scope => ({ source: sourceName(scope), openPath: `files/${sourceName(scope)}/` });
const sourcePerm = scope => ({ name: sourceName(scope), scope: scope.attachment ? '/' + scope.attachment.path : '/', permissions: permissions(scope) });
function scopedFile(scope, value) {
  if (typeof value !== 'string' || /[\\\x00-\x1f\x7f]/.test(value)) throw failure(400, 'Native file path must be unambiguous text');
  if (scope.attachment) {
    if (value.replace(/^\/+/, '') !== '') throw failure(403, 'Only this chat attachment is available');
    return path.join(scope.root, scope.attachment.path);
  }
  const filename = path.resolve(scope.root, value.replace(/^\/+/, ''));
  if (filename !== scope.root && !filename.startsWith(scope.root + path.sep)) throw failure(403, 'File path leaves this source');
  return filename;
}
export async function prepareFiles({ dataRoot, scope, endpoint, privatePaths = [], socketRoot = path.join(dataRoot, 'run') }) {
  if (!scope?.id || !scope.identity || !path.isAbsolute(scope.root) || !path.isAbsolute(dataRoot)) throw failure(400, 'An authenticated owning folder is required');
  return serial(dataRoot, async () => {
    const directory = path.join(dataRoot, 'services', 'files'); await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.mkdir(socketRoot, { recursive: true, mode: 0o700 }); const socketPath = path.join(socketRoot, 'quantum.sock');
    if (Buffer.byteLength(socketPath) > 107) throw failure(503, 'The backend runtime directory is too long for a native Unix socket');
    const root = await fs.realpath(scope.root); scope = { ...scope, root };
    const filename = path.join(directory, 'quantum.yaml');
    const previous = await load(filename, null);
    const bootstrap = previous?.auth?.adminUsername || 'owner_' + randomBytes(24).toString('hex');
    const rulesFor = folder => [{ folderPath: '/', ignoreSymlinks: true }, { fileStartsWith: '.bashkitten-save-' }, { fileStartsWith: '.bashkitten-restore-' }, ...privatePaths.filter(p => p === folder || p.startsWith(folder + path.sep)).flatMap(p => { const relative = p.slice(folder.length) || '/'; return [{ folderPath: relative, viewable: false }, { filePath: relative, viewable: false }]; })];
    const source = { name: sourceName(scope), path: root, config: { createUserDir: false, defaultEnabled: false, defaultUserScope: '/', private: true, defaultPermissions: { view: false, download: false, modify: false, delete: false, create: false, configured: true }, rules: rulesFor(root) } };
    // Preserve native source order. Merely returning to a previously opened
    // folder must not rewrite the shared configuration and restart Quantum.
    const sources = (previous?.server?.sources || []).map(entry => entry.path === root ? source : { ...entry, config: { ...entry.config, rules: rulesFor(entry.path) } });
    if (!sources.some(entry => entry.path === root)) sources.push(source);
    const config = { server: { disableUpdateCheck: true, database: { path: path.join(directory, 'quantum.sqlite') }, cacheDir: path.join(directory, 'cache'), sources }, http: { requestTimeoutMs: 120000, proxyTransferTimeouts: true, socket: socketPath, baseURL: '/', disableWebDAV: true, trustProxyHeaders: true }, auth: { adminUsername: bootstrap, adminPassword: previous?.auth?.adminPassword || randomBytes(48).toString('base64url'), key: previous?.auth?.key || randomBytes(48).toString('base64url'), methods: { noauth: false, password: { enabled: false }, proxy: { enabled: true, header: 'X-BashKitten-Quantum-User' } } }, frontend: { name: 'Files', favicon: path.join(moduleRoot, 'web', 'bashkitten.png'), loginIcon: path.join(moduleRoot, 'web', 'bashkitten.png'), description: 'Files · BashKitten', disableDefaultLinks: true, externalLinks: [{ text: 'About Files', title: 'BashKitten · source and licenses', url: '?bashkitten=about' }], disablePWAInstall: true, styling: { disableEventThemes: true, followBrowserTheme: true, customCSS: path.join(moduleRoot, 'web', 'quantum.css'), darkBackground: '#1e1e1e', lightBackground: '#f3f3f3' } }, userDefaults: { sidebar: { sticky: false, disableQuickToggles: true, showTools: false, hideFileActions: false }, account: { disableSettings: true, permissions: { admin: false, api: false, share: false, realtime: true } }, preview: { office: false } }, integrations: { media: { ffmpegPath: path.join(moduleRoot, 'bin') } } };
    await fs.mkdir(config.server.cacheDir, { recursive: true, mode: 0o700 });
    const content = JSON.stringify(config); const changed = !previous || JSON.stringify(previous) !== content; if (changed) await atomic(filename, config);
    const binary = path.join(moduleRoot, 'bin', 'filebrowser');
    return { service: { id: 'quantum', name: 'Files', target: { network: 'unix', address: config.http.socket }, scheme: 'http', kind: 'web', openPath: '/', enabled: false, startup: false, command: { argv: [binary, '-c', filename], cwd: directory, env: { BASHKITTEN_FILES_CONFIG_REVISION: digest(content) } } }, ...filesLocation(scope), username: userName(scope), configRevision: digest(content), needsRestart: !!previous && changed, endpoint };
  });
}
function request(socketPath, method, requestPath, { headers = {}, body, signal } = {}) {
  return new Promise((resolve, reject) => {
    let headerTimer;
    const req = http.request({ socketPath, method, path: requestPath, headers, signal }, response => { clearTimeout(headerTimer); resolve(response); }); req.once('error', reject);
    req.once('finish', () => { headerTimer = setTimeout(() => req.destroy(failure(504, 'Files did not produce its first response')), 120000); headerTimer.unref(); }); req.once('close', () => clearTimeout(headerTimer));
    req.setTimeout(180000, () => req.destroy(failure(504, 'Files transfer made no progress')));
    if (body?.pipe) body.pipe(req); else req.end(body);
  });
}
async function jsonRequest(socketPath, method, target, username, body, signal, byteLimit = 2 << 20) {
  const response = await request(socketPath, method, target, { headers: { 'X-BashKitten-Quantum-User': username, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  let size = 0; const chunks = []; for await (const chunk of response) { size += chunk.length; if (byteLimit && size > byteLimit) throw failure(502, 'Native API response exceeds its bound'); chunks.push(chunk); }
  const text = Buffer.concat(chunks).toString(); if (response.statusCode >= 400) throw failure(response.statusCode, 'Native Files account reconciliation failed');
  return text ? JSON.parse(text) : null;
}
async function reconcileAccount(dataRoot, scope, signal) {
  const dir = path.join(dataRoot, 'services', 'files'); const config = await load(path.join(dir, 'quantum.yaml'), null); if (!config) throw failure(503, 'Files is unavailable');
  const username = userName(scope); const socketPath = config.http.socket;
  const source = config.server.sources.find(entry => entry.name === sourceName(scope));
  if (!source) throw failure(403, 'Native Files source is unavailable');
  const ruleKey = socketPath + ':' + source.name, revision = digest(JSON.stringify(source.config.rules));
  if (reconciledRules.get(ruleKey) !== revision) {
    for (const rule of source.config.rules) if (rule.folderPath && !rule.ignoreSymlinks) {
      const target = '/api/access?' + new URLSearchParams({ source: source.name, path: rule.folderPath });
      const existing = await jsonRequest(socketPath, 'GET', target, config.auth.adminUsername, undefined, signal);
      if (existing?.denyAll !== true) await jsonRequest(socketPath, 'POST', target, config.auth.adminUsername, { allow: false, ruleCategory: 'all' }, signal);
    }
    reconciledRules.set(ruleKey, revision);
  }
  const data = { username, loginMethod: 'proxy', permissions: { admin: false, api: false, share: false, realtime: true }, disableSettings: true,
    stickySidebar: false, disableQuickToggles: true, showToolsInSidebar: false, hideSidebarFileActions: false,
    sidebarLinks: [{ name: scope.attachment?.path || path.basename(scope.root) || 'Files', category: 'source-minimal', sourceName: source.name, target: '/', icon: 'folder' }], scopes: [sourcePerm(scope)] };
  // Native proxy authentication creates the account using deny-all defaults; the
  // private bootstrap administrator then reconciles actual stored permissions.
  await jsonRequest(socketPath, 'GET', '/api/users?username=self', username, undefined, signal);
  await jsonRequest(socketPath, 'PATCH', '/api/users?username=' + encodeURIComponent(username), config.auth.adminUsername, { which: ['permissions', 'disableSettings', 'stickySidebar', 'disableQuickToggles', 'showToolsInSidebar', 'hideSidebarFileActions', 'sidebarLinks', 'scopes'], data }, signal);
  return { socketPath, username };
}
export async function listFiles({ dataRoot, scope, relative = '', signal, authorizePath }) {
  scope = { ...scope, root: await fs.realpath(scope.root) };
  const filename = scopedFile(scope, relative);
  if (authorizePath) await authorizePath(filename);
  const native = await serial('account:' + scope.id, () => reconcileAccount(dataRoot, scope, signal));
  const query = new URLSearchParams({ source: sourceName(scope), path: '/' + relative.replace(/^\/+/, '') });
  // Quantum's native names-only directory endpoint applies its own access/index
  // rules. The small account-reconciliation reply cap is not a folder-size quota.
  try { return await jsonRequest(native.socketPath, 'GET', '/api/resources/items?' + query, native.username, undefined, signal, 0); }
  catch (error) { error.message = 'Files could not list this folder: ' + error.message; throw error; }
}
const deniedPaths = /^\/(?:api\/(?:settings|users|auth|tokens|sharing|office|access)|public\/share)(?:\/|$|\?)/;
const quickToggleFields = new Set(['singleClick', 'darkMode', 'stickySidebar']);
async function quickToggleBody(req, url, username) {
  if ([...url.searchParams.keys()].length !== 1 || url.searchParams.get('username') !== username) throw failure(403, 'Files preferences belong to the current scoped account');
  let size = 0; const parts = [];
  for await (const part of req) { size += part.length; if (size > 1024) throw failure(413, 'Files preference update is too large'); parts.push(part); }
  let value;
  try { value = JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw failure(400, 'Invalid Files preference update'); }
  if (!value || Array.isArray(value) || Object.keys(value).length !== 2 || !Array.isArray(value.which) || !value.which.length || value.which.length > quickToggleFields.size || !value.data || typeof value.data !== 'object' || Array.isArray(value.data)) throw failure(400, 'Choose native Files quick-toggle preferences');
  if (new Set(value.which).size !== value.which.length || value.which.some(field => !quickToggleFields.has(field)) || Object.keys(value.data).some(field => !value.which.includes(field))) throw failure(403, 'Only native Files quick-toggle preferences can be changed');
  if (value.which.some(field => !Object.hasOwn(value.data, field) || typeof value.data[field] !== 'boolean')) throw failure(400, 'Files quick-toggle preferences must be boolean values');
  return Buffer.from(JSON.stringify({ which: value.which, data: Object.fromEntries(value.which.map(field => [field, value.data[field]])) }));
}
function nativeRoute(encoded) {
  // Go's ServeMux unescapes each path segment before matching. Make the same
  // decision here, then forward one canonical encoding, so encoded route names
  // cannot skip host policy checks while reaching a protected native handler.
  let segments;
  try { segments = encoded.split('/').map(value => decodeURIComponent(value)); }
  catch { throw failure(400, 'Invalid Files route encoding'); }
  if (segments.some(value => /[\\/\x00-\x1f\x7f]/.test(value) || value === '.' || value === '..')) throw failure(400, 'Ambiguous Files route');
  return { decoded: segments.join('/'), encoded: segments.map(value => encodeURIComponent(value)).join('/') };
}
export async function handleFiles(req, res, { dataRoot, scope, basePath, signal, authorizePath, openOffice, withNativeMove }) {
  if (!/^\/apps\/files\/[A-Za-z0-9_-]+\/$/.test(basePath)) throw failure(400, 'Invalid scoped Files route');
  scope = { ...scope, root: await fs.realpath(scope.root) };
  const url = new URL(req.url, 'http://files');
  if (!url.pathname.startsWith(basePath)) throw failure(403, 'Wrong Files launch scope');
  const route = nativeRoute('/' + url.pathname.slice(basePath.length));
  const relative = route.decoded;
  for (const key of ['auth', 'jwt', 'access_token']) url.searchParams.delete(key);
  // Native externalLinks accepts a query-only URL, which stays inside this
  // authenticated launch even while browsing nested folders. This is our legal
  // document, not a second Files UI or a replacement for native branding.
  if (url.searchParams.has('bashkitten')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw failure(405, 'Files information is read-only');
    const page = url.searchParams.get('bashkitten');
    let content, type;
    if (page === 'about') {
      const license = await fs.readFile(path.join(moduleRoot, 'legal', 'Quantum-LICENSE'), 'utf8');
      const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      content = (await fs.readFile(path.join(moduleRoot, 'web', 'about.html'), 'utf8')).replace('{{QUANTUM_LICENSE}}', escape(license));
      type = 'text/html; charset=utf-8';
    } else if (page === 'licenses') {
      content = await fs.readFile(path.join(moduleRoot, 'licenses.json'), 'utf8');
      type = 'application/json; charset=utf-8';
    } else throw failure(404, 'Unknown Files information page');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : content); return;
  }
  if (relative === '/api/document-provider/open') {
    if (req.method !== 'GET' || typeof openOffice !== 'function') throw failure(503, 'Office is unavailable');
    if (url.searchParams.get('source') !== sourceName(scope)) throw failure(403, 'Wrong Files source');
    const filename = scopedFile(scope, url.searchParams.get('path') || '');
    if (authorizePath) await authorizePath(filename);
    const launched = await openOffice({ relativePath: path.relative(scope.root, filename) });
    res.writeHead(303, { Location: launched.browserUrl, 'Cache-Control': 'no-store' }); res.end(); return;
  }
  // Office launch uses the existing document owner, not Quantum. Do not make
  // its cold startup depend on a Files account request or hold a native request
  // open while the independent renderer/storage services become ready.
  const native = await serial('account:' + scope.id, () => reconcileAccount(dataRoot, scope, signal));
  // These native read endpoints are needed by the ordinary frontend. All other
  // administration, shares and credential endpoints remain inaccessible.
  if (deniedPaths.test(relative + url.search) && !['/api/users', '/api/settings/sources', '/api/settings/user-defaults', '/api/settings/source', '/api/auth/login'].includes(relative)) throw failure(403, 'This Files account cannot administer the service');
  const userPreferencePatch = relative === '/api/users' && req.method === 'PATCH';
  if ((relative.startsWith('/api/users') && !(req.method === 'GET' && url.searchParams.get('username') === 'self') && !userPreferencePatch) || (relative.startsWith('/api/settings') && req.method !== 'GET')) throw failure(403, 'Files settings are managed by the owning backend');
  // Native scopes remain the actual file authority. The host additionally checks
  // every explicit source path, including private state and symlink targets.
  for (const key of ['source', 'destinationSource', 'destSource', 'fromSource', 'toSource']) if (url.searchParams.has(key) && url.searchParams.get(key) !== sourceName(scope)) throw failure(403, 'Files source is outside the launch grant');
  const tree = relative === '/api/raw' || relative === '/api/resources/download' || relative === '/api/resources/archive' || relative === '/api/resources/unarchive' || (relative.startsWith('/api/resources') && ['DELETE', 'PATCH'].includes(req.method));
  const checkPath = async value => { const filename = scopedFile(scope, value); if (authorizePath) await authorizePath(filename, { tree }); return scope.attachment ? '/' : '/' + path.relative(scope.root, filename).split(path.sep).join('/'); };
  for (const key of ['path', 'file', 'destination', 'destinationPath', 'destPath', 'fromPath', 'toPath']) for (const value of url.searchParams.getAll(key)) await checkPath(value);
  let forwardedBody = userPreferencePatch ? await quickToggleBody(req, url, native.username) : req, nativeMove;
  if ((req.method === 'PATCH' && relative === '/api/resources') || (req.method === 'DELETE' && relative === '/api/resources/bulk') || (req.method === 'POST' && ['/api/resources/archive', '/api/resources/unarchive', '/api/resources/view-token'].includes(relative))) {
    let size = 0; const parts = []; for await (const part of req) { size += part.length; if (size > 4 << 20) throw failure(413, 'Native operation list is too large'); parts.push(part); }
    forwardedBody = Buffer.concat(parts); const operation = JSON.parse(forwardedBody.toString('utf8'));
    const inspect = async value => { if (!value || typeof value !== 'object') return; for (const [key, entry] of Object.entries(value)) { if (['source', 'fromSource', 'toSource'].includes(key) && entry !== sourceName(scope)) throw failure(403, 'Files source is outside the launch grant'); if (['path', 'fromPath', 'toPath', 'destination', 'destinationPath'].includes(key)) await checkPath(entry); else if (key === 'paths' && Array.isArray(entry)) { for (const filename of entry) await checkPath(filename); } else if (typeof entry === 'object') await inspect(entry); } };
    await inspect(operation);
    if (req.method === 'PATCH' && relative === '/api/resources') {
      if (Object.hasOwn(operation || {}, 'observe')) throw failure(400, 'Native completion observers belong to the document owner');
      if (!['copy', 'move', 'rename'].includes(operation?.action) || !Array.isArray(operation.items) || !operation.items.length) throw failure(400, 'A native copy, move or rename operation is required');
      const source = sourceName(scope), items = [];
      for (const item of operation.items) {
        if (item?.fromSource !== source || item?.toSource !== source) throw failure(403, 'Files source is outside the launch grant');
        items.push({ fromSource: source, fromPath: await checkPath(item.fromPath), toSource: source, toPath: await checkPath(item.toPath) });
      }
      if (['overwrite', 'rename'].some(key => operation[key] !== undefined && typeof operation[key] !== 'boolean')) throw failure(400, 'Invalid native conflict option');
      nativeMove = { source, action: operation.action, overwrite: operation.overwrite === true, rename: operation.rename === true, items };
      forwardedBody = Buffer.from(JSON.stringify({ ...nativeMove, source: undefined }));
    }
  }
  const headers = { ...req.headers, 'X-BashKitten-Quantum-User': native.username, 'X-Forwarded-Prefix': basePath, 'X-BashKitten-Document-Provider': basePath + 'api/document-provider/open' };
  for (const key of Object.keys(headers)) if (key.toLowerCase().startsWith('x-bashkitten-') || ['cookie', 'authorization', 'x-bashkitten-quantum-user', 'x-forwarded-prefix', 'x-bashkitten-document-provider', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip'].includes(key.toLowerCase())) delete headers[key];
  headers['X-BashKitten-Quantum-User'] = native.username; headers['X-Forwarded-Prefix'] = basePath; headers['X-BashKitten-Document-Provider'] = basePath + 'api/document-provider/open'; headers.host = 'files';
  if (userPreferencePatch) headers['content-type'] = 'application/json';
  if (Buffer.isBuffer(forwardedBody)) { delete headers['transfer-encoding']; headers['content-length'] = String(forwardedBody.length); }
  if (nativeMove) {
    if (typeof withNativeMove !== 'function') throw failure(503, 'The document owner is unavailable for this file operation');
    let capability;
    try { capability = await jsonRequest(native.socketPath, 'OPTIONS', '/api/resources', native.username, undefined, signal); }
    catch { throw failure(503, 'Native Files must be updated before moving or copying documents'); }
    if (capability?.completedPaths !== 'scoped-v1' || capability?.atomicCopy !== 'observed-v1') throw failure(503, 'Native Files does not report completed document paths');
    const result = await withNativeMove(nativeMove, async ({ observe = [] } = {}) => {
      if (!Array.isArray(observe)) throw failure(500, 'Invalid document owner completion observers');
      const observed = new Set(); for (const name of observe) observed.add(await checkPath(name));
      const nativeBody = Buffer.from(JSON.stringify({ ...nativeMove, source: undefined, observe: [...observed] }));
      if (nativeBody.length > 4 << 20) throw failure(413, 'The native file operation and completion observers exceed their bound');
      const response = await request(native.socketPath, req.method, route.encoded + url.search, { headers: { ...headers, 'content-length': String(nativeBody.length) }, body: nativeBody, signal });
      let bytes = 0; const parts = [];
      for await (const part of response) { bytes += part.length; if (bytes > 16 << 20) { response.destroy(); throw failure(502, 'Native move receipt exceeds its bound'); } parts.push(part); }
      let completed; try { completed = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw failure(502, 'Native Files returned an incomplete move receipt'); }
      if (![200, 207, 500].includes(response.statusCode) || !Array.isArray(completed?.succeeded) || !Array.isArray(completed?.failed) || !Array.isArray(completed?.changed)) throw failure(response.statusCode >= 400 ? response.statusCode : 502, 'Native Files did not confirm the file operation');
      for (const item of completed.succeeded) {
        if (item.fromSource !== nativeMove.source || item.toSource !== nativeMove.source) throw failure(502, 'Native move receipt changed its source');
        item.fromPath = await checkPath(item.fromPath); item.toPath = await checkPath(item.toPath);
      }
      const publications = new Map(), successes = new Map();
      for (const item of completed.succeeded) successes.set(item.position, item);
      for (const item of completed.changed) {
        item.toPath = await checkPath(item.toPath);
        if (!Number.isInteger(item.position) || item.position < 0 || item.position >= nativeMove.items.length) throw failure(502, 'Native file publication has no matching operation');
        if (!publications.has(item.position)) publications.set(item.position, []);
        publications.get(item.position).push(item.toPath);
      }
      for (let position = 0; position < nativeMove.items.length; position++) {
        for (const name of publications.get(position) || []) if (!observed.has(name)) throw failure(502, 'Native file publication has no matching observer');
        const moved = successes.get(position);
        if (moved && nativeMove.action !== 'copy') {
          const from = moved.fromPath.replace(/\/$/, ''), to = moved.toPath.replace(/\/$/, '');
          const carried = [];
          for (const name of observed) if (name === from || name.startsWith(from + '/')) carried.push(to + name.slice(from.length));
          for (const name of carried) observed.add(name);
        }
      }
      return { status: response.statusCode, body: completed };
    });
    res.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(result.body)); return;
  }
  const upstream = await request(native.socketPath, req.method, route.encoded + url.search, { headers, body: forwardedBody, signal });
  const responseHeaders = { ...upstream.headers }; delete responseHeaders['set-cookie'];
  // Native inline content disables scripts, but a same-origin HTML form can
  // still mutate Files. Isolate active file documents; PDF/media retain their
  // normal browser path and the native sanitized HTML preview is unchanged.
  const type = String(responseHeaders['content-type'] || '').split(';')[0].trim().toLowerCase();
  if ((responseHeaders['content-disposition'] || relative.startsWith('/api/')) &&
      (['text/html', 'application/xhtml+xml', 'image/svg+xml', 'application/xml', 'text/xml'].includes(type) || type.endsWith('+xml'))) {
    responseHeaders['content-security-policy'] = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; form-action 'none'; base-uri 'none'";
  }
  responseHeaders['x-content-type-options'] = 'nosniff';
  if (responseHeaders.location?.startsWith('/') && !responseHeaders.location.startsWith(basePath)) responseHeaders.location = basePath + responseHeaders.location.replace(/^\//, '');
  res.writeHead(upstream.statusCode, responseHeaders); await pipeline(upstream, res, { signal });
}
