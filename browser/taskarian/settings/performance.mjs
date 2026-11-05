/* SPDX-License-Identifier: AGPL-3.0-only */
import { node } from './ui.mjs';

const percent = value => Number.isFinite(value) ? `${value.toFixed(2)}%` : 'Unavailable';

/** Counters and their per-view lease stay in the native controller. */
export async function renderSection({ root, call, signal }) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const grid = node(root, 'dl'), rows = {};
  for (const [id, title] of [['workload', 'Local Agent CPU'], ['cpu', 'Total CPU'], ['gpu', 'GPU'], ['ram', 'System RAM']]) {
    rows[id] = node(root, 'dd', '…'); grid.append(node(root, 'dt', title), rows[id]);
  }
  const note = node(root, 'p', "CPU percentages use this device's total CPU capacity. Measurements update only while this view is visible.");
  const status = node(root, 'p'); status.setAttribute('role', 'status');
  root.append(grid, note, status);
  let timer = null, reading = false, epoch = 0;
  const visible = () => !signal.aborted && root.isConnected && !doc.hidden;
  const release = () => call('performance-close', {}).catch(() => {});
  function pause() { epoch++; win.clearTimeout(timer); timer = null; void release(); }
  async function sample() {
    timer = null;
    if (!visible() || reading) return;
    reading = true;
    const generation = epoch, started = win.performance.now();
    try {
      const value = await call('performance-sample', {});
      if (!visible() || generation !== epoch) return;
      rows.workload.textContent = value.workload?.pending ? '…' : percent(value.workload?.cpuPercent);
      rows.cpu.textContent = value.cpuPending ? '…' : percent(value.cpuPercent);
      rows.gpu.textContent = value.gpus?.map(item => `${item.name}: ${percent(item.percent)}`).join(' · ') || 'Unavailable on this device';
      rows.ram.textContent = value.ram ? `${(value.ram.used / 1e9).toFixed(2)} / ${(value.ram.total / 1e9).toFixed(2)} GB` : 'Unavailable';
      status.textContent = value.workload?.reason || '';
    } catch (error) {
      if (visible() && generation === epoch) {
        for (const row of Object.values(rows)) row.textContent = 'Unavailable';
        status.textContent = error.message;
      }
    } finally {
      reading = false;
      if (generation !== epoch || !visible()) await release();
      if (visible()) timer = win.setTimeout(sample, Math.max(0, 1000 - (win.performance.now() - started)));
    }
  }
  doc.addEventListener('visibilitychange', () => { if (visible()) void sample(); else pause(); }, { signal });
  signal.addEventListener('abort', pause, { once: true });
  if (visible()) void sample();
}
