#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { requestCLI, run } from '../lib/native-cli.mjs';
await run((args, signal) => requestCLI(args, { help: 'References independent project database API (GET /projects lists Default and user-created databases; POST /projects creates one): --method GET|POST|PUT|PATCH|DELETE --path /projects/PROJECT/... [--input request.json] [--output result.json] [--overwrite] [--session CHAT]. Native file import: --path /projects/PROJECT/import --file references.ris [--encoding utf-8] [--request-id STABLE_ID]. Files stream through the existing upload owner; imports return resumable jobs.' }, signal));
