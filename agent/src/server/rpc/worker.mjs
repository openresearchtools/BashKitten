import http from 'node:http';
import fs from 'node:fs/promises';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { PiRpc, translateEvent, activeBranch, usageView, displayMessage, queueItem, savedSession } from './rpc.mjs';
import { readMeta, writeMeta, readJson, writeJson, sessionDir, socketPath, privateDir, json, jsonBody, dataDir, socketRequest } from '../common.mjs';
import path from 'node:path';
import { syncContext } from './context.mjs';
import { providerRevision } from './services.mjs';
import { selectedRuntime, allowRuntimeWork, loadPi } from './runtime.mjs';
import { managedLocalProvider, managedThinkingUnknown } from './managed-provider.mjs';
import { notifyTurn, notifyQuestion, resolvedQuestion, notifyAssistantMessage } from './notifications.mjs';
import { QuestionOwner } from './questions.mjs';
import { MessageAttribution, bindMessageEntries, unconsumedMessages, userAuthored } from './message-presentation.mjs';
import { createPhoneWorker } from '../phone/worker.mjs';
import { inheritChatProject } from '../projects.mjs';
import { validatePhoneDelivery } from '../phone.mjs';
import { claimInstance } from '../instance.mjs';
import { attachmentImages } from '../files/files.mjs';
import { browserSocketPath } from '../access/browser-channel.mjs';
import { readSubagentSettings, saveSubagentSettings } from './subagents.mjs';
import { agentRequest } from '../../../pi/agent-channel.mjs';

process.umask(0o077);
let id = process.argv[2];
let meta = await readMeta(id);
// A resumed native fork gets its own worker; only a live fork retains the
// original process identity and browser socket until that process exits.
meta.workerOwner = id;
meta.browserOwner = process.env.BASHKITTEN_BROWSER_OWNER || id;
let phoneWorker, phoneSession;
let rpc, providersVersion, localProviderRevision, projectNativeSession, busy = false, compacting = false, stopping = false, changing = false;
let entries = [], events = [], usage = null, queue = [], pendingModel = null, pendingContext = false, contextUpdates = 0;
let snapshotEntries = [];
const messageAttribution = new MessageAttribution();
let liveUserSubmission;
const draftsFile = () => path.join(sessionDir(id), 'drafts.json');
// A crashed process cannot prove whether Pi consumed its last submitted prompt.
// Hold remaining inputs. User drafts need explicit Send; agent deliveries may
// resume only when clear_queue proved them pending, never after an uncertain send.
queue = (await readJson(draftsFile(), [])).map(item => ({ ...item, held: true, recovered: true, editToken: undefined }));
let draftWrites = Promise.resolve();
function checkpoint() {
  const saved = structuredClone(queue), file = draftsFile();
  const work = draftWrites.then(() => writeJson(file, saved));
  draftWrites = work.catch(error => emit({ type: 'notice', message: 'Could not save drafts: ' + error.message }, false));
  return work;
}
const clients = new Set(), dialogs = new Map();
const extensionStatuses = new Map(), liveToolCalls = new Map();
const workerKey = randomBytes(32).toString('hex');
const privateSocket = socketPath(meta.workerOwner + ':extensions');
const questionOwner = new QuestionOwner({
  owner: () => ({ nativeSessionId: meta.piSessionId }),
  authorize: input => input.source === 'web' || (input.phoneAuthorization?.source === input.source && validatePhoneDelivery(id, input.phoneAuthorization)),
  verify: async question => {
    if (question.sessionId !== id || question.nativeSessionId !== meta.piSessionId) return false;
    const history = await rpc.command('get_entries');
    const branch = activeBranch(history.entries, history.leafId);
    let origin = question.originToolCallId;
    if (!origin) {
      let call = question.toolCallId, current = liveToolCalls.get(call);
      if (current?.name === 'ask_user') {
        const seen = new Set();
        while (current?.parent && !seen.has(call)) { seen.add(call); call = current.parent; current = liveToolCalls.get(call); }
        origin = call;
      } else origin = question.toolCallId;
    }
    const entry = branch.find(entry => entry.type === 'message' && entry.message?.role === 'assistant' &&
      Array.isArray(entry.message.content) && entry.message.content.some(block => block.type === 'toolCall' && block.id === origin &&
        (origin !== question.toolCallId || block.name === 'ask_user')));
    if (!entry) return false;
    // Nested stock codemode calls live below the model-issued tool call; their
    // native parent remains the branch anchor even before its result is saved.
    question.originToolCallId = origin; question.branchId = entry.id;
    return true;
  },
  deliver: item => serial(async () => {
    if (!await canSend(item) || item.sessionId !== id) return { held: true };
    meta.messages ||= [];
    if (queue.some(q => q.agentDelivery === item.agentDelivery) || meta.messages.some(q => q.agentDelivery === item.agentDelivery)) return { held: true };
    item.id = randomUUID(); queue.push(item);
    meta.messages.push({ id: item.id, text: item.text, wire: item.wire, attachments: [], agentDelivery: item.agentDelivery });
    try { await checkpoint(); await writeMeta(meta); await send(item); return { held: Boolean(item.held) }; }
    catch (error) { item.held = item.recovered = true; if (!queue.includes(item)) queue.push(item); await checkpoint(); throw error; }
  }),
  changed: questions => emit({ type: 'questions_changed', questions }, false),
  created: async question => notifyQuestion(await readMeta(question.sessionId), question),
  resolved: async question => resolvedQuestion(await readMeta(question.sessionId), question),
  error: error => emit({ type: 'notice', message: 'Question delivery: ' + error.message }, false),
});
let operations = Promise.resolve(), eventWork = Promise.resolve();
let reportWork = Promise.resolve();
async function reportCompleted(entryId, chatId = id, session = meta.piSessionId) {
  if (!meta.subagentParent) return;
  const file = path.join(sessionDir(chatId), 'subagent-reports.json');
  const work = reportWork.then(async () => {
    const state = await readJson(file, { pending: [], last: null });
    if (entryId && state.last !== entryId) { state.pending.push(entryId); state.last = entryId; await writeJson(file, state); }
    while (state.pending.length) {
      await agentRequest({ action: 'report', session, entryId: state.pending[0] });
      state.pending.shift(); await writeJson(file, state);
    }
  });
  reportWork = work.catch(error => emit({ type: 'notice', message: 'Could not deliver the subagent result: ' + error.message }, false));
  return reportWork;
}
function serial(fn) { const work = operations.then(fn); operations = work.catch(() => {}); return work; }
function displayEntries() { return snapshotEntries.map(e => e.type === 'message' ? { ...e, message: displayMessage(meta, e.message, questionOwner.state.records, e.id) } : e); }
function status() { return { stopGeneration: questionOwner.state.generation, questions: questionOwner.list(), runtimeVersion: rpc?.runtime.version, cwd: meta.cwd, busy, compacting, usage, extensionStatuses: [...extensionStatuses.values()], contextVersion: meta.contextVersion, pendingContext: pendingContext || contextUpdates > 0, modelSelection: { model: meta.model, thinking: meta.thinking },
  steeringMessages: queue.filter(q => q.kind === 'steer').map(item => queueItem(item, questionOwner.state.records)), queuedMessages: queue.filter(q => q.kind !== 'steer').map(item => queueItem(item, questionOwner.state.records)) }; }
