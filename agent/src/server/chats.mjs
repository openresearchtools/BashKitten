// SPDX-License-Identifier: AGPL-3.0-only
// Pure readers: never import the runtime/bootstrap, discover sessions or start workers.
import fs from 'node:fs/promises';
import path from 'node:path';

const validId = id => /^[a-f0-9-]{36}$/.test(id || '');
async function json(file, fallback, signal) {
  try { return JSON.parse(await fs.readFile(file, { encoding: 'utf8', signal })); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export async function chatCatalogue(root, signal) {
  signal?.throwIfAborted();
  const [names, hidden, catalogue] = await Promise.all([
    fs.readdir(path.join(root, 'sessions')).catch(error => { if (error.code === 'ENOENT') return []; throw error; }),
    json(path.join(root, 'hidden-pi-sessions.json'), [], signal),
    json(path.join(root, 'projects.json'), { projects: [], chats: {} }, signal),
  ]);
  const sessions = [];
  for (const id of names) {
    signal?.throwIfAborted();
    if (!validId(id)) continue;
    const meta = await json(path.join(root, 'sessions', id, 'ui.json'), null, signal);
    if (!meta || hidden.includes(meta.piFile)) continue;
    const project = catalogue.projects.find(value => value.id === catalogue.chats[id]);
    sessions.push({ ...meta, projectId: project?.id || null, projectName: project?.name || null });
  }
  sessions.sort((a, b) => (b.modified || 0) - (a.modified || 0));
  return { projects: catalogue.projects, sessions };
}

// Both the saved chat adapter and deferred tool pass their already-loaded SDK.
export async function nativeSession(pi, meta, signal) {
  if (!meta.piFile) return null;
  const text = await fs.readFile(meta.piFile, { encoding: 'utf8', signal }).catch(error => {
    if (error.code === 'ENOENT') return ''; throw error;
  });
  signal?.throwIfAborted();
  const parsed = pi.parseSessionEntries(text);
  if (!parsed.length) return null;
  if (parsed[0].type !== 'session') throw Error('Invalid native Pi session header');
  return pi.SessionManager.inMemory(parsed[0].cwd || meta.cwd, undefined, parsed);
}
export async function readNativeChat(pi, meta, { signal, leafId } = {}) {
  const native = await nativeSession(pi, meta, signal);
  if (!native) return { entries: [], branches: [], cwd: meta.cwd, leafId: null };
  const all = native.getEntries();
  if (leafId && !all.some(entry => entry.id === leafId)) throw Error('Unknown native branch entry');
  const parents = new Set(all.map(entry => entry.parentId).filter(Boolean));
  const branches = all.filter(entry => entry.id && !parents.has(entry.id)).map(entry => ({ id: entry.id, type: entry.type, timestamp: entry.timestamp }));
  const entries = native.getBranch(leafId).map(entry => {
    if (entry.type !== 'message' || entry.message.role !== 'user') return entry;
    const content = entry.message.content;
    const wire = typeof content === 'string' ? content : (content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
    const upload = (meta.messages || []).find(message => message.wire === wire);
    return upload ? { ...entry, message: { ...entry.message, agentSource: upload.agentSource,
      content: [...upload.attachments, { type: 'text', text: upload.text }] } } : entry;
  });
  return { entries, branches, cwd: native.getCwd(), leafId: leafId || native.getLeafId() };
}
const summary = meta => ({ id: meta.id, title: meta.title, projectId: meta.projectId,
  projectName: meta.projectName, cwd: meta.cwd, modified: meta.modified, subagentParent: meta.subagentParent });
const page = (items, offset, limit) => ({ items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null });
export async function lookupChats(pi, root, value = {}, signal) {
  const action = value.action || 'list', offset = Number(value.offset || 0), limit = Number(value.limit || 50);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw Error('Use a non-negative offset and positive page size');
  const catalogue = await chatCatalogue(root, signal);
  if (action === 'read') {
    const meta = catalogue.sessions.find(session => session.id === value.id);
    if (!meta) throw Error('Chat is unavailable on this backend');
    const history = await readNativeChat(pi, meta, { signal, leafId: value.leafId });
    return { chat: summary(meta), cwd: history.cwd, branches: history.branches, leafId: history.leafId,
      ...page(history.entries, offset, limit) };
  }
  const query = String(value.query || '').toLocaleLowerCase();
  const scoped = catalogue.sessions.filter(meta => !value.projectId || meta.projectId === value.projectId);
  if (action === 'list') return { ...page(scoped.filter(meta => !query || [meta.title, meta.projectName, meta.cwd, meta.id].some(text => String(text || '').toLocaleLowerCase().includes(query))).map(summary), offset, limit), projects: catalogue.projects };
  if (action !== 'search' || !query.trim()) throw Error('Choose list, read, or search with query text');
  const matches = [];
  for (const meta of scoped) {
    signal?.throwIfAborted();
    for (const entry of (await readNativeChat(pi, meta, { signal })).entries) {
      if (entry.type !== 'message') continue;
      const content = entry.message.content;
      const text = typeof content === 'string' ? content : (content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
      const index = text.toLocaleLowerCase().indexOf(query);
      if (index < 0) continue;
      matches.push({ chat: summary(meta), entryId: entry.id, role: entry.message.role,
        excerpt: text.slice(Math.max(0, index - 100), index + query.length + 200) });
    }
  }
  return page(matches, offset, limit);
}
