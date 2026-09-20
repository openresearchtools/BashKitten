#!/usr/bin/env node
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { loadPi, allowRuntimeWork } from '../rpc/runtime.mjs';
import { dataDir, sessionsDir, sessionDir, socketPath, readMeta, writeMeta, readJson, writeJson, privateDir, json, jsonBody, formBody, workerRequest, safeName, withinRoot, allMeta } from '../common.mjs';
import { displayMessage, queueItem, savedSession } from '../rpc/rpc.mjs';
import { ensureManager, controlRequest } from '../control.mjs';
import * as auth from './web-auth.mjs';
import { licenses } from '../licenses.mjs';
import { Services } from '../rpc/services.mjs';
import { folderLocations, pickerDirectory, listFolders } from '../files/folders.mjs';
import { listFiles, sendFile, sendZip, uploadFiles, saveAttachments, inlineAttachments, promptWithAttachments } from '../files/files.mjs';
import { syncContext } from '../rpc/context.mjs';
import { platform } from '../platform/index.mjs';
import { visibleSession } from '../platform/termux/notifications.mjs';
import { claimInstance, processStart, probeBackend, serverFile } from '../instance.mjs';

process.umask(0o077);
await privateDir(dataDir); await privateDir(sessionsDir); await privateDir(path.join(dataDir, 'run'));
const ownership = await claimInstance('web');
if (!ownership) {
  for (const deadline = Date.now() + 15000; Date.now() < deadline;) {
    const existing = await probeBackend();
    if (existing) { console.log(`BashKitten already running at ${existing.url}`); process.exit(0); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('The existing BashKitten backend is not responding. Use Restart backend.');
}
const instanceToken = randomBytes(32).toString('hex');
const started = await processStart(process.pid);
await syncContext();
const here = path.dirname(fileURLToPath(import.meta.url));
const certFile = process.env.BASHKITTEN_TLS_CERT, keyFile = process.env.BASHKITTEN_TLS_KEY;
if (Boolean(certFile) !== Boolean(keyFile)) throw Error('Configure both BASHKITTEN_TLS_CERT and BASHKITTEN_TLS_KEY');
const tls = certFile ? { cert: await fs.readFile(certFile), key: await fs.readFile(keyFile) } : null;
const scheme = tls ? 'https' : 'http';
const services = new Services(), starts = new Map();
const configFile = path.join(dataDir, 'settings.json');
let config = await readJson(configFile, { web_port: 3939, theme: 'system', default_cwd: os.homedir(), default_model: '', default_thinking: '' });
const portOverride = process.argv.find(arg => arg.startsWith('--port='))?.slice(7) || process.env.PORT;
if (portOverride) config.web_port = Number(portOverride);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function running(id) { try { return await workerRequest(id, '/status'); } catch { return null; } }
async function ensureWorker(id, explicit = false) {
  allowRuntimeWork();
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
    const child = spawn(process.execPath, [path.join(here, '../rpc/worker.mjs'), id], { detached: true, stdio: ['ignore', log, log], env: process.env });
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
async function sessionList() {
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
  if (await running(id)) await workerRequest(id, '/shutdown', {});
  // Pi owns history, including native forks that may share a session directory.
  // Removing a sidebar entry must never remove another native session.
  for (const name of ['ui.json', 'drafts.json', 'lifecycle.json', 'worker.log']) await fs.rm(path.join(sessionDir(id), name), { force: true });
  await fs.rmdir(sessionDir(id)).catch(() => {});
  await fs.rm(socketPath(id), { force: true }); await fs.rm(socketPath(id) + '.lock', { force: true });
}
function requireMethod(req, allowed) { if (!allowed.includes(req.method)) throw Object.assign(Error('Method not allowed'), { status: 405 }); }
const html = await fs.readFile(path.join(here, '../../web/web_ui.html'));
const loginHtml = await fs.readFile(path.join(here, '../../web/pi_login.html'));
const css = html.toString().match(/<style>([\s\S]*?)<\/style>/)[1];
const aboutScript = await fs.readFile(path.join(here, '../../web/about.js'));
let activeServer;
async function handler(req, res) {
  try {
    const requestHost = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(requestHost)) throw Object.assign(Error('Invalid localhost host'), { status: 403 });
    const url = new URL(req.url, `${scheme}://${requestHost}`), route = url.pathname;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (route === '/api/instance') {
      if (req.method !== 'GET' || req.headers.authorization !== 'Bearer ' + instanceToken) throw Object.assign(Error('Invalid instance token'), { status: 403 });
      return json(res, { pid: process.pid, instance: instanceToken });
    }
    if (['/', '/pi-login'].includes(route) && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" }); return res.end(route === '/' ? html : loginHtml); }
    if (route === '/app.css' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(css); }
    if (route === '/about.js' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(aboutScript); }
    if (route === '/licenses.json' && req.method === 'GET') return json(res, await licenses());
    if (route === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const mutation = !['GET', 'HEAD'].includes(req.method);
    if (mutation) auth.checkOrigin(req);
    const record = await auth.login(req);
    if (route === '/api/bootstrap') { requireMethod(req, ['GET']); return json(res, await auth.bootstrap(record)); }
    if (route === '/api/signup' || route === '/api/login') {
      requireMethod(req, ['POST']);
      try { return json(res, await auth.authenticate(await jsonBody(req), route.endsWith('signup'), res)); }
      catch (error) { await pause(300); throw error; }
    }
    if (!record) throw Object.assign(Error('Sign in to BashKitten'), { status: 401 });
    if (mutation) auth.checkCsrf(req, record);
    if (route === '/api/logout') { requireMethod(req, ['POST']); await auth.logout(record, res); return json(res, { ok: true }); }
    if (route === '/api/visibility') {
      requireMethod(req, ['POST']);
      const value = await jsonBody(req);
      if (platform === 'termux') await visibleSession(value.client, value.id, Boolean(value.visible));
      return json(res, { ok: true });
    }
    if (route === '/api/control') {
      requireMethod(req, ['GET', 'POST']);
      const value = mutation ? await jsonBody(req) : { command: 'status' };
      if (!['status', 'start', 'stop', 'restart', 'pi-abort', 'pi-stop', 'pi-kill', 'package-job', 'package-cancel', 'desktop-settings', 'desktop-start', 'desktop-stop'].includes(value.command)) throw Error('Unknown control action');
      await ensureManager(); return json(res, await controlRequest(value.command, mutation ? value : undefined));
    }
    if (route === '/api/settings') {
      requireMethod(req, ['GET', 'POST']);
      if (!mutation) return json(res, { config, locations: await folderLocations(), platform });
      const input = await jsonBody(req);
      const next = { web_port: Number(input.web_port), theme: ['system', 'light', 'dark'].includes(input.theme) ? input.theme : 'system',
        default_cwd: (await pickerDirectory(input.default_cwd)).path, default_model: String(input.default_model || ''), default_thinking: String(input.default_thinking || '') };
      if (platform === 'termux') next.notifications = { enabled: Boolean(input.notifications?.enabled), onlyWhenHidden: input.notifications?.onlyWhenHidden !== false, preview: input.notifications?.preview !== false };
      if (!Number.isInteger(next.web_port) || next.web_port < 1024 || next.web_port > 65535) throw Error('Port must be between 1024 and 65535');
      let restartUrl;
      if (next.web_port !== config.web_port) {
        const old = activeServer; activeServer = await listenAvailable(next.web_port);
        requestedPort = next.web_port;
        next.web_port = activeServer.address().port;
        restartUrl = `${scheme}://${url.hostname}:${next.web_port}`;
        await announce(next.web_port);
        setTimeout(() => { old.close(); old.closeAllConnections(); }, 500);
      }
      config = next; await writeJson(configFile, config); return json(res, { config, restartUrl });
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
    if (route === '/api/files' || route === '/api/files/content' || route === '/api/files/archive') {
      requireMethod(req, route === '/api/files' ? ['GET', 'POST'] : ['GET']);
      // The selected root is an explicit filesystem choice, same as the folder picker.
      const root = (await pickerDirectory(url.searchParams.get('root'))).path;
      const relative = url.searchParams.get('path') || '';
      if (route.endsWith('/content')) return await sendFile(req, res, await withinRoot(root, relative), url.searchParams.get('download') === 'true');
      if (route.endsWith('/archive')) return await sendZip(res, root);
      if (mutation) { const form = await formBody(req); return json(res, { saved: await uploadFiles(root, relative, form.getAll('file')) }); }
      return json(res, await listFiles(root, relative));
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
      res.on('close', () => upstream.destroy()); return;
    }
    if (action.startsWith('attachments/')) {
      requireMethod(req, ['GET']); const parts = action.split('/').slice(1).map(decodeURIComponent);
      if (parts.length !== 2) throw Error('Invalid attachment');
      const file = (meta.messages || []).flatMap(m => m.attachments).find(a => a.path.endsWith('/attachments/' + parts.join('/')));
      if (!file) throw Object.assign(Error('Attachment not found'), { status: 404 });
      return await sendFile(req, res, file.path, url.searchParams.get('download') === 'true');
    }
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
    if (action === 'fork') return json(res, await workerRequest(id, '/fork', input));
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
function listen(port) { return new Promise((resolve, reject) => { const server = tls ? https.createServer(tls, handler) : http.createServer(handler); server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server)); }); }
async function listenAvailable(port) {
  try { return await listen(port); }
  catch (error) { if (error.code !== 'EADDRINUSE') throw error; return listen(0); }
}
let requestedPort = config.web_port;
const announce = port => writeJson(serverFile, { pid: process.pid, started, token: instanceToken, script: fileURLToPath(import.meta.url), url: `${scheme}://127.0.0.1:${port}`, requestedPort });
const previous = await readJson(serverFile, null);
const remembered = previous?.requestedPort === requestedPort && /^https?:\/\/127\.0\.0\.1:\d+$/.test(previous.url || '') ? Number(new URL(previous.url).port) : requestedPort;
activeServer = await listenAvailable(remembered);
config.web_port = activeServer.address().port;
await writeJson(configFile, config);
await announce(activeServer.address().port);
for (const meta of await allMeta()) if (await running(meta.id)) await workerRequest(meta.id, '/context', {}).catch(() => {});
console.log(`BashKitten · Pi RPC · ${scheme}://127.0.0.1:${config.web_port}`);
process.on('SIGTERM', () => { activeServer.close(); activeServer.closeAllConnections(); services.cancel().finally(() => process.exit(0)); });
