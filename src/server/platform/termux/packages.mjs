import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sourceResult, checkPi, installPi, atIdle } from '../../updates/runtime.mjs';
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
export async function refreshApt(job) {
  return sourceResult('apt', async () => {
    await job.phase('Refreshing APT repositories'); await apt(job, ['update']);
    const output = await apt(job, ['-s', 'upgrade']);
    return { available: (output.match(/^Inst /gm) || []).length, summary: output.slice(-16000) };
  });
}
export async function checkPackages(job) {
  const results = [];
  if (platform === 'termux') results.push(await refreshApt(job));
  await job.phase('Checking Pi on npm'); results.push(await checkPi());
  const errors = results.filter(result => result.error);
  if (errors.length) throw Error(errors.map(result => result.error).join('; '));
}
export async function updatePackages(job) {
  requireTermux();
  await job.step('refresh-apt', 'Refreshing APT repositories', async () => {
    const result = await refreshApt(job); if (result.error) throw Error(result.error);
  });
  await job.phase('Checking Pi on npm');
  const piCheck = await checkPi();
  await job.step('apt-upgrade', 'Updating Termux packages', () => atIdle(job, async () => {
    const simulation = await apt(job, ['-s', 'full-upgrade']);
    if (/^Remv (bashkitten|nodejs-lts|termux-tools|openresearchtools-termux-keyring)(?: |:)/m.test(simulation)) throw Error('APT would remove a required suite package; inspect the transaction before proceeding');
    if (/^(Inst|Remv) bashkitten-termux-x11(?: |:)/m.test(simulation)) throw Error('X11 companion changes must be installed together with the matching viewer update');
    await apt(job, ['--download-only', '-y', 'full-upgrade']);
    await apt(job, ['-y', 'full-upgrade']);
  }, { desktop: true }));
  if (piCheck.error) throw Error('APT completed. Pi update check failed: ' + piCheck.error);
  await installPi(job);
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
  if (typeof companionVersion !== 'string' || !/^[0-9][a-zA-Z0-9.+:~\-]{0,100}$/.test(companionVersion)) throw Error('Choose an X11 release with a matching companion package');
  await job.step('x11-repo', 'Enabling the Termux X11 repository', () => apt(job, ['install', '-y', 'x11-repo']));
  await job.step('desktop-lists', 'Refreshing desktop packages', () => apt(job, ['update']));
  await job.step('desktop-packages', 'Installing XFCE and LibreOffice', async () => {
    await apt(job, ['install', '-y', 'xfce4', 'dbus', 'libreoffice', 'ttf-dejavu', 'mesa', 'mesa-demos', 'vulkan-tools', `bashkitten-termux-x11=${companionVersion}`]);
    await job.exec('apt-mark', ['hold', 'bashkitten-termux-x11']);
  });
}
