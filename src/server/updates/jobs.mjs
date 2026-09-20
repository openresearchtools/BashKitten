import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dataDir, readJson, writeJson, privateDir } from '../common.mjs';

/** The manager owns one transaction. Logs and step checkpoints survive every UI. */
export class Jobs {
  constructor(handlers, directory = path.join(dataDir, 'updates')) { this.handlers = handlers; this.directory = directory; this.file = path.join(directory, 'job.json'); this.busy = false; this.serial = Promise.resolve(); }
  async init() {
    await privateDir(this.directory);
    this.job = await readJson(this.file, null);
    if (this.job && !['complete', 'failed', 'interrupted', 'cancelled'].includes(this.job.status)) {
      this.job.status = 'interrupted'; this.job.error = 'The manager stopped during this operation. Inspect package state and Retry to resume completed steps.';
      await this.save();
    }
  }
  async save() { const value = structuredClone(this.job); const work = this.serial.then(() => writeJson(this.file, value)); this.serial = work.catch(() => {}); await work; }
  async status() {
    if (!this.job) return null;
    const log = await fs.readFile(path.join(this.directory, 'output.log'), 'utf8').catch(() => '');
    return { ...this.job, log: log.slice(-32000) };
  }
  async start(kind, value = {}, retry = false) {
    if (this.busy) {
      if (this.job.kind === kind && JSON.stringify(this.job.input) === JSON.stringify(value)) return this.status();
      throw Error('Another package operation is running');
    }
    if (!this.handlers[kind]) throw Error('Unsupported package operation');
    if (!retry) {
      this.job = { id: randomUUID(), kind, input: value, completed: [], status: 'running', phase: 'Preparing', startedAt: Date.now() };
      await fs.writeFile(path.join(this.directory, 'output.log'), '', { mode: 0o600 });
    } else if (!this.job || !['failed', 'interrupted', 'cancelled'].includes(this.job.status)) throw Error('There is no interrupted operation to retry');
    this.busy = true; this.job.status = 'running'; delete this.job.cancelRequested; delete this.job.error; await this.save();
    this.run().catch(() => {});
    return this.status();
  }
  async run() {
    try {
      await this.handlers[this.job.kind](this, this.job.input);
      this.job.status = 'complete'; this.job.phase = 'Complete'; this.job.finishedAt = Date.now();
    } catch (error) { this.job.status = error.code === 'CANCELLED' ? 'cancelled' : 'failed'; this.job.error = error.message; this.job.finishedAt = Date.now(); }
    finally { await this.save(); this.busy = false; }
  }
  checkCancellation() { if (this.job.cancelRequested) throw Object.assign(Error('Cancelled after the current package step finished safely.'), { code: 'CANCELLED' }); }
  async cancel() {
    if (!this.busy) return;
    this.job.cancelRequested = true; await this.save();
    await this.log('Cancellation requested. The current package transaction will finish safely.\n');
  }
  async phase(name, status = 'running') { this.checkCancellation(); this.job.phase = name; this.job.status = status; delete this.job.progress; await this.save(); }
  async progress(line) {
    // Native APT status-fd protocol; preserve the translated action and package name.
    const match = /^(dlstatus|pmstatus|pmerror|pmconffile):([^:]*):([0-9.]+):(.*)$/.exec(line);
    if (!match || !Number.isFinite(Number(match[3]))) return;
    const [, kind, item, percent, message] = match;
    this.job.progress = { kind, percent: Math.max(0, Math.min(100, Number(percent))), message,
      ...(kind === 'dlstatus' ? { downloadedPackages: Number(item) } : { package: item }) };
    await this.save();
  }
  async step(id, name, fn) {
    if (this.job.completed.includes(id)) return;
    await this.phase(name); await fn(); this.job.completed.push(id); await this.save();
  }
  async log(value) {
    const file = path.join(this.directory, 'output.log');
    await fs.appendFile(file, value, { mode: 0o600 });
    if ((await fs.stat(file)).size > 256000) {
      const text = await fs.readFile(file, 'utf8'); await fs.writeFile(file, text.slice(-192000), { mode: 0o600 });
    }
  }
  async exec(command, args = [], { env = {}, timeout = 0 } = {}) {
    this.checkCancellation();
    await this.log(`\n$ ${[command, ...args].join(' ')}\n`);
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
      let output = '', error, logs = Promise.resolve(), status = '';
      const append = bytes => {
        const text = bytes.toString(); output = (output + text).slice(-128000);
        logs = logs.then(() => this.log(text)).catch(value => { error = value; });
      };
      child.stdout.setEncoding('utf8').on('data', append); child.stderr.setEncoding('utf8').on('data', append);
      child.stdio[3].setEncoding('utf8').on('data', text => {
        status += text;
        const lines = status.split('\n'); status = lines.pop().slice(-8192);
        for (const line of lines) logs = logs.then(() => this.progress(line)).catch(value => { error = value; });
      });
      child.on('error', value => { error = value; });
      // Only non-dpkg probes/downloads use timeouts. Never kill an APT transaction.
      const timer = timeout ? setTimeout(() => child.kill('SIGTERM'), timeout) : null;
      child.on('close', async code => { clearTimeout(timer); await logs; if (error || code !== 0) reject(error || Error(`${path.basename(command)} failed (${code}); see package output`)); else resolve(output); });
    });
  }
}
