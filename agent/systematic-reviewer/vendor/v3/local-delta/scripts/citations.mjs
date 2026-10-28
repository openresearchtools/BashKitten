#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderDocument } from '../lib/citations.mjs';
import { scanDocument } from '../lib/markdown.mjs';
import { readText, writeOutput } from '../lib/io.mjs';
import { ZoteroClient, ZoteroError } from '../lib/zotero.mjs';

const USAGE = `Usage: node scripts/citations.mjs render --input MANUSCRIPT.md
       (--references SNAPSHOT.json | --zotero local)
       (--in-place | --output NEW.md) [--style STYLE.csl]

Refresh citation labels and an existing bibliography block from stable Zotero
identities. Add [cite](sr-cite:users/123/items/ABCD2345), using a verified ID;
the helper replaces only its visible label, retaining the identity and locators.
Ordinary brackets, unrelated links and code examples are left alone.

--references reads an offline snapshot; --zotero local explicitly fetches all
cited items from the running Zotero application into memory. No separate snapshot file
is required or written. Local Zotero needs no key and uses --local-url or
ZOTERO_LOCAL_URL when set.
The default local endpoint is http://127.0.0.1:23119/api/.
--style reads a local independent in-text CSL style; en-US is bundled.

--output never replaces an existing file. --in-place explicitly replaces the
manuscript after successful rendering, checking for edits during retrieval.
This check is not a lock against concurrent editors; save edits before running.
--help performs no network or file operations.
`;

class CitationCliError extends Error {}
const invalid = message => new CitationCliError(message);

function parse(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  if (args[0] !== 'render') throw invalid('Choose render; see --help.');
  const values = new Map();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (!['--input', '--references', '--zotero', '--in-place', '--output', '--style', '--local-url'].includes(flag)) throw invalid('Unknown argument; see --help.');
    if (values.has(flag)) throw invalid('Repeated argument; see --help.');
    const value = flag === '--in-place' ? true : args[++i];
    if (value !== true && (typeof value !== 'string' || !value || value.startsWith('--') || value.includes('\0'))) throw invalid('Missing or invalid argument value.');
    values.set(flag, value);
  }
  if (!values.has('--input')) throw invalid('--input is required.');
  if (values.has('--references') === values.has('--zotero')) throw invalid('Choose exactly one of --references or --zotero.');
  if (values.has('--in-place') === values.has('--output')) throw invalid('Choose exactly one of --in-place or --output.');
  if (values.has('--zotero') && values.get('--zotero') !== 'local') throw invalid('--zotero must be local; use the running Zotero application.');
  if (values.has('--local-url') && values.get('--zotero') !== 'local') throw invalid('--local-url requires --zotero local.');
  return { values };
}

/** Explicit CLI adapter; rendering remains offline and independent of Pi. */
export async function main(args, { signal, stdout = process.stdout, stderr = process.stderr, env = process.env,
  createClient = options => new ZoteroClient(options) } = {}) {
  let stage = 'Read failed; check input files and permissions.';
  try {
    const options = parse(args);
    if (options.help) { stdout.write(USAGE); return 0; }
    signal?.throwIfAborted();
    const { values } = options;
    const source = values.get('--input');
    const inPlace = values.has('--in-place');
    const destination = inPlace ? source : values.get('--output');
    const initial = await lstat(source);
    if (inPlace && !initial.isFile()) throw invalid('--in-place requires a regular manuscript file, not a symbolic link.');
    if (inPlace) {
      const sourcePath = await realpath(source);
      for (const flag of ['--references', '--style']) {
        if (values.has(flag) && await realpath(values.get(flag)) === sourcePath) throw invalid('The manuscript must be separate from its references and CSL style.');
      }
    } else {
      try { await lstat(destination); throw Object.assign(new Error(), { code: 'EEXIST' }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const markdown = await readText(source, { signal });
    stage = 'Invalid citation or bibliography markup; check sr-cite markers and their library-qualified IDs.';
    const document = scanDocument(markdown);
    const ids = [...new Set(document.citations.flatMap(citation => citation.cluster.items.map(item => item.id)))];
    stage = 'Cannot read the reference snapshot or CSL style; check file contents and permissions.';
    const styleXml = values.has('--style') ? await readText(values.get('--style'), { signal }) : undefined;
    let snapshot;
    if (values.has('--references')) snapshot = JSON.parse(await readText(values.get('--references'), { signal }));
    else {
      const client = ids.length ? createClient({ localUrl: values.get('--local-url') ?? env.ZOTERO_LOCAL_URL }) : null;
      snapshot = { version: 1, items: [] };
      stage = 'Zotero retrieval failed; check API access. The manuscript was not changed.';
      for (let start = 0; start < ids.length; start += 100) {
        signal?.throwIfAborted();
        const batch = await client.snapshot(ids.slice(start, start + 100), { signal });
        snapshot.items.push(...batch.items);
      }
    }
    signal?.throwIfAborted();
    stage = 'Rendering failed; verify all cited items are present, the reference metadata, and any supplied CSL style.';
    const rendered = renderDocument(markdown, snapshot, { styleXml });
    stage = 'Cannot save the manuscript; check output permissions.';
    if (inPlace) {
      const current = await lstat(source);
      if (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(key => current[key] !== initial[key])
          || await readText(source, { signal }) !== markdown) {
        throw invalid('The manuscript changed during rendering; no output was written. Run again after saving your edits.');
      }
    }
    await writeOutput(destination, rendered.markdown, { overwrite: inPlace, signal });
    return 0;
  } catch (error) {
    const message = signal?.aborted ? 'Operation cancelled.' : error instanceof CitationCliError || error instanceof ZoteroError
      ? error.message : error?.code === 'EEXIST' ? 'Output already exists; choose a new path or use --in-place for the manuscript.' : stage;
    stderr.write(`Citations: ${message}\n`);
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
