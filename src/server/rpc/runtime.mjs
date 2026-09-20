import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dataDir } from '../common.mjs';

export const bundledRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const runtimeFile = path.join(dataDir, 'runtime.json');
export const maintenanceFile = path.join(dataDir, 'run/maintenance.json');
export function selectedRuntime() {
  let selection;
  try { selection = JSON.parse(fs.readFileSync(runtimeFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const root = selection?.root || bundledRoot;
  const agent = path.join(root, 'node_modules/@earendil-works/pi-coding-agent');
  const ai = path.join(root, 'node_modules/@earendil-works/pi-ai');
  const pkg = JSON.parse(fs.readFileSync(path.join(agent, 'package.json'), 'utf8'));
  const aiPkg = JSON.parse(fs.readFileSync(path.join(ai, 'package.json'), 'utf8'));
  if (pkg.name !== '@earendil-works/pi-coding-agent' || aiPkg.name !== '@earendil-works/pi-ai' || pkg.version !== aiPkg.version || (selection && selection.version !== pkg.version)) throw Error('The selected Pi runtime is incomplete; use rollback in package controls');
  return { root, version: pkg.version, cli: path.join(agent, 'dist/cli.js'), agent: path.join(agent, 'dist/index.js'), ai: path.join(ai, 'dist/index.js'), previous: selection?.previous };
}
export async function loadPi() {
  const runtime = selectedRuntime();
  const [pi, ai] = await Promise.all([import(pathToFileURL(runtime.agent)), import(pathToFileURL(runtime.ai))]);
  return { ...runtime, pi, ai };
}
export function maintenance() {
  try {
    const value = JSON.parse(fs.readFileSync(maintenanceFile, 'utf8'));
    try { process.kill(value.pid, 0); return value; } catch (error) { if (error.code !== 'ESRCH') throw error; }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return null;
}
export function allowRuntimeWork() {
  if (maintenance()) throw Error('Package maintenance is waiting or applying. Your draft is preserved; retry when it finishes.');
}
