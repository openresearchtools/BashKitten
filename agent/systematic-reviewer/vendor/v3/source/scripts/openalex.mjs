#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lstat } from 'node:fs/promises';
import { harvestOpenAlex, createZoteroAbstractLookup } from '../lib/openalex.mjs';
import { ZoteroClient, ZoteroError } from '../lib/zotero.mjs';
import { MetadataError } from '../lib/metadata-http.mjs';
import { writeOutput } from '../lib/io.mjs';
import { serviceKey, ConfigError } from '../lib/services.mjs';

const USAGE = `Usage: node scripts/openalex.mjs --output FILE [options]

  --query TEXT            OpenAlex search, supplied by the researcher
  --filter EXPRESSION     Native OpenAlex filter; query or filter is required
  --sort EXPRESSION       Optional native OpenAlex sort; otherwise API default
  --limit N               Maximum records, 1–1000 (default 100)
  --page-size N           Records per request, 1–100 (default 100)
  --enrich-zotero local   Read existing items from the running Zotero app
  --library LIBRARY       Explicit users/ID or groups/ID for enrichment;
                          users/0 routes to the running local main library
  --overwrite            Explicitly replace the output file
  --help                 Show help without network access

An OpenAlex key is optional for the first page and required to follow cursors.
Configure it with /review-setup in Pi or node scripts/setup.mjs set openalex.
The saved OpenAlex key is reused; OPENALEX_API_KEY overrides it.
Zotero needs no key. ZOTERO_LOCAL_URL can set
an alternative loopback /api/ address for local reads. Keys stay out of results.
No imports or library writes. The complete bounded result is saved as JSON,
including original metadata, reconstructed abstracts, and source provenance.
Malformed abstracts retain their raw metadata and an explicit issue; the other
records continue. The final summary warns when abstracts could not be decoded.
`;

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--output', '--query', '--filter', '--sort', '--limit', '--page-size', '--enrich-zotero', '--library', '--overwrite'].includes(flag) || flags.has(flag)) {
      throw new MetadataError('Unknown or repeated argument; use --help.');
    }
    const value = flag === '--overwrite' ? true : args[++i];
    if (!value || (typeof value === 'string' && value.startsWith('--'))) throw new MetadataError('Missing argument value; use --help.');
    flags.set(flag, value);
  }
  if (!flags.get('--output') || (!flags.get('--query') && !flags.get('--filter'))) throw new MetadataError('Supply --output and at least one of --query or --filter.');
  const mode = flags.get('--enrich-zotero');
  const library = flags.get('--library');
  if ((mode && (mode !== 'local' || !library)) || (!mode && library)) throw new MetadataError('Enrichment requires --enrich-zotero local and --library together.');
  const number = (flag, fallback, maximum) => {
    const value = flags.get(flag) ?? String(fallback);
    if (!/^[1-9]\d*$/.test(value) || Number(value) > maximum) throw new MetadataError(`${flag} must be 1–${maximum}.`);
    return Number(value);
  };
  return {
    output: resolve(flags.get('--output')), overwrite: flags.get('--overwrite') ?? false,
    query: flags.get('--query') ?? '', filter: flags.get('--filter') ?? '', sort: flags.get('--sort') ?? '',
    limit: number('--limit', 100, 1000), pageSize: number('--page-size', 100, 100), mode, library,
  };
}

export async function main(args, { harvest = harvestOpenAlex, env = process.env, signal, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const options = parseArgs(args);
    if (options.help) { stdout.write(USAGE); return 0; }
    signal?.throwIfAborted();
    if (!options.overwrite) {
      try { await lstat(options.output); throw Object.assign(new Error(), { code: 'EEXIST' }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const lookupZotero = options.mode ? createZoteroAbstractLookup(new ZoteroClient({
      localUrl: env.ZOTERO_LOCAL_URL,
    }), { library: options.library }) : undefined;
    const result = await harvest({
      query: options.query, filter: options.filter, sort: options.sort, limit: options.limit,
      pageSize: options.pageSize, apiKey: await serviceKey('openalex', { env }), lookupZotero, signal,
    });
    await writeOutput(options.output, `${JSON.stringify(result, null, 2)}\n`, { overwrite: options.overwrite, signal });
    stdout.write(`Saved ${result.count} OpenAlex records; stop reason: ${result.stopReason}.\n`);
    const count = result.warnings?.malformedAbstracts;
    if (count) stderr.write(`Warning: ${count} OpenAlex abstract${count === 1 ? '' : 's'} could not be reconstructed; raw metadata and reasons were preserved.\n`);
    return 0;
  } catch (error) {
    const message = signal?.aborted ? 'Operation cancelled; output was not published.'
      : error?.code === 'EEXIST' ? 'Output exists; use a new path or --overwrite.'
      : error instanceof MetadataError || error instanceof ZoteroError || error instanceof ConfigError ? error.message
      : 'OpenAlex harvest or output failed; output was not published.';
    stderr.write(`OpenAlex: ${message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController();
  let interrupted = 0;
  const onInt = () => { interrupted = 130; controller.abort(); };
  const onTerm = () => { interrupted = 143; controller.abort(); };
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  try {
    const status = await main(process.argv.slice(2), { signal: controller.signal });
    process.exitCode = interrupted || status;
  }
  finally { process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm); }
}
