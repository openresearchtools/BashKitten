import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sourceResult, checkPi, installPi, atIdle } from '../../updates/runtime.mjs';
import { checkNpm, updateNpm } from '../../updates/npm.mjs';
import path from 'node:path';
import { dataDir, readJson, writeJson } from '../../common.mjs';
import { selectedRuntime } from '../../rpc/runtime.mjs';
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
  requireTermux();
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
  return { apt, npm, npmError, pi: selectedRuntime().version };
}
const sourceFile = path.join(dataDir, 'termux.json');
export async function termuxSource() { return (await readJson(sourceFile, {})).source || 'suite'; }
export async function configureTermux({ source }) {
  requireTermux();
  if (!['suite', 'external'].includes(source)) throw Error('Unknown Termux source');
  await writeJson(sourceFile, { source });
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
    if (/^Remv (bashkitten|nodejs-lts|termux-tools|openresearchtools-termux-keyring)(?: |:)/m.test(simulation)) throw Error('APT would remove a required suite package; inspect the transaction before proceeding');
    if (/^(Inst|Remv) bashkitten-termux-x11(?: |:)/m.test(simulation)) throw Error('X11 companion changes must be installed together with the matching viewer update');
    await apt(job, ['--download-only', '-y', 'full-upgrade']);
    await apt(job, ['-y', 'full-upgrade']);
  }, { desktop: true }));
  const errors = [];
  for (const operation of [updateNpm, installPi]) { try { await operation(job); } catch (error) { if (error.code === 'CANCELLED') throw error; errors.push(error.message); } }
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
export async function desktopPackages(job, { companionVersion } = {}) {
  requireTermux();
  const external = await termuxSource() === 'external';
  if (!external && (typeof companionVersion !== 'string' || !/^[0-9][a-zA-Z0-9.+:~\-]{0,100}$/.test(companionVersion))) throw Error('Choose an X11 release with a matching companion package');
  await job.step('x11-repo', 'Enabling the Termux X11 repository', () => apt(job, ['install', '-y', 'x11-repo']));
  await job.step('desktop-lists', 'Refreshing desktop packages', () => apt(job, ['update']));
  await job.step('desktop-packages', 'Installing XFCE and LibreOffice', async () => {
    await apt(job, ['install', '-y', '--no-install-recommends', '--allow-change-held-packages', 'xfce4', 'gtk3', 'dbus', 'libreoffice', 'ttf-dejavu', 'mesa', 'mesa-demos', 'vulkan-tools', external ? 'termux-x11-nightly' : `bashkitten-termux-x11=${companionVersion}`]);
    if (!external) await job.exec('apt-mark', ['hold', 'bashkitten-termux-x11']);
  });
}
export async function pairX11(job, companionVersion) {
  requireTermux();
  if (await termuxSource() === 'external') throw Error('Install X11 and its companion from the same source as your Termux');
  if (!/^[0-9][a-zA-Z0-9.+:~\-]{0,100}$/.test(companionVersion || '')) throw Error('The viewer update is missing its exact X11 companion version');
  const versions = await packageState(['bashkitten-termux-x11']);
  // Installing the viewer alone does not opt a user into the desktop bundle.
  if (!versions['bashkitten-termux-x11']) return;
  if (versions['bashkitten-termux-x11'] !== companionVersion) {
    await job.phase('Refreshing the paired X11 companion'); await apt(job, ['update']);
    const args = ['install', '-y', '--allow-change-held-packages', '--allow-downgrades', `bashkitten-termux-x11=${companionVersion}`];
    const plan = await apt(job, ['-s', ...args]);
    if (/^Remv /m.test(plan)) throw Error('The paired companion would remove installed packages; inspect the package output');
    await job.phase('Downloading the paired X11 companion'); await apt(job, ['--download-only', ...args]);
    await job.phase('Installing the paired X11 companion'); await apt(job, args);
  }
  await job.exec('apt-mark', ['hold', 'bashkitten-termux-x11']);
  if ((await packageState(['bashkitten-termux-x11']))['bashkitten-termux-x11'] !== companionVersion) throw Error('The X11 companion did not reach the viewer’s required version');
}
