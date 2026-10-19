// SPDX-License-Identifier: AGPL-3.0-only
// Native IPC only. The independent user service is outside Local's death guard.
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dataDir, privateDir, socketRequest } from '../common.mjs';
import { backendAlive, claimInstance, processStart } from '../instance.mjs';
import { binary } from '../access/paths.mjs';
import { daemonSocket, digest } from './config.mjs';
import { run } from './process.mjs';
import { duringUpdate, runtimeVersion, sameRuntime, updateMessage, updateError } from './update.mjs';
const unit = 'bashkitten-machines-' + digest(dataDir).slice(0,16);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const serviceScript = fileURLToPath(new URL('./service.mjs', import.meta.url));
const controlScript = fileURLToPath(new URL('../control.mjs', import.meta.url));
async function cleanupOrphans() {
  await run(binary('runtime-guard'), [process.execPath, fileURLToPath(new URL('./shutdown.mjs', import.meta.url)), 'serve'], { env: { ...process.env, BASHKITTEN_DATA_DIR: dataDir } });
  return { stopped: true };
}

async function legacyUnit() {
  const result = await run('/usr/bin/systemctl', ['--user','show',unit,'--property=MainPID,InvocationID,LoadState'], {signal:AbortSignal.timeout(5000),allowFailure:true});
  const state = Object.fromEntries(result.stdout.trim().split('\n').map(line => { const at=line.indexOf('='); return [line.slice(0,at),line.slice(at+1)]; }));
  if (result.code && state.LoadState !== 'not-found') throw Error(result.stderr.trim() || 'Could not inspect the container service unit');
  return state;
}
async function legacyIdentity(current) {
  const identity = {pid:current.pid, started:current.started || await processStart(current.pid), script:serviceScript};
  const state = await legacyUnit();
  if (!identity.started || Number(state.MainPID) !== identity.pid || !/^[a-f0-9]{32}$/.test(state.InvocationID || '') || !await backendAlive(identity)) throw Error('The container service owner changed');
  return {...identity, invocation:state.InvocationID};
}
async function sameLegacyUnit(identity) {
  const state = await legacyUnit();
  if (state.LoadState === 'not-found') return false;
  if (state.InvocationID !== identity.invocation || Number(state.MainPID) && Number(state.MainPID) !== identity.pid) throw Error('The container service owner changed');
  return true;
}
async function legacyClientsIdle(installedNode) {
  // Native machine calls are one-shot bashkittenctl processes, not requests to
  // the persistent Local manager. A process which loaded the old package may
  // still bypass machines-update. Let it finish before taking an idle snapshot.
  // Every package includes the private Node ELF; use the same inode identity
  // as runtimeVersion. Current clients wait on our lock and must not themselves
  // make an idle service appear busy. External historical code is not an owner.
  for (const name of await fs.readdir('/proc')) {
    if (!/^[1-9][0-9]*$/.test(name) || Number(name) === process.pid) continue;
    const pid=Number(name), started=await processStart(pid);
    if (!started) continue;
    try {
      if ((await fs.stat(`/proc/${pid}`)).uid !== process.getuid()) continue;
      const args=(await fs.readFile(`/proc/${pid}/cmdline`,'utf8')).split('\0');
      const entry=args.indexOf(controlScript);
      if (entry < 0 || !args[entry+1]?.startsWith('machines.')) continue;
      const node=await fs.stat(`/proc/${pid}/exe`);
      if (`${node.dev}:${node.ino}` === installedNode) continue;
      if (await backendAlive({pid,started,script:controlScript})) return false;
    } catch (error) { if (!['ENOENT','ESRCH'].includes(error.code)) throw error; }
  }
  return true;
}
async function legacyIdle(identity, installedNode) {
  if (!await legacyClientsIdle(installedNode)) return {idle:false,message:'A container request from the previous package is still in progress. Let it finish to load the updated container service.'};
  // Even read-only Podman can create a pause helper. Keep that transient child
  // under the existing cleanup guard, never under the long-lived UI controller.
  const result = await run(binary('runtime-guard'), [process.execPath, fileURLToPath(new URL('./shutdown.mjs', import.meta.url)), 'idle', 'serve'], {env:{...process.env,BASHKITTEN_DATA_DIR:dataDir}});
  if (JSON.parse(result.stdout).idle !== true) return {idle:false};
  const latest = await ready();
  if (latest?.schema !== 1 || latest.pid !== identity.pid || !await sameLegacyUnit(identity) || !await backendAlive(identity)) throw Error('The container service owner changed during its idle check');
  return {idle:true};
}
async function stopLegacy(current, identity = undefined) {
  identity ||= await legacyIdentity(current);
  if (!await sameLegacyUnit(identity) || !await backendAlive(identity)) throw Error('The container service owner changed before stopping');
  // The pre-ownership service cannot drain itself. Explicit Quit, or a verified
  // idle update under machines-update, retires only this unit invocation.
  let failure;
  try {
    await run('/usr/bin/systemctl', ['--user','kill','--kill-whom=all','--signal=SIGTERM',unit], {signal:AbortSignal.timeout(5000),allowFailure:true});
    for (const until=Date.now()+2000; Date.now()<until && await processStart(identity.pid)===identity.started;) await sleep(50);
    // The main process may have exited while a helper remains. The caller holds
    // the update lock, so this unit cannot be replaced during whole-unit cleanup.
    if (await sameLegacyUnit(identity)) {
      await run('/usr/bin/systemctl', ['--user','kill','--kill-whom=all','--signal=SIGKILL',unit], {signal:AbortSignal.timeout(5000),allowFailure:true});
      if (await sameLegacyUnit(identity)) await run('/usr/bin/systemctl', ['--user','stop',unit], {signal:AbortSignal.timeout(5000)});
    }
  } catch (error) {
    failure = error;
  }
  await cleanupOrphans();
  if (failure) throw failure;
  return {stopped:true};
}

