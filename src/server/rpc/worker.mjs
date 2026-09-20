import http from 'node:http';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PiRpc, translateEvent, activeBranch, usageView } from './rpc.mjs';
import { readMeta, writeMeta, socketPath, privateDir, json, jsonBody, existingDirectory } from '../common.mjs';
import path from 'node:path';
import { syncContext } from './context.mjs';
import { pickerDirectory } from '../files/folders.mjs';

process.umask(0o077);
const id = process.argv[2];
let meta = await readMeta(id);
let rpc, busy = false, compacting = false, stopping = false, changing = false;
let lastAccess = Date.now();
let entries = [], events = [], usage = null, queue = [], pendingCwd = null, pendingModel = null, pendingContext = false;
const clients = new Set(), dialogs = new Map();
let operations = Promise.resolve(), eventWork = Promise.resolve();
function serial(fn) { const work = operations.then(fn); operations = work.catch(() => {}); return work; }
function displayMessage(message) {
  if (message.role !== 'user') return message;
  const text = typeof message.content === 'string' ? message.content : (message.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  const upload = (meta.messages || []).find(m => m.wire === text);
  return upload ? { ...message, content: [...upload.attachments, { type: 'text', text: upload.text }] } : message;
}
function displayEntries() { return entries.map(e => e.type === 'message' ? { ...e, message: displayMessage(e.message) } : e); }
function queueItem(item) { return { id: item.id, content: item.text, attachments: item.attachments.map(a => a.name), attachmentPaths: item.attachments.map(a => a.path), editing: Boolean(item.editToken) }; }
function status() { return { busy, compacting, usage, contextVersion: meta.contextVersion, pendingContext, modelSelection: { model: meta.model, thinking: meta.thinking }, pendingCwd,
  steeringMessages: queue.filter(q => q.kind === 'steer').map(queueItem), queuedMessages: queue.filter(q => q.kind !== 'steer').map(queueItem) }; }
function snapshot() { return { ...status(), entries: displayEntries(), events, dialogs: [...dialogs.values()] }; }
function emit(event, remember = true) {
  if (remember) events.push(event);
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) if (!res.write(line) && res.writableLength > 8 * 1024 * 1024) res.destroy();
}
function queueChanged() { emit({ type: 'queue_state', data: status() }, false); }
async function refresh() {
  const [state, history, stats] = await Promise.all([rpc.command('get_state'), rpc.command('get_entries'), rpc.command('get_session_stats')]);
  entries = activeBranch(history.entries, history.leafId);
  meta.model = state.model ? `${state.model.provider}/${state.model.id}` : meta.model;
  meta.thinking = state.thinkingLevel;
  meta.piSessionId = state.sessionId;
  meta.piFile = state.sessionFile || meta.piFile;
  meta.modified = Math.max(meta.modified, Date.parse(entries.at(-1)?.timestamp) || 0);
  usage = usageView(stats, entries);
  await writeMeta(meta);
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
  meta.contextVersion = await syncContext();
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
        await serial(applyPending);
      }).catch(error => emit({ type: 'notice', message: error.message }));
      return;
    }
    const translated = translateEvent(event);
    if (translated?.type === 'message') translated.message = displayMessage(translated.message);
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
  if (meta.title) await rpc.command('set_session_name', { name: meta.title });
}
async function applyPending() {
  if (busy || compacting || queue.some(q => !q.editToken && !q.held)) return;
  const version = await syncContext();
  if (pendingCwd || version !== meta.contextVersion) {
    const target = pendingCwd || meta.cwd; pendingCwd = null; changing = true;
    await rpc.close();
    const previous = meta.cwd; meta.cwd = target;
    try { await launch(); emit({ type: 'cwd_change', cwd: target }, false); }
    catch (error) { meta.cwd = previous; await launch(); emit({ type: 'cwd_error', message: error.message }, false); }
    finally { changing = false; pendingContext = false; }
  }
  if (pendingModel) {
    const selection = pendingModel; pendingModel = null;
    const at = selection.model.indexOf('/');
    await rpc.command('set_model', { provider: selection.model.slice(0, at), modelId: selection.model.slice(at + 1) });
    await rpc.command('set_thinking_level', { level: selection.thinking });
    await refresh(); emit({ type: 'model_change', model: meta.model, thinking: meta.thinking }, false);
  }
}
async function send(item) {
  // Pi's prompt command is the authority for idle versus streaming delivery.
  await rpc.command('prompt', { message: item.wire, images: item.images || [], streamingBehavior: item.kind === 'steer' ? 'steer' : 'followUp' });
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
    delete item.held;
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
const server = http.createServer(async (req, res) => {
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
    const value = await jsonBody(req);
    if (req.url === '/reply') { if (!dialogs.has(value.id)) throw Error('This prompt is no longer pending'); dialogs.delete(value.id); rpc.reply(value); return json(res, { ok: true }); }
    if (req.url === '/stop') {
      const pending = status();
      await rpc.command('clear_queue'); queue = [];
      await rpc.command('abort'); busy = compacting = false;
      await refresh(); events = []; emit({ type: 'snapshot', data: snapshot() }, false); emit({ type: 'agent_settled' }, false);
      return json(res, { data: pending });
    }
    if (req.url === '/shutdown') {
      stopping = true; await rpc.close(); json(res, { ok: true });
      for (const client of clients) client.end();
      server.close(() => process.exit(0)); return;
    }
    const result = await serial(async () => {
      if (req.url === '/context') { pendingContext = (await syncContext()) !== meta.contextVersion; await applyPending(); return { data: status() }; }
      if (req.url === '/message') {
        await applyPending();
        meta.messages ||= [];
        meta.messages.push({ text: value.text, wire: value.wire, attachments: value.attachments });
        await writeMeta(meta);
        const item = { ...value, id: randomUUID(), kind: value.kind || 'queue' };
        queue.push(item);
        try { await send(item); } catch (error) { queue = queue.filter(q => q.id !== item.id); throw error; }
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
            else if (value.action === 'promote') item.kind = 'steer';
            else if (value.action === 'cancel_edit') delete item.editToken;
            else if (value.action === 'edit') {
              const suffix = item.wire.slice(item.text.length);
              item.text = value.content; item.wire = value.content + suffix; delete item.editToken;
              meta.messages.push({ text: item.text, wire: item.wire, attachments: item.attachments });
            } else throw Error('Unknown queue action');
          }
        });
        await writeMeta(meta); return { data: status() };
      }
      if (req.url === '/cwd') { pendingCwd = (await pickerDirectory(value.cwd)).path; await applyPending(); return { queued: Boolean(pendingCwd), cwd: meta.cwd }; }
      if (req.url === '/model') { pendingModel = value; await applyPending(); return { data: status() }; }
      if (req.url === '/rename') { await rpc.command('set_session_name', { name: value.title }); meta.title = value.title; await writeMeta(meta); return { ok: true }; }
      if (req.url === '/compact') {
        if (busy) throw Error('Wait for the current turn to finish before compacting');
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
});
await privateDir(path.dirname(socketPath(id)));
// The web launcher serializes starts; the exclusive lock protects other launchers.
let lock;
try { lock = await fs.open(socketPath(id) + '.lock', 'wx', 0o600); await lock.writeFile(String(process.pid)); await lock.close(); }
catch { process.exit(1); }
await fs.rm(socketPath(id), { force: true });
try { await launch(); await new Promise(resolve => server.listen(socketPath(id), resolve)); await fs.chmod(socketPath(id), 0o600); }
catch { await fs.rm(socketPath(id) + '.lock', { force: true }); process.exit(1); }
process.on('SIGTERM', async () => { stopping = true; await rpc.close(); await fs.rm(socketPath(id) + '.lock', { force: true }); process.exit(0); });
// Release idle Pi processes on memory-constrained phones. Active turns, queues,
// extension dialogs and subscribed browsers always retain their worker.
setInterval(async () => {
  if (stopping || changing || busy || compacting || clients.size || queue.length || dialogs.size || Date.now() - lastAccess < 300000) return;
  stopping = true; await rpc.close(); await fs.rm(socketPath(id) + '.lock', { force: true });
  server.close(() => process.exit(0));
}, 30000).unref();
