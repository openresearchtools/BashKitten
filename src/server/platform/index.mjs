import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir, readJson } from '../common.mjs';

export const platform = process.platform === 'android' ? 'termux' : 'linux';
export const telemetryOff = Object.freeze({ PI_TELEMETRY: '0', PI_OFFLINE: '1', GH_TELEMETRY: '0', DO_NOT_TRACK: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_NO_EXTENSION_UPDATE_NOTIFIER: '1' });
Object.assign(process.env, telemetryOff);

export async function projectLocations() {
  const home = await fs.realpath(os.homedir());
  const locations = [{ path: home, label: platform === 'termux' ? 'Termux home' : 'Home', display: '~' }];
  if (platform === 'linux') {
    const configured = await readJson(path.join(dataDir, 'project-roots.json'), []);
    for (const root of configured) {
      try {
        const real = await fs.realpath(root);
        if (!locations.some(item => item.path === real)) locations.push({ path: real, label: path.basename(real), display: real });
      } catch { /* A removed drive must not break the home picker. */ }
    }
  }
  return locations;
}
