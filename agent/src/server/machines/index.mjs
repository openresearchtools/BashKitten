// SPDX-License-Identifier: AGPL-3.0-only
// Native IPC only. The independent user service is outside Local's death guard.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir, privateDir, socketRequest } from '../common.mjs';
import { daemonSocket, digest } from './config.mjs';
import { run } from './process.mjs';
let starting;
async function ready() {
  try { return await socketRequest(daemonSocket, '/status', undefined, 1000); }
  catch (error) { if (!['ENOENT','ECONNREFUSED'].includes(error.code)) throw error; return null; }
}
async function ensure() {
  if (process.platform !== 'linux' || process.env.BASHKITTEN_EXECUTION_ROLE === 'container') throw Error('Container creation is available on the native Linux host only');
  if (await ready()) return;
  if (starting) return starting;
  starting = (async () => {
    await privateDir(path.dirname(daemonSocket));
    const args = ['--user','--collect','--service-type=exec', '--unit=bashkitten-machines-' + digest(dataDir).slice(0,16),
      '--property=KillMode=mixed','--property=Delegate=yes','--property=TimeoutStopSec=45','--property=UMask=0077',
      '--setenv=BASHKITTEN_DATA_DIR=' + dataDir];
    for (const key of ['HOME','PATH','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','PIPEWIRE_REMOTE','PULSE_SERVER']) if (process.env[key]) args.push('--setenv=' + key + '=' + process.env[key]);
    args.push('--', process.execPath, fileURLToPath(new URL('./service.mjs', import.meta.url)));
    const result = await run('/usr/bin/systemd-run', args, { allowFailure: true });
    // A concurrent caller may have already created this exact unit.
    for (const until = Date.now() + 15000; Date.now() < until;) {
      if (await ready()) return;
      if (result.code && !result.stderr.includes('already exists')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('Could not start the independent machine service. A working systemd user session is required. ' + result.stderr.trim());
  })();
  try { await starting; } finally { starting = null; }
}
export async function machineControl(action, value = {}) {
  await ensure();
  return socketRequest(daemonSocket, '/' + action, value, 30000);
}
