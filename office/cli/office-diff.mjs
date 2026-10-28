#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { agentPackageRoot } from '../src/host-paths.mjs';
const { applicationRequest } = await import(new URL('pi/apps-channel.mjs', agentPackageRoot));
const { options, requestForSession, run } = await import(new URL('systematic-reviewer/lib/native-cli.mjs', agentPackageRoot));
await run(async (args, signal) => {
  const flags = options(args, ['--session', '--project', '--document', '--from', '--to', '--format', '--help']);
  if (flags['--help']) { console.log('office-diff --project ID --document ID --from VERSION --to VERSION --format json|text [--session SESSION]'); return; }
  for (const key of ['--project', '--document', '--from', '--to']) if (!flags[key]) throw Error(key + ' is required');
  const format = flags['--format'] || 'json';
  const reply = await applicationRequest('office', 'POST', '/snapshots/diff', { projectId: flags['--project'], documentId: flags['--document'], from: flags['--from'], to: flags['--to'], format }, { signal, request: requestForSession(flags['--session']) });
  console.log(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body, null, 2));
});
