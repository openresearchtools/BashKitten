#!/usr/bin/env node
import { PhoneBackend, phoneStatus, requirePhoneIdentity, phonePolicy, savePhonePolicy, phoneRegistration, registerPhone, pendingPhoneEvents, acknowledgePhoneEvent, revokePhone, selectedPhone, initializePhonePolicy, pendingPhoneLive, acknowledgePhoneLive, disablePhone, pendingPhoneUpdates, acknowledgePhoneUpdate } from '../phone.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createPhoneWorkerSlot, withoutPhoneIssuers } from '../phone/owner.mjs';
import { handleGuestBrowser } from '../access/guest-browser.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { loadPi, allowRuntimeWork } from '../rpc/runtime.mjs';
import { dataDir, sessionsDir, sessionDir, socketPath, readMeta, writeMeta, readJson, writeJson, privateDir, createJson, json, jsonBody, body, formBody, workerRequest, safeName, withinRoot, allMeta } from '../common.mjs';
import { displayMessage, queueItem, savedSession } from '../rpc/rpc.mjs';
import { bindMessageEntries, unconsumedMessages } from '../rpc/message-presentation.mjs';
import { ensureManager, controlRequest } from '../control.mjs';
import * as auth from './web-auth.mjs';
import { Services } from '../rpc/services.mjs';
import { gitChanges, gitDiff } from '../files/git.mjs';
import { folderLocations, pickerDirectory, listFolders } from '../files/folders.mjs';
import { fileDirectory, filePath, referencedFile, sessionImage, sendFile, saveAttachments } from '../files/files.mjs';
import { managerAllowed, managerContext, authorizeManagerPath, runManagerRequest, refreshManagerPolicy, watchManagerPolicy } from '../files/access.mjs';
import { syncContext } from '../rpc/context.mjs';
import { platform } from '../platform/index.mjs';
import { visibleSession } from '../rpc/notifications.mjs';
import { claimInstance, processStart, probeBackend } from '../instance.mjs';
import { updateSettings } from '../settings.mjs';
import { paths } from '../access/paths.mjs';
import { handleBrowserChannel, closeBrowserChannels, ensureBrowserSocket, closeBrowserSocket } from '../access/browser-channel.mjs';
import { transcribe } from '../localai/dictation.mjs';
import { subagentSettings, readSubagentSettings, saveSubagentSettings } from '../rpc/subagents.mjs';
import { SubagentChats } from '../rpc/subagent-chats.mjs';
import { stopSavedQuestions } from '../rpc/questions.mjs';
import { projects, createProject, renameProject, removeProject, moveChat, forgetChat, projectDirectory, withProjectTransition } from '../projects.mjs';
import { ApplicationModules } from '../apps/index.mjs';

