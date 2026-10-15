// SPDX-License-Identifier: AGPL-3.0-only
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { binary } from '../access/paths.mjs';

export function ttsCpuArguments({ cpuThreads = 0 }, backend) {
  if (!Number.isSafeInteger(cpuThreads) || cpuThreads < 0) throw Error('CPU threads must be a positive whole number, or 0 for automatic');
  return backend === 'cpu' && cpuThreads > 0 ? ['--threads', String(cpuThreads)] : [];
}

export function launchInference(command, { signal, capture = true, diagnostics = false, outputPipe = false } = {}) {
  if (outputPipe) command = { ...command, argv: [binary('runtime-guard'), 'pipe-output', ...command.argv] };
  const child = spawn(binary('runtime-guard'), [process.execPath, fileURLToPath(new URL('./inference-worker.mjs', import.meta.url)), 'serve'],
    { stdio: [capture ? 'pipe' : 'ignore', capture ? 'pipe' : 'ignore', diagnostics ? 'pipe' : 'ignore', 'pipe'], signal });
  child.stdio[3].on('error', () => {});
  const message = Buffer.from(JSON.stringify(command));
  child.stdio[3].end(message, () => message.fill(0));
  return child;
}
