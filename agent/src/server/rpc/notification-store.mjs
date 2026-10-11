// SPDX-License-Identifier: AGPL-3.0-only
import { readJson, writeJson, digest } from '../common.mjs';
import { claimInstance } from '../instance.mjs';

// Workers and both delivery owners can update one outbox record. The existing
// kernel-owned lock vanishes on process death and avoids stale file-lock races.
export async function updateNotification(file, change) {
  let lock;
  while (!(lock = await claimInstance('notification:' + digest(file)))) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  try {
    const current = await readJson(file, null);
    const next = await change(current);
    if (next) await writeJson(file, next);
    return next;
  } finally {
    await new Promise(resolve => lock.close(resolve));
  }
}
