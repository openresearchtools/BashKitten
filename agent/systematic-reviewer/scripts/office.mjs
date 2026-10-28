#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { requestCLI, run } from '../lib/native-cli.mjs';
await run((args, signal) => requestCLI(args, { component: 'office', help: 'Office API: --method POST --path /sessions --input open.json, POST /sessions/ID/commands, or DELETE /sessions/ID. [--session CHAT] [--output result.json]. Editing uses a distinct native agent view without an open editor tab; returned browser URLs are available for optional visual inspection. See the bundled office skill for commands.' }, signal));
