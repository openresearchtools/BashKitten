// SPDX-License-Identifier: AGPL-3.0-only
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { binary } from '../access/paths.mjs';

export function launchInference(command, { signal, capture = true } = {}) {
  const child = spawn(binary('runtime-guard'), [process.execPath, fileURLToPath(new URL('./inference-worker.mjs', import.meta.url)), 'serve'],
    { stdio: [capture ? 'pipe' : 'ignore', capture ? 'pipe' : 'ignore', 'ignore', 'pipe'], signal });
  child.stdio[3].on('error', () => {});
  const message = Buffer.from(JSON.stringify(command));
  child.stdio[3].end(message, () => message.fill(0));
  return child;
}
