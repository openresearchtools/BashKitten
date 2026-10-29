#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Runs only inside the existing HostedServices lifetime/process group.
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
if (config.schema !== 1 || !Array.isArray(config.argv)) throw Error('Invalid prepared Office launch');
let child, stopping = false;
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { stopping = true; child?.kill(signal); });
async function run(argv) {
  if (stopping) throw Error('Office startup cancelled');
  return new Promise((resolve, reject) => {
    child = spawn(argv[0], argv.slice(1), { cwd: config.cwd, stdio: 'inherit', env: { ...process.env, ...(config.nativeEnvironment || {}) } });
    child.once('error', reject); child.once('exit', (code, signal) => { child = null; code === 0 ? resolve() : reject(Error('Native Office command exited with ' + (signal || code))); });
  });
}
const stamp = config.systemplate + '/.bashkitten-source-revision';
// Upstream setup creates an alias from this engine path to /lo in each jail.
// Reusing the same artifact at a new path still requires that alias to change.
const systemplateRevision = JSON.stringify({ revision: config.revision, engine: config.engine });
let previous; try { previous = await fs.readFile(stamp, 'utf8'); } catch {}
if (previous !== systemplateRevision) {
  await run([config.systemplateSetup, config.systemplate, config.engine]);
  if (stopping) throw Error('Office startup cancelled');
  await fs.writeFile(stamp, systemplateRevision, { mode: 0o600 });
}
await run(config.argv);
