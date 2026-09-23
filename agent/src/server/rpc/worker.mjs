import http from 'node:http';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PiRpc, translateEvent, activeBranch, usageView, displayMessage, queueItem, savedSession } from './rpc.mjs';
import { readMeta, writeMeta, readJson, writeJson, sessionDir, socketPath, privateDir, json, jsonBody, dataDir, socketRequest } from '../common.mjs';
import path from 'node:path';
import { syncContext } from './context.mjs';
import { selectedRuntime, allowRuntimeWork } from './runtime.mjs';
import { notifyTurn } from './notifications.mjs';
import { claimInstance } from '../instance.mjs';
import { attachmentImages } from '../files/files.mjs';

process.umask(0o077);
let id = process.argv[2];
let meta = await readMeta(id);
let rpc, busy = false, compacting = false, stopping = false, changing = false;
let lastAccess = Date.now();
let entries = [], events = [], usage = null, queue = [], pendingModel = null, pendingContext = false;
const draftsFile = () => path.join(sessionDir(id), 'drafts.json');
// A crashed process cannot prove whether Pi consumed its last submitted prompt.
// Recover every remaining item as a held draft; only an explicit user send releases it.
queue = (await readJson(draftsFile(), [])).map(item => ({ ...item, held: true, recovered: true, editToken: undefined }));
let draftWrites = Promise.resolve();
function checkpoint() {
  const saved = structuredClone(queue), file = draftsFile();
  const work = draftWrites.then(() => writeJson(file, saved));
  draftWrites = work.catch(error => emit({ type: 'notice', message: 'Could not save drafts: ' + error.message }, false));
  return work;
}
const clients = new Set(), dialogs = new Map();
let operations = Promise.resolve(), eventWork = Promise.resolve();
function serial(fn) { const work = operations.then(fn); operations = work.catch(() => {}); return work; }
function displayEntries() { return entries.map(e => e.type === 'message' ? { ...e, message: displayMessage(meta, e.message) } : e); }
function status() { return { runtimeVersion: rpc?.runtime.version, cwd: meta.cwd, busy, compacting, usage, contextVersion: meta.contextVersion, pendingContext, modelSelection: { model: meta.model, thinking: meta.thinking },
  steeringMessages: queue.filter(q => q.kind === 'steer').map(queueItem), queuedMessages: queue.filter(q => q.kind !== 'steer').map(queueItem) }; }
