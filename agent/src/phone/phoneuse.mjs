#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// The package launcher uses BashKitten's private bundled Node, not PATH node.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { endpoint, privateRequest } from '../server/phone/transport.mjs';

process.umask(0o077);
const controller = new AbortController();
let renewal;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort());
async function main() {
  const argv = process.argv.slice(2), first = argv.shift() || 'status';
  const command = ['status', 'capabilities', 'help'].includes(first) ? first : `${first}.${argv.shift() || ''}`;
  const args = {}; let output, input, timeoutMs = 30000;
  if (command === 'help' && argv[0] && !argv[0].startsWith('--')) args.group = argv.shift();
  while (argv.length) {
    const flag = argv.shift(); if (!/^--[A-Za-z][A-Za-z0-9-]*$/.test(flag)) throw Error('Use phoneuse help [group] for enabled commands');
    const name = flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'true';
    if (name === 'output') output = value;
    else if (name === 'input') input = value;
    else if (name === 'timeoutMs') timeoutMs = Number(value);
    else if (name === 'argsJson') Object.assign(args, JSON.parse(value));
    else args[name] = value === 'true' ? true : value === 'false' ? false : /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) throw Error('Use a deadline from 1 to 120000 ms');
  const socket = process.env.BASHKITTEN_PHONE_SOCKET, secret = process.env.BASHKITTEN_PHONE_WORKER_KEY;
  if (!socket || !secret) throw Error('Phone is unavailable: this process has no live BashKitten-owned local Pi authorization');
  const link = await privateRequest(socket, secret, 'lease');
  const url = endpoint(link.endpoint);
  // Renew only during this explicit command. Never resubmit/replay its operation.
  renewal = setInterval(() => { privateRequest(socket, secret, 'lease').then(next => {
    if (next.endpoint !== link.endpoint || next.grant !== link.grant) controller.abort();
  }).catch(() => controller.abort()); }, 20000);
  renewal.unref();
  let upload, length;
  if (input) {
    if (!['files.write', 'files.append'].includes(command)) throw Error('Only files write/append accept --input');
    const stat = await fsp.stat(input); if (!stat.isFile()) throw Error('Input must be a regular file');
    upload = fs.createReadStream(input); length = stat.size;
  }
  const request = { version: 1, command, args, timeoutMs };
  const bytes = Buffer.from(JSON.stringify(request));
  const headers = { Authorization: `Bearer ${link.grant}`, 'Content-Type': upload ? 'application/octet-stream' : 'application/json', 'Content-Length': upload ? length : bytes.length };
  if (upload) headers['X-Phone-Request'] = bytes.toString('base64url');
  const response = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: url.port, path: '/v1', method: 'POST', headers, signal: controller.signal }, resolve);
    req.setTimeout(timeoutMs, () => req.destroy(Error('Phone command timed out; its delivery may be unknown. Do not replay side effects.')));
    req.on('error', reject); if (upload) pipeline(upload, req).catch(reject); else req.end(bytes);
  });
  if (response.headers['content-type'] === 'application/json') {
    const chunks = []; for await (const chunk of response) chunks.push(chunk);
    const value = JSON.parse(Buffer.concat(chunks)); if (response.statusCode !== 200 || value.error) throw Error(value.error || 'Phone command failed');
    process.stdout.write(JSON.stringify(value.result) + '\n'); return;
  }
  if (response.statusCode !== 200) { response.destroy(); throw Error('Phone command failed'); }
  let directory;
  if (!output) { directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'bashkitten-phone-')); await fsp.chmod(directory, 0o700); output = path.join(directory, command === 'screen.screenshot' ? 'screen.png' : 'file'); }
  output = path.resolve(output);
  let destination;
  try {
    destination = await fsp.open(output, 'wx', 0o600);
    await pipeline(response, destination.createWriteStream(), { signal: controller.signal });
  } catch (error) {
    response.destroy();
    if (destination) { await destination.close().catch(() => {}); await fsp.rm(output, { force: true }); }
    if (directory) await fsp.rm(directory, { recursive: true, force: true });
    throw error;
  }
  process.stdout.write(JSON.stringify({ path: output, temporary: Boolean(directory), type: response.headers['content-type'] }) + '\n');
}
main().finally(() => clearInterval(renewal)).catch(error => { process.stderr.write(JSON.stringify({ error: error.message, code: controller.signal.aborted ? 'cancelled' : 'unavailable' }) + '\n'); process.exitCode = 1; });
