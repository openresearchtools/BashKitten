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

const exec = promisify(execFile), buildRepository = 'openresearchtools/Taskarian';
export const localAIDir = path.join(dataDir, 'localai');
export const runtimeDirectory = path.join(localAIDir, 'runtimes');
const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
const runtimeOS = platform === 'termux' ? 'android' : 'linux';
const repository = 'openresearchtools/taskarian-build-' + (runtimeOS === 'android'
  ? arch === 'arm64' ? 'android' : 'android-x86_64' : arch);
const executable = engine => engine === 'llama' ? 'llama-server' : 'whisper-server';
const engineName = engine => { if (!['llama', 'whisper'].includes(engine)) throw Error('Unknown LocalAI engine'); return engine; };
export function requireLocalRuntime() { if (!arch) throw Error('LocalAI requires an x86_64 or ARM64 native runtime'); }
export async function runtimeInfo(engine) { return readJson(path.join(runtimeDirectory, engineName(engine) + '.json'), null); }
export function runtimeRecordAttribution(runtime, source) {
  const name = engineName(runtime.engine) === 'llama' ? 'llama.cpp' : 'whisper.cpp';
  const original = `https://github.com/ggml-org/${name}`;
  const recipe = `https://github.com/${buildRepository}/tree/${runtime.builderCommit}/agent/localai`;
  // Installed historical records remain readable; no request uses this retired repository.
  const historicalRecipe = `https://github.com/openresearchtools/taskarian-localai/tree/${runtime.builderCommit}`;
  if (source.repository !== original || source.commit !== runtime.sourceCommit || !/^[a-f0-9]{40}$/.test(source.commit || '') ||
      ![recipe, historicalRecipe].includes(source.build) || !/^[a-f0-9]{40}$/.test(runtime.builderCommit || '') ||
      source.upstreamRelease && (source.upstreamRelease.commit !== source.commit || source.upstreamRelease.tag !== runtime.upstreamVersion)) throw Error('Installed runtime source records do not match');
  return { name, version: runtime.upstreamVersion || null, commit: source.commit, repository: original,
    buildRepository: source.build === recipe ? `https://github.com/${buildRepository}` : historicalRecipe.split('/tree/')[0],
    buildCommit: runtime.builderCommit, release: source.release || null, download: runtime.download || null,
    sourceArchive: runtime.sourceDownload || source.sourceArchive || null };
}
export function formatRuntimeLicenses(content, name) {
  const headings = [...content.matchAll(/^===== (.+) =====\r?$/gm)], upstream = [], dependencies = [], packaging = [];
  if (headings[0]?.index) dependencies.push(content.slice(0, headings[0].index));
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i][1], text = content.slice(headings[i].index, headings[i + 1]?.index ?? content.length);
    (heading === 'LICENSE' ? upstream : heading.startsWith('Taskarian build integration (') || heading === 'MIT build recipe provenance' ? packaging : dependencies).push(text);
  }
  if (upstream.length !== 1) throw Error('Runtime archive must identify its original upstream LICENSE');
  return `Original upstream license — ${name}\n\n${upstream[0]}` +
    (dependencies.length ? '\nDependency licenses and notices\n\n' + dependencies.join('') : '') +
    (packaging.length ? '\nBuild and packaging licenses and notices\n\n' + packaging.join('') : '');
}
// Native UI status needs the installed selection, not CMake commands or full
// readelf reports. Those remain in build.json/SOURCE.json beside the runtime.
// In particular, Termux truncates PendingIntent output beyond 100 KiB.
export function describeRuntime(runtime) {
  if (!runtime) return null;
  const { engine, version, upstreamVersion, sourceCommit, builderCommit, os, arch,
    backend, release, root, binary, selectedBackend, devices, executables,
    minimumAndroidApi, minimumGlibc, systemPackages, cudaRequirements, capabilities, upstreamRelease, packageRevision } = runtime;
  return { engine, version, upstreamVersion, sourceCommit, builderCommit, os, arch,
    backend, release, root, binary, selectedBackend, devices, executables,
    minimumAndroidApi, minimumGlibc, systemPackages, cudaRequirements, capabilities, upstreamRelease, packageRevision };
}
// Scope native library/plugin lookup to this downloaded engine, never to the
// controller's private Node or unrelated tool processes. Router model children
// inherit this same selection. System loader paths remain the OS defaults.
export function managedRuntimeEnvironment(binary, overrides = {}, executionBackend = 'auto') {
  if (!path.isAbsolute(binary || '')) throw Error('The managed runtime needs an absolute executable path');
  const directory = path.dirname(binary);
  // GGML_BACKEND_PATH names one out-of-tree library, not a search directory.
  // Upstream already discovers bundled plugins beside the executable.
  const { GGML_BACKEND_PATH, ...environment } = overrides;
  return { ...environment, LD_LIBRARY_PATH: directory, ...(executionBackend === 'cpu' ? { GGML_VK_VISIBLE_DEVICES: '', CUDA_VISIBLE_DEVICES: '' } : {}) };
}
export async function preferredBackend(choice) {
  requireLocalRuntime();
  if (platform === 'termux') {
    if (!['cpu', 'vulkan'].includes(choice)) throw Error('Choose CPU or GPU (native Termux Vulkan)');
    return 'vulkan';
  }
  if (!['auto', 'cuda', 'vulkan', 'cpu'].includes(choice)) throw Error('Select Auto, CUDA, Vulkan or CPU');
  if (choice !== 'auto') return choice === 'cpu' ? 'vulkan' : choice;
  try {
    const [{ stdout: driver }, { stdout: libraries }] = await Promise.all([
      exec('nvidia-smi', ['--query-gpu=driver_version,name', '--format=csv,noheader'], { timeout: 10000 }),
      exec('/sbin/ldconfig', ['-p'], { timeout: 10000 }),
    ]);
    if (driver.split('\n').some(line => parseInt(line, 10) >= 525) && libraries.includes('libcuda.so.1')) return 'cuda';
  } catch {}
  return 'vulkan';
}
function downloadURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.host !== 'github.com' || url.search || url.hash || !url.pathname.startsWith('/' + repository + '/releases/download/')) throw Error('Invalid LocalAI artifact URL');
  return url;
}
function releaseArtifact(file, value, release) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.tar\.gz$/.test(file || '')) throw Error('Invalid LocalAI archive filename');
  const expected = `https://github.com/${repository}/releases/download/${release}/${file}`;
  const url = downloadURL(value || expected);
  if (url.href !== expected) throw Error('Runtime archive release or filename differs');
  return url.href;
}
async function releaseManifest(engine, backend) {
  const index = `https://raw.githubusercontent.com/${repository}/main/localai/${runtimeOS}/${arch}/${backend}/${engine}.json`;
  const indexed = await fetch(index + '?taskarian=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
  if (!indexed.ok) throw Error(`Runtime catalogue returned HTTP ${indexed.status}`);
  const pointer = await indexed.json();
  if (pointer.version !== 1 || pointer.repository !== repository || !/^[A-Za-z0-9._-]+$/.test(pointer.release || '') ||
      !/^[a-f0-9]{64}$/.test(pointer.manifestSHA256 || '')) throw Error('Invalid LocalAI runtime catalogue');
  const manifestURL = downloadURL(pointer.manifest);
  if (manifestURL.pathname !== `/${repository}/releases/download/${pointer.release}/manifest.json`) throw Error('Runtime manifest release differs from its catalogue');
  const response = await fetch(manifestURL, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Runtime manifest returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== pointer.manifestSHA256) throw Error('Runtime manifest checksum mismatch');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.version !== 1 || manifest.engine !== engine || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || !Array.isArray(manifest.artifacts) || manifest.release !== pointer.release) throw Error('Invalid LocalAI runtime manifest');
  const upstream = manifest.upstreamRelease, upstreamRepo = engine === 'llama' ? 'llama.cpp' : 'whisper.cpp';
  if (!upstream || !/^[A-Za-z0-9._-]+$/.test(upstream.tag || '') || upstream.commit !== manifest.sourceCommit
      || !/^[a-f0-9]{40}$/.test(upstream.tagObject || '') || !Number.isSafeInteger(upstream.releaseId) || upstream.releaseId <= 0
      || upstream.url !== `https://github.com/ggml-org/${upstreamRepo}/releases/tag/${upstream.tag}`
      || manifest.upstreamVersion !== upstream.tag || !Number.isSafeInteger(manifest.packageRevision) || manifest.packageRevision < 1
      || pointer.release !== `localai-${engine}-${runtimeOS}-${arch}-${backend}-${upstream.tag}-r${manifest.packageRevision}`) throw Error('Runtime metadata does not identify an exact upstream release');
  return { manifest, release: pointer.release };
}
export async function checkRuntime(engine, config) {
  requireLocalRuntime(); engineName(engine);
  if (config.mode === 'custom') return { custom: true, binary: config.binary, updateAvailable: false };
  const backend = await preferredBackend(config.backend);
  const { manifest, release } = await releaseManifest(engine, backend);
  const artifact = manifest.artifacts.find(item => item.os === runtimeOS && item.arch === arch && item.backend === backend);
  if (!artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256) || artifact.executable !== executable(engine)) throw Error(`No matching ${runtimeOS} ${arch} ${backend} runtime`);
  if (artifact.capabilities?.cpu !== true || !Array.isArray(artifact.capabilities.executionBackends) || !artifact.capabilities.executionBackends.includes('cpu') || !artifact.capabilities.executionBackends.includes(backend)) throw Error('The runtime archive does not support the requested CPU/GPU execution modes');
  if (runtimeOS === 'android' && engine === 'llama' && (artifact.capabilities?.router !== true || artifact.capabilities?.subprocess !== true)) throw Error('The published Android llama.cpp runtime lacks required router subprocess support; check for an updated release');
  const url = releaseArtifact(artifact.file, artifact.url, release);
  if (!/^[a-f0-9]{64}$/.test(artifact.sourceSHA256 || '') || !artifact.sourceFile) throw Error('Runtime corresponding-source metadata is missing');
  const sourceUrl = releaseArtifact(artifact.sourceFile, artifact.sourceUrl, release);
  if (backend === 'cuda' && (!/^12\./.test(artifact.cudaRequirements?.toolkit || '') ||
      ['libcudart.so.12', 'libcublas.so.12', 'libcublasLt.so.12'].some(name => !/^[a-f0-9]{64}$/.test(artifact.cudaRequirements?.bundled?.[name]?.sha256 || '')))) throw Error('The CUDA runtime must bundle its CUDA 12 runtime and cuBLAS libraries');
  const installed = await runtimeInfo(engine);
  return { version: `${manifest.upstreamVersion} · r${manifest.packageRevision}`, upstreamRelease: manifest.upstreamRelease, packageRevision: manifest.packageRevision, sourceCommit: manifest.sourceCommit, release,
    backend: engine !== 'llama' && config.backend === 'cpu' ? 'cpu' : backend, packageBackend: backend,
    artifact: { ...artifact, bytes: artifact.size || artifact.bytes || null, url, sourceUrl },
    updateAvailable: installed?.release !== release || installed?.backend !== backend, installed: describeRuntime(installed) };
}
export async function listRuntimeDevices(binary, environment = {}) {
  const listed = await exec(binary, ['--list-devices'], { env: engineEnvironment(environment), timeout: 30000, maxBuffer: Infinity });
  return [...(listed.stdout + listed.stderr).matchAll(/(CUDA\d+|Vulkan\d+):\s*([^\n]+)/g)]
    .map(([, id, name]) => ({ id, name, label: id + ': ' + name, backend: id.startsWith('CUDA') ? 'cuda' : 'vulkan' }));
}
export async function runtimeCacheTypes(binary) {
  const { stdout, stderr } = await exec(binary, ['--help'], { env: engineEnvironment(managedRuntimeEnvironment(binary, {}, 'cpu')), timeout: 20000, maxBuffer: Infinity });
  const help = stdout + stderr, result = {};
  for (const side of ['k', 'v']) {
    const block = help.match(new RegExp('--cache-type-' + side + '(?=\\s|,|$)[\\s\\S]*?(?=\\n\\s*-[A-Za-z-]|$)'))?.[0];
    const allowed = block?.match(/allowed values:\s*([\s\S]*?)(?=\(default:|\(env:|$)/)?.[1] || '';
    result[side] = [...new Set(allowed.split(/[,\s]+/).filter(value => /^[a-z][a-z0-9_]*$/.test(value)))];
  }
  if (!result.k.length || !result.v.length) throw Error('The selected llama.cpp does not report its native K/V cache formats');
  return result;
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
  environment = { ...environment, ...(backend === 'cpu' ? { GGML_VK_VISIBLE_DEVICES: '', CUDA_VISIBLE_DEVICES: '' } : {}) };
  const env = engineEnvironment(environment);
  const { stdout, stderr } = await exec(filename, ['--help'], { env, timeout: 20000, maxBuffer: Infinity });
  const help = stdout + stderr;
  for (const option of engine === 'llama' ? ['--models-preset', '--models-dir', '--host', '--port'] : ['--model', '--host', '--port', '--no-gpu']) if (!help.includes(option)) throw Error(`The selected runtime does not support ${option}`);
  let devices = [], selectedBackend = backend;
  if (engine === 'llama' && backend !== 'cpu') {
    const listed = await exec(filename, ['--list-devices'], { env, timeout: 30000, maxBuffer: Infinity });
    devices = [...(listed.stdout + listed.stderr).matchAll(/(CUDA\d+|Vulkan\d+):\s*([^\n]+)/g)].map(([, id, name]) => ({ id, name, backend: id.startsWith('CUDA') ? 'cuda' : 'vulkan' }));
  } else if (engine === 'whisper' && backend !== 'cpu') {
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
  for (const entry of await fs.readdir(directory)) if (/^lib(?:ggml|llama|whisper|parakeet|mtmd|cudart|cublas)[^/]*\.so(?:\.[0-9]+)*$/.test(entry)) libraries.push(await fs.realpath(path.join(directory, entry)));
  return { binary: filename, backend: selectedBackend, devices, libraries: [...new Set(libraries)], env: environment };
}
export async function installRuntime(job, { engine, config, selection, repair = false }, activate) {
  requireLocalRuntime(); engineName(engine);
  if (config.mode !== 'managed') throw Error('Custom runtimes are not updated by Taskarian');
  const available = selection || await checkRuntime(engine, config);
  if (!available.updateAvailable && !repair) return;
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
    let received = 0, reported = 0; const startedAt = Date.now(), total = Number(response.headers.get('content-length')) || artifact.bytes || null;
    async function* chunks() { for await (const chunk of response.body) {
      job.checkCancellation(); hash.update(chunk); received += chunk.length;
      if (Date.now() - reported >= 1000) { reported = Date.now(); job.job.progress = { downloaded: received, total, bytesPerSecond: received / Math.max(1, (Date.now() - startedAt) / 1000) }; await job.save(); }
      yield chunk;
    } }
    try { await pipeline(chunks(), createWriteStream(archive, { mode: 0o600, flags: 'wx' })); }
    catch (error) { job.checkCancellation(); throw error; }
    finally { clearInterval(cancellation); downloadAbort.abort(); }
    if (hash.digest('hex') !== artifact.sha256) throw Error('Runtime archive checksum mismatch');
    await job.log(`Verified ${(received / (received >= 1e9 ? 1e9 : 1e6)).toFixed(2)} ${received >= 1e9 ? 'GB' : 'MB'} runtime archive.\n`);
    const extracted = path.join(staging, 'runtime'); await fs.mkdir(extracted, { mode: 0o700 });
    await job.phase('Extracting verified runtime');
    // Python's data filter rejects external links/devices and path traversal.
    await job.exec('python3', ['-c', 'import tarfile,sys\nwith tarfile.open(sys.argv[1]) as a:\n a.extractall(sys.argv[2],filter="data")', archive, extracted]);
    const record = await readJson(path.join(extracted, 'build.json'));
    if ((record.os || 'linux') !== runtimeOS || record.engine !== engine || record.arch !== arch || record.backend !== artifact.backend || record.sourceCommit !== available.sourceCommit) throw Error('Runtime build metadata does not match the selected release');
    if (record.capabilities?.cpu !== true || !Array.isArray(record.capabilities.executionBackends) || !record.capabilities.executionBackends.includes('cpu') || !record.capabilities.executionBackends.includes(artifact.backend)
        || record.packageRevision !== available.packageRevision || ['tag', 'commit', 'url', 'releaseId', 'tagObject'].some(key => record.upstreamRelease?.[key] !== available.upstreamRelease[key])) throw Error('Runtime archive does not match its upstream release and execution capabilities');
    if (runtimeOS === 'android' && engine === 'llama' && (record.capabilities?.router !== true || record.capabilities?.subprocess !== true)) throw Error('The Android llama.cpp archive lacks required router subprocess support');
    await fs.access(path.join(extracted, 'LICENSES.txt')); await fs.access(path.join(extracted, 'SOURCE.json'));
    const filename = path.join(extracted, 'bin', executable(engine));
    const executionBackend = engine === 'llama' || config.backend === 'cpu' ? 'cpu' : config.backend === 'auto' && artifact.backend === 'vulkan' ? 'auto' : artifact.backend;
    const verified = await validateBinary(engine, filename, executionBackend, managedRuntimeEnvironment(filename, {}, executionBackend));
    const destination = path.join(runtimeDirectory, engine + '-' + available.release + '-' + artifact.backend + '-' + path.basename(staging).slice(10));
    await fs.rename(extracted, destination); inactive = destination;
    const next = { ...record, release: available.release, version: available.version,
      download: { url: artifact.url, file: artifact.file, sha256: artifact.sha256 },
      sourceDownload: { url: artifact.sourceUrl, file: artifact.sourceFile, sha256: artifact.sourceSHA256 },
      root: destination, binary: path.join(destination, 'bin', executable(engine)), selectedBackend: verified.backend, devices: verified.devices };
    // The owner confirms stopped/idle and the still-saved Managed choice.
    await activate(next, async () => { await writeJson(path.join(runtimeDirectory, engine + '.json'), next); activated = true; });
  } finally { await fs.rm(staging, { recursive: true, force: true }); if (inactive && !activated) await fs.rm(inactive, { recursive: true, force: true }); }
}
