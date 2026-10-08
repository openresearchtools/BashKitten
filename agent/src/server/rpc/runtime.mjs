import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import semver from 'semver';
import { dataDir } from '../common.mjs';

export const bundledRoot = fileURLToPath(new URL('../../../', import.meta.url));
// Set Pi's supported profile boundary before importing its SDK or starting any
// CLI/package worker. Keep HOME/cwd intact for ordinary project and shell access.
export const piAgentDir = path.join(dataDir, 'pi');
process.env.PI_CODING_AGENT_DIR = piAgentDir;
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(piAgentDir, 'sessions');
// An inherited override must not redirect Pi's bundled resources to another
// installation; selectedRuntime owns the executable and SDK together.
delete process.env.PI_PACKAGE_DIR;
export const runtimeFile = path.join(dataDir, 'runtime.json');
export const maintenanceFile = path.join(dataDir, 'run/maintenance.json');
export const appUpdateFile = path.join(dataDir, 'run/app-update.json');
function saveSelection(selection) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const temporary = runtimeFile + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(selection), { mode: 0o600 });
  fs.renameSync(temporary, runtimeFile);
}
export function selectedRuntime() {
  let selection;
  try { selection = JSON.parse(fs.readFileSync(runtimeFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try {
    const bundled = JSON.parse(fs.readFileSync(path.join(bundledRoot, 'runtime-default.json'), 'utf8'));
    if (!selection || selection.packagedRoot !== bundled.root) {
      if (!fs.existsSync(path.join(bundled.root, 'ready'))) throw Error('The packaged Pi runtime is not ready; finish package configuration');
      let managed;
      if (selection) {
        try { managed = JSON.parse(fs.readFileSync(path.join(selection.root, 'managed.json'), 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      // Adopt a new package at the existing idle/restart boundary. Never replace
      // an independently selected external runtime or downgrade a newer Pi.
      const upgrade = !selection || (managed?.owner === 'bashkitten' &&
        semver.gte(bundled.version, selection.version));
      const previous = selection && { root: selection.root, version: selection.version };
      selection = upgrade ? { ...bundled, ...(previous && previous.root !== bundled.root ? { previous } : {}) } : selection;
      selection.packagedRoot = bundled.root;
      saveSelection(selection);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const root = selection?.root || bundledRoot;
  const agent = path.join(root, 'node_modules/@earendil-works/pi-coding-agent');
  const ai = path.join(root, 'node_modules/@earendil-works/pi-ai');
  const pkg = JSON.parse(fs.readFileSync(path.join(agent, 'package.json'), 'utf8'));
  const aiPkg = JSON.parse(fs.readFileSync(path.join(ai, 'package.json'), 'utf8'));
  if (pkg.name !== '@earendil-works/pi-coding-agent' || aiPkg.name !== '@earendil-works/pi-ai' || pkg.version !== aiPkg.version || (selection && selection.version !== pkg.version)) throw Error('The selected Pi runtime is incomplete; use rollback in package controls');
  const cli = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.pi;
  if (!cli || !fs.existsSync(path.join(agent, cli))) throw Error('The selected Pi runtime has no CLI entry point');
  return { root, version: pkg.version, cli: path.join(agent, cli), agent: path.join(agent, 'dist/index.js'), ai: path.join(ai, 'dist/index.js'), previous: selection?.previous };
}
export async function loadPi() {
  fs.mkdirSync(piAgentDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(piAgentDir, 0o700);
  const runtime = selectedRuntime();
  const [pi, ai] = await Promise.all([import(pathToFileURL(runtime.agent)), import(pathToFileURL(runtime.ai))]);
  return { ...runtime, pi, ai };
}
export function maintenance() {
  // APK replacement can kill the manager and its shared-UID processes. Keep
  // this barrier until Android reconciles the actual installer session.
  try { return JSON.parse(fs.readFileSync(appUpdateFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try {
    const value = JSON.parse(fs.readFileSync(maintenanceFile, 'utf8'));
    try { process.kill(value.pid, 0); return value; } catch (error) { if (error.code !== 'ESRCH') throw error; }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return null;
}
export function allowRuntimeWork() {
  if (maintenance()) throw Error('Package maintenance is waiting or applying. Your draft is preserved; retry when it finishes.');
}
