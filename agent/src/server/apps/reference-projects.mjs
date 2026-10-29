// SPDX-License-Identifier: AGPL-3.0-only
// References database identities are independent of native chat/workspace projects.
// The existing backend instance lock owns this catalogue; common.writeJson owns
// durable replacement, and the application adapter owns all authorization.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { dataDir, digest, readJson, writeJson } from '../common.mjs';
import { projects as workspaceProjects } from '../projects.mjs';

const root = path.join(dataDir, 'references');
const file = path.join(root, 'projects.json');
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const title = input => {
  const name = typeof input === 'string' ? input.trim() : '';
  if (!name || name.length > 256 || /[\x00-\x1f\x7f]/.test(name)) fail('Choose a project name of 1–256 characters');
  return name;
};
const present = async filename => fs.stat(filename).then(stat => stat.isFile(), error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});
const managedFolder = id => path.join(os.homedir(), 'References', id, 'Bibliography');
let initialization, transaction = Promise.resolve();

async function initialize() {
  const saved = await readJson(file, null);
  if (saved) {
    if (saved.version !== 1 || !Array.isArray(saved.projects) || typeof saved.defaultProjectId !== 'string') fail('References project catalogue is invalid', 500);
    // Finish the catalogue side if a prior deliberate database deletion reached
    // its durable tombstone immediately before the backend stopped.
    let changed = false;
    for (const project of saved.projects) {
      if (project.deletedAt) continue;
      const deleted = await readJson(path.join(root, digest(project.id), 'deleted.json'), null);
      if (deleted) { project.deletedAt = deleted.deletedAt || new Date().toISOString(); project.revision++; changed = true; }
    }
    if (changed) await writeJson(file, saved);
    return;
  }
  const catalogue = { version: 1, migrationVersion: 1, defaultProjectId: randomUUID(), projects: [], unmappedDatabases: [] };
  const known = new Set();
  for (const project of (await workspaceProjects({ includeArchived: true })).projects) {
    const directory = digest(project.id);
    known.add(directory);
    const deleted = await readJson(path.join(root, directory, 'deleted.json'), null);
    if (!deleted && !await present(path.join(root, directory, 'library.sqlite'))) continue;
    // Keep the old database/attachment identity, even when its folder is absent.
    catalogue.projects.push({ id: project.id, name: project.name, cwd: project.cwd,
      initialBibliographyPath: path.join(project.cwd, 'Bibliography'), revision: 1,
      archived: Boolean(project.archived), ...(project.archivedAt ? { archivedAt: project.archivedAt } : {}),
      ...(deleted ? { deletedAt: deleted.deletedAt || new Date().toISOString() } : {}) });
  }
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name) && !known.has(entry.name) &&
        await present(path.join(root, entry.name, 'library.sqlite'))) catalogue.unmappedDatabases.push(entry.name);
  }
  const bibliographyPath = managedFolder(catalogue.defaultProjectId);
  catalogue.projects.unshift({ id: catalogue.defaultProjectId, name: 'Default', cwd: path.dirname(bibliographyPath), initialBibliographyPath: bibliographyPath, revision: 1, archived: false });
  await writeJson(file, catalogue);
}
const ready = () => initialization ||= initialize().catch(error => { initialization = undefined; throw error; });
const view = (catalogue, project) => ({ ...project, isDefault: project.id === catalogue.defaultProjectId });
const find = (catalogue, id, { deleted = false } = {}) => {
  const project = catalogue.projects.find(item => item.id === id);
  if (!project) fail('References project not found', 404);
  if (project.deletedAt && !deleted) fail('This References project was deliberately deleted', 410);
  return project;
};
async function change(work) {
  const pending = transaction.then(async () => {
    await ready();
    const catalogue = await readJson(file);
    const result = await work(catalogue);
    await writeJson(file, catalogue);
    return result;
  });
  transaction = pending.catch(() => {});
  return pending;
}
export async function referenceProjects({ includeArchived = false } = {}) {
  await ready(); await transaction;
  const catalogue = await readJson(file);
  return { defaultProjectId: catalogue.defaultProjectId,
    projects: catalogue.projects.filter(project => !project.deletedAt && (includeArchived || !project.archived)).map(project => view(catalogue, project)),
    unmappedDatabases: catalogue.unmappedDatabases || [] };
}
export async function referenceProject(id) {
  await ready(); await transaction;
  const catalogue = await readJson(file);
  return view(catalogue, find(catalogue, id));
}
export async function createReferenceProject({ name, bibliographyPath, cwd } = {}) {
  name = title(name);
  const id = randomUUID();
  bibliographyPath ||= cwd ? path.join(cwd, 'Bibliography') : managedFolder(id);
  if (!path.isAbsolute(bibliographyPath) || bibliographyPath.includes('\0')) fail('Choose an absolute Bibliography folder');
  return change(catalogue => {
    const project = { id, name, cwd: cwd || path.dirname(bibliographyPath), initialBibliographyPath: bibliographyPath, archived: false, revision: 1 };
    catalogue.projects.push(project);
    return view(catalogue, project);
  });
}
export function renameReferenceProject(id, name) {
  name = title(name);
  return change(catalogue => { const project = find(catalogue, id); project.name = name; project.revision++; return view(catalogue, project); });
}
export function archiveReferenceProject(id, archived) {
  if (typeof archived !== 'boolean') fail('Choose whether to archive this project');
  return change(catalogue => {
    const project = find(catalogue, id);
    project.archived = archived; project.revision++;
    if (archived) project.archivedAt = new Date().toISOString(); else delete project.archivedAt;
    return view(catalogue, project);
  });
}
export function deleteReferenceProject(id) {
  return change(catalogue => {
    const project = find(catalogue, id, { deleted: true });
    project.deletedAt ||= new Date().toISOString(); project.revision++;
    return { deleted: id };
  });
}
