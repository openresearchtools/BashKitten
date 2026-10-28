#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ZoteroClient, ZoteroError } from '../lib/zotero.mjs';
import { connectorTarget, importDois, importIdentifier, ZoteroImportError } from '../lib/zotero-import.mjs';
import { resolveIdentifiers } from '../lib/identifiers.mjs';
import { listAttachments, attachmentText } from '../lib/zotero-attachments.mjs';
import { writeOutput } from '../lib/io.mjs';

const USAGE = `Usage: node scripts/zotero.mjs COMMAND [options]

  search      [--query TEXT] [--library users/0] [--limit 25] [--start 0]
  snapshot    --id users/123/items/ABCD2345 [--id ...]
  attachments --id PARENT_ID [--limit 100] [--start 0]
  attachment-text --id ATTACHMENT_ID
  target      Show Zotero's current import destination (read-only)
  resolve     --identifier DOI|PMID|PMCID|arXiv|ISBN [--identifier ...]
  import      --identifier IDENTIFIER --expect-target L1
  import-doi  --doi 10.1234/example [--doi ...] --expect-target L1

All commands emit JSON to stdout, or --output FILE (--overwrite is explicit).
Zotero reads and writes use the running local application; no API key is needed.
Local options: --local-url http://127.0.0.1:23119/api/
               (defaults to ZOTERO_LOCAL_URL when set)
--help performs no network or file operations.

import-doi WRITES to the running Zotero application's selected library/collection
using its Connector HTTP API and Crossref RIS metadata (1–20 Crossref DOIs).
Run target first and pass the reported L... or C... value to --expect-target.
Keep Zotero's selection unchanged during import; the guard is not an atomic lock.
No attachments or PDFs are downloaded. Imports can create duplicates. Writes
are never retried automatically; after any write failure, inspect Zotero first.
Search/snapshot then provides canonical citation identities from the read API.
attachments lists one page under a verified parent. attachment-text retrieves
Zotero's cached text with page/character indexing coverage; missing or partial
text is explicit. Neither command downloads, copies, or indexes an attachment.

resolve normalizes native Zotero identifiers and converts PMCID to PMID via PMC,
retaining DOI and provenance when available. It does not fetch article metadata.
Use prefixes for clarity (PMID:100, PMCID:PMC2707599, arXiv:1706.03762, ISBN:...).
import handles one DOI, PMID, PMCID, or unversioned arXiv ID through Crossref RIS,
PubMed article XML, or arXiv BibTeX. It needs the same selected-target guard.
ISBN, PubMed books, and versioned arXiv require Zotero's native Add by Identifier;
the helper refuses those imports explicitly. --mailto EMAIL optionally identifies
the caller to PMC conversion. resolve performs no Zotero writes.
`;
const input = message => new ZoteroImportError(message);

function parse(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const command = args[0];
  const allowed = {
    search: ['--query', '--library', '--limit', '--start'],
    snapshot: ['--id'], target: [], 'import-doi': ['--doi', '--expect-target'],
    attachments: ['--id', '--limit', '--start'], 'attachment-text': ['--id'],
    resolve: ['--identifier', '--mailto'], import: ['--identifier', '--expect-target', '--mailto'],
  }[command];
  if (!allowed) throw input('Unknown command; see --help for reference, attachment, and import commands.');
  const values = new Map();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (![...allowed, '--local-url', '--output', '--overwrite'].includes(flag)) throw input('Unknown argument; see --help.');
    const repeatable = ['--doi', ...(command === 'snapshot' ? ['--id'] : []), ...(command === 'resolve' ? ['--identifier'] : [])].includes(flag);
    if (values.has(flag) && !repeatable) throw input('Repeated argument; see --help.');
    const value = flag === '--overwrite' ? true : args[++i];
    if (value !== true && (typeof value !== 'string' || !value || value.startsWith('--') || value.includes('\0'))) throw input('Missing or invalid argument value.');
    if (repeatable) values.set(flag, [...values.get(flag) ?? [], value]);
    else values.set(flag, value);
  }
  if (values.has('--overwrite') && !values.has('--output')) throw input('--overwrite requires --output.');
  for (const [flag, min, max] of [['--limit', 1, 100], ['--start', 0, Number.MAX_SAFE_INTEGER]]) {
    if (values.has(flag) && (!/^\d+$/.test(values.get(flag)) || Number(values.get(flag)) < min || Number(values.get(flag)) > max)) throw input(`${flag} must be an integer from ${min} to ${max}.`);
  }
  return { command, values };
}

/** Injectable entry point; outputs use the shared no-clobber writer. */
export async function main(args, { signal, stdout = process.stdout, stderr = process.stderr, env = process.env,
  createClient = options => new ZoteroClient(options), target = connectorTarget, importItems = importDois,
  resolveIds = resolveIdentifiers, importOne = importIdentifier,
  attachments = listAttachments, textAttachment = attachmentText } = {}) {
  let attemptedWrite = false;
  try {
    const options = parse(args);
    if (options.help) { stdout.write(USAGE); return 0; }
    signal?.throwIfAborted();
    const { command, values } = options;
    const output = values.get('--output');
    const overwrite = values.get('--overwrite') ?? false;
    if (output && !overwrite) {
      try { await lstat(output); throw Object.assign(new Error(), { code: 'EEXIST' }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const local = { localUrl: values.get('--local-url') ?? env.ZOTERO_LOCAL_URL, signal };
    let result;
    if (command === 'target') result = await target(local);
    else if (command === 'resolve') result = await resolveIds({ identifiers: values.get('--identifier'), signal, mailto: values.get('--mailto') });
    else if (command === 'import') {
      attemptedWrite = true;
      result = await importOne({ ...local, identifier: values.get('--identifier'), expectedTarget: values.get('--expect-target'), mailto: values.get('--mailto') });
    }
    else if (command === 'import-doi') {
      attemptedWrite = true;
      result = await importItems({ ...local, dois: values.get('--doi'), expectedTarget: values.get('--expect-target') });
    } else {
      const client = createClient({ localUrl: local.localUrl });
      if (command === 'attachments') result = await attachments({ id: values.get('--id'), limit: Number(values.get('--limit') ?? 100), start: Number(values.get('--start') ?? 0), signal }, { client });
      else if (command === 'attachment-text') result = await textAttachment({ id: values.get('--id'), signal }, { client });
      else result = command === 'snapshot' ? await client.snapshot(values.get('--id'), { signal }) : await client.search({
        library: values.get('--library') ?? 'users/0', query: values.get('--query') ?? '',
        limit: Number(values.get('--limit') ?? 25), start: Number(values.get('--start') ?? 0), signal,
      });
    }
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (output) await writeOutput(output, serialized, { overwrite, signal });
    else stdout.write(serialized);
    return 0;
  } catch (error) {
    // Never echo an unknown transport error, URL, credential, or raw response.
    const message = error instanceof ZoteroImportError || error instanceof ZoteroError ? error.message : error?.code === 'EEXIST'
      ? 'Output already exists; choose another path or use --overwrite.' : signal?.aborted
        ? 'Operation cancelled.' : 'Operation failed; check arguments, API access, and output permissions.';
    stderr.write(`Zotero: ${message}${attemptedWrite && !(error instanceof ZoteroImportError) ? ' Items may already be saved; inspect Zotero before retrying.' : ''}\n`);
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
  try { process.exitCode = await main(process.argv.slice(2), { signal: controller.signal }); }
  finally {
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
    if (interrupted) process.exitCode = interrupted;
  }
}
