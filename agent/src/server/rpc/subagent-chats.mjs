// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { allMeta, readMeta, readJson, writeMeta, writeJson, sessionDir, workerRequest } from '../common.mjs';
import { savedSession } from './rpc.mjs';
import { readSubagentSettings } from './subagents.mjs';

export class SubagentChats {
  locks = new Map();
  constructor({ createSession, ensureWorker, running }) { Object.assign(this, { createSession, ensureWorker, running }); }
  async serial(key, operation) {
    const work = (this.locks.get(key) || Promise.resolve()).catch(() => {}).then(operation);
    this.locks.set(key, work);
    try { return await work; }
    finally { if (this.locks.get(key) === work) this.locks.delete(key); }
  }
  async admit(meta, start) {
    if (!meta.subagentParent) return start();
    return this.serial('children:' + meta.subagentParent, async () => {
      const settings = await readSubagentSettings(meta.subagentParent);
      const siblings = (await allMeta()).filter(item => item.subagentParent === meta.subagentParent && item.id !== meta.id);
      const active = await Promise.all(siblings.map(item => this.running(item.id)));
      if (active.filter(Boolean).length >= settings.count) throw Error(`The parent chat already has ${settings.count} running subagents. Stop a finished child before resuming this one.`);
      return start();
    });
  }
  async deliver(source, target, text, deliveryId, report = false) {
    const agentSource = { id: source.id, name: source.title, report };
    const label = `${report ? 'Completed turn' : 'Message'} from agent ${JSON.stringify(source.title)} (${source.id})`;
    const value = { text, wire: `${label}\n\n${text}`, attachments: [], kind: 'queue', agentSource,
      agentDelivery: `${source.id}:${deliveryId}` };
    // Use the ordinary worker queue, including held drafts for an explicitly
    // stopped chat. Taking its startup lock prevents two owners of drafts.json.
    const held = await this.serial('worker:' + target.id, async () => {
      if (await this.running(target.id)) return false;
      if (!(await readJson(path.join(sessionDir(target.id), 'lifecycle.json'), {})).stopped) return false;
      const file = path.join(sessionDir(target.id), 'drafts.json');
      const drafts = await readJson(file, []);
      const meta = await readMeta(target.id);
      if ((meta.messages || []).some(item => item.agentDelivery === value.agentDelivery)) return true;
      const item = { ...value, id: randomUUID(), held: true, recovered: true };
      // Save the queue before its display attribution; retries are deduplicated
      // by the same delivery ID, never by prompt text.
      if (!drafts.some(item => item.agentDelivery === value.agentDelivery)) await writeJson(file, [...drafts, item]);
      meta.messages ||= []; meta.messages.push(value); await writeMeta(meta);
      return true;
    });
    if (held) return { id: target.id, delivery: 'held', message: 'Pi is stopped; the message is kept as a draft in that chat.' };
    await this.ensureWorker(target.id);
    await workerRequest(target.id, '/message', value);
    return { id: target.id, delivery: 'accepted' };
  }
  async handle(piSessionId, value) {
    const all = await allMeta();
    const source = all.find(meta => meta.piSessionId === piSessionId) ||
      (value.action === 'settings' ? all.find(meta => meta.id === value.chat) : null);
    if (!source) throw Error('The source chat is no longer available');
    const settings = await readSubagentSettings(source.id);
    const root = source.subagentRoot || source.id;
    const family = all.filter(meta => (meta.subagentRoot || meta.id) === root);
    if (value.action === 'settings') return { id: source.id, settings, canMessage: family.length > 1 };
    if (value.action === 'report') {
      if (!source.subagentParent) return { delivered: false };
      const target = all.find(meta => meta.id === source.subagentParent);
      if (!target) return { delivered: false, reason: 'Parent chat was removed' };
      const entry = (await savedSession(source))?.getEntries().find(item => item.id === value.entryId);
      if (entry?.type !== 'message' || entry.message.role !== 'assistant') throw Error('Completed turn not found');
      const message = entry.message;
      const text = (message.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
      return this.deliver(source, target, [text, message.errorMessage].filter(Boolean).join('\n') || `Turn ended (${message.stopReason}).`, entry.id, true);
    }
    if (!settings.enabled && family.length === 1) throw Error('Subagents are off for this chat');
    if (value.action === 'list') return { self: source.id, parent: source.subagentParent || null, settings,
      agents: await Promise.all(family.map(async meta => {
        const status = (await this.running(meta.id))?.data;
        return { id: meta.id, name: meta.title, parent: meta.subagentParent || null,
          state: !status ? 'stopped' : status.busy || status.compacting || status.queuedMessages.some(item => !item.recovered) ? 'running' : 'idle' };
      })) };
    if (value.action === 'spawn') return this.serial('spawn:' + source.id, async () => {
      const settings = await readSubagentSettings(source.id);
      if (!settings.enabled) throw Error('Subagents are off for this chat. Only the user can enable them.');
      if (typeof value.message !== 'string' || !value.message.trim()) throw Error('Write a task for the subagent');
      if (typeof value.name !== 'string' || !value.name.trim()) throw Error('Name the subagent');
      const children = (await allMeta()).filter(meta => meta.subagentParent === source.id);
      const existing = children.find(meta => meta.spawnCall === value.deliveryId);
      if (existing) {
        // Chat creation precedes worker startup. Retry the original delivery
        // after a startup failure; the durable delivery ID prevents replay of
        // an already accepted task and preserves an explicit Stop as a draft.
        const delivery = await this.deliver(source, existing, value.message, value.deliveryId);
        return { ...delivery, name: existing.title, parent: source.id };
      }
      const active = await Promise.all(children.map(meta => this.running(meta.id)));
      if (active.filter(Boolean).length >= settings.count) throw Error(`This chat already has ${settings.count} running subagents. Stop a finished child before starting another.`);
      const parent = await readMeta(source.id);
      if (!parent.piFile) throw Error('The parent Pi session is not saved yet');
      const child = await this.createSession({ cwd: parent.cwd, title: value.name,
        model: settings.model || parent.model, thinking: settings.thinking || parent.thinking,
        subagents: { enabled: false } }, { subagentParent: parent.id, subagentRoot: root,
        spawnCall: value.deliveryId, piSessionDir: path.join(path.dirname(parent.piFile), 'subagentsessions', parent.piSessionId) });
      await this.deliver(parent, child, value.message, value.deliveryId);
      if (await this.running(parent.id)) await workerRequest(parent.id, '/sidebar-changed', {});
      return { id: child.id, name: child.title, parent: parent.id };
    });
    const target = family.find(meta => meta.id === value.id);
    if (!target || target.id === source.id) throw Error('Choose another agent ID returned by list');
    if (value.action === 'send' || value.action === 'follow_up') {
      if (typeof value.message !== 'string' || !value.message.trim()) throw Error('Write a message');
      if (value.action === 'follow_up') await this.ensureWorker(target.id, true);
      return this.deliver(source, target, value.message, value.deliveryId);
    }
    if (value.action === 'stop') {
      if (target.subagentParent !== source.id) throw Error('Only the direct parent can stop this subagent');
      return this.serial('worker:' + target.id, async () => {
        if (await this.running(target.id)) await workerRequest(target.id, '/shutdown', {});
        // A crashed/idle-exited worker still needs a durable Stop intent. A
        // later peer message must become a held draft instead of restarting it.
        else await writeJson(path.join(sessionDir(target.id), 'lifecycle.json'), { stopped: true });
        return { id: target.id, state: 'stopped', message: 'Chat and history kept. The user can resume it.' };
      });
    }
    throw Error('Unknown agent operation');
  }
}
