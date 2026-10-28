#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { requestCLI, run } from '../lib/native-cli.mjs';
await run((args, signal) => requestCLI(args, { method: 'POST', path: '/crossref/search', project: true,
  help: 'Crossref harvest --project PROJECT --input request.json [--output result.json] [--overwrite] [--session CHAT]. Request specifies query, explicit result limit and optional cursor; shared References owns contact settings, provenance and pacing. Search does not imply import or full-text retrieval.' }, signal));
