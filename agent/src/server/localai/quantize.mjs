// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pickerDirectory } from '../files/folders.mjs';
import { runtimeInfo } from './runtimes.mjs';
import { launchInference } from './launch.mjs';
import { publishNewFile } from './files.mjs';

const catalogue = JSON.parse(await fs.readFile(new URL('./models.json', import.meta.url), 'utf8'));
const pocket = catalogue.models.find(model => model.repository === 'EryriLabs/pocket-tts-GGUF')?.files.find(file => file.name === 'pocket-tts-en.gguf');
const absoluteGGUF = file => typeof file === 'string' && !file.includes('\0') && path.isAbsolute(file) && /\.gguf$/i.test(file);
const unchanged = (a, b) => b?.isFile() && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

// A Jobs handler: only the explicitly selected official F16 Pocket source is
// converted. The original model and its matching projector are never changed.
export async function quantizePocket(job, { file, type, output } = {}) {
  if (!['Q4_0', 'Q8_0'].includes(type) || !absoluteGGUF(file) || !absoluteGGUF(output)) throw Error('Choose the Pocket F16 model, Q4_0 or Q8_0, and a new absolute GGUF filename');
  if (!pocket || !/^[a-f0-9]{64}$/.test(pocket.sha256)) throw Error('The verified Pocket source is not available in the model catalogue');
  file = await fs.realpath(file);
  await pickerDirectory(path.dirname(file));
  const destination = (await pickerDirectory(path.dirname(output))).path;
  output = path.join(destination, path.basename(output));
  if (file === output || await fs.lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; return null; })) throw Error('The output file already exists; choose another GGUF filename');
  const runtime = await runtimeInfo('llama');
  if (!runtime?.binary) throw Error('Download the managed llama.cpp runtime first');
  const executable = path.join(path.dirname(await fs.realpath(runtime.binary)), 'llama-quantize');
  await fs.access(executable, constants.X_OK);
  let source, staging;
  try {
    await job.phase('Verifying the original Pocket F16 model');
    source = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const identity = await source.stat();
    if (!identity.isFile() || identity.size !== pocket.bytes) throw Error('Select the original Pocket F16 download before creating a quantized copy');
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024);
    for (let offset = 0; offset < identity.size;) {
      job.checkCancellation();
      const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, identity.size - offset), offset);
      if (!bytesRead) throw Error('The source model changed during verification');
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    if (hash.digest('hex') !== pocket.sha256 || !unchanged(identity, await fs.lstat(file))) throw Error('The source does not match the verified Pocket F16 model');
    staging = await fs.mkdtemp(path.join(destination, '.bashkitten-quantize-'));
    const temporary = path.join(staging, 'model.gguf');
    await job.phase(`Creating Pocket ${type}; the original model and projector are preserved`);
    const child = launchInference({ argv: [executable, file, temporary, type], cwd: destination, env: {} }, { capture: false });
    const cancellation = setInterval(() => { if (job.job.cancelRequested) child.kill('SIGTERM'); }, 250);
    try {
      await new Promise((resolve, reject) => {
        let failure;
        child.once('error', error => { failure = error; });
        child.once('close', code => failure || code !== 0 ? reject(failure || Error('Pocket quantization failed; check the managed runtime and available memory')) : resolve());
      });
    } catch (error) { job.checkCancellation(); throw error; }
    finally { clearInterval(cancellation); }
    job.checkCancellation();
    if (!unchanged(identity, await fs.lstat(file))) throw Error('The source model changed during quantization');
    await job.phase('Verifying and publishing the new Pocket model');
    const result = await fs.open(temporary, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes;
    try {
      const header = Buffer.alloc(24); const read = await result.read(header, 0, header.length, 0);
      const stat = await result.stat(); bytes = stat.size;
      if (!stat.isFile() || read.bytesRead !== 24 || header.toString('ascii', 0, 4) !== 'GGUF' || ![2, 3].includes(header.readUInt32LE(4)) || !header.readBigUInt64LE(8) || !header.readBigUInt64LE(16) || bytes >= identity.size) throw Error('The quantizer did not produce a valid smaller GGUF model');
      await result.chmod(0o600);
    } finally { await result.close(); }
    job.checkCancellation();
    await publishNewFile(temporary, output);
    job.job.result = { file: output, type, bytes, source: file, modelKind: 'pocket' };
    await job.save();
    await job.log(`Created Pocket ${type} (${bytes} bytes). Use the original matching Pocket projector.\n`);
    return job.job.result;
  } finally {
    await source?.close();
    if (staging) await fs.rm(staging, { recursive: true, force: true });
  }
}
