import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sourceResult, atIdle } from './runtime.mjs';

const exec = promisify(execFile);
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
export async function checkNpm() {
  return sourceResult('npm', async () => {
    let stdout;
    try { ({ stdout } = await exec('npm', ['outdated', '--global', '--json'], { timeout: 60000, maxBuffer: 1024 * 1024 })); }
    catch (error) { if (error.code !== 1 || !error.stdout) throw error; stdout = error.stdout; }
    const values = JSON.parse(stdout || '{}');
    if (values.error) throw Error(values.error.summary || 'npm update check failed');
    const packages = [];
    for (const [name, value] of Object.entries(values)) {
      if (!packageName.test(name) || !value.current || !value.latest) continue;
      // npm shipped by nodejs-lts belongs to APT. Never overwrite its files.
      if (process.platform === 'android' && value.location) {
        try { await exec('dpkg-query', ['-S', path.join(value.location, 'package.json')]); continue; }
        catch (error) { if (error.code !== 1) throw error; }
      }
      packages.push({ name, current: value.current, latest: value.latest });
    }
    return { available: packages.length, packages };
  });
}
export async function updateNpm(job) {
  await job.phase('Checking installed npm packages');
  const result = await checkNpm();
  if (result.error) throw Error(result.error);
  for (const item of result.packages) {
    if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?$/.test(item.latest)) throw Error('npm returned an invalid package version');
    await job.step('npm:' + item.name + '@' + item.latest, `Updating ${item.name} ${item.current} → ${item.latest}`, () => atIdle(job,
      () => job.exec('npm', ['install', '--global', `${item.name}@${item.latest}`, '--no-audit', '--no-fund', '--loglevel=http'])));
  }
  await job.log(result.packages.length ? 'npm package updates complete.\n' : 'Installed npm packages are up to date.\n');
  await checkNpm();
}
