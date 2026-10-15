// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { helper, podmanEnvironment } from './config.mjs';
const pending = new Set();
let quiescing = false;
export async function run(file, args, { env = process.env, cwd, input, output, signal, allowFailure = false, binary = false, maxOutputBytes = Infinity } = {}) {
  const piped = typeof input === 'string' || Buffer.isBuffer(input);
  const child = spawn(file, args, { env, cwd, stdio: [piped ? 'pipe' : input ?? 'ignore', 'pipe', 'pipe'], signal });
  if (piped) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  let stdout = '', stderr = '', stdoutBytes = 0, sizeError; const chunks = [];

  const deliver = (source, bytes) => {
    const pending = output?.(bytes);
    if (pending && typeof pending.then === 'function') { source.pause(); pending.then(() => source.resume(), () => child.kill('SIGTERM')); }
  };
  child.stdout.on('data', bytes => {
    stdoutBytes += bytes.length;
    if (stdoutBytes > maxOutputBytes) { sizeError ||= Error('Command output exceeds the supported size'); child.kill('SIGTERM'); return; }
    if (output) deliver(child.stdout, bytes); else if (binary) chunks.push(bytes); else stdout += bytes;
  });
  child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-65536); if(output) deliver(child.stderr, bytes); });
  const result = await new Promise((resolve, reject) => {
    let failure, killTimer;
    const escalate = () => {
      if (killTimer || child.exitCode !== null || child.signalCode !== null) return;
      // AbortSignal sends TERM first. Escalate only this still-owned child;
      // Podman's persistent container descendants have separate lifecycle owners.
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 1000);
    };
    const stopEscalation = () => { clearTimeout(killTimer); signal?.removeEventListener('abort', escalate); };
    signal?.addEventListener('abort', escalate, { once: true });
    if (signal?.aborted) escalate();
    child.once('exit', stopEscalation);
    // Abort/error can precede process exit. Do not call a command drained until
    // its close event; the owner must not tear down a namespace still in use.
    child.once('error', error => { failure = error; });
    child.once('close', (code, sig) => {
      stopEscalation();
      failure ? reject(failure) : resolve({ code, signal: sig, stdout: binary ? Buffer.concat(chunks) : stdout, stderr });
    });
  });
  if (sizeError) throw sizeError;
  if (!allowFailure && result.code !== 0) throw Error(`${file.split('/').at(-1)} exited ${result.signal || result.code}: ${result.stderr.trim()}`);
  return result;
}
export function podmanLaunch(file, args, options = {}) {
  if (quiescing && !options.cleanup) throw Error('The container engine is stopping');
  const result = run(file, args, { ...options, env: podmanEnvironment(options.env) });
  pending.add(result);
  result.then(() => pending.delete(result), () => pending.delete(result));
  return result;
}
export const podman = (args, options = {}) => podmanLaunch(helper('podman'), args, options);
export async function quiescePodman() {
  quiescing = true;
  let timer;
  try {
    await Promise.race([Promise.allSettled([...pending]), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Container commands have not finished stopping; namespace cleanup was not attempted')), 3000);
    })]);
  } finally { clearTimeout(timer); }
}
export async function installed() {
  if (process.getuid?.() === 0) throw Error('Run BashKitten machines as your desktop user, not host root');
  for (const name of ['podman','crun','conmon','pasta','netavark','aardvark-dns','fuse-overlayfs','fusermount3','catatonit']) {
    try { await fs.access(helper(name), fs.constants.X_OK); }
    catch { throw Error(`The private ${name} runtime is missing; reinstall the BashKitten machine package`); }
  }
  for (const name of ['/usr/bin/newuidmap','/usr/bin/newgidmap']) {
    try { await fs.access(name, fs.constants.X_OK); } catch { throw Error('Rootless containers require the host uidmap package (newuidmap and newgidmap)'); }
  }
  const info = JSON.parse((await podman(['info', '--format=json'])).stdout);
  if (!info.host?.security?.rootless) throw Error('The private Podman engine is not running rootless');
  return info;
}
