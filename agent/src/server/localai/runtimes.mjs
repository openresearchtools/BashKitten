// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dataDir, privateDir, readJson, writeJson } from '../common.mjs';
import { platform } from '../platform/index.mjs';
import { engineEnvironment } from './environment.mjs';

const exec = promisify(execFile), repository = 'openresearchtools/bashkitten-localai';
export const localAIDir = path.join(dataDir, 'localai');
export const runtimeDirectory = path.join(localAIDir, 'runtimes');
const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
const runtimeOS = platform === 'termux' ? 'android' : 'linux';
const executable = engine => engine === 'llama' ? 'llama-server' : 'whisper-server';
const engineName = engine => { if (!['llama', 'whisper'].includes(engine)) throw Error('Unknown LocalAI engine'); return engine; };
export function requireLocalRuntime() { if (!arch) throw Error('LocalAI requires an x86_64 or ARM64 native runtime'); }
export async function runtimeInfo(engine) { return readJson(path.join(runtimeDirectory, engineName(engine) + '.json'), null); }
// Native UI status needs the installed selection, not CMake commands or full
// readelf reports. Those remain in build.json/SOURCE.json beside the runtime.
// In particular, Termux truncates PendingIntent output beyond 100 KiB.
export function describeRuntime(runtime) {
  if (!runtime) return null;
  const { engine, version, upstreamVersion, sourceCommit, builderCommit, os, arch,
    backend, release, root, binary, selectedBackend, devices, executables,
    minimumAndroidApi, minimumGlibc, systemPackages, cudaRequirements, capabilities } = runtime;
  return { engine, version, upstreamVersion, sourceCommit, builderCommit, os, arch,
    backend, release, root, binary, selectedBackend, devices, executables,
    minimumAndroidApi, minimumGlibc, systemPackages, cudaRequirements, capabilities };
}
// Scope native library/plugin lookup to this downloaded engine, never to the
// controller's private Node or unrelated tool processes. Router model children
// inherit this same selection. System loader paths remain the OS defaults.
export function managedRuntimeEnvironment(binary, overrides = {}) {
  if (!path.isAbsolute(binary || '')) throw Error('The managed runtime needs an absolute executable path');
  const directory = path.dirname(binary);
  // GGML_BACKEND_PATH names one out-of-tree library, not a search directory.
  // Upstream already discovers bundled plugins beside the executable.
  const { GGML_BACKEND_PATH, ...environment } = overrides;
  return { ...environment, LD_LIBRARY_PATH: directory };
}
export async function preferredBackend(choice) {
  requireLocalRuntime();
  if (platform === 'termux') {
    if (!['cpu', 'vulkan'].includes(choice)) throw Error('Choose CPU or GPU (native Termux Vulkan)');
    return choice;
  }
  if (!['auto', 'cuda', 'vulkan', 'cpu'].includes(choice)) throw Error('Select Auto, CUDA, Vulkan or CPU');
  if (choice !== 'auto') return choice;
  try {
    const [{ stdout: driver }, { stdout: libraries }] = await Promise.all([
      exec('nvidia-smi', ['--query-gpu=driver_version,name', '--format=csv,noheader'], { timeout: 10000 }),
      exec('/sbin/ldconfig', ['-p'], { timeout: 10000 }),
    ]);
    if (driver.split('\n').some(line => parseInt(line, 10) >= 580) && ['libcuda.so.1', 'libcudart.so.13', 'libcublas.so.13'].every(name => libraries.includes(name))) return 'cuda';
  } catch {}
  return 'vulkan';
}
function downloadURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname !== 'github.com' || !url.pathname.startsWith('/' + repository + '/releases/download/')) throw Error('Invalid LocalAI artifact URL');
  return url;
}
async function github(route) {
  const response = await fetch('https://api.github.com/repos/' + repository + route, { headers: { Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Runtime catalogue returned HTTP ${response.status}`);
  return response.json();
}
async function releaseManifest(engine) {
  const releases = await github('/releases?per_page=100');
  // Android's native CPU/Vulkan releases are independent of the Linux CUDA
  // matrix. A mobile publication must not replace desktop's runtime catalogue.
  const prefix = (runtimeOS === 'android' ? 'android-' : '') + engine + '-';
  const release = releases.find(item => !item.draft && item.tag_name.startsWith(prefix) && item.assets.some(asset => asset.name === 'manifest.json'));
  if (!release) throw Error(`No ${runtimeOS} ${engine} runtime release is published yet`);
  const asset = release.assets.find(asset => asset.name === 'manifest.json');
  const response = await fetch(downloadURL(asset.browser_download_url), { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Runtime manifest returned HTTP ${response.status}`);
  const manifest = await response.json();
  if (manifest.version !== 1 || manifest.engine !== engine || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || !Array.isArray(manifest.artifacts) || manifest.release !== release.tag_name) throw Error('Invalid LocalAI runtime manifest');
  return { manifest, release };
}
export async function checkRuntime(engine, config) {
  requireLocalRuntime(); engineName(engine);
  if (config.mode === 'custom') return { custom: true, binary: config.binary, updateAvailable: false };
  const { manifest, release } = await releaseManifest(engine);
  const backend = await preferredBackend(config.backend);
  const artifact = manifest.artifacts.find(item => item.os === runtimeOS && item.arch === arch && item.backend === backend);
  if (!artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256) || artifact.executable !== executable(engine)) throw Error(`No matching ${runtimeOS} ${arch} ${backend} runtime`);
  if (runtimeOS === 'android' && engine === 'llama' && (artifact.capabilities?.router !== true || artifact.capabilities?.subprocess !== true)) throw Error('The published Android llama.cpp runtime lacks required router subprocess support; check for an updated release');
  const asset = release.assets.find(item => item.name === artifact.file);
  if (!asset) throw Error('The runtime archive is missing');
  const installed = await runtimeInfo(engine);
  return { version: manifest.upstreamVersion, sourceCommit: manifest.sourceCommit, release: release.tag_name,
    backend, artifact: { ...artifact, url: downloadURL(asset.browser_download_url).href },
    updateAvailable: installed?.release !== release.tag_name || installed?.backend !== backend, installed: describeRuntime(installed) };
}
export async function validateBinary(engine, filename, backend, environment = {}) {
  requireLocalRuntime(); engineName(engine);
  if (platform === 'termux' && !['cpu', 'vulkan'].includes(backend)) throw Error('Choose CPU or GPU (native Termux Vulkan)');
  filename = await fs.realpath(filename);
  if ((await fs.stat(filename)).isDirectory()) filename = await fs.realpath(path.join(filename, executable(engine)));
  await fs.access(filename, fs.constants.X_OK);
  const file = await fs.open(filename, 'r');
  try {
    const bytes = Buffer.alloc(20); await file.read(bytes, 0, 20, 0);
    if (bytes.readUInt32BE(0) !== 0x7f454c46 || bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== (arch === 'arm64' ? 183 : 62)) throw Error('The runtime executable has the wrong native architecture');
  } finally { await file.close(); }
  const env = engineEnvironment(environment);
  const { stdout, stderr } = await exec(filename, ['--help'], { env, timeout: 20000, maxBuffer: Infinity });
  const help = stdout + stderr;
  for (const option of engine === 'llama' ? ['--models-preset', '--models-dir', '--host', '--port'] : ['--model', '--host', '--port', '--no-gpu']) if (!help.includes(option)) throw Error(`The selected runtime does not support ${option}`);
  let devices = [], selectedBackend = backend;
  if (engine === 'llama') {
    const listed = await exec(filename, ['--list-devices'], { env, timeout: 30000, maxBuffer: Infinity });
    devices = [...(listed.stdout + listed.stderr).matchAll(/(CUDA\d+|Vulkan\d+):\s*([^\n]+)/g)].map(([, id, name]) => ({ id, name, backend: id.startsWith('CUDA') ? 'cuda' : 'vulkan' }));
  } else if (backend !== 'cpu') {
    const result = await exec('python3', [fileURLToPath(new URL('./devices.py', import.meta.url)), path.dirname(filename)], { env, timeout: 30000, maxBuffer: Infinity });
    devices = JSON.parse(result.stdout);
  }
  if (backend === 'auto') selectedBackend = devices.some(device => device.backend === 'cuda') ? 'cuda' : devices.some(device => device.backend === 'vulkan') ? 'vulkan' : 'cpu';
  if (selectedBackend !== 'cpu' && !devices.some(device => device.backend === selectedBackend)) throw Error(`The runtime cannot initialize ${selectedBackend}. Select CPU or correct the driver installation.`);
  // Bionic provides the dependency report itself; Termux does not require a
  // separate ldd package. This only inspects linkage, never launches inference.
  const linked = platform === 'termux'
    ? await exec('/system/bin/linker64', ['--list', filename], { env, timeout: 10000 })
    : await exec('ldd', [filename], { env, timeout: 10000 });
  const libraries = [...new Set([...linked.stdout.matchAll(/(?:=>\s*)?(\/[^\s]+)\s*\(/g)].map(match => match[1]))];
  if (environment.GGML_BACKEND_PATH) libraries.push(await fs.realpath(environment.GGML_BACKEND_PATH));
  const directory = path.dirname(filename);
  for (const entry of await fs.readdir(directory)) if (/^lib(?:ggml|llama|whisper|parakeet|mtmd)[^/]*\.so(?:\.[0-9]+)*$/.test(entry)) libraries.push(await fs.realpath(path.join(directory, entry)));
  return { binary: filename, backend: selectedBackend, devices, libraries: [...new Set(libraries)], env: environment };
}
export async function installRuntime(job, { engine, config, selection }, activate) {
  requireLocalRuntime(); engineName(engine);
  if (config.mode !== 'managed') throw Error('Custom runtimes are not updated by BashKitten');
  const available = selection || await checkRuntime(engine, config);
  if (!available.updateAvailable) return;
  const { artifact } = available;
  await privateDir(runtimeDirectory);
  const staging = await fs.mkdtemp(path.join(runtimeDirectory, '.download-'));
  let inactive, activated = false;
  try {
    await job.phase(`Downloading ${engine} ${available.version} (${artifact.backend})`);
    const downloadAbort = new AbortController();
    const cancellation = setInterval(() => { if (job.job.cancelRequested) downloadAbort.abort(); }, 250);
    let response;
    try { response = await fetch(downloadURL(artifact.url), { signal: downloadAbort.signal }); }
    catch (error) { clearInterval(cancellation); job.checkCancellation(); throw error; }
    if (!response.ok) { clearInterval(cancellation); downloadAbort.abort(); throw Error(`Runtime download returned HTTP ${response.status}`); }
    const archive = path.join(staging, 'runtime.tar.gz'), hash = createHash('sha256');
    let received = 0, reported = 0;
    async function* chunks() { for await (const chunk of response.body) {
      job.checkCancellation(); hash.update(chunk); received += chunk.length;
      if (Date.now() - reported >= 1000) { reported = Date.now(); job.job.progress = { downloaded: received, total: Number(response.headers.get('content-length')) || null }; await job.save(); }
      yield chunk;
    } }
    try { await pipeline(chunks(), createWriteStream(archive, { mode: 0o600, flags: 'wx' })); }
    catch (error) { job.checkCancellation(); throw error; }
    finally { clearInterval(cancellation); downloadAbort.abort(); }
    if (hash.digest('hex') !== artifact.sha256) throw Error('Runtime archive checksum mismatch');
    await job.log(`Verified ${received} downloaded bytes.\n`);
    const extracted = path.join(staging, 'runtime'); await fs.mkdir(extracted, { mode: 0o700 });
    await job.phase('Extracting verified runtime');
    // Python's data filter rejects external links/devices and path traversal.
    await job.exec('python3', ['-c', 'import tarfile,sys\nwith tarfile.open(sys.argv[1]) as a:\n a.extractall(sys.argv[2],filter="data")', archive, extracted]);
    const record = await readJson(path.join(extracted, 'build.json'));
    if ((record.os || 'linux') !== runtimeOS || record.engine !== engine || record.arch !== arch || record.backend !== artifact.backend || record.sourceCommit !== available.sourceCommit) throw Error('Runtime build metadata does not match the selected release');
    if (runtimeOS === 'android' && engine === 'llama' && (record.capabilities?.router !== true || record.capabilities?.subprocess !== true)) throw Error('The Android llama.cpp archive lacks required router subprocess support');
    await fs.access(path.join(extracted, 'LICENSES.txt')); await fs.access(path.join(extracted, 'SOURCE.json'));
    const filename = path.join(extracted, 'bin', executable(engine));
    const verified = await validateBinary(engine, filename, config.backend === 'auto' && artifact.backend === 'vulkan' ? 'auto' : artifact.backend, managedRuntimeEnvironment(filename));
    const destination = path.join(runtimeDirectory, engine + '-' + available.release + '-' + artifact.backend + '-' + path.basename(staging).slice(10));
    await fs.rename(extracted, destination); inactive = destination;
    const next = { ...record, release: available.release, version: available.version, root: destination, binary: path.join(destination, 'bin', executable(engine)), selectedBackend: verified.backend, devices: verified.devices };
    // The owner confirms stopped/idle and the still-saved Managed choice.
    await activate(next, async () => { await writeJson(path.join(runtimeDirectory, engine + '.json'), next); activated = true; });
  } finally { await fs.rm(staging, { recursive: true, force: true }); if (inactive && !activated) await fs.rm(inactive, { recursive: true, force: true }); }
}
