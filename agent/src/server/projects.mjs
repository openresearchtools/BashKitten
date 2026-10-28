// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dataDir, readJson, writeJson, readMeta, privateDir } from './common.mjs';
import { processStart } from './instance.mjs';
import { pickerDirectory } from './files/folders.mjs';

const file = path.join(dataDir, 'projects.json');
let transaction = Promise.resolve();
export async function projects({ includeArchived = false } = {}) {
  const catalogue = await readJson(file, { projects: [], chats: {} });
  if (includeArchived) return catalogue;
  const active = catalogue.projects.filter(project => !project.archived), ids = new Set(active.map(project => project.id));
  return { ...catalogue, projects: active, chats: Object.fromEntries(Object.entries(catalogue.chats).filter(([, id]) => ids.has(id))) };
}
const projectOperations = new Map(), transitions = new Map();
const operations = id => { if (!projectOperations.has(id)) projectOperations.set(id, { blocked: false, active: new Set() }); return projectOperations.get(id); };
// Library commits participate in the same owning project's explicit lifecycle.
// A relink drains acknowledged commits before checking the new attachment root.
export async function withProjectOperation(id, work) {
  const state = operations(id);
  if (state.blocked) throw Object.assign(Error('The project is changing; retry after it finishes'), { status: 409 });
  const controller = new AbortController(); let finish;
  const active = { controller, done: new Promise(resolve => { finish = resolve; }) };
  state.active.add(active);
  try { return await work(controller.signal); }
  finally { state.active.delete(active); finish(); }
}
export async function withProjectTransition(id, work) {
  const previous = transitions.get(id) || Promise.resolve();
  const pending = previous.catch(() => {}).then(async () => {
    const state = operations(id); state.blocked = true;
    try {
      for (const active of state.active) active.controller.abort(Error('The project lifecycle changed'));
      await Promise.all([...state.active].map(active => active.done));
      return await work();
    } finally { state.blocked = false; }
  });
  transitions.set(id, pending);
  try { return await pending; } finally { if (transitions.get(id) === pending) transitions.delete(id); }
}
const title = input => { const value = String(input || '').trim(); if (!value || /[\x00-\x1f]/.test(value)) throw Error('Choose a project name'); return value; };
function change(work) {
  const operation = transaction.then(async () => {
    await privateDir(dataDir);
    const lock = file + '.lock', owner = { pid: process.pid, started: await processStart(process.pid) };
    for (;;) {
      try { await fs.mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const held = await readJson(path.join(lock, 'owner.json'), null);
        const stale = held ? await processStart(held.pid).catch(() => null) !== held.started
          : Date.now() - (await fs.stat(lock).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs > 30000;
        if (stale) await fs.rm(lock, { recursive: true, force: true });
        else await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    try {
      await writeJson(path.join(lock, 'owner.json'), owner);
      const catalogue = await projects({ includeArchived: true });
      const result = await work(catalogue);
      await writeJson(file, catalogue);
      return result;
    } finally { await fs.rm(lock, { recursive: true, force: true }); }
  });
  transaction = operation.catch(() => {}); return operation;
}
export async function createProject(value) {
  const name = title(value.name), cwd = (await pickerDirectory(value.cwd)).path;
  return change(catalogue => { const project = { id: randomUUID(), name, cwd }; catalogue.projects.push(project); return project; });
}
export function renameProject(id, name) {
  return change(catalogue => { const project = catalogue.projects.find(item => item.id === id); if (!project) throw Error('Project not found'); project.name = title(name); return project; });
}
export function removeProject(id) {
  return change(catalogue => {
    const project = catalogue.projects.find(item => item.id === id);
    if (!project) throw Error('Project not found');
    project.archived = true; project.archivedAt = new Date().toISOString();
    for (const [chat, project] of Object.entries(catalogue.chats)) if (project === id) delete catalogue.chats[chat];
    return { removed: id };
  });
}
export function archiveProject(id, archived) {
  if (typeof archived !== 'boolean') throw Error('Choose whether to archive this project');
  return change(catalogue => {
    const project = catalogue.projects.find(item => item.id === id); if (!project) throw Error('Project not found');
    project.archived = archived;
    if (archived) project.archivedAt = new Date().toISOString(); else delete project.archivedAt;
    return project;
  });
}
export async function relinkProject(id, cwd, { expectedCwd } = {}) {
  const target = (await pickerDirectory(cwd)).path;
  return change(catalogue => {
    const project = catalogue.projects.find(item => item.id === id); if (!project) throw Error('Project not found');
    if (typeof expectedCwd !== 'string' || project.cwd !== expectedCwd) throw Object.assign(Error('The project folder changed; refresh before relinking'), { status: 409 });
    project.cwd = target;
    return project;
  });
}
export async function moveChat(id, projectId) {
  await readMeta(id);
  return change(catalogue => {
    if (projectId && !catalogue.projects.some(item => item.id === projectId && !item.archived)) throw Error('Project not found');
    if (projectId) catalogue.chats[id] = projectId; else delete catalogue.chats[id];
    return { id, projectId: projectId || null };
  });
}
export function forgetChat(id) { return change(catalogue => { delete catalogue.chats[id]; }); }
export function inheritChatProject(previous, id) {
  return change(catalogue => {
    const projectId = catalogue.chats[previous];
    if (!catalogue.chats[id] && catalogue.projects.some(project => project.id === projectId && !project.archived)) catalogue.chats[id] = projectId;
  });
}
export async function projectDirectory(id) {
  const project = (await projects()).projects.find(item => item.id === id);
  if (!project) throw Error('Project not found');
  return (await pickerDirectory(project.cwd)).path;
}
