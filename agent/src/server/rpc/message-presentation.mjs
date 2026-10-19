// SPDX-License-Identifier: AGPL-3.0-only
import { questionPresentation } from './question-presentation.mjs';

const textOf = message => typeof message.content === 'string' ? message.content
  : (message.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');

// Attribution belongs to a consumed native message, never every occurrence of
// its text. Forks retain entry IDs; imported/unbound history stays native.
export function displayMessage(meta, message, questions = [], entryId, submissionId) {
  if (message.role !== 'user') return message;
  const text = textOf(message);
  const matches = (meta.messages || []).filter(item => item.nativeMessage && item.wire === text &&
    item.nativeMessage.timestamp === message.timestamp && (entryId ? item.nativeMessage.entryId === entryId : submissionId && item.id === submissionId));
  if (matches.length !== 1) return message;
  const item = matches[0], question = questionPresentation(item, questions);
  return { ...message, agentSource: question?.agentSource || item.agentSource,
    content: [...item.attachments, { type: 'text', text: question?.text ?? item.text }] };
}

export function bindMessageEntries(meta, entries) {
  const native = new Map();
  for (const entry of entries) {
    if (entry.type !== 'message' || entry.message.role !== 'user') continue;
    const key = JSON.stringify([entry.message.timestamp, textOf(entry.message)]);
    if (!native.has(key)) native.set(key, []);
    native.get(key).push(entry);
  }
  for (const item of meta.messages || []) {
    const receipt = item.nativeMessage;
    if (!receipt || receipt.entryId || receipt.sessionId !== meta.piSessionId) continue;
    // Equal messages may share a millisecond timestamp. The occurrence was
    // observed in native event order, including inputs we did not submit.
    const entry = native.get(JSON.stringify([receipt.timestamp, item.wire]))?.[receipt.occurrence];
    if (entry) receipt.entryId = entry.id;
  }
}

// Stock RPC reports queue removal before message_start, without a request ID.
// Track its ordered queue occurrences while they are live, including unknown
// extension inputs. A clear/rebuild drops this correlation before resubmission.
export class MessageAttribution {
  queues = { steer: [], queue: [] };
  consumed = [];
  submitting = null;
  immediate = null;
  sessionId = null;
  occurrences = new Map();
  seed(sessionId, entries) {
    if (this.sessionId === sessionId) return;
    this.sessionId = sessionId; this.occurrences.clear();
    for (const entry of entries) if (entry.type === 'message' && entry.message.role === 'user') this.observe(entry.message);
  }
  observe(message) {
    const key = JSON.stringify([message.timestamp, textOf(message)]), occurrence = this.occurrences.get(key) || 0;
    this.occurrences.set(key, occurrence + 1);
    return { sessionId: this.sessionId, timestamp: message.timestamp, occurrence };
  }
  submit(item) { this.submitting = { item, queued: false, consumed: false }; }
  accepted(disposition) {
    if (disposition === 'started' && this.submitting && !this.submitting.consumed) this.immediate = this.submitting;
    this.submitting = null;
  }
  clear() { this.queues = { steer: [], queue: [] }; this.consumed = []; this.submitting = this.immediate = null; }
  update(event) {
    for (const [kind, values] of [['steer', event.steering || []], ['queue', event.followUp || []]]) {
      const previous = this.queues[kind];
      if (values.length === previous.length && values.every((wire, index) => wire === previous[index].wire)) continue;
      if (values.length === previous.length + 1 && previous.every((value, index) => value.wire === values[index])) {
        const pending = this.submitting, wire = values.at(-1);
        const owned = pending && !pending.queued && pending.item.kind === kind && pending.item.wire === wire;
        this.queues[kind] = [...previous, { wire, item: owned ? pending.item : null }];
        if (owned) pending.queued = true;
      } else if (values.length === previous.length - 1) {
        // Pi removes the first equal message from steering, then follow-up.
        let index = 0;
        while (index < values.length && previous[index].wire === values[index]) index++;
        while (index > 0 && previous[index - 1].wire === previous[index].wire) index--;
        const retained = previous.filter((_, at) => at !== index);
        if (retained.every((remaining, at) => remaining.wire === values[at])) {
          this.consumed.push(previous[index]);
          this.queues[kind] = retained;
        } else this.queues[kind] = values.map(wire => ({ wire, item: null }));
      } else this.queues[kind] = values.map(wire => ({ wire, item: null }));
    }
  }
  start(message) {
    const nativeMessage = this.observe(message);
    const wire = textOf(message), removed = this.consumed.shift();
    const pending = this.immediate || (this.submitting?.queued ? null : this.submitting);
    const item = removed ? removed.item : pending?.item;
    if (!removed && pending) { pending.consumed = true; this.immediate = null; }
    if (!item || item.wire !== wire || !Number.isFinite(message.timestamp)) return null;
    return { item, nativeMessage };
  }
}
