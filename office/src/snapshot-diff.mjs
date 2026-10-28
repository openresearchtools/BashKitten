// SPDX-License-Identifier: AGPL-3.0-only
import { Worker } from 'node:worker_threads';
export function compareSnapshots(before, after, { signal, format = 'json' } = {}) {
  if (!['json', 'text'].includes(format)) throw Error('Diff format must be json or text');
  for (const snapshot of [before, after]) if (!snapshot?.path || !snapshot.documentId || !snapshot.versionId || !/^[a-f0-9]{64}$/.test(snapshot.sha256)) throw Error('An authorized immutable Office snapshot descriptor is required');
  if (before.documentId !== after.documentId) throw Error('Compare versions of the same saved Office document');
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./snapshot-diff-worker.mjs', import.meta.url), { workerData: { before, after, format }, resourceLimits: { maxOldGenerationSizeMb: 384 }, execArgv: [] });
    let done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(deadline); signal?.removeEventListener('abort', abort); worker.terminate(); error ? reject(error) : resolve(value); };
    const abort = () => finish(signal.reason || Error('Snapshot comparison cancelled'));
    const deadline = setTimeout(() => finish(Error('Snapshot comparison exceeded its bounded work budget')), 30000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', result => result.error ? finish(Error(result.error)) : finish(null, result.value));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!done) finish(Error('Snapshot comparison worker exited (' + code + ')')); });
  });
}
