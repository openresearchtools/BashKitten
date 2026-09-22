import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sourceResult, checkPi, installPi, atIdle } from '../../updates/runtime.mjs';
import { checkNpm, updateNpm } from '../../updates/npm.mjs';
import { selectedRuntime } from '../../rpc/runtime.mjs';
import { ensureIntegration, integrationStatus, searchRuntime } from '../../rpc/integration.mjs';
import { platform } from '../index.mjs';

const exec = promisify(execFile);
const options = ['-o', 'DPkg::Lock::Timeout=300', '-o', 'Dpkg::Use-Pty=0', '-o', 'APT::Status-Fd=3', '-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold'];
const environment = { DEBIAN_FRONTEND: 'noninteractive' };
export function requireTermux() { if (platform !== 'termux') throw Error('APT package controls are available only inside Termux'); }
export async function apt(job, args) { requireTermux(); return job.exec('apt-get', [...options, ...args], { env: environment }); }
export async function packageState(names) {
  requireTermux();
  const { stdout } = await exec('dpkg-query', ['-W', '-f=${binary:Package}\t${Version}\t${db:Status-Status}\n'], { maxBuffer: 4 * 1024 * 1024 });
  return Object.fromEntries(stdout.trim().split('\n').map(line => line.split('\t')).filter(([name, , state]) => names.includes(name) && state === 'installed').map(([name, version]) => [name, version]));
}
// Explicit local inventory: no registry or repository requests.
export async function packageInventory() {
  const { stdout } = await exec('dpkg-query', ['-W', '-f=${binary:Package}\t${Version}\t${db:Status-Status}\n'], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  const apt = stdout.trim().split('\n').map(line => line.split('\t')).filter(([, , state]) => state === 'installed').map(([name, version]) => ({ name, version }));
  let npm = [], npmError;
  try {
    let output;
    try { ({ stdout: output } = await exec('npm', ['ls', '--global', '--depth=0', '--json', '--offline', '--update-notifier=false'], { timeout: 15000, maxBuffer: 1024 * 1024 })); }
    catch (error) { if (error.code !== 1 || !error.stdout) throw error; output = error.stdout; }
    const value = JSON.parse(output);
    npm = Object.entries(value.dependencies || {}).map(([name, item]) => ({ name, version: item.version || 'Unknown' }));
    npmError = value.error?.summary;
  } catch (error) { npmError = error.message; }
  return { apt, npm, npmError, pi: selectedRuntime().version, search: await searchRuntime(), browser: await integrationStatus() };
}
export async function refreshApt(job) {
  return sourceResult('apt', async () => {
    await job.phase('Refreshing APT repositories'); await apt(job, ['update']);
    const output = await apt(job, ['-s', 'upgrade']);
    const packages = [...output.matchAll(/^Inst (\S+)(?: \[([^\]]+)\])? \((\S+)/gm)].map(([, name, current, latest]) => ({ name, current: current || 'Not installed', latest }));
    return { available: packages.length, packages, summary: output.slice(-16000) };
  });
}
export async function checkPackages(job) {
  const results = [];
  if (platform === 'termux') results.push(await refreshApt(job));
  await job.phase('Checking installed npm packages'); results.push(await checkNpm());
  await job.phase('Checking Pi on npm'); results.push(await checkPi());
  const errors = results.filter(result => result.error);
  if (errors.length) throw Error(errors.map(result => result.error).join('; '));
}
export async function updatePackages(job) {
  requireTermux();
  await job.step('refresh-apt', 'Refreshing APT repositories', async () => {
    const result = await refreshApt(job); if (result.error) throw Error(result.error);
  });
  await job.step('apt-upgrade', 'Updating Termux packages', () => atIdle(job, async () => {
    const simulation = await apt(job, ['-s', 'full-upgrade']);
    if (/^Remv (bashkitten|nodejs-lts|python|termux-tools|openresearchtools-termux-keyring)(?: |:)/m.test(simulation)) throw Error('APT would remove a required BashKitten package; inspect the transaction before proceeding');
    await apt(job, ['--download-only', '-y', 'full-upgrade']);
    await apt(job, ['-y', 'full-upgrade']);
  }));
  const errors = [];
  for (const operation of [updateNpm, installPi, ensureIntegration]) { try { await operation(job); } catch (error) { if (error.code === 'CANCELLED') throw error; errors.push(error.message); } }
  if (errors.length) throw Error('APT completed. npm: ' + errors.join('; '));
  await refreshApt(job);
}
export async function recoverPackages(job) {
  requireTermux();
  await atIdle(job, async () => {
    await job.phase('Completing interrupted package configuration');
    await job.exec('dpkg', ['--force-confdef', '--force-confold', '--configure', '-a'], { env: environment });
    await apt(job, ['-f', 'install', '-y']);
  });
}
