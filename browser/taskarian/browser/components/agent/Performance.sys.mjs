/* SPDX-License-Identifier: AGPL-3.0-only */


// procfs/sysfs report zero file sizes. IOUtils performs these fixed counter
// reads off the UI thread; supplying a read length avoids an empty result.
async function counter(path) {
  return new TextDecoder().decode(await IOUtils.read(path, { maxBytes: 65536 }));
}
async function cpu() {
  const line = (await counter("/proc/stat")).split("\n", 1)[0];
  const fields = line.trim().split(/\s+/);
  if (fields.shift() !== "cpu" || fields.length < 8) throw new Error("CPU counters unavailable");
  const ticks = fields.slice(0, 8).map(Number);
  if (ticks.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error("Invalid CPU counters");
  // Guest time is already included in user/nice. Idle includes iowait.
  return { total: ticks.reduce((a, b) => a + b, 0), idle: ticks[3] + ticks[4] };
}
async function memory() {
  const text = await counter("/proc/meminfo");
  const total = Number(/^MemTotal:\s+(\d+) kB$/m.exec(text)?.[1]) * 1024;
  const available = Number(/^MemAvailable:\s+(\d+) kB$/m.exec(text)?.[1]) * 1024;
  if (!Number.isFinite(total) || !Number.isFinite(available) || total <= 0 || available < 0 || available > total) throw new Error("RAM counters unavailable");
  return { used: total - available, total };
}
async function gpu() {
  const cards = (await IOUtils.getChildren("/sys/class/drm")).filter(path => /\/card\d+$/.test(path)).sort();
  const readings = await Promise.all(cards.map(async path => {
    try {
      const text = (await counter(`${path}/device/gpu_busy_percent`)).trim();
      const value = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
      return value >= 0 && value <= 100 ? { name: path.split("/").at(-1), percent: value } : null;
    } catch { return null; }
  }));
  return readings.filter(Boolean);
}

/** One native view's counters. No timer, shell, driver probe or remote fallback. */
export class LinuxPerformanceMonitor {
  constructor() { this.previousCPU = null; this.generation = 0; }
  reset() { this.previousCPU = null; this.generation++; }
  async sample() {
    const generation = this.generation;
    const [cpuResult, ramResult, gpuResult] = await Promise.allSettled([cpu(), memory(), gpu()]);
    if (generation !== this.generation) return { cpuPercent: null, cpuPending: true, ram: null, gpus: [] };
    let cpuPercent = null, cpuPending = false;
    if (cpuResult.status === "fulfilled") {
      const current = cpuResult.value;
      const total = this.previousCPU && current.total - this.previousCPU.total;
      const idle = this.previousCPU && current.idle - this.previousCPU.idle;
      if (total > 0 && idle >= 0 && idle <= total) cpuPercent = (total - idle) / total * 100;
      else cpuPending = true;
      this.previousCPU = current;
    } else this.reset();
    return { cpuPercent, cpuPending,
      ram: ramResult.status === "fulfilled" ? ramResult.value : null,
      gpus: gpuResult.status === "fulfilled" ? gpuResult.value : [] };
  }
}
