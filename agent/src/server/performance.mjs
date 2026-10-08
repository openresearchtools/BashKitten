// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const now = () => Number(process.hrtime.bigint()) / 1e9;
export const performanceUnavailable = reason => ({ cpuPercent: null, pending: false,
  available: false, reason, sampledProcessCount: 0, onlineCpuCount: 0 });

async function processStat(pid) {
  try {
    const text = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/);
    // Linux stat fields 14–17 contain this process's CPU time and the CPU
    // time of children it has already waited for. Summing both over the live
    // tree preserves work when a short-lived subprocess is reaped between views.
    const values = [fields[1], fields[11], fields[12], fields[13], fields[14]];
    if (!/^\d+$/.test(fields[19] || '') || values.some(value => !/^\d+$/.test(value || ''))) return null;
    return { pid, parent: Number(fields[1]), started: fields[19], state: fields[0],
      ticks: values.slice(1).reduce((sum, value) => sum + Number(value), 0) };
  } catch (error) {
    if (['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) return null;
    throw error;
  }
}

async function snapshot(owner) {
  const processes = new Map();
  const names = (await fs.readdir('/proc')).filter(name => /^[1-9][0-9]*$/.test(name));
  // Bound concurrent file descriptors without restricting the process count.
  for (let at = 0; at < names.length; at += 64) {
    for (const value of await Promise.all(names.slice(at, at + 64).map(name => processStat(Number(name))))) {
      if (value) processes.set(value.pid, value);
    }
  }
  const root = processes.get(owner.pid);
  if (!root || root.started !== owner.started || ['Z', 'X'].includes(root.state)) throw Error('The Agent workload owner is unavailable');
  const children = new Map();
  for (const value of processes.values()) {
    const parent = processes.get(value.parent);
    if (!parent || Number(parent.started) > Number(value.started)) continue;
    if (!children.has(value.parent)) children.set(value.parent, []);
    children.get(value.parent).push(value);
  }
  const owned = new Map([[root.pid, root]]), pending = [root];
  for (let at = 0; at < pending.length; at++) {
    for (const value of children.get(pending[at].pid) || []) {
      if (owned.has(value.pid)) continue;
      owned.set(value.pid, value); pending.push(value);
    }
  }
  // Never attribute a PID that was reused or reparented during collection.
  // A changing tree gets a fresh baseline on the next visible request.
  let ticks = 0, count = 0;
  for (const previous of pending.reverse()) {
    const value = await processStat(previous.pid);
    if (!value || value.started !== previous.started || value.parent !== previous.parent) {
      throw Error('The workload process tree changed while sampling');
    }
    ticks += value.ticks;
    if (!['Z', 'X'].includes(value.state)) count++;
  }
  // If a child was reaped after its counter read but before its parent's, its
  // time could be present in both. Reject that changing snapshot, not a spike.
  for (let at = 0; at < pending.length; at += 64) {
    const values = await Promise.all(pending.slice(at, at + 64).map(value => processStat(value.pid)));
    for (let index = 0; index < values.length; index++) {
      const previous = pending[at + index], value = values[index];
      if (!value || value.started !== previous.started || value.parent !== previous.parent) {
        throw Error('The workload process tree changed while sampling');
      }
    }
  }
  return { ticks, count, time: now() };
}

async function onlineCPUs() {
  const list = (await fs.readFile('/sys/devices/system/cpu/online', 'utf8')).trim();
  if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(list)) throw Error('The online CPU count is unavailable');
  const ids = new Set();
  for (const range of list.split(',')) {
    const [start, end = start] = range.split('-').map(Number);
    if (end < start) throw Error('Invalid online CPU range');
    for (let cpu = start; cpu <= end; cpu++) ids.add(cpu);
  }
  return { list, count: ids.size };
}

/** Read-only, explicit native requests. No timer, process control or disk state. */
export class WorkloadPerformance {
  constructor(owner) { this.owner = owner; this.sessions = new Map(); this.ticksPerSecond = null; }
  session(value) {
    if (!sessionPattern.test(value?.session || '')) throw Error('Invalid performance view session');
    return value.session;
  }
  close(value) { this.sessions.delete(this.session(value)); return { ok: true }; }
  async sample(value) {
    const id = this.session(value), time = now();
    // Expire abandoned baselines only when somebody opens/looks at the view.
    for (const [key, entry] of this.sessions) if (time - entry.seen > 60) this.sessions.delete(key);
    let entry = this.sessions.get(id);
    if (!entry) { entry = { seen: time, previous: null }; this.sessions.set(id, entry); }
    if (entry.sampling) return { ...performanceUnavailable('A sample is already in progress'), pending: true };
    entry.sampling = true; entry.seen = time;
    try {
      if (!this.ticksPerSecond) {
        const result = await exec(process.platform === 'android' ? '/system/bin/getconf' : 'getconf', ['CLK_TCK']);
        const ticks = Number(result.stdout.trim());
        if (!Number.isSafeInteger(ticks) || ticks <= 0) throw Error('The CPU clock tick frequency is unavailable');
        this.ticksPerSecond = ticks;
      }
      const cpus = await onlineCPUs(), current = await snapshot(this.owner);
      if (this.sessions.get(id) !== entry) return performanceUnavailable('The performance view is closed');
      const previous = entry.previous;
      entry.previous = { ...current, online: cpus.list };
      const result = { cpuPercent: null, pending: true, available: true, reason: '',
        sampledProcessCount: current.count, onlineCpuCount: cpus.count };
      if (!previous || previous.online !== cpus.list) return result;
      const elapsed = current.time - previous.time, ticks = current.ticks - previous.ticks;
      if (elapsed <= 0 || ticks < 0) return { ...result, reason: 'CPU counters changed; taking a fresh sample' };
      return { ...result, pending: false,
        cpuPercent: Math.min(100, ticks / this.ticksPerSecond / elapsed / cpus.count * 100) };
    } catch (error) {
      entry.previous = null;
      return performanceUnavailable(error.message || 'Workload CPU counters are unavailable');
    } finally { entry.sampling = false; }
  }
}
