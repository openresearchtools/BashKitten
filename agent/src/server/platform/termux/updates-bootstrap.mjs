// SPDX-License-Identifier: AGPL-3.0-only
// Also shipped verbatim in the signed APK. Keep package matching here so an APK
// can replace an older backend without asking that backend to understand it.
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const prefix = '/data/data/com.termux/files/usr';
const app = prefix + '/lib/bashkitten';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const acknowledge = value => { if (process.connected) process.send(value, () => {}); };
const terminal = state => ['complete', 'failed', 'interrupted', 'cancelled'].includes(state);
const aptOptions = ['-o', 'DPkg::Lock::Timeout=300', '-o', 'Dpkg::Use-Pty=0', '-o', 'APT::Status-Fd=3',
  '-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold',
  '-o', 'APT::Get::AllowUnauthenticated=false', '-o', 'Acquire::AllowInsecureRepositories=false'];
const importInstalled = name => import(pathToFileURL(path.join(app, 'src/server', name)).href);
function termux() { if (process.platform !== 'android' || process.env.PREFIX !== prefix) throw Error('These package updates require the installed Termux backend'); }
export function validateTarget(value) {
  if (value?.schema !== 1 || !/^[a-f0-9]{40}$/.test(value.sourceCommit || '') || !/^[a-f0-9]{64}$/.test(value.bootstrapSha256 || '') ||
      !['aarch64', 'x86_64'].includes(value.architecture) || value.apkAbi !== (value.architecture === 'aarch64' ? 'arm64-v8a' : 'x86_64') ||
      !/^[0-9][0-9A-Za-z.+:~_-]*$/.test(value.productVersion || '') || !Array.isArray(value.packages) || value.packages.length !== 2)
    throw Error('The APK package manifest is invalid');
  for (const name of ['bashkitten', 'bashkitten-os']) {
    const records = value.packages.filter(item => item.name === name);
    if (records.length !== 1) throw Error('The APK package manifest has an invalid package list');
    const item = records[0];
    if (!/^[0-9][0-9A-Za-z.+:~_-]*$/.test(item.version || '') || item.architecture !== value.architecture ||
        !/^[a-f0-9]{40}$/.test(item.sourceCommit || '') || item.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(item.sha256)) throw Error('Invalid package release identity');
    if (name === 'bashkitten' && (item.version !== value.productVersion || item.sourceCommit !== value.sourceCommit)) throw Error('The backend does not match the APK release');
    if (name === 'bashkitten-os' && (!item.sha256 || !/^[a-f0-9]{64}$/.test(item.installedManifestSha256 || ''))) throw Error('The APK has no OS package identity');
  }
  return { schema: 1, productVersion: value.productVersion, sourceCommit: value.sourceCommit, bootstrapSha256: value.bootstrapSha256,
    architecture: value.architecture, apkAbi: value.apkAbi, packages: ['bashkitten', 'bashkitten-os'].map(name => {
      const item = value.packages.find(record => record.name === name);
      return { name, version: item.version, architecture: item.architecture, sourceCommit: item.sourceCommit,
        ...(item.sha256 ? { sha256: item.sha256 } : {}),
        ...(item.installedManifestSha256 ? { installedManifestSha256: item.installedManifestSha256 } : {}) };
    }) };
}
async function json(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function installed() {
  termux();
  const [{ stdout: architecture }, { stdout: listing }] = await Promise.all([
    exec('dpkg', ['--print-architecture'], { timeout: 15000 }),
    exec('dpkg-query', ['-W', '-f=${binary:Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n'], { timeout: 15000, maxBuffer: Infinity }),
  ]);
  return { architecture: architecture.trim(), packages: listing.trim().split('\n').map(line => line.split('\t'))
    .filter(([name, , , state]) => ['bashkitten', 'bashkitten-os'].includes(name) && state === 'installed')
    .map(([name, version, architecture]) => ({ name, version, architecture })),
    build: await json(path.join(app, 'build-platform.json')) };
}
export async function releaseStatus(target) {
  target = validateTarget(target);
  const current = await installed();
  const versions = current.architecture === target.architecture && target.packages.every(expected =>
    current.packages.some(item => item.name === expected.name && item.version === expected.version && item.architecture === expected.architecture));
  const build = current.build;
  const backend = build?.revision === target.sourceCommit && build?.packageVersion === target.productVersion && build?.architecture === target.architecture;
  const expected = target.packages.find(item => item.name === 'bashkitten-os');
  const osBuild = await json(path.join(prefix, 'share/bashkitten-os/build.json'));
  let os = osBuild?.schemaVersion === 1 && osBuild.sourceCommit === expected.sourceCommit && osBuild.version === expected.version &&
    osBuild.target === 'termux' && osBuild.architecture === expected.architecture;
  if (os) {
    try { os = sha(await fs.readFile(path.join(prefix, 'var/lib/dpkg/info/bashkitten-os.md5sums'))) === expected.installedManifestSha256; }
    catch (error) { if (error.code !== 'ENOENT') throw error; os = false; }
  }
  return { matched: Boolean(versions && backend && os), installed: { architecture: current.architecture, packages: current.packages,
    sourceCommit: build?.revision, osSourceCommit: osBuild?.sourceCommit, osVerified: os } };
}
// Existing Jobs supplies cancellation/checkpoints, progress and durable output.
// This small executor adds cwd for apt download and complete simulation capture;
// it never kills dpkg/APT halfway through an applying transaction.
async function command(job, executable, args, { cwd, captureAll = false } = {}) {
  job.checkCancellation();
  await job.log('\n$ ' + [executable, ...args].join(' ') + '\n');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    let output = '', status = '', failure, work = Promise.resolve();
    const append = text => { output += text; if (!captureAll) output = output.slice(-128000); work = work.then(() => job.log(text)).catch(error => { failure ||= error; }); };
    child.stdout.setEncoding('utf8').on('data', append); child.stderr.setEncoding('utf8').on('data', append);
    child.stdio[3].setEncoding('utf8').on('data', text => {
      const lines = (status + text).split('\n'); status = lines.pop();
      for (const line of lines) work = work.then(() => job.progress(line)).catch(error => { failure ||= error; });
    });
    child.once('error', error => { failure ||= error; });
    child.once('close', async code => { await work; if (failure || code !== 0) reject(failure || Error(`${executable} failed (${code}); see update output`)); else resolve(output); });
  });
}
const apt = (job, args, options) => command(job, 'apt-get', [...aptOptions, ...args], options);
function checkRemoval(output) {
  if (/^Remv (?:bashkitten(?:-os)?|python|termux-tools|openresearchtools-termux-keyring)(?: |:)/m.test(output))
    throw Error('APT would remove a required BashKitten package; the transaction was not applied');
}
function checkPlan(output, target) {
  checkRemoval(output);
  for (const [, name, version] of output.matchAll(/^Inst (\S+)(?: \[[^\]]+\])? \((\S+)/gm)) {
    const expected = target.packages.find(item => item.name === name.split(':')[0]);
    if (expected && version !== expected.version) throw Error('APT preferences would replace ' + expected.name + ' with a version that does not match this APK');
  }
}
async function archiveBuild(file) {
  return new Promise((resolve, reject) => {
    const unpack = spawn('dpkg-deb', ['--fsys-tarfile', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    const read = spawn('tar', ['-xOf', '-', '.' + app + '/build-platform.json'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let text = '', failure, remaining = 2;
    unpack.stdout.pipe(read.stdin); read.stdin.on('error', error => { if (error.code !== 'EPIPE') failure ||= error; });
    unpack.stderr.resume(); read.stderr.resume(); read.stdout.setEncoding('utf8').on('data', bytes => { text += bytes; });
    for (const child of [unpack, read]) {
      child.on('error', error => { failure ||= error; });
      child.on('close', code => {
        if (code !== 0) failure ||= Error('The signed APT backend package has no readable build manifest');
        if (--remaining) return;
        if (failure) return reject(failure);
        try { resolve(JSON.parse(text)); } catch { reject(Error('The APT backend build manifest is invalid')); }
      });
    }
  });
}
async function archives(job, target) {
  const directory = path.join(job.directory, 'archives', job.job.id);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  // Retry downloads are revalidated; no completed checkpoint substitutes for bytes.
  await job.phase('Downloading the exact packages for this app');
  const requested = target.packages.map(item => item.name + '=' + item.version);
  try { await apt(job, ['download', ...requested], { cwd: directory }); }
  catch (error) { throw Error('Could not download the exact packages required by this app (' + requested.join(', ') + '): ' + error.message); }
  const files = [];
  for (const expected of target.packages) {
    let found;
    for (const name of await fs.readdir(directory)) {
      if (!name.endsWith('.deb')) continue;
      const file = path.join(directory, name);
      const { stdout } = await exec('dpkg-deb', ['-f', file, 'Package', 'Version', 'Architecture'], { timeout: 30000 });
      const metadata = Object.fromEntries(stdout.trim().split('\n').map(line => { const i = line.indexOf(':'); return [line.slice(0, i), line.slice(i + 1).trim()]; }));
      if (metadata.Package !== expected.name) continue;
      if (found || metadata.Version !== expected.version || metadata.Architecture !== expected.architecture) throw Error('APT returned an unexpected package identity');
      const hash = createHash('sha256');
      const handle = await fs.open(file);
      try { for await (const bytes of handle.createReadStream({ autoClose: false })) hash.update(bytes); } finally { await handle.close(); }
      if (expected.sha256 && hash.digest('hex') !== expected.sha256) throw Error(`${expected.name} does not match the APK package checksum`);
      if (expected.name === 'bashkitten') {
        const build = await archiveBuild(file);
        if (build.revision !== expected.sourceCommit || build.packageVersion !== expected.version || build.architecture !== expected.architecture)
          throw Error('The configured APT repository does not contain the exact backend source release required by this APK');
      }
      found = file;
    }
    if (!found) throw Error(`The configured APT repositories do not provide ${expected.name} ${expected.version}`);
    files.push(found);
  }
  return files;
}
export async function applyPackages(job, { target }, { beforeApply = async fn => fn() } = {}) {
  termux(); target = validateTarget(target);
  const current = await installed();
  if (current.architecture !== target.architecture) throw Error('The APK and Termux architectures do not match');
  const matching = (await releaseStatus(target)).matched;
  if (matching && job.job.kind === 'match-packages') { await job.phase('Installed packages already match this app'); return; }
  await job.phase('Refreshing configured signed APT repositories'); await apt(job, ['update']);
  const directory = path.join(job.directory, 'archives', job.job.id);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const files = matching && job.job.kind !== 'recover-packages' ? null : await archives(job, target);
  const args = [...(files ? ['--reinstall'] : []), '--allow-downgrades', '-y', 'install',
    ...(files || target.packages.map(item => item.name + '=' + item.version))];
  await job.phase('Checking the complete package transaction');
  checkPlan(await apt(job, ['-s', ...args], { captureAll: true }), target);
  await job.phase('Downloading package dependencies'); await apt(job, ['--download-only', ...args]);
  // A per-command standard APT preference holds only the two APK-owned package
  // versions. Preserve the user's other preferences and automatic dependencies;
  // no global hold, source/channel change or silent package skip is installed.
  const preferences = path.join(job.directory, 'archives', job.job.id, 'preferences');
  async function upgradeOptions() {
    let existing = '';
    try { existing = await fs.readFile(path.join(prefix, 'etc/apt/preferences'), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.writeFile(preferences, target.packages.map(item => `Package: ${item.name}\nPin: version ${item.version}\nPin-Priority: 1001\n`).join('\n') + '\n' + existing, { mode: 0o600 });
    return ['-o', 'Dir::Etc::preferences=' + preferences];
  }
  if (job.job.kind === 'update-packages') {
    const options = await upgradeOptions();
    checkPlan(await apt(job, [...options, '-s', 'full-upgrade'], { captureAll: true }), target);
    await apt(job, [...options, '--download-only', '-y', 'full-upgrade']);
  }
  await beforeApply(async () => {
    await job.phase('Installing the matching app packages and dependencies');
    // Recheck immediately before applying: external APT changes are not assumed away.
    checkPlan(await apt(job, ['-s', ...args], { captureAll: true }), target);
    await apt(job, args);
    if (job.job.kind === 'update-packages') {
      const options = await upgradeOptions();
      checkPlan(await apt(job, [...options, '-s', 'full-upgrade'], { captureAll: true }), target);
      await apt(job, [...options, '-y', 'full-upgrade']);
    }
    const final = await installed();
    if (final.build?.revision !== target.sourceCommit || final.architecture !== target.architecture ||
        !target.packages.every(expected => final.packages.some(item => item.name === expected.name && item.version === expected.version && item.architecture === expected.architecture)))
      throw Error('Package installation finished without the exact APK/backend match');
    if (!(await releaseStatus(target)).matched) throw Error('The installed OS package identity does not match this APK');
    const verification = await command(job, 'dpkg', ['--verify', 'bashkitten-os'], { captureAll: true });
    if (verification.trim()) throw Error('Installed package verification reported changed files; see update output');
  });
}
async function bootstrap(request) {
  termux();
  const target = validateTarget(request.target);
  if (sha(await fs.readFile(fileURLToPath(import.meta.url))) !== target.bootstrapSha256) throw Error('The update program does not match this APK');
  // These APIs predate the Updates page. Missing/incomplete old installations
  // return a setup error rather than execute an unguarded package transaction.
  const [{ Jobs }, common, runtime, instance, { paths }] = await Promise.all([
    importInstalled('updates/jobs.mjs'), importInstalled('common.mjs'), importInstalled('updates/runtime.mjs'),
    importInstalled('instance.mjs'), importInstalled('access/paths.mjs'),
  ]);
  const { dataDir, privateDir, readJson, writeJson, socketRequest } = common;
  const directory = path.join(dataDir, 'updates/apk-jobs');
  const jobFile = path.join(directory, 'job.json'), cancelFile = path.join(directory, 'cancel.json'), ownerFile = path.join(directory, 'owner.json');
  await privateDir(directory);
  async function activeOwner() {
    const owner = await readJson(ownerFile, null);
    return owner && await instance.processStart(owner.pid) === owner.started ? owner : null;
  }
  async function snapshot() {
    let job = await readJson(jobFile, null);
    const owner = await activeOwner();
    if (job && !terminal(job.status) && !owner) job = { ...job, status: 'interrupted', error: 'The updater stopped. Retry to verify and finish the package transaction.' };
    let result;
    try { result = await releaseStatus(target); }
    catch (error) {
      if (!owner || !job || terminal(job.status)) throw error;
      result = { matched: false, installed: { error: error.message } };
    }
    if (job && (await readJson(cancelFile, null))?.id === job.id) job.cancelRequested = true;
    if (job) job.log = (await fs.readFile(path.join(directory, 'output.log'), 'utf8').catch(() => '')).slice(-32000);
    const selection = await readJson(path.join(dataDir, 'runtime.json'), null);
    const packaged = await readJson(path.join(app, 'runtime-default.json'), null);
    return { ...result, job, sources: await readJson(path.join(dataDir, 'updates/sources.json'), {}),
      runtime: { version: selection?.version || packaged?.version, previous: selection?.previous?.version } };
  }
  if (request.mode === 'status') return snapshot();
  if (request.mode === 'inventory') return (await importInstalled('platform/termux/packages.mjs')).packageInventory();
  if (request.mode === 'cancel') {
    const job = await readJson(jobFile, null);
    if (job && !terminal(job.status) && await activeOwner()) await writeJson(cancelFile, { id: job.id });
    return snapshot();
  }
  const kinds = ['match-packages', 'check-packages', 'update-packages', 'refresh-lists', 'recover-packages', 'update-pi', 'rollback-pi'];
  if (request.mode !== 'start' || !kinds.includes(request.kind)) throw Error('Unknown update operation');
  if (process.argv[2] !== '--run') {
    if (await activeOwner()) {
      const active = await snapshot();
      if (active.job?.kind !== request.kind || JSON.stringify(active.job?.input?.target) !== JSON.stringify(target)) throw Error('Another package operation is running');
      return active;
    }
    const file = fileURLToPath(import.meta.url);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [file, '--run'], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env } });
      child.unref();
      const timer = setTimeout(() => { if (child.connected) child.disconnect(); reject(Error('The package updater did not become ready')); }, 30000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('message', message => { clearTimeout(timer); if (child.connected) child.disconnect(); message.error ? reject(Error(message.error)) : resolve(); });
      child.once('exit', code => { clearTimeout(timer); reject(Error(`The package updater exited before becoming ready (${code})`)); });
      child.send(request);
    });
    return snapshot();
  }
  const ownership = await instance.claimInstance('package-update');
  if (!ownership) { acknowledge({ error: 'Another package operation is starting; wait for its status' }); return null; }
  let controlOwner, started;
  try {
    started = await instance.processStart(process.pid);
    if (!started) throw Error('The update process has no live ownership identity');
    await writeJson(ownerFile, { pid: process.pid, started });
    class UpdateJobs extends Jobs {
      async run() { try { await super.run(); } finally { this.busy = false; } }
      checkCancellation() {
        try { if (JSON.parse(readFileSync(cancelFile, 'utf8')).id === this.job?.id) this.job.cancelRequested = true; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        super.checkCancellation();
      }
    }
    async function controller() {
      try { return await socketRequest(paths.control, '/status', undefined, 3000); }
      catch (error) { if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) return null; throw error; }
    }
    async function beforeApply(job, fn) {
      // Do not retire a controller while its existing package/LocalAI job is active.
      while (true) {
        const state = await controller();
        if (!state?.packages?.job || terminal(state.packages.job.status)) break;
        await job.phase('Waiting for the current backend operation to finish', 'waiting'); await sleep(1000);
      }
      return runtime.atIdle(job, async () => {
        await job.phase('Closing the idle backend for package replacement');
        if (await controller()) await socketRequest(paths.control, '/shutdown', { restart: true }, 30000);
        // The same kernel lock used by the real controller prevents any old UI or
        // CLI from recreating it halfway through package replacement.
        while (!(controlOwner = await instance.claimInstance('control'))) {
          await job.phase('Waiting for the previous backend to finish closing', 'waiting'); await sleep(500);
        }
        const { acquireWake, releaseWake } = await importInstalled('access/wake.mjs');
        await acquireWake();
        let failure;
        try { return await fn(); } catch (error) { failure = error; throw error; }
        finally { try { await releaseWake(); } catch (error) { if (!failure) throw error; await job.log('Wake-lock release: ' + error.message + '\n'); } }
      });
    }
    const handlers = {
      'match-packages': (job, input) => applyPackages(job, input, { beforeApply: fn => beforeApply(job, fn) }),
      'update-packages': (job, input) => applyPackages(job, input, { beforeApply: fn => beforeApply(job, fn) }),
      'recover-packages': (job, input) => beforeApply(job, async () => {
        await job.phase('Completing interrupted package configuration');
        await command(job, 'dpkg', ['--force-confdef', '--force-confold', '--configure', '-a']);
        await applyPackages(job, input);
      }),
      'check-packages': async job => {
        await job.phase('Checking configured APT repositories');
        const result = await runtime.sourceResult('apt', async () => {
          await apt(job, ['update']); const output = await apt(job, ['-s', 'full-upgrade'], { captureAll: true });
          const packages = [...output.matchAll(/^Inst (\S+)(?: \[([^\]]+)\])? \((\S+)/gm)].map(([, name, current, latest]) => ({ name, current: current || 'Not installed', latest,
            ...(target.packages.some(item => item.name === name.split(':')[0]) ? { managedByApk: true } : {}) }));
          return { available: packages.filter(item => !item.managedByApk).length, packages };
        });
        if (result.error) throw Error(result.error);
      },
      'refresh-lists': job => apt(job, ['update']),
      'update-pi': runtime.installPi, 'rollback-pi': runtime.rollbackPi,
    };
    const jobs = new UpdateJobs(handlers, directory);
    await jobs.init();
    if (request.retry && jobs.job && (jobs.job.kind !== request.kind || JSON.stringify(jobs.job.input?.target) !== JSON.stringify(target))) throw Error('The previous job belongs to a different APK; start a new matching update');
    await fs.rm(cancelFile, { force: true });
    await jobs.start(request.kind, { target }, Boolean(request.retry));
    acknowledge({ ok: true });
    while (jobs.busy) await sleep(100);
  } finally {
    try {
      const owner = await readJson(ownerFile, null);
      if (owner?.pid === process.pid && owner.started === started) await fs.rm(ownerFile, { force: true });
    } finally { controlOwner?.close(); ownership.close(); }
  }
  return null;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let request;
    if (process.argv[2] === '--run') request = await new Promise((resolve, reject) => {
      process.once('message', resolve);
      process.once('disconnect', () => reject(Error('The updater request was interrupted before it was received')));
    });
    else { let input = ''; for await (const bytes of process.stdin) input += bytes; request = JSON.parse(input); }
    const result = await bootstrap(request);
    if (result !== null) process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    if (process.connected) acknowledge({ error: error.message });
    else process.stderr.write(JSON.stringify({ error: error.message }) + '\n');
    process.exitCode = 1;
  }
}
