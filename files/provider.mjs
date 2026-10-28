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
const sourcePerm = scope => ({ name: sourceName(scope), scope: '/', permissions: permissions(scope) });
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
    const sources = (previous?.server?.sources || []).filter(entry => entry.path !== root).map(entry => ({ ...entry, config: { ...entry.config, rules: rulesFor(entry.path) } })); sources.push(source);
    const config = { server: { disableUpdateCheck: true, database: { path: path.join(directory, 'quantum.sqlite') }, cacheDir: path.join(directory, 'cache'), sources }, http: { requestTimeoutMs: 120000, proxyTransferTimeouts: true, socket: socketPath, baseURL: '/', disableWebDAV: true, trustProxyHeaders: true }, auth: { adminUsername: bootstrap, adminPassword: previous?.auth?.adminPassword || randomBytes(48).toString('base64url'), key: previous?.auth?.key || randomBytes(48).toString('base64url'), methods: { noauth: false, password: { enabled: false }, proxy: { enabled: true, header: 'X-BashKitten-Quantum-User' } } }, frontend: { name: 'BashKitten Files', favicon: path.join(moduleRoot, 'web', 'bashkitten.png'), loginIcon: path.join(moduleRoot, 'web', 'bashkitten.png'), description: 'Files', disableDefaultLinks: true, disablePWAInstall: true, styling: { disableEventThemes: true, customCSS: path.join(moduleRoot, 'web', 'quantum.css'), darkBackground: '#20201f', lightBackground: '#faf9f7' } }, userDefaults: { ui: { darkMode: true }, account: { disableSettings: true, permissions: { admin: false, api: false, share: false, realtime: true } }, preview: { office: false } }, integrations: { media: { ffmpegPath: path.join(moduleRoot, 'bin') } } };
    await fs.mkdir(config.server.cacheDir, { recursive: true, mode: 0o700 });
    const content = JSON.stringify(config); const changed = !previous || JSON.stringify(previous) !== content; if (changed) await atomic(filename, config);
    const binary = path.join(moduleRoot, 'bin', 'filebrowser');
    return { service: { id: 'quantum', name: 'Files', target: { network: 'unix', address: config.http.socket }, scheme: 'http', kind: 'web', openPath: '/', enabled: false, startup: false, command: { argv: [binary, '-c', filename], cwd: directory, env: { BASHKITTEN_FILES_CONFIG_REVISION: digest(content) } } }, openPath: `files/${source.name}/`, source: source.name, username: userName(scope), configRevision: digest(content), needsRestart: !!previous && changed, endpoint };
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
async function jsonRequest(socketPath, method, target, username, body, signal) {
  const response = await request(socketPath, method, target, { headers: { 'X-BashKitten-Quantum-User': username, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  let size = 0; const chunks = []; for await (const chunk of response) { size += chunk.length; if (size > 2 << 20) throw failure(502, 'Native API response exceeds its bound'); chunks.push(chunk); }
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
  const data = { username, loginMethod: 'proxy', permissions: { admin: false, api: false, share: false, realtime: true }, disableSettings: true, scopes: [sourcePerm(scope)] };
  // Native proxy authentication creates the account using deny-all defaults; the
  // private bootstrap administrator then reconciles actual stored permissions.
  await jsonRequest(socketPath, 'GET', '/api/users?username=self', username, undefined, signal);
  await jsonRequest(socketPath, 'PATCH', '/api/users?username=' + encodeURIComponent(username), config.auth.adminUsername, { which: ['permissions', 'disableSettings', 'scopes'], data }, signal);
  return { socketPath, username };
}
const deniedPaths = /^\/(?:api\/(?:settings|users|auth|tokens|sharing|office|access)|public\/share)(?:\/|$|\?)/;
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
export async function handleFiles(req, res, { dataRoot, scope, basePath, signal, authorizePath, openOffice }) {
  if (!/^\/apps\/files\/[A-Za-z0-9_-]+\/$/.test(basePath)) throw failure(400, 'Invalid scoped Files route');
  scope = { ...scope, root: await fs.realpath(scope.root) };
  const native = await serial('account:' + scope.id, () => reconcileAccount(dataRoot, scope, signal));
  const url = new URL(req.url, 'http://files');
  if (!url.pathname.startsWith(basePath)) throw failure(403, 'Wrong Files launch scope');
  const route = nativeRoute('/' + url.pathname.slice(basePath.length));
  const relative = route.decoded;
  for (const key of ['auth', 'jwt', 'access_token']) url.searchParams.delete(key);
  if (relative === '/api/document-provider/open') {
    if (req.method !== 'GET' || typeof openOffice !== 'function') throw failure(503, 'Office is unavailable');
    if (url.searchParams.get('source') !== sourceName(scope)) throw failure(403, 'Wrong Files source');
    const launched = await openOffice({ relativePath: (url.searchParams.get('path') || '').replace(/^\//, '') });
    res.writeHead(303, { Location: launched.browserUrl, 'Cache-Control': 'no-store' }); res.end(); return;
  }
  // These native read endpoints are needed by the ordinary frontend. All other
  // administration, shares and credential endpoints remain inaccessible.
  if (deniedPaths.test(relative + url.search) && !['/api/users', '/api/settings/sources', '/api/settings/user-defaults', '/api/settings/source', '/api/auth/login'].includes(relative)) throw failure(403, 'This Files account cannot administer the service');
  if ((relative.startsWith('/api/users') && !(req.method === 'GET' && url.searchParams.get('username') === 'self')) || (relative.startsWith('/api/settings') && req.method !== 'GET')) throw failure(403, 'Files settings are managed by the owning backend');
  // Native scopes remain the actual file authority. The host additionally checks
  // every explicit source path, including private state and symlink targets.
  for (const key of ['source', 'destinationSource', 'destSource', 'fromSource', 'toSource']) if (url.searchParams.has(key) && url.searchParams.get(key) !== sourceName(scope)) throw failure(403, 'Files source is outside the launch grant');
  const tree = relative === '/api/raw' || relative === '/api/resources/download' || relative === '/api/resources/archive' || relative === '/api/resources/unarchive' || (relative.startsWith('/api/resources') && ['DELETE', 'PATCH'].includes(req.method));
  const checkPath = async value => { if (typeof value !== 'string') throw failure(400, 'Native file path must be text'); const filename = path.resolve(scope.root, value.replace(/^\//, '')); if (filename !== scope.root && !filename.startsWith(scope.root + path.sep)) throw failure(403, 'File path leaves this source'); if (authorizePath) await authorizePath(filename, { tree }); };
  for (const key of ['path', 'file', 'destination', 'destinationPath', 'destPath', 'fromPath', 'toPath']) for (const value of url.searchParams.getAll(key)) await checkPath(value);
  let forwardedBody = req;
  if ((req.method === 'PATCH' && relative === '/api/resources') || (req.method === 'DELETE' && relative === '/api/resources/bulk') || (req.method === 'POST' && ['/api/resources/archive', '/api/resources/unarchive', '/api/resources/view-token'].includes(relative))) {
    let size = 0; const parts = []; for await (const part of req) { size += part.length; if (size > 4 << 20) throw failure(413, 'Native operation list is too large'); parts.push(part); }
    forwardedBody = Buffer.concat(parts); const operation = JSON.parse(forwardedBody.toString('utf8'));
    const inspect = async value => { if (!value || typeof value !== 'object') return; for (const [key, entry] of Object.entries(value)) { if (['source', 'fromSource', 'toSource'].includes(key) && entry !== sourceName(scope)) throw failure(403, 'Files source is outside the launch grant'); if (['path', 'fromPath', 'toPath', 'destination', 'destinationPath'].includes(key)) await checkPath(entry); else if (key === 'paths' && Array.isArray(entry)) { for (const filename of entry) await checkPath(filename); } else if (typeof entry === 'object') await inspect(entry); } };
    await inspect(operation);
  }
  const headers = { ...req.headers, 'X-BashKitten-Quantum-User': native.username, 'X-Forwarded-Prefix': basePath, 'X-BashKitten-Document-Provider': basePath + 'api/document-provider/open' };
  for (const key of Object.keys(headers)) if (key.toLowerCase().startsWith('x-bashkitten-') || ['cookie', 'authorization', 'x-bashkitten-quantum-user', 'x-forwarded-prefix', 'x-bashkitten-document-provider', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip'].includes(key.toLowerCase())) delete headers[key];
  headers['X-BashKitten-Quantum-User'] = native.username; headers['X-Forwarded-Prefix'] = basePath; headers['X-BashKitten-Document-Provider'] = basePath + 'api/document-provider/open'; headers.host = 'files';
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
