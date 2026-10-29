#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { requestCLI, run } from '../lib/native-cli.mjs';
await run((args, signal) => {
  const operation = args[0] === '--help' ? 'search' : args.shift();
  if (!['search', 'import'].includes(operation)) throw Error('Choose search or import, or --help');
  return requestCLI(args, { method: 'POST', path: `/openalex/${operation}`, project: true,
    help: 'OpenAlex search|import --project PROJECT --input request.json [--output result.json] [--overwrite] [--session CHAT]. Search uses explicit bounded filters/pages; import fixes its References project database and returns a cancellable job. Shared References owns keys, strict identity/abstract validation and resolver pacing.' }, signal);
});