async function ready() {
  try { return await socketRequest(daemonSocket, '/status', undefined, 1000); }
  catch (error) { if (!['ENOENT','ECONNREFUSED','ECONNRESET','EPIPE'].includes(error.code)) throw error; return null; }
}
async function ensure(browserOwner) {
  if (process.platform !== 'linux' || process.env.BASHKITTEN_EXECUTION_ROLE === 'container') throw Error('Container creation is available on the native Linux host only');
  let current = await ready();
  const desired = await runtimeVersion();
  if (current?.schema >= 2 && sameRuntime(current.runtime, desired) && !current.updatePending) return;
  await privateDir(dataDir);
  let ownership;
  for (const until = Date.now() + 25000; !(ownership = await claimInstance('machines-update'));) {
    current = await ready();
    if (current?.schema >= 2 && sameRuntime(current.runtime, desired) && !current.updatePending) return;
    if (Date.now() >= until) throw Error('The container service is still applying its update. Try again shortly.');
    await sleep(100);
  }
  let retained = false;
  try {
    current = await ready();
    if (current?.schema >= 2 && sameRuntime(current.runtime, desired) && !current.updatePending) return;
    if (current && current.schema < 2) {
      let identity, result, error;
      try { identity = await legacyIdentity(current); result = await legacyIdle(identity,desired.node); }
      catch (failure) { error = failure; }
      if (!result?.idle) {
        // Keep admission serialized through the caller's allowed legacy request:
        // another client must not inspect idle between ensure() and its Stop.
        retained = true;
        return { pending:error ? `${updateMessage} Could not confirm idle: ${error.message}` : result?.message || updateMessage, ownership };
      }
      await stopLegacy(current,identity);
      current = await ready();
      if (current) throw Error('The previous container service has not stopped');
    }
    if (current) {
      const replacement = await socketRequest(daemonSocket, '/upgrade', { pid: current.pid, started: current.started }, 15000);
      if (!replacement.restarting) return { pending:replacement.error ? `${updateMessage} ${replacement.error}` : updateMessage };
      // Only the old owner can declare itself drained and exit. We never stop
      // its unit from a client, so a concurrent client cannot kill a new owner.
      for (const until = Date.now() + 15000; current && Date.now() < until;) {
        await sleep(100); current = await ready();
      }
      if (current) throw Error('The container service is finishing its update. Try again shortly.');
    }
    if (!Number.isInteger(browserOwner?.pid) || browserOwner.pid < 2 || !browserOwner.started || await processStart(browserOwner.pid) !== browserOwner.started) throw Error('Open BashKitten before starting its containers');
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
      '--setenv=BASHKITTEN_DATA_DIR=' + dataDir,
      '--setenv=BASHKITTEN_BROWSER_PID=' + browserOwner.pid,
      '--setenv=BASHKITTEN_BROWSER_STARTED=' + browserOwner.started];
    for (const key of ['HOME','PATH','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','PIPEWIRE_REMOTE','PULSE_SERVER']) if (process.env[key]) args.push('--setenv=' + key + '=' + process.env[key]);
    args.push('--', binary('runtime-guard'), process.execPath, serviceScript, 'serve');
    const result = await run('/usr/bin/systemd-run', args, { allowFailure: true });
    // A concurrent caller may have already created this exact unit.
    for (const until = Date.now() + 15000; Date.now() < until;) {
      const status = await ready();
      if (status?.schema >= 2 && sameRuntime(status.runtime, desired) && !status.updatePending) return;
      if (result.code && !result.stderr.includes('already exists')) break;
      await sleep(100);
    }
    throw Error('Could not start the independent machine service. A working systemd user session is required. ' + result.stderr.trim());
  } finally { if (!retained) ownership.close(); }
}
export async function machineControl(action, value = {}) {
  if (action === 'browser-shutdown') {
    await privateDir(dataDir);
    let ownership;
    for (const until=Date.now()+25000; !(ownership=await claimInstance('machines-update'));) {
      if (Date.now()>=until) throw Error('The container service is still changing during Quit');
      await sleep(100);
    }
    try {
      const current = await ready();
      if (!current) {
        return await cleanupOrphans();
      }
      if (current.schema < 3) return await stopLegacy(current);
      return await socketRequest(daemonSocket, '/browser-shutdown', value, 30000);
    } finally {
      ownership.close();
    }
  }
  const update = await ensure(value.browserOwner);
  try {
    const pending = update?.pending;
    if (pending && !duringUpdate.has(action)) throw updateError(pending);
    const result = await socketRequest(daemonSocket, '/' + action, value,
      ['display-start','display-stop'].includes(action) || action === 'guest-control' && value.command === 'start' ? 180000 : 30000);
    return pending ? { ...result, serviceUpdate: { pending:true, message:pending } } : result;
  } finally { update?.ownership?.close(); }
}
