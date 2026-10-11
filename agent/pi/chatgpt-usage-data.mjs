// SPDX-License-Identifier: MIT
// Adapted 11 October 2026 from llblab/pi-codex-usage v0.13.0 lib/query.ts
// and lib/usage.ts. Copyright narumiruna and llblab; full license in
// vendor/pi-codex-usage/LICENSE. Only Pi auth + quota normalization retained.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export function normalizeUsage(payload, observedAt = Date.now()) {
  const buckets = [];
  function bucket(id, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const windows = [];
    for (const key of ['primary_window', 'secondary_window']) {
      const item = value[key];
      if (item == null) continue;
      if (typeof item !== 'object' || !Number.isFinite(item.used_percent) || !Number.isFinite(item.limit_window_seconds) || item.limit_window_seconds <= 0 || !Number.isFinite(item.reset_at) || item.reset_at <= 0) throw Error('Malformed usage window');
      windows.push({ key, durationSeconds: item.limit_window_seconds, usedPercent: Math.max(0, Math.min(100, item.used_percent)), remainingPercent: Math.max(0, Math.min(100, 100 - item.used_percent)), resetAt: item.reset_at * 1000 });
    }
    if (windows.length) buckets.push({ id: String(id), windows });
  }
  bucket('codex', payload?.rate_limit);
  const additional = payload?.additional_rate_limits;
  if (Array.isArray(additional)) for (const [index, item] of additional.entries()) bucket(item.limit_name ?? item.limit_id ?? item.metered_feature ?? ('additional-' + index), item.rate_limit ?? item);
  else if (additional && typeof additional === 'object') for (const [key, value] of Object.entries(additional)) bucket(key, value.rate_limit ?? value);
  if (!buckets.length) throw Error('No usage windows were returned');
  return { status: 'available', observedAt, buckets };
}
export function usageText(snapshot, locale, timeZone) {
  if (!snapshot) return '';
  const unavailable = snapshot.status === 'unavailable';
  if (unavailable) return 'ChatGPT usage unavailable';
  const pieces = snapshot.buckets.flatMap(bucket => bucket.windows.map(window => {
    const seconds = window.durationSeconds;
    const label = seconds === 604800 ? 'Weekly' : seconds % 3600 === 0 ? `${seconds / 3600}h` : seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;
    const options = { hour: '2-digit', minute: '2-digit', ...(seconds === 604800 ? { year: 'numeric', month: 'short', day: 'numeric' } : {}), ...(timeZone ? { timeZone } : {}) };
    return `${bucket.id === 'codex' ? '' : bucket.id + ' · '}${label} ${window.remainingPercent.toFixed(0)}% remaining · resets ${new Date(window.resetAt).toLocaleString(locale, options)}`;
  }));
  return `${snapshot.status === 'stale' ? 'Stale (observed ' + new Date(snapshot.observedAt).toLocaleString(locale, timeZone ? { timeZone } : {}) + ') · ' : ''}${pieces.join(' | ')}`;
}
// Only inspect the selected model's supported Pi auth result. There is no file
// scraping, account scan, refresh implementation or fallback provider/process.
export async function selectedUsageAuth(ctx) {
  const model = ctx.model;
  if (!model || !['openai', 'openai-codex'].includes(model.provider) || !ctx.modelRegistry.isUsingOAuth(model) || !ctx.modelRegistry.getProvider(model.provider)?.auth?.oauth?.isSubscription) return null;
  const resolved = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!resolved.ok) return null;
  const headers = new Headers();
  for (const [key, value] of Object.entries(resolved.headers || {})) if (value != null) headers.set(key, value);
  if (!headers.has('authorization') && resolved.apiKey) headers.set('authorization', 'Bearer ' + resolved.apiKey);
  const bearer = headers.get('authorization');
  if (!bearer?.startsWith('Bearer ')) return null;
  let claims;
  try { claims = JSON.parse(Buffer.from(bearer.slice(7).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
  const account = claims?.['https://api.openai.com/auth']?.chatgpt_account_id;
  // Same identity used by Pi's openai-codex transport. An opaque API token or
  // workspace mismatch is unavailable; never guess a personal account instead.
  if (typeof account !== 'string' || !account || (headers.has('chatgpt-account-id') && headers.get('chatgpt-account-id') !== account)) return null;
  headers.set('chatgpt-account-id', account); headers.set('accept', 'application/json');
  const key = createHash('sha256').update(model.provider + ':' + account).digest('hex');
  return { key, headers };
}
async function read(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function save(file, value) {
  const temp = file + '.' + randomUUID();
  try { await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
}
// One lock/cache for all workers of this backend/account. Only an active
// refresh waits; there is no perpetual timer. Persist no credentials/account ID.
export async function cachedUsage(auth, root, signal) {
  const directory = path.join(root, 'cache/chatgpt-usage');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, auth.key + '.json'), lock = file + '.lock';
  const fresh = item => item && Date.now() < item.retryAt;
  let cached = await read(file);
  if (fresh(cached)) return cached.snapshot;
  const until = Date.now() + 12000;
  while (true) {
    signal?.throwIfAborted();
    try { await fs.mkdir(lock, { mode: 0o700 }); await save(path.join(lock, 'owner'), { pid: process.pid }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await read(path.join(lock, 'owner'));
      let stale = false;
      if (owner?.pid) { try { process.kill(owner.pid, 0); } catch (error) { stale = error.code === 'ESRCH'; } }
      else stale = Date.now() - (await fs.stat(lock).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs > 15000;
      if (stale) { await fs.rm(lock, { recursive: true, force: true }); continue; }
      cached = await read(file); if (fresh(cached)) return cached.snapshot;
      if (Date.now() >= until) return cached?.snapshot ? { ...cached.snapshot, status: 'stale' } : { status: 'unavailable', observedAt: Date.now(), buckets: [] };
      await delay(100, undefined, { signal });
    }
  }
  try {
    cached = await read(file); if (fresh(cached)) return cached.snapshot;
    try {
      const response = await fetch('https://chatgpt.com/backend-api/wham/usage', { headers: auth.headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), redirect: 'error' });
      if (!response.ok) throw Error('Usage unavailable');
      const snapshot = normalizeUsage(await response.json());
      await save(file, { retryAt: Date.now() + 60000, snapshot }); return snapshot;
    } catch (error) {
      if (signal?.aborted) throw error;
      const snapshot = cached?.snapshot?.buckets?.length ? { ...cached.snapshot, status: 'stale' } : { status: 'unavailable', observedAt: Date.now(), buckets: [] };
      await save(file, { retryAt: Date.now() + 60000, snapshot }); return snapshot;
    }
  } finally { await fs.rm(lock, { recursive: true, force: true }); }
}
