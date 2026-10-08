// SPDX-License-Identifier: AGPL-3.0-only
// Short-lived child of the existing runtime guard. Commands arrive through an
// inherited private pipe rather than the worker command line. Audio stays on
// stdin; the upstream TTS CLI receives its requested prompt argument.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { engineEnvironment } from './environment.mjs';

try {
  if (process.argv.at(-1) !== 'serve' || process.env.BASHKITTEN_GUARDED !== '1' || Number(process.env.BASHKITTEN_GUARD_PID) !== process.ppid) throw Error('Private inference worker only');
  const input = fs.readFileSync(3); fs.closeSync(3);
  let command;
  try { command = JSON.parse(input.toString('utf8')); } finally { input.fill(0); }
  if (!Array.isArray(command.argv) || !command.argv.length || !command.argv.every(value => typeof value === 'string' && !value.includes('\0'))) throw Error('Invalid inference command');
  const child = spawn(command.argv[0], command.argv.slice(1), { cwd: command.cwd, env: engineEnvironment(command.env), stdio: 'inherit' });
  command = null;
  process.on('SIGTERM', () => { child.kill('SIGTERM'); });
  child.once('error', () => process.exit(1));
  child.once('close', code => process.exit(code ?? 1));
} catch { process.exitCode = 1; }
