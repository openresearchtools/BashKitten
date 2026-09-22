#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadPi, allowRuntimeWork } from '../rpc/runtime.mjs';
import { dataDir, sessionsDir, sessionDir, socketPath, readMeta, writeMeta, readJson, writeJson, privateDir, createJson, json, jsonBody, formBody, workerRequest, safeName, withinRoot, allMeta } from '../common.mjs';
import { displayMessage, queueItem, savedSession } from '../rpc/rpc.mjs';
import { ensureManager, controlRequest } from '../control.mjs';
import * as auth from './web-auth.mjs';
import { licenses } from '../licenses.mjs';
import { Services } from '../rpc/services.mjs';
import { gitChanges, gitDiff } from '../files/git.mjs';
import { folderLocations, pickerDirectory, listFolders } from '../files/folders.mjs';
import { fileDirectory, filePath, listFiles, sendFile, uploadFiles, saveAttachments, inlineAttachments, promptWithAttachments } from '../files/files.mjs';
import { startFileJob, fileJob, cancelFileJob, downloadFileJob, sendZip, closeFileJobs } from '../files/jobs.mjs';
import { syncContext } from '../rpc/context.mjs';
import { platform } from '../platform/index.mjs';
import { visibleSession } from '../rpc/notifications.mjs';
import { claimInstance, processStart, probeBackend } from '../instance.mjs';
import { paths } from '../access/paths.mjs';
import { handleBrowserChannel, closeBrowserChannels, ensureBrowserSocket, closeBrowserSocket } from '../access/browser-channel.mjs';