process.umask(0o077);
await privateDir(dataDir); await privateDir(sessionsDir); await privateDir(path.join(dataDir, 'run'));
if (!process.env.BASHKITTEN_BACKEND_SOCKET) {
  const port = process.argv.find(arg => arg.startsWith('--port='))?.slice(7) || process.env.PORT;
  if (port) {
    if (!Number.isInteger(Number(port)) || Number(port) < 1024 || Number(port) > 65535) throw Error('Invalid HTTPS port');
    await updateSettings(current => ({ ...current, web_port: Number(port) }));
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
const phoneOwnerToken = process.env.BASHKITTEN_PHONE_OWNER_HTTP_TOKEN;
delete process.env.BASHKITTEN_PHONE_OWNER_HTTP_TOKEN;
if (!/^[a-f0-9]{64}$/.test(phoneOwnerToken || '')) throw Error('Private Phone controller token required');
const providerOwnerToken = process.env.BASHKITTEN_PROVIDER_OWNER_HTTP_TOKEN;
delete process.env.BASHKITTEN_PROVIDER_OWNER_HTTP_TOKEN;
if (!/^[a-f0-9]{64}$/.test(providerOwnerToken || '')) throw Error('Private provider controller token required');
const started = await processStart(process.pid);
await syncContext();
const here = path.dirname(fileURLToPath(import.meta.url));
const scheme = 'https';
const services = new Services(), starts = new Map();
const apps = new ApplicationModules({ auth, resolveSession: async id => {
  const meta = await readMeta(id), catalogue = await projects();
  return { id, cwd: (await savedSession(meta))?.getCwd() || meta.cwd, projectId: catalogue.chats[id] || null };
} });
const subagents = new SubagentChats({ createSession, ensureWorker, running });
const phoneBackend = new PhoneBackend({ listSessions: sessionList, createSession, ensureWorker, running });
const configFile = path.join(dataDir, 'settings.json');
let config = await readJson(configFile, { web_port: 3939, theme: 'system', default_cwd: os.homedir(), default_model: '', default_thinking: '' });
const portOverride = process.argv.find(arg => arg.startsWith('--port='))?.slice(7) || process.env.PORT;
if (portOverride) config.web_port = Number(portOverride);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function running(id) { try { return await workerRequest(id, '/status'); } catch { return null; } }
async function ensureWorker(id, explicit = false) {
  return subagents.serial('worker:' + id, () => startWorker(id, explicit));
}
async function startWorker(id, explicit) {
  allowRuntimeWork();
  const lifecycle = path.join(sessionDir(id), 'lifecycle.json');
  if ((await readJson(lifecycle, {})).stopped) {
    if (!explicit) throw Error('Pi is stopped. Use Resume Pi or send a message to continue.');
  }
  if (starts.has(id)) return starts.get(id);
  const starting = (async () => {
    const meta = await readMeta(id);
    if (await running(id)) { await ensureBrowserSocket(meta.browserOwner || meta.workerOwner || id, id); return; }
    const cwd = (await savedSession(meta))?.getCwd() || meta.cwd;
    try {
      if (!(await fs.stat(cwd)).isDirectory()) throw Error(`This chat's working folder is not a directory: ${cwd}`);
    } catch (error) {
      if (error.code === 'ENOENT') throw Error(`This chat's working folder no longer exists: ${cwd}. Restore it or start a new chat in another folder.`);
      throw error;
    }
    return subagents.admit(meta, async () => {
      if (explicit) {
        // Recover a Stop interrupted after its durable marker but before the
        // offline question state was saved. No worker owns it under this lock.
        if ((await readJson(lifecycle, {})).stopped) await stopSavedQuestions(id);
        await writeJson(lifecycle, { stopped: false });
      }
      await closeBrowserSocket(id, { keepBinding: true });
      const browserOwner = randomUUID(), browserSocket = await ensureBrowserSocket(browserOwner, id);
      const log = openSync(path.join(sessionDir(id), 'worker.log'), 'a', 0o600);
      const phoneSlot = await createPhoneWorkerSlot(id);
      const workerEnvironment = withoutPhoneIssuers(process.env); delete workerEnvironment.BASHKITTEN_GUEST_BROWSER_OWNER_TOKEN;
      delete workerEnvironment.BASHKITTEN_PROVIDER_OWNER_HTTP_TOKEN;
      let child;
      try {
        child = spawn(process.execPath, [path.join(here, '../rpc/worker.mjs'), id], { detached: true, stdio: ['ignore', log, log], env: { ...workerEnvironment, ...phoneSlot.environment, BASHKITTEN_BROWSER_SOCKET: browserSocket, BASHKITTEN_BROWSER_OWNER: browserOwner } });
        await phoneSlot.attach(child);
      } catch (error) { await phoneSlot.close(); child?.kill(); throw error; }
      finally { closeSync(log); }
      child.unref();
      let failure; child.on('error', error => { failure = error; });
      child.once('exit', (code, signal) => { if (code !== 0) failure = Error(`BashKitten's Pi runtime could not start (${signal || code}). Check this chat's worker.log.`); });
      for (let attempt = 0; attempt < 160; attempt++) { if (failure) throw failure; if (await running(id)) return; await pause(100); }
      throw Error("BashKitten's Pi runtime did not become ready. Check this chat's worker.log.");
    });
  })();
  starts.set(id, starting);
  try { return await starting; } finally { starts.delete(id); }
}
async function savedView(meta) {
  const native = await savedSession(meta);
  if (native && native.getCwd() !== meta.cwd) { meta.cwd = native.getCwd(); await writeMeta(meta); }
  const entries = native?.getBranch() || [];
  bindMessageEntries(meta, native?.getEntries() || []);
  const drafts = unconsumedMessages(meta, await readJson(path.join(sessionDir(meta.id), 'drafts.json'), []), native?.getEntries() || [])
    .map(item => ({ ...item, held: true, recovered: true, editToken: undefined }));
  const questions = (await readJson(path.join(sessionDir(meta.id), 'questions.json'), { records: [] })).records;
  return { questions, cwd: native?.getCwd() || meta.cwd, busy: false, stopped: Boolean((await readJson(path.join(sessionDir(meta.id), 'lifecycle.json'), {})).stopped),
    entries: entries.map(e => e.type === 'message' ? { ...e, message: displayMessage(meta, e.message, questions, e.id) } : e), events: [],
    steeringMessages: drafts.filter(q => q.kind === 'steer').map(item => queueItem(item, questions)), queuedMessages: drafts.filter(q => q.kind !== 'steer').map(item => queueItem(item, questions)) };
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
  const catalogue = await projects();
  return Promise.all((await allMeta()).map(async meta => {
    const state = await running(meta.id);
    return { id: meta.id, title: meta.title, cwd: meta.cwd, projectId: catalogue.chats[meta.id] || null, model: meta.model, thinking: meta.thinking, modified: meta.modified, current_segment: 1, running: Boolean(state?.data.busy), subagentParent: meta.subagentParent, phone: await phonePolicy(meta.id), subagents: await readSubagentSettings(meta.id) };
  })).then(items => items.sort((a, b) => b.modified - a.modified));
}
async function createSession(value, ownership = {}) {
  const cwd = value.projectId ? await projectDirectory(value.projectId) : (await pickerDirectory(value.cwd || config.default_cwd)).path;
  const id = randomUUID(), dir = sessionDir(id); await privateDir(dir);
  const title = String(value.title || value.prompt || 'New chat').trim().replace(/\s+/g, ' ').slice(0, 100) || 'Image session';
  const meta = { id, cwd, title, model: value.model || config.default_model, thinking: value.thinking || config.default_thinking,
    piFile: null, modified: Date.now(), messages: [], ...ownership };
  const settings = typeof value.subagents === 'string' ? JSON.parse(value.subagents) : value.subagents;
  await saveSubagentSettings(id, subagentSettings({ ...config.default_subagents, ...settings }));
  await writeMeta(meta);
  await initializePhonePolicy(meta.id);
  if (value.projectId) await moveChat(meta.id, value.projectId);
  return meta;
}
async function deleteSession(id) {
  if (discovery) await discovery;
  const meta = await readMeta(id);
  if (meta.piFile) await writeJson(hiddenSessionsFile, [...new Set([...(await readJson(hiddenSessionsFile, [])), meta.piFile])]);
  if (await running(id)) await workerRequest(id, '/shutdown', {});
  // Pi owns history, including native forks that may share a session directory.
  // Removing a sidebar entry must never remove another native session.
  for (const name of ['ui.json', 'drafts.json', 'lifecycle.json', 'worker.log', 'subagents.json', 'subagent-reports.json']) await fs.rm(path.join(sessionDir(id), name), { force: true });
  await fs.rmdir(sessionDir(id)).catch(() => {});
  await fs.rm(socketPath(id), { force: true }); await fs.rm(socketPath(id) + '.lock', { force: true });
  await closeBrowserSocket(id);
  await forgetChat(id);
}
function requireMethod(req, allowed) { if (!allowed.includes(req.method)) throw Object.assign(Error('Method not allowed'), { status: 405 }); }
async function applicationBody(req) {
  const bytes = await body(req, 16 * 1024 * 1024);
  try { return bytes.length ? JSON.parse(bytes.toString('utf8')) : {}; } catch { throw Error('Invalid application JSON request'); }
}
const logo = await fs.readFile(path.join(here, '../../web/logo.png'));
const favicon = await fs.readFile(path.join(here, '../../web/favicon.ico'));
const logoUrl = '/logo.png?v=' + createHash('sha256').update(logo).digest('hex');
const faviconUrl = '/favicon.ico?v=' + createHash('sha256').update(favicon).digest('hex');
const build = await readJson(path.join(here, '../../../build-platform.json'), {});
const sourceRef = /^[a-f0-9]{40}$/.test(build.revision || '') ? build.revision : 'main';
const sourceRoot = 'https://github.com/openresearchtools/BashKitten';
const html = (await fs.readFile(path.join(here, '../../web/web_ui.html'), 'utf8'))
  .replaceAll('/logo.png', logoUrl).replaceAll('/favicon.ico', faviconUrl)
  .replaceAll('/__bashkitten_source__', `${sourceRoot}/tree/${sourceRef}`)
  .replaceAll('/__bashkitten_license__', `${sourceRoot}/blob/${sourceRef}/LICENSE`);
const loginHtml = await fs.readFile(path.join(here, '../../web/pi_login.html'));
const css = html.toString().match(/<style>([\s\S]*?)<\/style>/)[1];
async function selectedFile(url) {
  if (!url.searchParams.has('session')) return { root: url.searchParams.get('root'), path: url.searchParams.get('path') };
  const id = url.searchParams.get('session');
  if (!/^[a-f0-9-]{36}$/.test(id || '') || url.searchParams.getAll('session').length !== 1 ||
      url.searchParams.has('root') || url.searchParams.getAll('path').length !== 1) {
    throw Object.assign(Error('Choose a file from this chat'), { status: 400 });
  }
  const meta = await readMeta(id), cwd = (await savedSession(meta))?.getCwd() || meta.cwd;
  return referencedFile(cwd, url.searchParams.get('path'));
}
async function fileRequest(req, res, url, record) {
  const route = url.pathname, mutation = !['GET', 'HEAD'].includes(req.method);
  if (route === '/api/folders') {
    requireMethod(req, ['GET', 'POST']);
    if (mutation) { const input = await jsonBody(req); const parent = (await pickerDirectory(input.parent)).path; const folder = path.join(parent, safeName(input.name)); await authorizeManagerPath(folder); await fs.mkdir(folder, { mode: 0o700 }); return json(res, { path: folder }); }
    return json(res, await listFolders(url.searchParams.get('path') || config.default_cwd, url.searchParams.get('nearest') === 'true'));
  }
  // Shared transcript/native file access remains; Quantum owns browsing,
  // mutations, transfers and archives. Removed manager endpoints return 404.
  if (route === '/api/files/content') {
    requireMethod(req, ['GET', 'HEAD']);
    const selection = await selectedFile(url);
    return await sendFile(req, res, await filePath(selection.root, selection.path), url.searchParams.get('download') === 'true');
  }
  if (route === '/api/git/changes' || route === '/api/git/diff') {
    requireMethod(req, ['GET']);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.once('close', cancel);
    try {
      const root = (await fileDirectory(url.searchParams.get('root') || config.default_cwd)).path;
      const options = { signal: AbortSignal.any([controller.signal, managerContext().signal]), authorizeRoot: async root => { await authorizeManagerPath(root, { tree: true }); return fileDirectory(root); } };
      const result = route.endsWith('/diff')
        ? await gitDiff(root, url.searchParams.get('path'), options)
        : await gitChanges(root, options);
      return json(res, result);
    } finally { res.off('close', cancel); }
  }
  throw Object.assign(Error('Not found'), { status: 404 });
}
let activeServer;
async function handler(req, res) {
  try {
    const requestHost = req.headers.host || '';
    if (!/^(?:127\.0\.0\.1:\d+|[a-z2-7]{56}\.onion(?::\d+)?)$/.test(requestHost)) throw Object.assign(Error('Invalid Agent host'), { status: 403 });
    const url = new URL(req.url, `${scheme}://${requestHost}`), route = url.pathname;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (await handleGuestBrowser(req, res, route, handleBrowserChannel)) return;
    if (route === '/api/instance') {
      if (req.method !== 'GET' || req.headers.authorization !== 'Bearer ' + instanceToken) throw Object.assign(Error('Invalid instance token'), { status: 403 });
      return json(res, { pid: process.pid, instance: instanceToken });
    }
    if (route === '/api/instance/apps') {
      if (req.method !== 'POST' || req.headers.authorization !== 'Bearer ' + instanceToken) throw Object.assign(Error('Invalid instance token'), { status: 403 });
      const input = await applicationBody(req);
      if (input.operation === 'lifecycle') return json(res, await apps.lifecycle(input.component, input.action));
      if (input.session) await readMeta(input.session);
      const controller = new AbortController(), cancel = () => controller.abort(Error('Application caller disconnected'));
      res.once('close', cancel);
      try { return json(res, await apps.request(input, auth.localAuthority(), { signal: controller.signal, workerId: input.session })); }
      catch (error) {
        const details = error.details && Object.fromEntries(['operationId', 'reason', 'version', 'hash', 'message'].filter(key => typeof error.details[key] === 'string').map(key => [key, error.details[key].slice(0, 16000)]));
        return json(res, { error: error.message, code: typeof error.code === 'string' ? error.code : undefined, ...(details ? { details } : {}) }, error.status || 400);
      }
      finally { res.off('close', cancel); }
    }
    if (route === '/api/instance/file-manager') {
      if (req.method !== 'POST' || req.headers.authorization !== 'Bearer ' + instanceToken) throw Object.assign(Error('Invalid instance token'), { status: 403 });
      const { block } = await jsonBody(req);
      if (typeof block !== 'boolean') throw Error('Choose file-manager policy transition');
      await refreshManagerPolicy(() => apps.revokeRemote(), block);
      return json(res, { ok: true });
    }
    if (route === '/api/instance/provider-login') {
      if (req.method !== 'POST' || req.headers.authorization !== 'Bearer ' + providerOwnerToken) throw Object.assign(Error('Invalid provider controller token'), { status: 403 });
      const { action, value = {} } = await jsonBody(req);
      return json(res, services.nativeLogin(action, value));
    }
    if (route === '/api/instance/phone') {
      if (req.method !== 'POST' || req.headers.authorization !== 'Bearer ' + phoneOwnerToken) throw Object.assign(Error('Invalid Phone controller token'), { status: 403 });
      const { action, value = {}, identity } = await jsonBody(req);
      if (action === 'phone.status') return json(res, await phoneStatus());
      if (action === 'phone.register') return json(res, await registerPhone(value));
      await requirePhoneIdentity(identity);
      if (action === 'phone.disable') { await disablePhone(identity.phoneId); return json(res, { ok: true }); }
      if (action === 'phone.revoke') { await revokePhone(identity.phoneId); return json(res, { ok: true }); }
      if (action === 'phone.pending') return json(res, { events: await pendingPhoneEvents(identity.phoneId), live: await pendingPhoneLive(identity.phoneId), updates: await pendingPhoneUpdates(identity.phoneId) });
      if (action === 'phone.update-ack') { await acknowledgePhoneUpdate(identity.phoneId, value.eventId); return json(res, { ok: true }); }
      if (action === 'phone.live-ack') { await acknowledgePhoneLive(identity.phoneId, value.key); return json(res, { ok: true }); }
      if (action === 'phone.ack') { await acknowledgePhoneEvent(identity.phoneId, value.eventId, value.state); return json(res, { ok: true }); }
      return json(res, await phoneBackend.command(action, value, identity));
    }
    if (route === '/api/instance/subagents') {
      if (req.method !== 'POST' || req.headers.authorization !== 'Bearer ' + instanceToken) throw Object.assign(Error('Invalid instance token'), { status: 403 });
      const value = await jsonBody(req);
      return json(res, await subagents.handle(value.session, value));
    }
    auth.origin(req);
    if (route === '/.well-known/bashkitten-ca' && req.method === 'GET') return json(res, await readJson(paths.identity));
    if (['/', '/pi-login'].includes(route) && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" }); return res.end(route === '/' ? html : loginHtml); }
    if (route === '/app.css' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(css); }
    if (['/logo.png', '/favicon.ico'].includes(route) && ['GET', 'HEAD'].includes(req.method)) {
      const image = route === '/logo.png' ? logo : favicon;
      res.writeHead(200, { 'Content-Type': route === '/logo.png' ? 'image/png' : 'image/x-icon', 'Content-Length': image.length, 'Cache-Control': 'public, max-age=86400' });
      return res.end(req.method === 'HEAD' ? undefined : image);
    }
    const mutation = !['GET', 'HEAD'].includes(req.method);
    if (mutation) auth.checkOrigin(req);
    const record = await auth.login(req);
    if (route === '/api/bootstrap') { requireMethod(req, ['GET']); return json(res, { ...await auth.bootstrap(record), fileManager: await managerAllowed(record) }); }
    if (!record) throw Object.assign(Error('Sign in to BashKitten'), { status: 401 });
    if (mutation) auth.checkCsrf(req, record);
    if (route === '/api/apps/resolve') {
      requireMethod(req, ['POST']);
      return json(res, await apps.resolve(await applicationBody(req), record));
    }
    const appOpen = /^\/api\/apps\/(files|references)\/open$/.exec(route);
    if (appOpen) {
      requireMethod(req, ['POST']);
      return json(res, await apps.open(appOpen[1], await applicationBody(req), record));
    }
    if (route === '/api/references/connector') {
      requireMethod(req, ['POST']);
      const controller = new AbortController(), cancel = () => controller.abort(Error('References caller disconnected'));
      res.once('close', cancel);
      try { return json(res, await apps.connector(await applicationBody(req), record, { signal: controller.signal })); }
      finally { res.off('close', cancel); }
    }
    if (route.startsWith('/api/references/')) {
      requireMethod(req, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
      const controller = new AbortController(), cancel = () => controller.abort(Error('References caller disconnected'));
      res.once('close', cancel);
      try {
        const result = await apps.request({ component: 'references', method: req.method, path: route.slice('/api/references'.length) + url.search,
          body: mutation ? await applicationBody(req) : undefined }, record, { signal: controller.signal });
        return apps.sendResult(req, res, result, record);
      } finally { res.off('close', cancel); }
    }
    if (/^\/api\/(?:files|folders|git)(?:\/|$)/.test(route)) {
      const stopWatching = auth.watch(record, () => { req.destroy(); res.destroy(); });
      try { return await runManagerRequest(req, res, record, () => fileRequest(req, res, url, record)); }
      finally { stopWatching(); }
    }
    if (route === '/api/file-manager/events') {
      requireMethod(req, ['GET']);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      const notify = async () => {
        const allowed = await managerAllowed(record);
        if (!res.destroyed) res.write('data: ' + JSON.stringify({ fileManager: allowed }) + '\n\n');
      };
      const stopPolicy = watchManagerPolicy(() => { void notify(); });
      const stopAuth = auth.watch(record, () => res.end());
      res.once('close', () => { stopPolicy(); stopAuth(); });
      await notify(); return;
    }
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
      if (!['status', 'start', 'stop', 'restart', 'pi-abort', 'pi-stop', 'pi-kill', 'notifications', 'notifications-ack'].includes(value.command)) throw Error('Unknown control action');
      await ensureManager(); return json(res, await controlRequest(value.command, mutation ? value : undefined));
    }
    if (route === '/api/dictation/capability') {
      requireMethod(req, ['GET']); return json(res, await controlRequest('whisper-capability', {}));
    }
    if (route === '/api/dictation') {
      requireMethod(req, ['POST']);
      res.setHeader('Cache-Control', 'no-store');
      return json(res, await transcribe(req, res, cancel => auth.watch(record, cancel)));
    }
    if (route === '/api/phone/status') { requireMethod(req,['GET']); return json(res,await phoneStatus()); }
    if (route === '/api/settings') {
      requireMethod(req, ['GET', 'POST']);
      if (!mutation) return json(res, { config, locations: await folderLocations(), platform });
      const input = await jsonBody(req);
      const next = { web_port: Number(input.web_port), theme: ['system', 'light', 'dark'].includes(input.theme) ? input.theme : 'system',
        default_cwd: (await pickerDirectory(input.default_cwd)).path, default_model: String(input.default_model || ''), default_thinking: String(input.default_thinking || ''),
        default_subagents: subagentSettings(input.default_subagents || config.default_subagents) };
      if (!Number.isInteger(next.web_port) || next.web_port < 1024 || next.web_port > 65535) throw Error('Port must be between 1024 and 65535');
      const restartRequired = next.web_port !== config.web_port;
      config = await updateSettings(current => {
        if (current.notifications !== undefined) next.notifications = current.notifications;
        return next;
      });
      return json(res, { config, restartRequired });
    }
    if (route === '/api/models') {
      requireMethod(req, ['GET']);
      const id = url.searchParams.get('session');
      const native = id && await running(id) ? await workerRequest(id, '/models') : null;
      return json(res, await services.catalog(native?.models, { cwd: config.default_cwd || os.homedir(),
        model: config.default_model, thinking: config.default_thinking }));
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
      if (mutation) {
        const form = await formBody(req);
        try {
          const input = Object.fromEntries(form);
          const meta = await createSession(input);
          await ensureWorker(meta.id);
          return json(res, { id: meta.id });
        }
        finally { await form.cleanup(); }
      }
      const sessions = await sessionList(), offset = Math.max(0, Number(url.searchParams.get('offset')) || 0), limit = Math.min(100, Number(url.searchParams.get('limit')) || 100);
      const page = sessions.slice(offset, offset + limit), included = new Set(page.map(session => session.id));
      const byId = new Map(sessions.map(session => [session.id, session]));
      for (const session of page) {
        const parent = byId.get(session.subagentParent);
        if (parent && !included.has(parent.id)) { included.add(parent.id); page.push(parent); }
      }
      const phoneAvailable = await phoneStatus().then(status => status.registrations.some(phone =>
        phone.connected && (phone.telephony || phone.messages)), () => false);
      return json(res, { sessions: page, projects: (await projects()).projects, phoneAvailable, nextOffset: offset + limit < sessions.length ? offset + limit : null });
    }
    if (route === '/api/projects') {
      requireMethod(req, ['GET', 'POST']);
      if (!mutation) return json(res, { projects: (await projects()).projects });
      const input = await jsonBody(req);
      return await runManagerRequest(req, res, record, async () => json(res, { project: await createProject(input) }));
    }
    const projectMatch = route.match(/^\/api\/projects\/([a-f0-9-]{36})$/);
    if (projectMatch) {
      requireMethod(req, ['PATCH', 'DELETE']);
      const input = await jsonBody(req);
      if (req.method === 'PATCH') return json(res, { project: await renameProject(projectMatch[1], input.name) });
      if (input.confirm !== true) throw Error('Confirm removing the project grouping; its chats are kept');
      return withProjectTransition(projectMatch[1], async () => {
        await apps.revokeProject(projectMatch[1]);
        return json(res, await removeProject(projectMatch[1]));
      });
    }
    if (route === '/api/session-groups') {
      requireMethod(req, ['GET', 'POST', 'DELETE']);
      if (!mutation) return json(res, { sessionIds: (await allMeta()).filter(m => m.cwd === url.searchParams.get('cwd')).map(m => m.id) });
      const input = await jsonBody(req);
      const selected = (await allMeta()).filter(m => m.cwd === input.cwd);
      if (!input.confirm || selected.some(m => !input.sessionIds?.includes(m.id)) || input.sessionIds?.length !== selected.length) throw Error('Project chats changed. Review the deletion again.');
      for (const meta of selected) await deleteSession(meta.id);
      return json(res, { deletedIds: selected.map(m => m.id) });
    }
    const match = route.match(/^\/api\/sessions\/([a-f0-9-]{36})(?:\/(.*))?$/);
    if (!match) throw Object.assign(Error('Not found'), { status: 404 });
    const [, id, action = ''] = match; let meta = await readMeta(id);
    if (action === 'project') {
      requireMethod(req, ['POST']);
      return json(res, await moveChat(id, (await jsonBody(req)).projectId));
    }
    if (action === 'questions' || action === 'questions/answer' || action === 'questions/dismiss') {
      requireMethod(req, action === 'questions' ? ['GET'] : ['POST']);
      if (!await running(id)) {
        if (action !== 'questions') throw Error('This chat is stopped. Resume it explicitly before sending a reply.');
        const { savedQuestions } = await import('../rpc/questions.mjs');
        return json(res, { questions: await savedQuestions(id) });
      }
      return json(res, await workerRequest(id, '/' + action, action === 'questions' ? undefined : { ...await jsonBody(req), source: 'web' }));
    }
    if (action === 'phone') {
      requireMethod(req, ['GET', 'POST']);
      if (mutation) { const input = await jsonBody(req); const previous = await phonePolicy(id); const registration = input.phoneId || previous.phoneId ? await phoneRegistration(input.phoneId || previous.phoneId) : await selectedPhone(); return json(res, { phone: await savePhonePolicy(id, input, registration) }); }
      return json(res, { phone: await phonePolicy(id) });
    }
    if (action === 'subagents') {
      requireMethod(req, ['GET', 'POST']);
      if (mutation) {
        await saveSubagentSettings(id, await jsonBody(req));
        if (await running(id)) await workerRequest(id, '/subagent-settings', {});
      }
      return json(res, { settings: await readSubagentSettings(id) });
    }
    if (action === 'image') {
      requireMethod(req, ['GET']);
      const view = await running(id) ? await workerRequest(id, '/view') : await savedView(meta);
      return await sendFile(req, res, await sessionImage(meta, url.searchParams.get('path'), view), url.searchParams.get('download') === 'true');
    }
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
    if (action === 'fork-messages') { requireMethod(req, ['GET']); await ensureWorker(id, true); return json(res, await workerRequest(id, '/fork-messages')); }
    if (action === 'status') { requireMethod(req, ['GET']); return json(res, await running(id) || { data: await savedView(meta) }); }
    if (action.startsWith('segments/')) { requireMethod(req, ['GET']); const view = await workerRequest(id, '/view').catch(() => savedView(meta)); return json(res, { segment: 1, entries: view.entries }); }
    requireMethod(req, ['POST', 'DELETE', 'PATCH']);
    if (!action && req.method === 'PATCH') {
      const input = await jsonBody(req), title = String(input.name || '').trim();
      if (!title) throw Error('Choose a name');
      await ensureWorker(id); await workerRequest(id, '/rename', { title }); return json(res, { title });
    }
    if (!action || action === 'delete') { if (req.method !== 'DELETE' && action !== 'delete') throw Error('Use DELETE'); await deleteSession(id); return json(res, { deleted: [id] }); }
    if (action === 'resume') {
      const value = await jsonBody(req);
      if ((await readJson(path.join(sessionDir(id), 'lifecycle.json'), {})).stopped && !value.start) return json(res, { stopped: true, snapshot: await savedView(meta) });
      await ensureWorker(id, Boolean(value.start));
      if (value.start) await workerRequest(id, '/resume');
      return json(res, { ok: true });
    }
    if (action === 'stop') {
      const input = await jsonBody(req);
      return json(res, await subagents.serial('worker:' + id, async () => {
        if (await running(id)) return workerRequest(id, '/stop', input);
        await writeJson(path.join(sessionDir(id), 'lifecycle.json'), { stopped: true });
        await stopSavedQuestions(id, 'User stopped this chat');
        return { data: await savedView(meta) };
      }));
    }
    await ensureWorker(id, ['messages', 'fork', 'clone', 'compact'].includes(action));
    if (action === 'messages') {
      const form = await formBody(req);
      try {
        const text = String(form.get('content') || ''), attachments = await saveAttachments(form.getAll('file'));
        const known = (meta.messages || []).flatMap(m => m.attachments);
        for (const retained of form.getAll('retained_attachment')) { const file = known.find(a => a.path === retained); if (!file) throw Error('Unknown retained attachment'); if (!attachments.some(a => a.path === file.path)) attachments.push(file); }
        if (!text.trim() && !attachments.length) throw Error('Write a message or attach a file');
        if (form.get('goal')) throw Error('Goals are provided by Pi extensions; use a configured Pi command');
        const references = attachments.map(a => `${a.name}: ${a.path}`).join('\n');
        const wire = text + (references ? `\n\nAttached files:\n${references}` : '');
        return json(res, await workerRequest(id, '/message', { text, attachments, wire, kind: form.get('delivery') === 'steer' ? 'steer' : 'queue' }));
      } finally { await form.cleanup(); }
    }
    const input = await jsonBody(req);
    if (['fork', 'clone'].includes(action)) return json(res, await workerRequest(id, '/' + action, input));
    if (action === 'title' || action === 'rename') {
      const title = String(input.title || input.name || '').trim(); if (!title) throw Error('Choose a name');
      return json(res, await workerRequest(id, '/rename', { title }));
    }
    if (!['queue', 'model', 'compact', 'reply'].includes(action)) throw Error('Unknown session action');
    return json(res, await workerRequest(id, '/' + action, input));
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    json(res, { error: error.message, ...(error.code === 'FILE_MANAGER_DENIED' ? { code: error.code } : {}) }, error.status || (error.code === 'ENOENT' ? 404 : 400));
  }
}
activeServer = http.createServer(handler);
// Uploads stream to disk; a large file may legitimately take more than five minutes.
activeServer.requestTimeout = 0;
await fs.rm(process.env.BASHKITTEN_BACKEND_SOCKET, { force: true });
await new Promise((resolve, reject) => { activeServer.once('error', reject); activeServer.listen(process.env.BASHKITTEN_BACKEND_SOCKET, resolve); });
await fs.chmod(process.env.BASHKITTEN_BACKEND_SOCKET, 0o600);
await writeJson(paths.backendInfo, { pid: process.pid, started });
for (const meta of await allMeta()) if (await running(meta.id)) {
  await ensureBrowserSocket(meta.browserOwner || meta.workerOwner || meta.id, meta.id);
  await workerRequest(meta.id, '/context', {}).catch(() => {});
}
console.log('BashKitten private Pi RPC backend ready');
process.on('SIGTERM', () => { closeBrowserChannels(); activeServer.close(); activeServer.closeAllConnections(); Promise.allSettled([services.cancel(), apps.close()]).finally(() => process.exit(0)); });
