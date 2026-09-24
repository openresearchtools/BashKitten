import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';

import { selectedRuntime, loadPi } from './runtime.mjs';
import { browserSocketPath } from '../access/browser-channel.mjs';

// Read native history without opening a second writable session manager.
export async function savedSession(meta) {
  if (!meta.piFile) return null;
  const { pi: { SessionManager, parseSessionEntries } } = await loadPi();
  const text = await fs.readFile(meta.piFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  const entries = parseSessionEntries(text);
  if (!entries.length) return null;
  if (entries[0]?.type !== 'session') throw Error('Invalid native Pi session header');
  return SessionManager.inMemory(entries[0].cwd || meta.cwd, undefined, entries);
}

export function displayMessage(meta, message) {
  if (message.role !== 'user') return message;
  const text = typeof message.content === 'string' ? message.content : (message.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  const upload = (meta.messages || []).find(m => m.wire === text);
  return upload ? { ...message, content: [...upload.attachments, { type: 'text', text: upload.text }] } : message;
}
export function queueItem(item) {
  return { id: item.id, content: item.text, attachments: item.attachments.map(a => a.name), attachmentPaths: item.attachments.map(a => a.path), editing: Boolean(item.editToken), recovered: Boolean(item.recovered) };
}

/** Strict LF framing: a JSON string may contain U+2028/U+2029. */
export class JsonLines {
  buffer = '';
  constructor(consume) { this.consume = consume; }
  push(chunk) {
    this.buffer += chunk;
    let end;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).replace(/\r$/, '');
      this.buffer = this.buffer.slice(end + 1);
      if (line.trim()) this.consume(JSON.parse(line));
    }
  }
}

export class PiRpc extends EventEmitter {
  pending = new Map();
  constructor(meta) {
    super();
    this.runtime = selectedRuntime();
    const args = [this.runtime.cli, '--offline', '--mode', 'rpc'];
    if (meta.piFile) args.push('--session', meta.piFile);
    // Pi owns tools/extensions and restores model/thinking from its session.
    // Only a new chat receives the user's explicit initial selections.
    if (!meta.piFile || !existsSync(meta.piFile)) {
      if (meta.model && meta.model !== 'unknown/unknown') args.push('--model', meta.model);
      if (meta.thinking) args.push('--thinking', meta.thinking);
    }
    this.child = spawn(process.execPath, args, { cwd: meta.cwd, env: { ...process.env, PI_TELEMETRY: '0', BASHKITTEN_BROWSER_SOCKET: browserSocketPath(meta.browserOwner || meta.workerOwner || meta.id) }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    const lines = new JsonLines(value => {
      if (value.type === 'response') {
        const pending = this.pending.get(value.id);
        if (!pending) return;
        clearTimeout(pending.timeout); this.pending.delete(value.id);
        if (value.success) pending.resolve(value.data); else pending.reject(Error(value.error || 'Pi command failed'));
      } else this.emit('event', value);
    });
    this.child.stdout.on('data', chunk => {
      try { lines.push(chunk); } catch { this.fail(Error('Pi sent an invalid RPC record')); this.child.kill(); }
    });
    // Keep only startup diagnostics in memory; never return raw provider stderr.
    this.child.stderr.resume();
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', (code, signal) => { this.fail(Error(`Pi stopped (${signal || code})`)); this.emit('exit', { code, signal }); });
  }
  fail(error) { for (const p of this.pending.values()) { clearTimeout(p.timeout); p.reject(error); } this.pending.clear(); }
  command(type, payload = {}, timeoutMs = 120000) {
    if (this.child.exitCode !== null || this.child.killed) return Promise.reject(Error('Pi is not running'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(Error(`Pi ${type} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdin.write(JSON.stringify({ ...payload, type, id }) + '\n');
    });
  }
  reply(value) { this.child.stdin.write(JSON.stringify({ ...value, type: 'extension_ui_response' }) + '\n'); }
  async close() {
    if (this.child.exitCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => this.child.kill('SIGKILL'), 3000);
      this.child.once('exit', () => { clearTimeout(timer); resolve(); });
      this.child.kill('SIGTERM');
    });
  }
}

/** Presentation-only translation. Pi remains the agent and usage authority. */
export function translateEvent(event) {
  const e = event.assistantMessageEvent;
  if (event.type === 'message_update') {
    if (e.type === 'text_delta') return { type: 'assistant_delta', delta: e.delta };
    if (e.type === 'thinking_delta') return { type: 'thinking_delta', delta: e.delta };
    if (['toolcall_start', 'toolcall_delta', 'toolcall_end'].includes(e.type)) {
      const call = e.toolCall || e.partial?.content[e.contentIndex];
      return { type: e.type.replace('toolcall_', 'tool_call_'), index: e.contentIndex,
        id: call?.id, name: call?.name, arguments: call?.arguments, delta: e.delta };
    }
    return null;
  }
  if (event.type === 'message_end') return { type: 'message', message: event.message };
  if (event.type.startsWith('tool_execution_')) return { ...event, type: event.type.replace('tool_execution_', 'tool_'), id: event.toolCallId, name: event.toolName };
  if (['agent_start', 'agent_settled', 'compaction_start', 'compaction_end', 'auto_retry_start', 'auto_retry_end', 'summarization_retry_scheduled', 'extension_ui_request'].includes(event.type)) return event;
  if (event.type === 'extension_error') return { type: 'notice', message: event.error };
  return null;
}

export function activeBranch(entries, leafId) {
  const byId = new Map(entries.map(e => [e.id, e])); const branch = []; const seen = new Set();
  while (leafId && byId.has(leafId) && !seen.has(leafId)) { seen.add(leafId); const entry = byId.get(leafId); branch.push(entry); leafId = entry.parentId; }
  return branch.reverse();
}
export function usageView(stats = {}, entries = []) {
  const t = stats.tokens || {}, ctx = stats.contextUsage;
  const fmt = n => n == null ? '?' : n < 1000 ? String(n) : n < 10000 ? (n / 1000).toFixed(1) + 'k' : n < 1000000 ? Math.round(n / 1000) + 'k' : (n / 1000000).toFixed(1) + 'M';
  return { ...stats, compactions: entries.filter(e => e.type === 'compaction').length,
    text: `↑${fmt(t.input)} ↓${fmt(t.output)} R${fmt(t.cacheRead)} W${fmt(t.cacheWrite)} $${Number(stats.cost || 0).toFixed(3)} · ${ctx?.percent == null ? '?' : ctx.percent.toFixed(1)}%/${fmt(ctx?.contextWindow)}` };
}
