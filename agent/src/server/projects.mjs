// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dataDir, readJson, writeJson, readMeta, privateDir } from './common.mjs';
import { processStart } from './instance.mjs';
import { pickerDirectory } from './files/folders.mjs';

const file = path.join(dataDir, 'projects.json');
let transaction = Promise.resolve();
export const projects = () => readJson(file, { projects: [], chats: {} });
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
      const catalogue = await projects();
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
    if (!catalogue.projects.some(item => item.id === id)) throw Error('Project not found');
    catalogue.projects = catalogue.projects.filter(item => item.id !== id);
    for (const [chat, project] of Object.entries(catalogue.chats)) if (project === id) delete catalogue.chats[chat];
    return { removed: id };
  });
}
export async function moveChat(id, projectId) {
  await readMeta(id);
  return change(catalogue => {
    if (projectId && !catalogue.projects.some(item => item.id === projectId)) throw Error('Project not found');
    if (projectId) catalogue.chats[id] = projectId; else delete catalogue.chats[id];
    return { id, projectId: projectId || null };
  });
}
export function forgetChat(id) { return change(catalogue => { delete catalogue.chats[id]; }); }
export function inheritChatProject(previous, id) {
  return change(catalogue => {
    const projectId = catalogue.chats[previous];
    if (!catalogue.chats[id] && catalogue.projects.some(project => project.id === projectId)) catalogue.chats[id] = projectId;
  });
}
export async function projectDirectory(id) {
  const project = (await projects()).projects.find(item => item.id === id);
  if (!project) throw Error('Project not found');
  return (await pickerDirectory(project.cwd)).path;
}
