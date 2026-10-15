// SPDX-License-Identifier: AGPL-3.0-only
// One live worker owns a chat's optional questions. This is operational state,
// never Pi history; all answer/expiry delivery goes through its existing queue.
import path from 'node:path';
import { digest, readJson, writeJson, readMeta, sessionDir } from '../common.mjs';
import { resolvedQuestion } from './notifications.mjs';

export const QUESTION_TIMEOUT_MS = 120000;
export async function savedQuestions(id) {
  return (await readJson(path.join(sessionDir(id), 'questions.json'), { records: [] })).records;
}
function cancelPending(state, reason) {
  const cancelled = [];
  for (const question of state.records) if (question.status === 'pending') {
    question.status = 'cancelled'; question.reason = reason; question.resolvedAt = Date.now();
    cancelled.push(question);
  }
  return cancelled;
}
/** Only after the live worker has exited, or under its startup lock. */
export async function stopSavedQuestions(id, reason = 'Pi backend is Off') {
  const file = path.join(sessionDir(id), 'questions.json'), state = await readJson(file, null);
  if (!state) return;
  if (!state.stopped) state.generation++;
  state.stopped = true; cancelPending(state, reason);
  for (const question of state.records) {
    for (const delivery of question.deliveries || []) if (delivery.status === 'submitting') delivery.status = 'held';
    if (question.deliveryStatus === 'submitting') question.deliveryStatus = 'held';
  }
  await writeJson(file, state);
  // The existing outbox deduplicates these resolved controls by question ID.
  // Reconcile on retry too, including a crash after saving cancellation.
  const meta = await readMeta(id);
  for (const question of state.records) if (question.status === 'cancelled') await resolvedQuestion(meta, question);
}
export class QuestionOwner {
  constructor({ owner, verify, authorize, deliver, changed, created, resolved, error }) {
    Object.assign(this, { owner, verify, authorize, deliver, changed, created, resolved, error });
    this.work = Promise.resolve(); this.timer = null; this.epoch = 0;
    this.state = { generation: 0, stopped: false, records: [] };
  }
  serial(fn) { const task = this.work.then(fn); this.work = task.catch(() => {}); return task; }
  async open(id) {
    clearTimeout(this.timer); this.epoch++; this.closed = false;
    this.id = id; this.file = path.join(sessionDir(id), 'questions.json');
    this.state = await readJson(this.file, { generation: 0, stopped: false, records: [] });
    // A worker may be starting when Stop persists its intent. Do not schedule
    // old questions even if the previous owner died before saving cancellation.
    if (this.state.stopped || (await readJson(path.join(sessionDir(id), 'lifecycle.json'), {})).stopped) {
      if (!this.state.stopped) this.state.generation++;
      this.state.stopped = true; cancelPending(this.state, 'Pi backend is Off');
    }
    // Submitted delivery at death is uncertain. Existing draft recovery holds it;
    // never replay from this operational record, even if no queue item survived.
    for (const question of this.state.records) {
      for (const delivery of question.deliveries || []) if (delivery.status === 'submitting') delivery.status = 'held';
      if (question.deliveryStatus === 'submitting') question.deliveryStatus = 'held';
    }
    await this.save(); this.schedule();
  }
  list() { return structuredClone(this.state.records.map(({ deliveries, ...question }) => question)); }
  heldDeliveries() {
    return this.state.records.flatMap(question => (question.deliveries || []).filter(delivery => delivery.status === 'held' && delivery.text).map(delivery => ({
      questionId: question.questionId, generation: question.generation, sessionId: question.sessionId, nativeSessionId: question.nativeSessionId,
      text: delivery.text, wire: delivery.text, attachments: [], kind: 'steer', agentDelivery: delivery.id, phoneAuthorization: delivery.phoneAuthorization, held: true, recovered: true,
    })));
  }
  async save() { await writeJson(this.file, this.state); }
  schedule() {
    clearTimeout(this.timer);
    const next = this.closed || this.state.stopped ? undefined : this.state.records.filter(q => q.status === 'pending').sort((a, b) => a.deadline - b.deadline)[0];
    if (!next) return;
    this.timer = setTimeout(() => this.serial(() => this.expire()).catch(this.error), Math.max(1, next.deadline - Date.now()));
    this.timer.unref();
  }
  async publish(question, invitation = false) {
    await this.save(); this.changed(this.list()); this.schedule();
    // The outbox cannot delay the tool result, next turn, or UI transition.
    void Promise.resolve().then(() => invitation ? this.created(question) : this.resolved(question)).catch(this.error);
  }
  validDelivery(question) {
    return !this.closed && !this.state.stopped && question.generation === this.state.generation &&
      question.sessionId === this.id && question.nativeSessionId === this.owner().nativeSessionId;
  }
  async request(input) {
    return this.serial(async () => {
      const current = this.owner();
      if (this.closed || this.state.stopped || input.nativeSessionId !== current.nativeSessionId) throw Error('This question no longer belongs to an active chat');
      if (typeof input.toolCallId !== 'string' || !input.toolCallId || typeof input.text !== 'string' || !input.text.trim()) throw Error('Question text and originating tool call are required');
      if (input.options !== undefined && (!Array.isArray(input.options) || input.options.some(option => typeof option !== 'string' || !option.trim()))) throw Error('Question choices must be nonempty text');
      const questionId = digest(this.id + ':' + current.nativeSessionId + ':' + input.toolCallId);
      const previous = this.state.records.find(q => q.questionId === questionId);
      if (previous) return previous;
      const now = Date.now();
      const question = { questionId, revision: 1, sessionId: this.id, nativeSessionId: current.nativeSessionId,
        branchId: input.branchId, toolCallId: input.toolCallId, text: input.text.trim(), options: input.options || [],
        createdAt: now, deadline: now + QUESTION_TIMEOUT_MS, status: 'pending', generation: this.state.generation };
      if (!await this.verify(question) || !this.validDelivery(question)) throw Error('The originating question tool call is no longer on this active chat branch');
      this.state.records.push(question); await this.publish(question, true); return question;
    });
  }
  async dispatch(question, text, deliveryId, source, phoneAuthorization) {
    question.deliveries ||= [];
    if (question.deliveries.some(delivery => delivery.id === deliveryId)) return;
    const delivery = { id: deliveryId, text, source, phoneAuthorization, status: 'submitting' };
    question.deliveries.push(delivery); question.deliveryId = deliveryId; question.deliveryStatus = 'submitting';
    // Resolution and its delivery intent persist together. If a crash lands
    // before queue insertion, reopen exposes this text only as a held draft.
    await this.publish(question);
    if (!this.validDelivery(question) || !await this.verify(question) || !this.validDelivery(question)) {
      delivery.status = 'held'; question.deliveryStatus = 'held'; await this.publish(question); return;
    }
    const epoch = this.epoch;
    void this.deliver({ questionId: question.questionId, generation: question.generation, sessionId: question.sessionId,
      nativeSessionId: question.nativeSessionId, text, wire: text, attachments: [], kind: 'steer',
      agentDelivery: deliveryId, questionSource: source, phoneAuthorization }).then(result => this.serial(async () => {
        if (epoch !== this.epoch) return;
        delivery.status = result?.held ? 'held' : 'accepted';
        if (delivery.status === 'accepted') delete delivery.text;
        if (question.deliveryId === deliveryId) question.deliveryStatus = delivery.status;
        await this.publish(question);
      })).catch(error => this.serial(async () => {
        if (epoch !== this.epoch) return;
        delivery.status = 'held'; if (question.deliveryId === deliveryId) question.deliveryStatus = 'held';
        await this.publish(question); this.error(error);
      }));
  }
  async expire() {
    for (const question of this.state.records) {
      if (this.closed || this.state.stopped) break;
      if (question.status !== 'pending' || question.deadline > Date.now()) continue;
      question.status = 'expired'; question.resolvedAt = Date.now();
      await this.dispatch(question, `[Optional question ${question.questionId}: ${question.text}]\nBackend timeout notice: No response; proceed with the best long-term solution. This is not a user choice or permission approval.`, 'question:' + question.questionId + ':expiry', 'expiry');
    }
    this.schedule();
  }
  dismiss(input) {
    return this.serial(async () => {
      const question = this.state.records.find(q => q.questionId === input.questionId);
      if (!question || input.revision !== question.revision) throw Error('This question or its revision is no longer available');
      const epoch = this.epoch, generation = this.state.generation;
      if (input.source !== 'web' || !await this.authorize(input)) throw Error('This question cannot be dismissed from this source');
      const result = () => ({ question, status: question.status, deliveryStatus: question.deliveryStatus });
      if (question.dismissed || !['pending', 'expired'].includes(question.status)) return result();
      if (question.status === 'expired') {
        // This only hides a settled control. An earlier Stop must not require
        // resuming work, but an owner change during validation still rejects it.
        const ownsQuestion = () => !this.closed && this.epoch === epoch && this.state.generation === generation &&
          question.sessionId === this.id && question.nativeSessionId === this.owner().nativeSessionId;
        if (!ownsQuestion() || !await this.verify(question) || !ownsQuestion()) throw Error('The originating question is no longer on this active chat branch');
        question.dismissed = true; question.dismissedAt = Date.now();
        await this.publish(question); return result();
      }
      if (!this.validDelivery(question)) throw Error('This chat is stopped or no longer owns the question');
      if (!await this.verify(question) || !this.validDelivery(question)) throw Error('The originating question is no longer on this active chat branch');
      // The absolute deadline still wins if branch verification crossed it.
      if (question.status === 'pending' && question.deadline <= Date.now()) await this.expire();
      if (!this.validDelivery(question)) throw Error('This chat is stopped or no longer owns the question');
      question.dismissed = true; question.dismissedAt = Date.now();
      if (question.status === 'expired') {
        // Hide the remaining reply control without changing the timeout or
        // delivering another notice after the original expiry resolution.
        await this.publish(question); return result();
      }
      question.status = 'cancelled'; question.reason = 'User dismissed this question'; question.resolvedAt = question.dismissedAt;
      await this.dispatch(question, `[Optional question ${question.questionId}: ${question.text}]\nUser dismissed this optional question without an answer. Proceed with the best long-term solution. This is not a user choice or permission approval.`, 'question:' + question.questionId + ':dismissal', 'dismissal');
      return result();
    });
  }
  answer(input) {
    return this.serial(async () => {
      const question = this.state.records.find(q => q.questionId === input.questionId);
      if (!question || input.revision !== question.revision) throw Error('This question or its revision is no longer available');
      if (!['web', 'call', 'notification', 'voicemail'].includes(input.source)) throw Error('Invalid question reply source');
      if (typeof input.text !== 'string' || !input.text.trim() || typeof input.deliveryId !== 'string' || !input.deliveryId) throw Error('A reply and stable delivery ID are required');
      if (!await this.authorize(input)) throw Error('This reply source is no longer enabled for this chat');
      // The dismissal notice's accepted delivery is not acceptance of this reply.
      if (question.dismissed) return { question, status: 'cancelled', deliveryStatus: 'held' };
      if (question.status === 'pending' && question.deadline <= Date.now()) await this.expire();
      if (question.status === 'cancelled' || !this.validDelivery(question)) return { question, status: 'cancelled', deliveryStatus: 'held' };
      const followup = async () => {
        const expired = question.status === 'expired';
        const reviewedChannel = ['call', 'voicemail'].includes(input.source);
        if (reviewedChannel && !input.lateConfirmed) return { question, status: question.status, requiresFollowupConfirmation: true };
        if (!expired && !reviewedChannel) return { question, status: question.status, deliveryStatus: question.deliveryStatus };
        const deliveryId = 'question:' + question.questionId + ':late:' + digest(input.deliveryId);
        if (!(question.deliveries || []).some(delivery => delivery.id === deliveryId)) {
          await this.dispatch(question, `[User follow-up to ${expired ? 'expired' : 'already answered'} optional question ${question.questionId}: ${question.text}]\n${input.text.trim()}`, deliveryId, input.source, input.phoneAuthorization);
        }
        return { question, status: question.status, deliveryStatus: question.deliveryStatus, followup: true };
      };
      if (question.status === 'answered') {
        if (question.resolutionDeliveryId === input.deliveryId) return { question, status: question.status, deliveryStatus: question.deliveryStatus };
        return followup();
      }
      if (question.status === 'expired') return followup();
      if (!await this.verify(question) || !this.validDelivery(question)) { question.status = 'cancelled'; question.reason = 'The native chat branch changed'; await this.publish(question); return { question, status: question.status }; }
      // Native branch verification is asynchronous; enforce the absolute
      // deadline again immediately before the in-memory resolution transition.
      if (!await this.authorize(input)) throw Error('This reply source is no longer enabled for this chat');
      if (!this.validDelivery(question)) return { question, status: 'cancelled', deliveryStatus: 'held' };
      if (question.deadline <= Date.now()) { await this.expire(); return followup(); }
      question.status = 'answered'; question.answer = input.text.trim(); question.source = input.source; question.resolutionDeliveryId = input.deliveryId; question.resolvedAt = Date.now();
      await this.dispatch(question, `[User answer to optional question ${question.questionId}: ${question.text}]\n${question.answer}`, 'question:' + question.questionId + ':answer', input.source, input.phoneAuthorization);
      return { question, status: question.status, deliveryStatus: question.deliveryStatus };
    });
  }
  stop(reason = 'User stopped this chat') {
    // Synchronous generation invalidation wins against a send awaiting I/O.
    this.state.stopped = true; this.state.generation++; clearTimeout(this.timer);
    return this.serial(async () => {
      for (const question of cancelPending(this.state, reason)) await this.publish(question);
      await this.save();
    });
  }
  releaseHeld(deliveryId, removed = false) {
    return this.serial(async () => {
      for (const question of this.state.records) {
        const delivery = question.deliveries?.find(item => item.id === deliveryId);
        if (!delivery) continue;
        delivery.status = removed ? 'discarded' : 'accepted'; delete delivery.text;
        if (question.deliveryId === deliveryId) question.deliveryStatus = delivery.status;
        await this.publish(question);
      }
    });
  }
  resume(generation = this.state.generation) { return this.serial(async () => { if (generation !== this.state.generation) return false; this.state.stopped = false; await this.save(); this.schedule(); return true; }); }
  close() { this.closed = true; clearTimeout(this.timer); this.epoch++; }
}