process.umask(0o077);
await privateDir(dataDir); await privateDir(sessionsDir); await privateDir(path.join(dataDir, 'run'));
if (!process.env.BASHKITTEN_BACKEND_SOCKET) {
  const port = process.argv.find(arg => arg.startsWith('--port='))?.slice(7) || process.env.PORT;
  if (port) {
    if (!Number.isInteger(Number(port)) || Number(port) < 1024 || Number(port) > 65535) throw Error('Invalid HTTPS port');
    const file = path.join(dataDir, 'settings.json');
    await writeJson(file, { ...await readJson(file, {}), web_port: Number(port) });
  }
  await ensureManager();
  const status = await controlRequest('start', {});
  console.log('BashKitten · ' + status.web.url);
  process.exit(0);
}
const ownership = await claimInstance('web');
if (!ownership) {
  for (const deadline = Date.now() + 15000; Date.now() < deadline;) {
    const existing = await probeBackend();
    if (existing) { console.log(`BashKitten already running at ${existing.url}`); process.exit(0); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('The existing BashKitten backend is not responding. Use Restart backend.');
}
const instanceToken = process.env.BASHKITTEN_INSTANCE_TOKEN;
if (!/^[a-f0-9]{64}$/.test(instanceToken || '')) throw Error('Private controller token required');
const started = await processStart(process.pid);
await syncContext();
const here = path.dirname(fileURLToPath(import.meta.url));
const scheme = 'https';
const services = new Services(), starts = new Map();
const configFile = path.join(dataDir, 'settings.json');
let config = await readJson(configFile, { web_port: 3939, theme: 'system', default_cwd: os.homedir(), default_model: '', default_thinking: '' });
const portOverride = process.argv.find(arg => arg.startsWith('--port='))?.slice(7) || process.env.PORT;
if (portOverride) config.web_port = Number(portOverride);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function running(id) { try { return await workerRequest(id, '/status'); } catch { return null; } }
async function ensureWorker(id, explicit = false) {
  allowRuntimeWork();
  const browserSocket = await ensureBrowserSocket(id);
  const lifecycle = path.join(sessionDir(id), 'lifecycle.json');
  if ((await readJson(lifecycle, {})).stopped) {
    if (!explicit) throw Error('Pi instance is stopped. Press Start Pi to resume.');
    await writeJson(lifecycle, { stopped: false });
  }
  if (starts.has(id)) return starts.get(id);
  const starting = (async () => {
    if (await running(id)) return;
    await readMeta(id);
    const log = openSync(path.join(sessionDir(id), 'worker.log'), 'a', 0o600);
    const child = spawn(process.execPath, [path.join(here, '../rpc/worker.mjs'), id], { detached: true, stdio: ['ignore', log, log], env: { ...process.env, BASHKITTEN_BROWSER_SOCKET: browserSocket } });
    closeSync(log); child.unref();
    let failure; child.on('error', error => { failure = error; });
    for (let attempt = 0; attempt < 160; attempt++) { if (failure) throw failure; if (await running(id)) return; await pause(100); }
    throw Error('Pi could not start. Check Node/Pi installation and the session worker.log.');
  })();
  starts.set(id, starting);
  try { return await starting; } finally { starts.delete(id); }
}
async function savedView(meta) {
  const native = await savedSession(meta);
  if (native && native.getCwd() !== meta.cwd) { meta.cwd = native.getCwd(); await writeMeta(meta); }
  const entries = native?.getBranch() || [];
  const drafts = (await readJson(path.join(sessionDir(meta.id), 'drafts.json'), [])).map(item => ({ ...item, recovered: true, editToken: undefined }));
  return { cwd: native?.getCwd() || meta.cwd, busy: false, stopped: Boolean((await readJson(path.join(sessionDir(meta.id), 'lifecycle.json'), {})).stopped),
    entries: entries.map(e => e.type === 'message' ? { ...e, message: displayMessage(meta, e.message) } : e), events: [],
    steeringMessages: drafts.filter(q => q.kind === 'steer').map(queueItem), queuedMessages: drafts.filter(q => q.kind !== 'steer').map(queueItem) };
}
const hiddenSessionsFile = path.join(dataDir, 'hidden-pi-sessions.json');
let discovery, discoveredAt = 0;
async function discoverSessions() {
  if (discovery) return discovery;
  if (Date.now() - discoveredAt < 5000) return;
  discovery = (async () => {
    const { pi: { SessionManager } } = await loadPi();
    const native = await SessionManager.listAll();
    const hidden = await readJson(hiddenSessionsFile, []);
    const known = new Map((await allMeta()).filter(meta => meta.piFile).map(meta => [meta.piFile, meta]));
    for (const session of native) {
      if (hidden.includes(session.path) || !session.cwd || !/^[a-f0-9-]{36}$/.test(session.id)) continue;
      const existing = known.get(session.path);
      if (existing) {
        // A live worker owns its metadata. Pi's discovery remains read-only.
        if (await running(existing.id)) continue;
        const next = { ...existing, cwd: session.cwd, title: session.name || existing.title, modified: Number(session.modified) };
        if (next.cwd !== existing.cwd || next.title !== existing.title || next.modified !== existing.modified) await writeMeta(next);
      } else {
        const meta = { id: session.id, cwd: session.cwd, title: session.name || session.firstMessage?.replace(/\s+/g, ' ').slice(0, 100) || 'Pi session',
          piFile: session.path, piSessionId: session.id, imported: true, modified: Number(session.modified), messages: [] };
        await privateDir(sessionDir(meta.id));
        await createJson(path.join(sessionDir(meta.id), 'ui.json'), meta);
      }
    }
    discoveredAt = Date.now();
  })();
  try { await discovery; } finally { discovery = null; }
}
async function sessionList() {
  await discoverSessions();
  return Promise.all((await allMeta()).map(async meta => {
    const state = await running(meta.id);
    return { id: meta.id, title: meta.title, cwd: meta.cwd, model: meta.model, thinking: meta.thinking, modified: meta.modified, current_segment: 1, running: Boolean(state?.data.busy) };
  })).then(items => items.sort((a, b) => b.modified - a.modified));
}
async function createSession(value) {
  const cwd = (await pickerDirectory(value.cwd || config.default_cwd)).path;
  const id = randomUUID(), dir = sessionDir(id); await privateDir(dir);
  const title = String(value.title || value.prompt || 'New chat').trim().replace(/\s+/g, ' ').slice(0, 100) || 'Image session';
  const meta = { id, cwd, title, model: value.model || config.default_model, thinking: value.thinking || config.default_thinking,
    piFile: null, modified: Date.now(), messages: [] };
  await writeMeta(meta);
  return meta;
}
async function deleteSession(id) {
  if (discovery) await discovery;
  const meta = await readMeta(id);
  if (meta.piFile) await writeJson(hiddenSessionsFile, [...new Set([...(await readJson(hiddenSessionsFile, [])), meta.piFile])]);
  if (await running(id)) await workerRequest(id, '/shutdown', {});
  // Pi owns history, including native forks that may share a session directory.
  // Removing a sidebar entry must never remove another native session.
  for (const name of ['ui.json', 'drafts.json', 'lifecycle.json', 'worker.log']) await fs.rm(path.join(sessionDir(id), name), { force: true });
  await fs.rmdir(sessionDir(id)).catch(() => {});
  await fs.rm(socketPath(id), { force: true }); await fs.rm(socketPath(id) + '.lock', { force: true });
  await closeBrowserSocket(id);
}
function requireMethod(req, allowed) { if (!allowed.includes(req.method)) throw Object.assign(Error('Method not allowed'), { status: 405 }); }
const html = await fs.readFile(path.join(here, '../../web/web_ui.html'));
const loginHtml = await fs.readFile(path.join(here, '../../web/pi_login.html'));
const css = html.toString().match(/<style>([\s\S]*?)<\/style>/)[1];
const aboutHtml = await fs.readFile(path.join(here, '../../web/about.html'));
const aboutScript = await fs.readFile(path.join(here, '../../web/about.js'));
let activeServer;
async function handler(req, res) {
  try {
    const requestHost = req.headers.host || '';
    if (!/^(?:127\.0\.0\.1:\d+|[a-z2-7]{56}\.onion(?::\d+)?)$/.test(requestHost)) throw Object.assign(Error('Invalid Agent host'), { status: 403 });
    const url = new URL(req.url, `${scheme}://${requestHost}`), route = url.pathname;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (route === '/api/instance') {
      if (req.method !== 'GET' || req.headers.authorization !== 'Bearer ' + instanceToken) throw Object.assign(Error('Invalid instance token'), { status: 403 });
      return json(res, { pid: process.pid, instance: instanceToken });
    }
    auth.origin(req);
    if (route === '/.well-known/bashkitten-ca' && req.method === 'GET') return json(res, await readJson(paths.identity));
    if (route === '/about' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(aboutHtml); }
    if (['/', '/pi-login'].includes(route) && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" }); return res.end(route === '/' ? html : loginHtml); }
    if (route === '/app.css' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(css); }
    if (route === '/about.js' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(aboutScript); }
    if (route === '/licenses.json' && req.method === 'GET') return json(res, await licenses());
    if (route === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const mutation = !['GET', 'HEAD'].includes(req.method);
    if (mutation) auth.checkOrigin(req);
    const record = await auth.login(req);
    if (route === '/api/bootstrap') { requireMethod(req, ['GET']); return json(res, await auth.bootstrap(record)); }
    if (!record) throw Object.assign(Error('Sign in to BashKitten'), { status: 401 });
    if (mutation) auth.checkCsrf(req, record);
    if (route === '/api/logout') { requireMethod(req, ['POST']); await auth.logout(record, res); closeBrowserChannels(record.key); return json(res, { ok: true, loginUrl: '/login' }); }
    if (route === '/api/browser-channel/poll') {
      const stopWatching = auth.watch(record, () => { closeBrowserChannels(record.key); res.end(); });
      res.once('close', stopWatching);
    }
    if (await handleBrowserChannel(req, res, record, route)) return;
    if (route === '/api/visibility') {
      requireMethod(req, ['POST']);
      const value = await jsonBody(req);
      await visibleSession(value.client, value.id, Boolean(value.visible));
      return json(res, { ok: true });
    }
    if (route === '/api/control') {
      requireMethod(req, ['GET', 'POST']);
      const value = mutation ? await jsonBody(req) : { command: 'status' };
      if (!['status', 'start', 'stop', 'restart', 'pi-abort', 'pi-stop', 'pi-kill', 'package-job', 'package-cancel', 'package-inventory', 'notifications', 'notifications-ack', 'notification-settings', 'llama-options', 'llama-configure', 'llama-start', 'llama-stop', 'llama-probe', 'get_remote_access', 'set_remote_access', 'create_remote_connection', 'revoke_remote_connection'].includes(value.command)) throw Error('Unknown control action');
      await ensureManager(); return json(res, await controlRequest(value.command, mutation ? value : undefined));
    }
    if (route === '/api/settings') {
      requireMethod(req, ['GET', 'POST']);
      if (!mutation) return json(res, { config, locations: await folderLocations(), platform });
      const input = await jsonBody(req);
      const next = { web_port: Number(input.web_port), theme: ['system', 'light', 'dark'].includes(input.theme) ? input.theme : 'system',
        default_cwd: (await pickerDirectory(input.default_cwd)).path, default_model: String(input.default_model || ''), default_thinking: String(input.default_thinking || '') };
      if (input.notifications !== undefined) next.notifications = { enabled: Boolean(input.notifications?.enabled), onlyWhenHidden: input.notifications?.onlyWhenHidden !== false, preview: input.notifications?.preview !== false };
      if (!Number.isInteger(next.web_port) || next.web_port < 1024 || next.web_port > 65535) throw Error('Port must be between 1024 and 65535');
      const restartRequired = next.web_port !== config.web_port;
      config = next; await writeJson(configFile, config);
      return json(res, { config, restartRequired });
    }
    if (route === '/api/models') {
      requireMethod(req, ['GET']);
      const id = url.searchParams.get('session');
      const native = id && await running(id) ? await workerRequest(id, '/models') : null;
      return json(res, { models: await services.models(native?.models), defaultModel: config.default_model, defaultThinking: config.default_thinking });
    }
    if (route === '/api/services') { requireMethod(req, ['GET']); return json(res, { services: await services.list(), login: services.state() }); }
    if (route === '/api/services/login-status') { requireMethod(req, ['GET']); return json(res, { login: services.state() }); }
    if (route.startsWith('/api/services/')) {
      requireMethod(req, ['POST']); const input = await jsonBody(req);
      if (route.endsWith('/login')) await services.start(input.provider, input.type);
      else if (route.endsWith('/answer')) services.answer(input.id, input.promptId, input.input);
      else if (route.endsWith('/cancel')) await services.cancel(input.id);
      else if (route.endsWith('/logout')) await services.logout(input.provider);
      else if (route.endsWith('/refresh')) await services.refresh(input.provider);
      else throw Error('Unknown service action');
      return json(res, { login: services.state() });
    }
    if (route === '/api/folders') {
      requireMethod(req, ['GET', 'POST']);
      if (mutation) { const input = await jsonBody(req); const parent = (await pickerDirectory(input.parent)).path; const folder = path.join(parent, safeName(input.name)); await fs.mkdir(folder, { mode: 0o700 }); return json(res, { path: folder }); }
      return json(res, await listFolders(url.searchParams.get('path') || config.default_cwd, url.searchParams.get('nearest') === 'true'));
    }
    if (route === '/api/files/jobs') {
      requireMethod(req, ['POST']); return json(res, await startFileJob(await jsonBody(req)), 202);
    }
    if (route === '/api/files/archive' && req.method === 'POST') {
      const { root } = await jsonBody(req);
      return json(res, await startFileJob({ operation: 'archive', root, paths: [''] }, { whole: true }), 202);
    }
    const fileJobRoute = route.match(/^\/api\/files\/jobs\/([a-f0-9-]{36})(?:\/(cancel|download))?$/);
    if (fileJobRoute) {
      const [, id, action] = fileJobRoute;
      requireMethod(req, action === 'cancel' ? ['POST'] : ['GET']);
      if (action === 'cancel') return json(res, cancelFileJob(id));
      if (action === 'download') return await downloadFileJob(req, res, id);
      return json(res, fileJob(id));
    }
    if (route === '/api/files' || route === '/api/files/content' || route === '/api/files/archive') {
      requireMethod(req, route === '/api/files' ? ['GET', 'POST'] : ['GET']);
      const root = (await fileDirectory(url.searchParams.get('root'))).path;
      const relative = url.searchParams.get('path') || '';
      if (route.endsWith('/content')) return await sendFile(req, res, await filePath(root, relative), url.searchParams.get('download') === 'true');
      if (route.endsWith('/archive')) return await sendZip(req, res, root);
      if (mutation) { const form = await formBody(req); return json(res, { saved: await uploadFiles(root, relative, form.getAll('file')) }); }
      return json(res, await listFiles(root, relative));
    }
    if (route === '/api/git/changes' || route === '/api/git/diff') {
      requireMethod(req, ['GET']);
      const controller = new AbortController();
      const cancel = () => controller.abort();
      res.once('close', cancel);
      try {
        const root = (await fileDirectory(url.searchParams.get('root') || config.default_cwd)).path;
        const options = { signal: controller.signal, authorizeRoot: fileDirectory };
        const result = route.endsWith('/diff')
          ? await gitDiff(root, url.searchParams.get('path'), options)
          : await gitChanges(root, options);
        return json(res, result);
      } finally { res.off('close', cancel); }
    }
    if (route === '/api/pi-sessions') {
      const { pi: { SessionManager } } = await loadPi();
      requireMethod(req, ['GET']);
      return json(res, { sessions: (await SessionManager.listAll()).map(s => ({ path: s.path, id: s.id, cwd: s.cwd, name: s.name || s.firstMessage || 'Pi session' })) });
    }
    if (route === '/api/sessions/import') {
      const { pi: { SessionManager } } = await loadPi();
      requireMethod(req, ['POST']); const input = await jsonBody(req);
      const found = (await SessionManager.listAll()).find(s => s.path === input.path);
      if (!found) throw Error('Choose a session from Pi’s session list');
      await writeJson(hiddenSessionsFile, (await readJson(hiddenSessionsFile, [])).filter(file => file !== found.path));
      const existing = (await allMeta()).find(m => m.piFile === found.path);
      if (existing) return json(res, { id: existing.id });
      const meta = await createSession({ cwd: found.cwd, title: found.name || found.firstMessage });
      meta.piFile = found.path; meta.imported = true; await writeMeta(meta); return json(res, { id: meta.id });
    }
    if (route === '/api/sessions') {
      requireMethod(req, ['GET', 'POST']);
      if (mutation) { const form = await formBody(req); const meta = await createSession(Object.fromEntries(form)); await ensureWorker(meta.id); return json(res, { id: meta.id }); }
      const sessions = await sessionList(), offset = Math.max(0, Number(url.searchParams.get('offset')) || 0), limit = Math.min(100, Number(url.searchParams.get('limit')) || 100);
      return json(res, { sessions: sessions.slice(offset, offset + limit), nextOffset: offset + limit < sessions.length ? offset + limit : null });
    }
    if (route === '/api/projects/delete' || route === '/api/sessions/project' || route === '/api/session-groups') {
      requireMethod(req, ['GET', 'POST', 'DELETE']);
      if (!mutation) return json(res, { sessionIds: (await allMeta()).filter(m => m.cwd === url.searchParams.get('cwd')).map(m => m.id) });
      const input = await jsonBody(req);
      const selected = (await allMeta()).filter(m => m.cwd === input.cwd);
      if (route === '/api/session-groups' && (!input.confirm || selected.some(m => !input.sessionIds?.includes(m.id)) || input.sessionIds?.length !== selected.length)) throw Error('Project chats changed. Review the deletion again.');
      for (const meta of selected) await deleteSession(meta.id);
      return json(res, { deletedIds: selected.map(m => m.id) });
    }
    const match = route.match(/^\/api\/sessions\/([a-f0-9-]{36})(?:\/(.*))?$/);
    if (!match) throw Object.assign(Error('Not found'), { status: 404 });
    const [, id, action = ''] = match; let meta = await readMeta(id);
    if (action === 'events') {
      requireMethod(req, ['GET']);
      const upstream = http.get({ socketPath: socketPath(id), path: '/events' }, stream => {
        res.writeHead(stream.statusCode, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' }); stream.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('event: offline\ndata: {}\n\n'); });
      const stopWatching = auth.watch(record, () => { upstream.destroy(); res.end(); });
      res.on('close', () => { stopWatching(); upstream.destroy(); }); return;
    }
    if (action.startsWith('attachments/')) {
      requireMethod(req, ['GET']); const parts = action.split('/').slice(1).map(decodeURIComponent);
      if (parts.length !== 2) throw Error('Invalid attachment');
      const file = (meta.messages || []).flatMap(m => m.attachments).find(a => a.path.endsWith('/attachments/' + parts.join('/')));
      if (!file) throw Object.assign(Error('Attachment not found'), { status: 404 });
      return await sendFile(req, res, file.path, url.searchParams.get('download') === 'true');
    }
    if (action === 'fork-messages') { requireMethod(req, ['GET']); await ensureWorker(id); return json(res, await workerRequest(id, '/fork-messages')); }
    if (action === 'status') { requireMethod(req, ['GET']); return json(res, await running(id) || { data: await savedView(meta) }); }
    if (action.startsWith('segments/')) { requireMethod(req, ['GET']); const view = await workerRequest(id, '/view').catch(() => savedView(meta)); return json(res, { segment: 1, entries: view.entries }); }
    requireMethod(req, ['POST', 'DELETE', 'PATCH']);
    if (!action && req.method === 'PATCH') {
      const input = await jsonBody(req), title = String(input.name || '').trim();
      if (!title || title.length > 200) throw Error('Choose a name of 1–200 characters');
      await ensureWorker(id); await workerRequest(id, '/rename', { title }); return json(res, { title });
    }
    if (!action || action === 'delete') { if (req.method !== 'DELETE' && action !== 'delete') throw Error('Use DELETE'); await deleteSession(id); return json(res, { deleted: [id] }); }
    if (action === 'resume') {
      const value = await jsonBody(req);
      if ((await readJson(path.join(sessionDir(id), 'lifecycle.json'), {})).stopped && !value.start) return json(res, { stopped: true, snapshot: await savedView(meta) });
      await ensureWorker(id, Boolean(value.start)); return json(res, { ok: true });
    }
    await ensureWorker(id);
    if (action === 'messages') {
      const form = await formBody(req), text = String(form.get('content') || '');
      const attachments = await saveAttachments([...form.getAll('file'), ...inlineAttachments(form.getAll('inline_file'))]);
      const known = (meta.messages || []).flatMap(m => m.attachments);
      for (const retained of form.getAll('retained_attachment')) { const file = known.find(a => a.path === retained); if (!file) throw Error('Unknown retained attachment'); if (!attachments.some(a => a.path === file.path)) attachments.push(file); }
      if (!text.trim() && !attachments.length) throw Error('Write a message or attach a file');
      if (form.get('goal')) throw Error('Goals are provided by Pi extensions; use a configured Pi command');
      return json(res, await workerRequest(id, '/message', { ...await promptWithAttachments(text, attachments), kind: form.get('delivery') === 'steer' ? 'steer' : 'queue' }));
    }
    const input = await jsonBody(req);
    if (['fork', 'clone'].includes(action)) return json(res, await workerRequest(id, '/' + action, input));
    if (action === 'title' || action === 'rename') {
      const title = String(input.title || input.name || '').trim(); if (!title || title.length > 200) throw Error('Choose a name of 1–200 characters');
      return json(res, await workerRequest(id, '/rename', { title }));
    }
    if (!['stop', 'queue', 'model', 'compact', 'reply'].includes(action)) throw Error('Unknown session action');
    return json(res, await workerRequest(id, '/' + action, input));
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    json(res, { error: error.message }, error.status || (error.code === 'ENOENT' ? 404 : 400));
  }
}
activeServer = http.createServer(handler);
await fs.rm(process.env.BASHKITTEN_BACKEND_SOCKET, { force: true });
await new Promise((resolve, reject) => { activeServer.once('error', reject); activeServer.listen(process.env.BASHKITTEN_BACKEND_SOCKET, resolve); });
await fs.chmod(process.env.BASHKITTEN_BACKEND_SOCKET, 0o600);
await writeJson(paths.backendInfo, { pid: process.pid, started });
for (const meta of await allMeta()) if (await running(meta.id)) {
  await ensureBrowserSocket(meta.id);
  await workerRequest(meta.id, '/context', {}).catch(() => {});
}
console.log('BashKitten private Pi RPC backend ready');
process.on('SIGTERM', () => { closeBrowserChannels(); activeServer.close(); activeServer.closeAllConnections(); Promise.allSettled([services.cancel(), closeFileJobs()]).finally(() => process.exit(0)); });
