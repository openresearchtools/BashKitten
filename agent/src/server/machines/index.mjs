// SPDX-License-Identifier: AGPL-3.0-only
// Native IPC only. The independent user service is outside Local's death guard.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir, privateDir, socketRequest } from '../common.mjs';
import { claimInstance } from '../instance.mjs';
import { daemonSocket, digest } from './config.mjs';
import { run } from './process.mjs';
import { duringUpdate, runtimeVersion, sameRuntime, updateMessage, legacyUpdateMessage, updateError } from './update.mjs';
const unit = 'bashkitten-machines-' + digest(dataDir).slice(0,16);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready() {
  try { return await socketRequest(daemonSocket, '/status', undefined, 1000); }
  catch (error) { if (!['ENOENT','ECONNREFUSED','ECONNRESET','EPIPE'].includes(error.code)) throw error; return null; }
}
async function ensure() {
  if (process.platform !== 'linux' || process.env.BASHKITTEN_EXECUTION_ROLE === 'container') throw Error('Container creation is available on the native Linux host only');
  let current = await ready();
  const desired = await runtimeVersion();
  if (current?.schema >= 2 && sameRuntime(current.runtime, desired) && !current.updatePending) return;
  // Legacy services have no atomic drain. Never turn a racy status snapshot
  // into permission to terminate their jobs or display/media children.
  if (current && current.schema < 2) return legacyUpdateMessage;
  await privateDir(dataDir);
  let ownership;
  for (const until = Date.now() + 25000; !(ownership = await claimInstance('machines-update'));) {
    current = await ready();
    if (current?.schema >= 2 && sameRuntime(current.runtime, desired) && !current.updatePending) return;
    if (Date.now() >= until) throw Error('The container service is still applying its update. Try again shortly.');
    await sleep(100);
  }
  try {
    current = await ready();
    if (current?.schema >= 2 && sameRuntime(current.runtime, desired) && !current.updatePending) return;
    if (current && current.schema < 2) return legacyUpdateMessage;
    if (current) {
      const replacement = await socketRequest(daemonSocket, '/upgrade', { pid: current.pid, started: current.started }, 15000);
      if (!replacement.restarting) return replacement.error ? `${updateMessage} ${replacement.error}` : updateMessage;
      // Only the old owner can declare itself drained and exit. We never stop
      // its unit from a client, so a concurrent client cannot kill a new owner.
      for (const until = Date.now() + 15000; current && Date.now() < until;) {
        await sleep(100); current = await ready();
      }
      if (current) throw Error('The container service is finishing its update. Try again shortly.');
    }
    await privateDir(path.dirname(daemonSocket));
    // --collect removes the exited transient unit asynchronously. Wait for it
    // before creating the replacement with the same persistent ownership name.
    for (const until = Date.now() + 15000;;) {
      const state = await run('/usr/bin/systemctl', ['--user','show',unit,'--property=LoadState','--value'], { allowFailure:true });
      if (state.code || state.stdout.trim() === 'not-found') break;
      current = await ready();
      if (current?.schema >= 2 && sameRuntime(current.runtime, desired) && !current.updatePending) return;
      if (Date.now() >= until) throw Error('The container service is still stopping after its update. Try again shortly.');
      await sleep(100);
    }
    const args = ['--user','--collect','--service-type=exec', '--unit=' + unit,
      '--property=KillMode=mixed','--property=Delegate=yes','--property=TimeoutStopSec=45','--property=UMask=0077',
      '--setenv=BASHKITTEN_DATA_DIR=' + dataDir];
    for (const key of ['HOME','PATH','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','PIPEWIRE_REMOTE','PULSE_SERVER']) if (process.env[key]) args.push('--setenv=' + key + '=' + process.env[key]);
    args.push('--', process.execPath, fileURLToPath(new URL('./service.mjs', import.meta.url)));
    const result = await run('/usr/bin/systemd-run', args, { allowFailure: true });
    // A concurrent caller may have already created this exact unit.
    for (const until = Date.now() + 15000; Date.now() < until;) {
      const status = await ready();
      if (status?.schema >= 2 && sameRuntime(status.runtime, desired) && !status.updatePending) return;
      if (result.code && !result.stderr.includes('already exists')) break;
      await sleep(100);
    }
    throw Error('Could not start the independent machine service. A working systemd user session is required. ' + result.stderr.trim());
  } finally { ownership.close(); }
}
export async function machineControl(action, value = {}) {
  const pending = await ensure();
  if (pending && !duringUpdate.has(action)) throw updateError(pending);
  const result = await socketRequest(daemonSocket, '/' + action, value, 30000);
  return pending ? { ...result, serviceUpdate: { pending:true, message:pending } } : result;
}
