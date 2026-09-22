import { platform } from '../platform/index.mjs';
import { command } from './io.mjs';
let held = false;
export async function acquireWake() {
  if (platform !== 'termux' || held) return;
  await command('termux-wake-lock', [], { timeout: 15000 });
  held = true;
  if (Number(process.env.BASHKITTEN_GUARD_PID) === process.ppid) process.kill(process.ppid, 'SIGUSR1');
}
export async function releaseWake() {
  if (platform !== 'termux') return;
  // Reconcile the app-wide lock after an interrupted previous controller too.
  await command('termux-wake-unlock', [], { timeout: 15000 });
  held = false;
  if (Number(process.env.BASHKITTEN_GUARD_PID) === process.ppid) process.kill(process.ppid, 'SIGUSR2');
}