function snapshot() { return { ...status(), entries: displayEntries(), events, dialogs: [...dialogs.values()] }; }
function settleSnapshot() { snapshotEntries = entries; events = []; }
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
  if (phoneSession !== state.sessionId) { await phoneWorker.adopt(state.sessionId); phoneSession = state.sessionId; }
  if (server && !changing && meta.piSessionId && state.sessionId !== meta.piSessionId) await adoptSession(state, follow);
  entries = activeBranch(history.entries, history.leafId);
  // Live events replay after this boundary. Attribution/status refreshes may
  // read newer persisted messages, but must not also add them to that prefix.
  // Advance the prefix and discard its replay together when the turn settles.
  if (!events.length) snapshotEntries = entries;
  messageAttribution.seed(state.sessionId, history.entries);
  bindMessageEntries(meta, history.entries);
  const pending = unconsumedMessages(meta, queue, history.entries);
  if (pending.length !== queue.length) { queue = pending; queueChanged(); }
  meta.model = state.model && !(state.model.provider === 'unknown' && state.model.id === 'unknown') ? `${state.model.provider}/${state.model.id}` : '';
  meta.thinking = state.thinkingLevel;
  if (await managedThinkingUnknown(meta.model)) {
    // Stock Pi clamps against its startup catalogue without changing the saved
    // native choice. Unknown cold capabilities must not replace that choice.
    const saved = projectNativeSession(history.entries, history.leafId);
    if (`${saved.model?.provider}/${saved.model?.modelId}` === meta.model && entries.some(entry => entry.type === 'thinking_level_change')) meta.thinking = saved.thinkingLevel;
  }
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
  await questionOwner.stop('The native chat session changed');
  questionOwner.close();
  const subagents = await readSubagentSettings(previous);
  await draftWrites;
  id = state.sessionId;
  meta = { ...meta, id, piFile: state.sessionFile, piSessionId: state.sessionId,
    title: state.sessionName || `Fork: ${meta.title}`, parentSession: previous, modified: Date.now() };
  meta.cwd = (await savedSession(meta))?.getCwd() || meta.cwd;
  await writeMeta(meta);
  await inheritChatProject(previous, id);
  await saveSubagentSettings(id, subagents);
  await questionOwner.open(id);
  if (meta.subagentParent) {
    const last = (await savedSession(meta))?.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'assistant');
    // Forked history is already past work, not a newly completed child turn.
    await writeJson(path.join(sessionDir(id), 'subagent-reports.json'), { pending: [], last: last?.id || null });
  }
  ownership = await claimInstance('pi-' + id);
  await listen();
  await socketRequest(browserSocketPath(meta.browserOwner), '/session', { id });
  oldServer.close();
  await fs.rm(socketPath(previous) + '.lock', { force: true });
  oldOwnership.close();
  if (follow) emit({ type: 'session_changed', id }, false);
  for (const client of clients) client.end();
  clients.clear(); entries = []; snapshotEntries = []; events = []; dialogs.clear(); extensionStatuses.clear(); liveToolCalls.clear(); queue = [];
  messageAttribution.clear();
  busy = state.isStreaming; compacting = state.isCompacting;
  pendingModel = null;
  await checkpoint();
}
function reconcileQueue() {
  const remaining = [];
  const candidates = new Map(queue.map(item => [item.id, item]));
  for (const [kind, values] of Object.entries(messageAttribution.queues)) {
    for (const slot of values) {
      const id = slot.item?.id || (slot.id ||= randomUUID());
      const item = candidates.get(id) || slot.item || { id, wire: slot.wire, text: slot.wire, attachments: [], userAuthored: false };
      if (!slot.item) {
        slot.item = item;
        meta.messages ||= [];
        meta.messages.push({ id, text: item.text, wire: item.wire, attachments: [], userAuthored: false });
      }
      candidates.delete(id);
      remaining.push({ ...item, kind });
    }
  }
  queue = [...remaining, ...[...candidates.values()].filter(q => q.editToken || q.held)];
  queueChanged();
}
async function launch() {
  extensionStatuses.clear(); liveToolCalls.clear();
  messageAttribution.clear();
  messageAttribution.sessionId = null;
  const newSession = !meta.piFile;
  meta.contextVersion = await syncContext();
  providersVersion = await providerRevision();
  localProviderRevision = (await managedLocalProvider()).revision;
  projectNativeSession = (await loadPi()).pi.buildSessionContext;
  meta.cwd = (await savedSession(meta))?.getCwd() || meta.cwd;
  rpc = new PiRpc(meta, { ...phoneWorker.environment, BASHKITTEN_WORKER_SOCKET: privateSocket, BASHKITTEN_WORKER_KEY: workerKey });
  let lastAssistantMessage;
  rpc.on('event', event => {
    if (event.type === 'tool_execution_start') liveToolCalls.set(event.toolCallId, { name: event.toolName, parent: event.parentToolCallId });
    if (event.type === 'tool_execution_end') liveToolCalls.delete(event.toolCallId);
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      lastAssistantMessage = event.message;
      void notifyAssistantMessage(meta, event.message).catch(() => {});
    }
    if (event.type === 'extension_ui_request' && event.method === 'setStatus') {
      if (event.statusText === undefined) extensionStatuses.delete(event.statusKey);
      else extensionStatuses.set(event.statusKey, event);
      // Status is replaceable state, not transcript history. Keep the latest
      // snapshot for reconnects without accumulating every telemetry heartbeat.
      emit(event, false);
      return;
    }
    // State transitions are synchronous with the RPC input stream. Slow history
    // reads happen separately, so abort/extension replies never block on a turn.
    if (event.type === 'agent_start') busy = true;
    if (event.type === 'compaction_start') { compacting = true; busy = true; }
    if (event.type === 'compaction_end') compacting = false;
    if (event.type === 'queue_update') { messageAttribution.update(event); reconcileQueue(); return; }
    if (event.type === 'message_start' && event.message?.role === 'user') {
      const consumed = messageAttribution.start(event.message);
      liveUserSubmission = consumed?.item.id;
      if (consumed) {
        const record = meta.messages.find(item => item.id === consumed.item.id);
        if (record) record.nativeMessage = consumed.nativeMessage;
      }
      const index = queue.findIndex(q => q.id === consumed?.item.id);
      if (index >= 0) { queue.splice(index, 1); queueChanged(); }
    }
    if (event.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(event.method)) dialogs.set(event.id, event);
    if (event.type === 'agent_settled') {
      busy = false;
      const completed = lastAssistantMessage; lastAssistantMessage = null;
      if (meta.subagentParent && completed && completed.stopReason !== 'toolUse') {
        const chatId = id, session = meta.piSessionId;
        // The normal message_end event precedes native persistence. By settled,
        // Pi has saved it; read its native ID instead of manufacturing history.
        rpc.command('get_entries').then(history => {
          const entry = history.entries.findLast(item => item.type === 'message' && item.message.role === 'assistant' && item.message.timestamp === completed.timestamp);
          if (!entry) throw Error('Pi did not return the completed turn');
          return reportCompleted(entry.id, chatId, session);
        }).catch(error => emit({ type: 'notice', message: 'Could not deliver the subagent result: ' + error.message }, false));
      }
      eventWork = eventWork.then(async () => {
        await refresh();
        // A new prompt may have arrived while RPC history was being read.
        if (busy) return;
        settleSnapshot();
        emit({ type: 'snapshot', data: snapshot() }, false);
        emit({ type: 'agent_settled' }, false);
        notifyTurn(meta, entries).catch(() => {});
        await serial(applyPending);
      }).catch(error => emit({ type: 'notice', message: error.message }));
      return;
    }
    const translated = translateEvent(event);
    if (translated?.type === 'message') translated.message = displayMessage(meta, translated.message, questionOwner.state.records, undefined, liveUserSubmission);
    if (translated) emit(translated);
    if (event.type === 'message_end' && event.message.role === 'user') {
      liveUserSubmission = undefined;
      // Pi appends after emitting message_end. Read its ID asynchronously and
      // persist attribution while the turn runs, without delaying RPC controls.
      void refresh().catch(error => emit({ type: 'notice', message: 'Could not save message attribution: ' + error.message }, false));
    }
  });
  rpc.on('exit', () => {
    if (changing || stopping) return;
    // Startup commands reject when Pi exits. Let the startup catch report that
    // failure; the worker's HTTP server does not exist until launch succeeds.
    if (!server) return;
    busy = compacting = false;
    questionOwner.close(); extensionServer.close();
    emit({ type: 'notice', message: 'Pi stopped. Send a message to resume this session.' }, false);
    for (const res of clients) res.end('event: offline\ndata: {}\n\n');
    server.close(() => { void phoneWorker.close().finally(() => process.exit(1)); });
  });
  await refresh();
  if (newSession && meta.title) await rpc.command('set_session_name', { name: meta.title });
}
async function applyPending() {
  if (stopping || busy || compacting || dialogs.size || queue.some(q => !q.editToken && !q.held)) return;
  const version = await syncContext();
  if (pendingContext || version !== meta.contextVersion || selectedRuntime().root !== rpc.runtime.root || await providerRevision() !== providersVersion ||
      (await managedLocalProvider()).revision !== localProviderRevision) {
    // Stock Pi snapshots its providers at startup. Reopen its own saved session
    // only at an idle boundary after login/logout/catalog changes; never replay a turn.
    const state = await rpc.command('get_state');
    if (state.isStreaming || state.isCompacting || state.pendingMessageCount) return;
    changing = true;
    await rpc.close();
    try { await launch(); }
    finally { changing = false; pendingContext = false; }
    emit({ type: 'models_changed', model: meta.model, thinking: meta.thinking }, false);
  }
  if (pendingModel) {
    const selection = pendingModel; pendingModel = null;
    const at = selection.model.indexOf('/');
    const provider = selection.model.slice(0, at), modelId = selection.model.slice(at + 1);
    const { model } = await rpc.command('get_state');
    // Selecting thinking must retain Pi's current model, including capabilities
    // discovered by its extensions, rather than reloading the catalog definition.
    if (model?.provider !== provider || model?.id !== modelId) {
      await prepareManagedModel(selection.model);
      await rpc.command('set_model', { provider, modelId });
    } else if (selection.thinking && await managedThinkingUnknown(selection.model)) {
      // Resolve capabilities before an explicit choice, so Pi can record it
      // against the actual model instead of an interim startup clamp.
      await prepareManagedModel(selection.model);
    }
    if (selection.thinking) await rpc.command('set_thinking_level', { level: selection.thinking });
    await refresh(); emit({ type: 'model_change', model: meta.model, thinking: meta.thinking }, false);
  }
}
async function prepareManagedModel(model = meta.model) {
  if (!model?.startsWith('bashkitten-llama/')) return;
  const modelId = model.slice('bashkitten-llama/'.length);
  let managed = await managedLocalProvider(), ready, readinessError;
  if (managed.owned) {
    emit({ type: 'notice', message: 'Checking local llama.cpp readiness' }, false);
    try { ready = await socketRequest(path.join(dataDir, 'run/control.sock'), '/llama-wait', { model: modelId }, 16 * 60 * 1000); }
    catch (error) { readinessError = error; }
    // A user can take over this definition while readiness is awaiting I/O.
    // Its old local service's outcome must not constrain the user's provider.
    managed = await managedLocalProvider();
  }
  if (stopping) throw Error('Pi instance is stopping');
  if (managed.owned) {
    if (readinessError) throw readinessError;
    if (ready?.state !== 'ready' || !ready.url || ready.model !== modelId) throw Error('The selected local llama.cpp model is not ready');
    if (managed.unknownThinking.includes(modelId)) throw Error('The local model loaded, but its reasoning capabilities could not be checked. Retry after checking the llama.cpp service.');
  }
  const available = managed.owned ? (await rpc.command('get_available_models')).models : [];
  const loaded = available.find(item => item.provider === 'bashkitten-llama' && item.id === modelId);
  const version = await providerRevision();
  managed = await managedLocalProvider();
  if (stopping) throw Error('Pi instance is stopping');
  if (managed.revision === localProviderRevision && (!managed.owned || loaded?.baseUrl === ready?.url + '/v1') &&
      version === providersVersion) return;
  const state = await rpc.command('get_state');
  if (state.isStreaming || state.isCompacting || state.pendingMessageCount) throw Error('Pi model configuration changed while Pi was active. Retry after the current turn ends.');
  if (stopping) throw Error('Pi instance is stopping');
  // Stock RPC has no model-registry reload command. Reopen its own saved
  // session at this idle boundary, exactly as for a native runtime update.
  changing = true;
  await rpc.close();
  try { await launch(); } finally { changing = false; }
  managed = await managedLocalProvider();
  if (stopping) throw Error('Pi instance is stopping');
  if (managed.revision !== localProviderRevision) throw Error('Pi model configuration changed while reloading. Retry the operation.');
  if (!managed.owned) return;
  if (!ready) throw Error('Pi model ownership changed while reloading. Retry the operation.');
  const updated = await rpc.command('get_available_models');
  if (!updated.models.some(item => item.provider === 'bashkitten-llama' && item.id === modelId && item.baseUrl === ready.url + '/v1')) throw Error('Pi could not load the ready local llama.cpp model');
  const resumed = await rpc.command('get_state');
  const current = await managedLocalProvider();
  if (stopping || !current.owned || current.revision !== localProviderRevision) throw Error('Pi model configuration changed while reloading. Retry the operation.');
  if (resumed.model?.provider !== 'bashkitten-llama' || resumed.model?.id !== modelId) await rpc.command('set_model', { provider: 'bashkitten-llama', modelId });
  await refresh();
  const refreshed = await managedLocalProvider();
  if (stopping || !refreshed.owned || refreshed.revision !== localProviderRevision) throw Error('Pi model configuration changed while reloading. Retry the operation.');
}
async function canSend(item) {
  if ((item.phoneDelivery || item.phoneAuthorization) && !await validatePhoneDelivery(id, item.phoneAuthorization)) return false;
  // Recheck synchronous lifetime invalidation after the asynchronous policy read.
  return !stopping && (!item.questionId || questionOwner.validDelivery(item)) &&
    (!item.phoneDelivery || item.stopGeneration === questionOwner.state.generation) &&
    (item.ownerGeneration === undefined || item.ownerGeneration === questionOwner.state.generation);
}
async function send(item) {
  allowRuntimeWork();
  await prepareManagedModel();
  if (!await canSend(item)) { item.held = item.recovered = true; await checkpoint(); return; }
  // Pi's prompt command is the authority for idle versus streaming delivery.
  item.delivery = 'submitted'; await checkpoint();
  const images = item.images || await attachmentImages(item.attachments || []);
  if (!await canSend(item)) { item.held = item.recovered = true; await checkpoint(); return; }
  // Older held drafts have no submission identity in their presentation record.
  // Give this explicit send its own record; never reuse an earlier equal text.
  if (!meta.messages.some(record => record.id === item.id)) {
    meta.messages.push({ id: item.id, text: item.text, wire: item.wire, attachments: item.attachments,
      agentSource: item.agentSource, agentDelivery: item.agentDelivery, userAuthored: item.userAuthored });
    await writeMeta(meta);
  }
  messageAttribution.submit(item);
  try {
    const accepted = await rpc.command('prompt', { message: item.wire, images, streamingBehavior: item.kind === 'steer' ? 'steer' : 'followUp' });
    messageAttribution.accepted(accepted?.disposition);
  } catch (error) { messageAttribution.accepted('failed'); throw error; }
  // Pi can expand skills/templates or transform input before message_start, so
  // its consumed text need not equal item.wire. After accepted preflight, an
  // empty native queue means this item is no longer pending even during a turn.
  const state = await rpc.command('get_state');
  if (!state.pendingMessageCount && queue.includes(item)) { queue.splice(queue.indexOf(item), 1); queueChanged(); }
  if (item.wire.startsWith('/')) { await refresh(); emit({ type: 'snapshot', data: snapshot() }, false); }
}
async function rebuildQueue(mutate) {
  const old = [...queue];
  const submitted = messageAttribution.queues;
  messageAttribution.beginClear();
  let cleared;
  try { cleared = await rpc.command('clear_queue'); }
  finally { messageAttribution.endClear(Boolean(cleared)); }
  // Only restore messages Pi actually returned. A boundary may have consumed a
  // message before clear_queue; replaying the browser's stale copy duplicates it.
  const candidates = new Map(old.map(item => [item.id, item])), retained = [];
  for (const [kind, values] of [['steer', cleared.steering], ['queue', cleared.followUp]]) {
    // Pi consumes each queue in order. A turn boundary before clear_queue can
    // leave only its suffix, including indistinguishable equal-text entries.
    const slots = submitted[kind].slice(submitted[kind].length - (values || []).length);
    const known = slots.length === (values || []).length && slots.every((slot, index) => slot.wire === values[index]);
    for (const [index, wire] of (values || []).entries()) {
      const slot = known ? slots[index] : null, id = slot?.item?.id || slot?.id;
      const item = candidates.get(id) || slot?.item || { id: randomUUID(), wire, text: wire, attachments: [], userAuthored: false };
      candidates.delete(id); retained.push({ ...item, kind, delivery: 'pending' });
    }
  }
  retained.push(...[...candidates.values()].filter(q => q.editToken || q.held));
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
  for (let index = 0; index < toSend.length; index++) {
    try { await send(toSend[index]); }
    catch (error) {
      // clear_queue removed these from Pi. A rejected draft send must remain
      // held, including later unsent drafts, rather than block model changes.
      for (const item of toSend.slice(index)) if (queue.includes(item)) item.held = item.recovered = true;
      await checkpoint(); queueChanged(); throw error;
    }
  }
  // Native queue_update events may have run during send; held edits still exist.
  for (const item of retained.filter(q => q.editToken || q.held)) if (!queue.some(q => q.id === item.id)) queue.push(item);
  queueChanged();
  if (failure) throw failure;
}
async function resumeAgentMessages(generation) {
  for (const item of [...queue]) {
    if (!item.agentSource?.id || !item.held || item.delivery !== 'pending') continue;
    item.ownerGeneration = generation; item.kind = 'steer';
    delete item.recovered; delete item.held; delete item.editToken;
    try { await send(item); }
    catch (error) { item.held = item.recovered = true; if (!queue.includes(item)) queue.push(item); await checkpoint(); throw error; }
  }
  queueChanged();
}
async function userForkMessages() {
  const [result, history] = await Promise.all([rpc.command('get_fork_messages'), rpc.command('get_entries')]);
  bindMessageEntries(meta, history.entries);
  const byId = new Map(history.entries.filter(entry => entry.type === 'message').map(entry => [entry.id, entry.message]));
  return { ...result, messages: result.messages.filter(item => {
    const message = byId.get(item.entryId);
    return message?.role === 'user' && displayMessage(meta, message, questionOwner.state.records, item.entryId).userAuthored !== false;
  }) };
}
async function handle(req, res) {
  // A native session switch rebinds this worker; do not reuse its old control connection.
  res.setHeader('Connection', 'close');
  try {
    if (req.url === '/events') {
      void rpc.command('get_commands').then(({ commands }) => { if (commands.some(command => command.source === 'extension' && command.name === 'bashkitten-usage-refresh')) return rpc.command('prompt', { message: '/bashkitten-usage-refresh' }); }).catch(() => {});
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      clients.add(res);
      res.write(`data: ${JSON.stringify({ ok: true, message: 'subscribed', data: snapshot() })}\n\n`);
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
      res.on('close', () => { clearInterval(heartbeat); clients.delete(res); }); return;
    }
    if (req.url === '/questions') return json(res, { questions: questionOwner.list() });
    if (req.url === '/status') return json(res, { data: status() });
    if (req.url === '/view') return json(res, snapshot());
    if (req.url === '/fork-messages') return json(res, await userForkMessages());
    if (req.url === '/models') return json(res, await serial(async () => { await applyPending(); return rpc.command('get_available_models'); }));
    const value = await jsonBody(req), requestGeneration = questionOwner.state.generation;
    if (req.url === '/context') {
      if (stopping) throw Error('Pi instance is stopping');
      // Model readiness can import a provider while this worker's current
      // operation awaits it. Acknowledge the queued refresh without making
      // that importer wait on its own blocked operation.
      contextUpdates++;
      void serial(async () => {
        if (stopping) return;
        if (await providerRevision() !== providersVersion) {
          for (const statusKey of ['chatgpt-usage', 'chatgpt-usage:data']) { extensionStatuses.delete(statusKey); emit({ type: 'extension_ui_request', method: 'setStatus', statusKey }, false); }
          void rpc.command('get_commands').then(({ commands }) => { if (commands.some(command => command.source === 'extension' && command.name === 'bashkitten-usage-refresh')) return rpc.command('prompt', { message: '/bashkitten-usage-refresh invalidate' }); }).catch(() => {});
        }
        pendingContext ||= Boolean(value.reload) || (await syncContext()) !== meta.contextVersion;
        await applyPending();
      }).catch(error => emit({ type: 'notice', message: 'Could not refresh Pi settings: ' + error.message }, false))
        .finally(() => { contextUpdates--; });
      return json(res, { data: status() });
    }
    if (req.url === '/questions/answer') return json(res, await questionOwner.answer(value));
    if (req.url === '/questions/dismiss') return json(res, await questionOwner.dismiss(value));
    if (req.url === '/sidebar-changed') { emit({ type: 'sessions_changed' }, false); return json(res, { ok: true }); }
    if (req.url === '/subagent-settings') {
      const { commands } = await rpc.command('get_commands');
      if (!commands.some(command => command.source === 'extension' && command.name === 'bashkitten-agents-refresh')) throw Error('The BashKitten subagents extension is not loaded in this Pi chat');
      await rpc.command('prompt', { message: '/bashkitten-agents-refresh' });
      emit({ type: 'subagent_settings', settings: await readSubagentSettings(id) }, false);
      return json(res, { ok: true });
    }
    if (req.url === '/reply') { if (!dialogs.has(value.id)) throw Error('This prompt is no longer pending'); dialogs.delete(value.id); rpc.reply(value); return json(res, { ok: true }); }
    if (req.url === '/stop') {
      const stoppedItems = new Set(queue.map(item => item.id));
      await questionOwner.stop();
      const pending = await serial(async () => {
        // Preserve only the queue Pi actually cleared; a boundary may have
        // consumed an earlier item. Agent inputs stay held with their identity.
        await rebuildQueue(items => { for (const item of items) { item.recovered = true; item.held = true; delete item.editToken; } });
        const pending = status();
        for (const key of ['steeringMessages', 'queuedMessages']) pending[key] = pending[key].filter(item => stoppedItems.has(item.id) && item.userAuthored);
        queue = queue.filter(item => !stoppedItems.has(item.id) || !userAuthored(item, questionOwner.state.records));
        await checkpoint(); return pending;
      });
      await rpc.command('abort'); busy = compacting = false;
      await refresh(); settleSnapshot(); emit({ type: 'snapshot', data: snapshot() }, false); emit({ type: 'agent_settled' }, false);
      return json(res, { data: pending });
    }
    if (req.url === '/shutdown') {
      stopping = true;
      if (value.restart) questionOwner.close();
      else await questionOwner.stop('Pi backend is Off');
      if (!value.restart) await writeJson(path.join(sessionDir(id), 'lifecycle.json'), { stopped: true });
      await serial(async () => {
        await rebuildQueue(items => { for (const item of items) { item.recovered = true; item.held = true; delete item.editToken; } });
        await rpc.command('abort'); await checkpoint(); await rpc.close(); await phoneWorker.close();
      });
      json(res, { ok: true });
      for (const client of clients) client.end();
      await fs.rm(socketPath(id) + '.lock', { force: true });
      server.close(() => process.exit(0)); return;
    }
    const result = await serial(async () => {
      if (stopping) throw Error('Pi instance is stopping');
      if (req.url === '/barrier') { const state = await rpc.command('get_state'); return { idle: !state.isStreaming && !state.isCompacting && !dialogs.size && !queue.some(q => !q.held && !q.editToken) }; }
      allowRuntimeWork();
      if (req.url === '/resume') {
        await questionOwner.resume(requestGeneration);
        await resumeAgentMessages(requestGeneration);
        return { data: status() };
      }
      if (req.url === '/message') {
        const authorizedPhone = !value.phoneDelivery || await validatePhoneDelivery(id, value.phoneAuthorization);
        const stalePhone = !authorizedPhone || requestGeneration !== questionOwner.state.generation || (value.phoneDelivery && value.stopGeneration !== questionOwner.state.generation);
        const stoppedAgent = value.agentSource?.id && questionOwner.state.stopped && !value.agentResume;
        if (!stalePhone && !stoppedAgent) {
          await questionOwner.resume(requestGeneration); await applyPending();
          if (!value.agentSource || value.agentResume) await resumeAgentMessages(requestGeneration);
        }
        meta.messages ||= [];
        if (value.agentDelivery && (queue.some(item => item.agentDelivery === value.agentDelivery) || meta.messages.some(item => item.agentDelivery === value.agentDelivery))) return { held: Boolean(queue.find(item => item.agentDelivery === value.agentDelivery)?.held), data: status() };
        const item = { ...value, ownerGeneration: requestGeneration, id: randomUUID(), kind: value.kind || 'queue', delivery: 'pending' };
        meta.messages.push({ id: item.id, text: value.text, wire: value.wire, attachments: value.attachments, agentSource: value.agentSource, agentDelivery: value.agentDelivery });
        queue.push(item);
        if (stalePhone || stoppedAgent) { item.held = item.recovered = true; await checkpoint(); await writeMeta(meta); queueChanged(); return { held: true, data: status() }; }
        try { await checkpoint(); await writeMeta(meta); await send(item); } catch (error) { item.held = item.recovered = true; if (!queue.includes(item)) queue.push(item); await checkpoint(); throw error; }
        return { held: Boolean(item.held), data: status() };
      }
      if (req.url === '/queue') {
        const selected = queue.find(q => q.id === value.id);
        if (!selected) throw Error('Queued message no longer exists');
        if (!userAuthored(selected, questionOwner.state.records)) throw Error('Only user-authored messages can be edited or sent from the user queue');
        const changedDelivery = selected.agentDelivery;
        if (['send', 'promote', 'edit'].includes(value.action)) await questionOwner.resume(requestGeneration);
        await applyPending();
        await rebuildQueue(items => {
          const index = items.findIndex(q => q.id === value.id), item = items[index];
          if (!item) throw Error('Queued message no longer exists');
          if (!userAuthored(item, questionOwner.state.records)) throw Error('Only user-authored messages can be edited or sent from the user queue');
          if (value.action === 'begin_edit' || value.action === 'take_edit') { if (item.editToken && value.action !== 'take_edit') throw Error('Message is being edited'); item.editToken = value.edit_token; }
          else {
            if (item.editToken && item.editToken !== value.edit_token) throw Error('Edit is no longer owned by this tab');
            if (value.action === 'remove') items.splice(index, 1);
            else if (value.action === 'send') { delete item.recovered; delete item.held; delete item.questionId; delete item.phoneDelivery; delete item.phoneAuthorization; item.ownerGeneration = requestGeneration; }
            else if (value.action === 'promote') { item.kind = 'steer'; delete item.recovered; delete item.questionId; delete item.phoneDelivery; delete item.phoneAuthorization; item.ownerGeneration = requestGeneration; }
            else if (value.action === 'cancel_edit') delete item.editToken;
            else if (value.action === 'edit') {
              // Editing an actual question answer remains user input even
              // after its text no longer matches the original question wire.
              item.userAuthored = true;
              item.agentSource ||= queueItem(item, questionOwner.state.records).agentSource;
              const prefix = item.agentSource ? item.wire.slice(0, item.wire.length - item.text.length) : '';
              const suffix = item.agentSource ? '' : item.wire.slice(item.text.length);
              item.text = value.content; item.wire = prefix + value.content + suffix; delete item.editToken; delete item.recovered; delete item.questionId; delete item.phoneDelivery; delete item.phoneAuthorization; item.ownerGeneration = requestGeneration;
              const record = meta.messages.find(record => record.id === item.id);
              if (record) Object.assign(record, { text: item.text, wire: item.wire, agentSource: item.agentSource, userAuthored: true });
            } else throw Error('Unknown queue action');
          }
        });
        if (changedDelivery && ['remove', 'send', 'promote', 'edit'].includes(value.action) && !queue.some(item => item.agentDelivery === changedDelivery && item.held)) await questionOwner.releaseHeld(changedDelivery, value.action === 'remove');
        await writeMeta(meta); return { data: status() };
      }
      if (req.url === '/fork' || req.url === '/clone') {
        if (req.url === '/fork' && !(await userForkMessages()).messages.some(item => item.entryId === value.entryId)) throw Error('Choose a user-authored message to return to the editor');
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
          await refresh(); busy = compacting = false; settleSnapshot(); emit({ type: 'snapshot', data: snapshot() }, false); emit({ type: 'agent_settled' }, false);
        }).catch(error => { busy = compacting = false; emit({ type: 'compaction_end', errorMessage: error.message }); emit({ type: 'agent_settled' }, false); });
        return { ok: true };
      }
      throw Error('Unknown worker operation');
    });
    json(res, result);
  } catch (error) { json(res, { error: error.message }, 400); }
}
let server, ownership;
const extensionServer = http.createServer(async (req, res) => {
  try {
    const supplied = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
    const expected = Buffer.from(workerKey);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json(res, { error: 'Worker authorization required' }, 403);
    if (req.method !== 'POST' || req.url !== '/questions/create') return json(res, { error: 'Unknown worker extension operation' }, 404);
    return json(res, await questionOwner.request(await jsonBody(req)));
  } catch (error) { json(res, { error: error.message }, 400); }
});
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
try {
  phoneWorker = await createPhoneWorker({});
  await launch(); await questionOwner.open(id);
  for (const item of questionOwner.heldDeliveries()) if (!queue.some(existing => existing.agentDelivery === item.agentDelivery)) queue.push({ ...item, id: randomUUID() });
  await checkpoint(); await listen();
  await fs.rm(privateSocket, { force: true });
  await new Promise((resolve, reject) => { extensionServer.once('error', reject); extensionServer.listen(privateSocket, resolve); });
  await fs.chmod(privateSocket, 0o600);
  const last = entries.findLast(entry => entry.type === 'message' && entry.message.role === 'assistant');
  void reportCompleted(last && last.message.stopReason !== 'toolUse' ? last.id : null);
}
catch (error) { await phoneWorker?.close().catch(() => {}); console.error('Pi startup failed:', error.message); await fs.rm(socketPath(id) + '.lock', { force: true }); process.exit(1); }
process.on('SIGTERM', async () => { stopping = true; await questionOwner.stop('Pi backend is Off'); questionOwner.close(); extensionServer.close(); await fs.rm(privateSocket, { force: true }); await phoneWorker.close(); await rpc.close(); await fs.rm(socketPath(id) + '.lock', { force: true }); process.exit(0); });
