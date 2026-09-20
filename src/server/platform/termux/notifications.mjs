import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dataDir, digest, readJson, writeJson, createJson, privateDir, sessionDir } from '../../common.mjs';
import { platform } from '../index.mjs';

const execute = promisify(execFile), outbox = path.join(dataDir, 'notifications');
export const previewText = text => [...String(text).replace(/\s+/g, ' ').trim()].slice(0, 240).join('');

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
export async function notifyTurn(meta, entries, options = {}) {
  if ((options.platform || platform) !== 'termux') return;
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
  await deliverNotifications(options);
}
export async function deliverNotifications(options = {}) {
  if ((options.platform || platform) !== 'termux') return;
  const settings = (await readJson(path.join(dataDir, 'settings.json'), {})).notifications;
  if (!settings?.enabled) return;
  await privateDir(outbox);
  for (const name of await fs.readdir(outbox)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(outbox, name), lock = file + '.lock';
    const value = await readJson(file, null);
    if (value?.state !== 'pending') continue;
    try {
      const stat = await fs.stat(lock).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 30000) await fs.rm(lock, { force: true });
      const handle = await fs.open(lock, 'wx', 0o600); await handle.close();
    } catch (error) { if (error.code === 'EEXIST') continue; throw error; }
    try {
      // Re-read after claiming: another worker/manager may have completed it.
      const current = await readJson(file, null);
      if (current?.state !== 'pending') continue;
      const content = settings.preview !== false ? current.text : 'Turn finished';
      const result = await (options.execute || execute)('termux-notification', ['--id', 'bashkitten-' + name.slice(0, 24), '--alert-once', '--group', 'BashKitten',
        '--title', current.title || 'BashKitten', '--content', content, '--action',
        `am start -a android.intent.action.VIEW -d bashkitten://session/${current.id} -p com.bashkitten`], { timeout: 10000, maxBuffer: 65536 });
      if (result?.stdout?.trim()) throw Object.assign(Error('Termux:API returned an error'), { code: 'API_ERROR' });
      await writeJson(file, { ...current, state: 'sent', sentAt: Date.now(), error: undefined });
    } catch (error) { await writeJson(file, { ...value, error: error.code || 'Termux:API could not post the notification' }); }
    finally { await fs.rm(lock, { force: true }); }
  }
}
