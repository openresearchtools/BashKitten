#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { resolve } from 'node:path';
import { renderDocument } from '../lib/citations.mjs';
import { readText, writeOutput } from '../lib/io.mjs';
import { options, inputFile, requestForSession, run } from '../lib/native-cli.mjs';
await run(async (args, signal) => {
  if (args[0] === 'render') args.shift();
  const flags = options(args, ['--project', '--input', '--output', '--references', '--style', '--locale', '--session', '--overwrite', '--help']);
  if (flags['--help']) { process.stdout.write('Render: --project PROJECT --input manuscript.md --output rendered.md [--references snapshot.json] [--style ID] [--locale en-US] [--overwrite] [--session CHAT]. Renders the whole document through shared References CSL; preserves marker identities.\n'); return; }
  if (!flags['--input'] || !flags['--output']) throw Error('--input and --output are required');
  const output = resolve(flags['--output']);
  if (flags['--references'] && output === resolve(flags['--references'])) throw Error('Output must not replace its reference snapshot');
  const rendered = await renderDocument(await readText(resolve(flags['--input']), { signal }), await inputFile(flags['--references'], signal), {
    projectId: flags['--project'], style: flags['--style'], locale: flags['--locale'], signal, request: requestForSession(flags['--session']),
  });
  await writeOutput(output, rendered.markdown, { overwrite: flags['--overwrite'], signal });
  process.stdout.write(`${JSON.stringify({ path: output, citations: rendered.citations.length, style: rendered.style })}\n`);
});
