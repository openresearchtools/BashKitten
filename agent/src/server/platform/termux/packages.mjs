import { npmCommand, npmArgs } from '../../node-runtime.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { selectedRuntime } from '../../rpc/runtime.mjs';
import { integrationStatus, searchRuntime } from '../../rpc/integration.mjs';
import { platform } from '../index.mjs';

const exec = promisify(execFile);
const options = ['-o', 'DPkg::Lock::Timeout=300', '-o', 'Dpkg::Use-Pty=0', '-o', 'APT::Status-Fd=3', '-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold'];
const environment = { DEBIAN_FRONTEND: 'noninteractive' };
export function requireTermux() { if (platform !== 'termux') throw Error('APT package controls are available only inside Termux'); }
export async function apt(job, args) { requireTermux(); return job.exec('apt-get', [...options, ...args], { env: environment }); }
export async function packageState(names) {
  requireTermux();
  const { stdout } = await exec('dpkg-query', ['-W', '-f=${binary:Package}\t${Version}\t${db:Status-Status}\n'], { maxBuffer: Infinity });
  return Object.fromEntries(stdout.trim().split('\n').map(line => line.split('\t')).filter(([name, , state]) => names.includes(name) && state === 'installed').map(([name, version]) => [name, version]));
}
// Explicit local inventory: no registry or repository requests.
export async function packageInventory() {
  requireTermux();
  const { stdout } = await exec('dpkg-query', ['-W', '-f=${binary:Package}\t${Version}\t${db:Status-Status}\n'], { timeout: 15000, maxBuffer: Infinity });
  const apt = stdout.trim().split('\n').map(line => line.split('\t')).filter(([, , state]) => state === 'installed').map(([name, version]) => ({ name, version }));
  let npm = [], npmError;
  try {
    let output;
    try { ({ stdout: output } = await exec(npmCommand, npmArgs(['ls', '--global', '--depth=0', '--json', '--offline', '--update-notifier=false']), { timeout: 15000, maxBuffer: Infinity })); }
    catch (error) { if (error.code !== 1 || !error.stdout) throw error; output = error.stdout; }
    const value = JSON.parse(output);
    npm = Object.entries(value.dependencies || {}).map(([name, item]) => ({ name, version: item.version || 'Unknown' }));
    npmError = value.error?.summary;
  } catch (error) { npmError = error.message; }
  return { apt, npm, npmError, pi: selectedRuntime().version, search: await searchRuntime(), browser: await integrationStatus() };
}
