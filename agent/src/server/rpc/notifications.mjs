import fs from 'node:fs/promises';
import { updateNotification } from './notification-store.mjs';
import { updateSettings } from '../settings.mjs';
import path from 'node:path';
import { phoneEvent, putPhoneEvent, phoneQuestionResolved, liveAssistantMessage } from '../phone.mjs';
import { dataDir, digest, readJson, writeJson, createJson, privateDir, sessionDir } from '../common.mjs';

const outbox = path.join(dataDir, 'notifications');
export const previewText = text => [...String(text).replace(/\s+/g, ' ').trim()].slice(0, 240).join('');
export async function notificationSettings(input) {
  let settings;
  if (input !== undefined) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid notification settings');
    for (const [key, value] of Object.entries(input)) if (!['enabled', 'onlyWhenHidden', 'preview'].includes(key) || typeof value !== 'boolean') throw Error('Invalid notification setting');
    settings = await updateSettings(current => ({ ...current, notifications: { ...current.notifications, ...input } }));
  } else settings = await readJson(path.join(dataDir, 'settings.json'), {});
  return { enabled: false, onlyWhenHidden: true, preview: true, ...settings.notifications };
}

export async function visibleSession(client, id, visible) {
  if (!/^[a-f0-9-]{36}$/.test(client)) throw Error('Invalid browser identity');
  if (id) sessionDir(id);
  await writeJson(path.join(dataDir, 'visibility', client + '.json'), { id, expires: visible ? Date.now() + 45000 : 0 });
}
async function isVisible(id) {
  const root = path.join(dataDir, 'visibility');
  for (const name of await fs.readdir(root).catch(() => [])) {
    const file = path.join(root, name), value = await readJson(file, null);
    if (value?.expires < Date.now()) continue;
    if (value?.id === id) return true;
  }
  return false;
}
export async function notifyTurn(meta, entries) {
  const settings = (await readJson(path.join(dataDir, 'settings.json'), {})).notifications;
  const last = entries.findLast(entry => entry.type === 'message' && entry.message?.role === 'assistant');
  if (!last || ['aborted', 'error', 'toolUse'].includes(last.message.stopReason)) return;
  sessionDir(meta.id);
  const text = typeof last.message.content === 'string' ? last.message.content : (last.message.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  if (!text.trim()) return;
  const phone = await phoneEvent(meta, last.id, { kind: 'final', entryId: last.id, text });
  if (!settings?.enabled && !phone) return;
  const file = path.join(outbox, digest(meta.id + ':' + last.id) + '.json');
  await updateNotification(file, async current => {
    if(current)return null;
    const suppressed = !settings?.enabled || phone?.route === 'messages' || settings.onlyWhenHidden !== false && await isVisible(meta.id);
    return { id: meta.id, turn: last.id, title: meta.title, text: previewText(text), state: suppressed ? 'suppressed' : 'pending', ...(phone ? { phone, phoneState: 'pending' } : {}) };
  });
}
// Native browser clients consume this private outbox through authenticated
// events or the trusted Termux controller. Termux:API is not involved.
export async function pendingNotifications() {
  const settings = (await readJson(path.join(dataDir, 'settings.json'), {})).notifications;
  if (!settings?.enabled) return [];
  await privateDir(outbox);
  const result = [];
  for (const name of await fs.readdir(outbox)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const value = await readJson(path.join(outbox, name), null);
    if (value?.state !== 'pending') continue;
    result.push({ key: name.slice(0, -5), id: value.id, turn: value.turn,
      title: value.title || 'BashKitten', text: settings.preview !== false ? value.text : 'Turn finished' });
  }
  return result;
}
export async function acknowledgeNotifications(keys) {
  if (!Array.isArray(keys) || keys.some(key => !/^[a-f0-9]{64}$/.test(key))) throw Error('Invalid notification IDs');
  let acknowledged = 0;
  for (const key of keys) {
    await updateNotification(path.join(outbox, key + '.json'), value => {
      if (value?.state !== 'pending') return null;
      acknowledged++;
      return { ...value, state: 'sent', sentAt: Date.now(), error: undefined };
    });
  }
  return { acknowledged };
}
// Kept for workers surviving an in-place upgrade. Delivery is browser-owned.
export const deliverNotifications = pendingNotifications;

// Phone hooks are independent of ordinary notification settings and visibility.
export async function notifyQuestion(meta, question) {
  return putPhoneEvent(meta, `question:${question.questionId}:${question.revision}`, { kind: 'question',
    questionId: question.questionId, revision: question.revision, nativeSessionId: question.nativeSessionId, branchId: question.branchId, text: question.text, options: question.options,
    expiresAt: question.deadline, createdAt: question.createdAt });
}
export const resolvedQuestion = phoneQuestionResolved;
export const notifyAssistantMessage = liveAssistantMessage;
