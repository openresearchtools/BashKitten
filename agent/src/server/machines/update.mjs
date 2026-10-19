// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson } from '../common.mjs';
import { packageRoot } from './config.mjs';

// A package update must not turn a persistent desktop's lifetime into the
// browser's lifetime. The old owner keeps serving these paths until it is idle.
export const duringUpdate = new Set(['status','list','get','operation','activations','cancel','stop','endpoint','display','display-stop','clipboard','guest-control','media-devices','autostart-status']);
export const mutations = new Set(['create','save','startup','start','stop','restart','retry','delete','autostart-save','display-start','display-stop']);
export const updateMessage = 'BashKitten has been updated. Let current container operations finish and stop running containers to load the updated container service.';

export async function runtimeVersion(running = false) {
  const manifest = await readJson(path.join(packageRoot, '..', 'build-platform.json'), null);
  const installed = manifest?.installationStamp ? await readJson(manifest.installationStamp, null) : manifest;
  const node = await fs.stat(running ? '/proc/self/exe' : process.execPath);
  return { revision: installed?.revision || null, node: `${node.dev}:${node.ino}` };
}
export const sameRuntime = (a, b) => a?.revision === b?.revision && a?.node === b?.node;
export const updateError = message => Object.assign(Error(message), { code: 'MACHINE_UPDATE_PENDING' });
