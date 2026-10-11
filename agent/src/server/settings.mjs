// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { dataDir, readJson, writeJson } from './common.mjs';
import { claimInstance } from './instance.mjs';

// General settings and the private notification controller share this file.
// Serialize their read/modify/write across processes; rename alone is not a lock.
export async function updateSettings(change) {
  let lock;
  while (!(lock = await claimInstance('settings'))) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  try {
    const file = path.join(dataDir, 'settings.json');
    const next = await change(await readJson(file, {}));
    await writeJson(file, next);
    return next;
  } finally {
    await new Promise(resolve => lock.close(resolve));
  }
}