function snapshot() { return { ...status(), entries: displayEntries(), events, dialogs: [...dialogs.values()] }; }
function emit(event, remember = true) {
  if (remember) events.push(event);
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) if (!res.write(line) && res.writableLength > 8 * 1024 * 1024) res.destroy();
}
function queueChanged() { checkpoint().catch(() => {}); emit({ type: 'queue_state', data: status() }, false); }
let refreshes = Promise.resolve();
function refresh(follow = true) {
  const work = refreshes.then(() => readState(follow));
  refreshes = work.catch(() => {});
  return work;
}
async function readState(follow) {
  const [state, history, stats] = await Promise.all([rpc.command('get_state'), rpc.command('get_entries'), rpc.command('get_session_stats')]);
  if (server && !changing && meta.piSessionId && state.sessionId !== meta.piSessionId) await adoptSession(state, follow);
  entries = activeBranch(history.entries, history.leafId);
  meta.model = state.model && !(state.model.provider === 'unknown' && state.model.id === 'unknown') ? `${state.model.provider}/${state.model.id}` : '';
  meta.thinking = state.thinkingLevel;
  if (state.sessionName) meta.title = state.sessionName;
  meta.piSessionId = state.sessionId;
  meta.piFile = state.sessionFile || meta.piFile;
  meta.modified = Math.max(meta.modified, Date.parse(entries.at(-1)?.timestamp) || 0);
  usage = usageView(stats, entries);
  await writeMeta(meta);
}
// Pi can replace its session through RPC or an extension. Keep that live process
// and bind a new sidebar row to the session Pi selected; never serialize history.
async function adoptSession(state, follow) {
  const previous = id, oldServer = server, oldOwnership = ownership;
  await draftWrites;
  id = state.sessionId;
  meta = { ...meta, id, piFile: state.sessionFile, piSessionId: state.sessionId,
    title: state.sessionName || `Fork: ${meta.title}`, parentSession: previous, modified: Date.now() };
  meta.cwd = (await savedSession(meta))?.getCwd() || meta.cwd;
  await writeMeta(meta);
  ownership = await claimInstance('pi-' + id);
  await listen();
  oldServer.close();
  await fs.rm(socketPath(previous) + '.lock', { force: true });
  oldOwnership.close();
  if (follow) emit({ type: 'session_changed', id }, false);
  for (const client of clients) client.end();
  clients.clear(); events = []; dialogs.clear(); queue = [];
  busy = state.isStreaming; compacting = state.isCompacting;
  pendingModel = null;
  await checkpoint();
}
function reconcileQueue(event) {
  const remaining = [];
  const candidates = [...queue];
  for (const [kind, values] of [['steer', event.steering], ['queue', event.followUp]]) {
    for (const wire of values || []) {
      const index = candidates.findIndex(q => q.wire === wire && !q.editToken);
      const item = index < 0 ? { id: randomUUID(), wire, text: wire, attachments: [] } : candidates.splice(index, 1)[0];
      remaining.push({ ...item, kind });
    }
  }
  queue = [...remaining, ...candidates.filter(q => q.editToken || q.held)];
  queueChanged();
}
async function launch() {
  const newSession = !meta.piFile;
  meta.contextVersion = await syncContext();
  meta.cwd = (await savedSession(meta))?.getCwd() || meta.cwd;
  rpc = new PiRpc(meta);
  rpc.on('event', event => {
    // State transitions are synchronous with the RPC input stream. Slow history
    // reads happen separately, so abort/extension replies never block on a turn.
    if (event.type === 'agent_start') busy = true;
    if (event.type === 'compaction_start') { compacting = true; busy = true; }
    if (event.type === 'compaction_end') compacting = false;
    if (event.type === 'queue_update') { reconcileQueue(event); return; }
    if (event.type === 'message_start' && event.message?.role === 'user') {
      const content = event.message.content;
      const wire = typeof content === 'string' ? content : (content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      const index = queue.findIndex(q => q.wire === wire && !q.editToken);
      if (index >= 0) { queue.splice(index, 1); queueChanged(); }
    }
    if (event.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(event.method)) dialogs.set(event.id, event);
    if (event.type === 'agent_settled') {
      busy = false;
      eventWork = eventWork.then(async () => {
        await refresh();
        // A new prompt may have arrived while RPC history was being read.
        if (busy) return;
        events = [];
        emit({ type: 'snapshot', data: snapshot() }, false);
        emit({ type: 'agent_settled' }, false);
        notifyTurn(meta, entries).catch(() => {});
        await serial(applyPending);
      }).catch(error => emit({ type: 'notice', message: error.message }));
      return;
    }
    const translated = translateEvent(event);
    if (translated?.type === 'message') translated.message = displayMessage(meta, translated.message);
    if (translated) emit(translated);
  });
  rpc.on('exit', () => {
    if (changing || stopping) return;
    busy = compacting = false;
    emit({ type: 'notice', message: 'Pi stopped. Send a message to resume this session.' }, false);
    for (const res of clients) res.end('event: offline\ndata: {}\n\n');
    server.close(() => process.exit(1));
  });
  await refresh();
  if (newSession && meta.title) await rpc.command('set_session_name', { name: meta.title });
}
async function applyPending() {
  if (stopping || busy || compacting || queue.some(q => !q.editToken && !q.held)) return;
  const version = await syncContext();
  if (pendingContext || version !== meta.contextVersion || selectedRuntime().root !== rpc.runtime.root) {
    changing = true;
    await rpc.close();
    try { await launch(); }
    finally { changing = false; pendingContext = false; }
  }
  if (pendingModel) {
    const selection = pendingModel; pendingModel = null;
    await prepareManagedModel(selection.model);
    const at = selection.model.indexOf('/');
    await rpc.command('set_model', { provider: selection.model.slice(0, at), modelId: selection.model.slice(at + 1) });
    if (selection.thinking) await rpc.command('set_thinking_level', { level: selection.thinking });
    await refresh(); emit({ type: 'model_change', model: meta.model, thinking: meta.thinking }, false);
  }
}
async function prepareManagedModel(model = meta.model) {
  if (!model?.startsWith('bashkitten-llama/')) return;
  emit({ type: 'notice', message: 'Checking local llama.cpp readiness' }, false);
  const modelId = model.slice('bashkitten-llama/'.length);
  const ready = await socketRequest(path.join(dataDir, 'run/control.sock'), '/llama-wait', { model: modelId }, 16 * 60 * 1000);
  if (stopping) throw Error('Pi instance is stopping');
  if (ready.state !== 'ready' || !ready.url || ready.model !== modelId) throw Error('The selected local llama.cpp model is not ready');
  const { models } = await rpc.command('get_available_models');
  const current = models.find(item => item.provider === 'bashkitten-llama' && item.id === ready.model);
  if (current?.baseUrl === ready.url + '/v1') return;
  const state = await rpc.command('get_state');
  if (state.isStreaming || state.isCompacting || state.pendingMessageCount) throw Error('Local llama.cpp changed while Pi was active. Retry after the current turn ends.');
  // Stock RPC has no model-registry reload command. Reopen its own saved
  // session at this idle boundary, exactly as for a native runtime update.
  changing = true;
  await rpc.close();
  try { await launch(); } finally { changing = false; }
  const updated = await rpc.command('get_available_models');
  if (!updated.models.some(item => item.provider === 'bashkitten-llama' && item.id === ready.model && item.baseUrl === ready.url + '/v1')) throw Error('Pi could not load the ready local llama.cpp model');
  await rpc.command('set_model', { provider: 'bashkitten-llama', modelId: ready.model });
  await refresh();
}
async function send(item) {
  allowRuntimeWork();
  await prepareManagedModel();
  // Pi's prompt command is the authority for idle versus streaming delivery.
  item.delivery = 'submitted'; await checkpoint();
  await rpc.command('prompt', { message: item.wire, images: item.images || await attachmentImages(item.attachments || []), streamingBehavior: item.kind === 'steer' ? 'steer' : 'followUp' });
  // A native extension may consume the input without starting a model turn.
  const state = await rpc.command('get_state');
  if (!state.isStreaming && !state.pendingMessageCount && queue.includes(item)) { queue.splice(queue.indexOf(item), 1); queueChanged(); }
  if (item.wire.startsWith('/')) { await refresh(); emit({ type: 'snapshot', data: snapshot() }, false); }
}
async function rebuildQueue(mutate) {
  const old = [...queue];
  const cleared = await rpc.command('clear_queue');
  // Only restore messages Pi actually returned. A boundary may have consumed a
  // message before clear_queue; replaying the browser's stale copy duplicates it.
  const candidates = [...old], retained = [];
  for (const [kind, values] of [['steer', cleared.steering], ['queue', cleared.followUp]]) {
    for (const wire of values || []) {
      const index = candidates.findIndex(q => q.wire === wire && !q.editToken);
      retained.push({ ...(index < 0 ? { id: randomUUID(), wire, text: wire, attachments: [] } : candidates.splice(index, 1)[0]), kind });
    }
  }
  retained.push(...candidates.filter(q => q.editToken || q.held));
  const order = new Map(old.map((item, index) => [item.id, index]));
  retained.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  let failure;
  try { mutate(retained); } catch (error) { failure = error; }
  // An edit holds the rest of its FIFO queue behind it. Otherwise a later
  // follow-up could overtake the message while the user is editing its text.
  const blocked = new Set();
  for (const item of retained) {
    item.held = Boolean(item.recovered);
    if (item.editToken) blocked.add(item.kind);
    else if (blocked.has(item.kind)) item.held = true;
  }
  queue = retained;
  const toSend = retained.filter(q => !q.editToken && !q.held);
  for (const item of toSend) await send(item);
  // Native queue_update events may have run during send; held edits still exist.
  for (const item of retained.filter(q => q.editToken || q.held)) if (!queue.some(q => q.id === item.id)) queue.push(item);
  queueChanged();
  if (failure) throw failure;
}
async function handle(req, res) {
  // A native session switch rebinds this worker; do not reuse its old control connection.
  res.setHeader('Connection', 'close');
  if (req.url !== '/status') lastAccess = Date.now();
  try {
    if (req.url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      clients.add(res);
      res.write(`data: ${JSON.stringify({ ok: true, message: 'subscribed', data: snapshot() })}\n\n`);
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
      res.on('close', () => { clearInterval(heartbeat); clients.delete(res); }); return;
    }
    if (req.url === '/status') return json(res, { data: status() });
    if (req.url === '/view') return json(res, snapshot());
    if (req.url === '/fork-messages') return json(res, await rpc.command('get_fork_messages'));
    if (req.url === '/models') return json(res, await rpc.command('get_available_models'));
    const value = await jsonBody(req);
    if (req.url === '/reply') { if (!dialogs.has(value.id)) throw Error('This prompt is no longer pending'); dialogs.delete(value.id); rpc.reply(value); return json(res, { ok: true }); }
    if (req.url === '/stop') {
      const pending = status();
      await rpc.command('clear_queue'); queue = []; await checkpoint();
      await rpc.command('abort'); busy = compacting = false;
      await refresh(); events = []; emit({ type: 'snapshot', data: snapshot() }, false); emit({ type: 'agent_settled' }, false);
      return json(res, { data: pending });
    }
    if (req.url === '/shutdown') {
      stopping = true;
      if (!value.restart) await writeJson(path.join(sessionDir(id), 'lifecycle.json'), { stopped: true });
      await serial(async () => {
        await rebuildQueue(items => { for (const item of items) { item.recovered = true; item.held = true; delete item.editToken; } });
        await rpc.command('abort'); await checkpoint(); await rpc.close();
      });
      json(res, { ok: true });
      for (const client of clients) client.end();
      await fs.rm(socketPath(id) + '.lock', { force: true });
      server.close(() => process.exit(0)); return;
    }
    const result = await serial(async () => {
      if (stopping) throw Error('Pi instance is stopping');
      if (req.url === '/barrier') { const state = await rpc.command('get_state'); return { idle: !state.isStreaming && !state.isCompacting && !dialogs.size && !queue.some(q => !q.held && !q.editToken) }; }
      if (!['/context', '/barrier'].includes(req.url)) allowRuntimeWork();
      if (req.url === '/context') { pendingContext = Boolean(value.reload) || (await syncContext()) !== meta.contextVersion; await applyPending(); return { data: status() }; }
      if (req.url === '/message') {
        await applyPending();
        meta.messages ||= [];
        meta.messages.push({ text: value.text, wire: value.wire, attachments: value.attachments });
        await writeMeta(meta);
        const item = { ...value, id: randomUUID(), kind: value.kind || 'queue' };
        queue.push(item);
        try { await send(item); } catch (error) { item.held = item.recovered = true; if (!queue.includes(item)) queue.push(item); await checkpoint(); throw error; }
        return { data: status() };
      }
      if (req.url === '/queue') {
        await rebuildQueue(items => {
          const index = items.findIndex(q => q.id === value.id), item = items[index];
          if (!item) throw Error('Queued message no longer exists');
          if (value.action === 'begin_edit' || value.action === 'take_edit') { if (item.editToken && value.action !== 'take_edit') throw Error('Message is being edited'); item.editToken = value.edit_token; }
          else {
            if (item.editToken && item.editToken !== value.edit_token) throw Error('Edit is no longer owned by this tab');
            if (value.action === 'remove') items.splice(index, 1);
            else if (value.action === 'send') { delete item.recovered; delete item.held; }
            else if (value.action === 'promote') { item.kind = 'steer'; delete item.recovered; }
            else if (value.action === 'cancel_edit') delete item.editToken;
            else if (value.action === 'edit') {
              const suffix = item.wire.slice(item.text.length);
              item.text = value.content; item.wire = value.content + suffix; delete item.editToken; delete item.recovered;
              meta.messages.push({ text: item.text, wire: item.wire, attachments: item.attachments });
            } else throw Error('Unknown queue action');
          }
        });
        await writeMeta(meta); return { data: status() };
      }
      if (req.url === '/fork' || req.url === '/clone') {
        const result = await rpc.command(req.url.slice(1), req.url === '/fork' ? { entryId: value.entryId } : {});
        if (result.cancelled) return result;
        await refresh(false);
        return { ...result, id };
      }
      if (req.url === '/model') { pendingModel = value; await applyPending(); return { data: status() }; }
      if (req.url === '/rename') { await rpc.command('set_session_name', { name: value.title }); meta.title = value.title; await writeMeta(meta); return { ok: true }; }
      if (req.url === '/compact') {
        if (busy) throw Error('Wait for the current turn to finish before compacting');
        await prepareManagedModel();
        // Do not occupy the control queue while a potentially long compaction runs.
        busy = compacting = true;
        rpc.command('compact', { customInstructions: value.instructions || undefined }, 30 * 60 * 1000).then(async () => {
          await refresh(); busy = compacting = false; events = []; emit({ type: 'snapshot', data: snapshot() }, false); emit({ type: 'agent_settled' }, false);
        }).catch(error => { busy = compacting = false; emit({ type: 'compaction_end', errorMessage: error.message }); emit({ type: 'agent_settled' }, false); });
        return { ok: true };
      }
      throw Error('Unknown worker operation');
    });
    json(res, result);
  } catch (error) { json(res, { error: error.message }, 400); }
}
let server, ownership;
async function listen() {
  const boundId = id;
  server = http.createServer((req, res) => {
    if (boundId !== id) return json(res, { error: 'Pi switched sessions. Reopen this chat.' }, 409);
    return handle(req, res);
  });
  meta.workerOwner = process.argv[2]; await writeMeta(meta);
  await fs.writeFile(socketPath(id) + '.lock', String(process.pid), { mode: 0o600 });
  await fs.rm(socketPath(id), { force: true });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath(id), resolve); });
  await fs.chmod(socketPath(id), 0o600);
}
await privateDir(path.dirname(socketPath(id)));
// Keep one worker per saved session, including simultaneous reconnects after a kill.
ownership = await claimInstance('pi-' + id);
if (!ownership) process.exit(0);
try { await launch(); await listen(); }
catch (error) { console.error('Pi startup failed:', error.message); await fs.rm(socketPath(id) + '.lock', { force: true }); process.exit(1); }
process.on('SIGTERM', async () => { stopping = true; await rpc.close(); await fs.rm(socketPath(id) + '.lock', { force: true }); process.exit(0); });
// Release idle Pi processes on memory-constrained phones. Active turns, queues,
// extension dialogs and subscribed browsers always retain their worker.
setInterval(async () => {
  if (stopping || changing || busy || compacting || clients.size || queue.length || dialogs.size || Date.now() - lastAccess < 300000) return;
  stopping = true; await rpc.close(); await fs.rm(socketPath(id) + '.lock', { force: true });
  server.close(() => process.exit(0));
}, 30000).unref();
