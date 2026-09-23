import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir, digest, readJson, writeJson, createJson, privateDir, sessionDir } from '../common.mjs';

const outbox = path.join(dataDir, 'notifications');
export const previewText = text => [...String(text).replace(/\s+/g, ' ').trim()].slice(0, 240).join('');
export async function notificationSettings(input) {
  const file = path.join(dataDir, 'settings.json'), settings = await readJson(file, {});
  if (input !== undefined) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid notification settings');
    for (const [key, value] of Object.entries(input)) if (!['enabled', 'onlyWhenHidden', 'preview'].includes(key) || typeof value !== 'boolean') throw Error('Invalid notification setting');
    settings.notifications = { ...settings.notifications, ...input };
    await writeJson(file, settings);
  }
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
  if (!settings?.enabled) return;
  const last = entries.findLast(entry => entry.type === 'message' && entry.message?.role === 'assistant');
  if (!last || ['aborted', 'error', 'toolUse'].includes(last.message.stopReason)) return;
  sessionDir(meta.id);
  const text = typeof last.message.content === 'string' ? last.message.content : (last.message.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  if (!text.trim()) return;
  const file = path.join(outbox, digest(meta.id + ':' + last.id) + '.json');
  if (!await readJson(file, null)) {
    const suppressed = settings.onlyWhenHidden !== false && await isVisible(meta.id);
    await createJson(file, { id: meta.id, turn: last.id, title: meta.title, text: previewText(text), state: suppressed ? 'suppressed' : 'pending' });
  }
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
    const file = path.join(outbox, key + '.json'), value = await readJson(file, null);
    if (value?.state !== 'pending') continue;
    await writeJson(file, { ...value, state: 'sent', sentAt: Date.now(), error: undefined });
    acknowledged++;
  }
  return { acknowledged };
}
// Kept for workers surviving an in-place upgrade. Delivery is browser-owned.
export const deliverNotifications = pendingNotifications;
