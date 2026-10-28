#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { requestCLI, run } from '../lib/native-cli.mjs';
await run((args, signal) => requestCLI(args, { help: 'References API: --method GET|POST|PUT|PATCH|DELETE --path /projects/PROJECT/... [--input request.json] [--output result.json] [--overwrite] [--session CHAT]. Uses the existing authorized backend; bounded pages/jobs and version preconditions follow its API.' }, signal));
