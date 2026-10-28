#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readText, writeOutput } from '../lib/io.mjs';
import { EmbeddingError, rankPapers } from '../lib/embeddings.mjs';

const USAGE = `Usage: node scripts/embeddings.mjs rank --input FILE --query TEXT
  --base-url URL --model MODEL --output FILE [options]

  --cache FILE             Reuse cache from a previous ranking JSON (or cache object)
  --document-prefix TEXT   Explicit model prefix before title + abstract (default empty)
  --query-prefix TEXT      Explicit model prefix before the query (default empty)
  --batch-size N           Maximum texts per request, 1–64 (default 8)
  --timeout-ms N           Per-request deadline, 1–120000 (default 30000)
  --overwrite              Explicitly replace an output, never the input/cache file
  --help                   Show help without network or model access

Uses the selected OpenAI-compatible /v1/embeddings endpoint. A root URL adds
/v1/embeddings; a /v1 base adds /embeddings. EMBEDDINGS_API_KEY is optional and
sent only as an Authorization header. No provider/model discovery or downloads.

Input is a record array or harvest object with records[]. Stable id, raw.title
(or title), and abstract are used. Original input is preserved under source.
Title and abstract are combined; missing fields are reported. The helper never
clips text, chooses a scientific cutoff, or excludes papers. Check the selected
model's token budget and server overflow policy; byte limits cannot prove coverage.
The research query and title/abstract text are sent to the explicitly selected
endpoint. Output includes cosine ranking, reusable vectors, and exact recipe scope.
`;

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  if (args[0] !== 'rank') throw new EmbeddingError('Choose rank, or use --help.');
  const flags = new Map();
  const allowed = ['--input', '--query', '--base-url', '--model', '--output', '--cache', '--document-prefix', '--query-prefix', '--batch-size', '--timeout-ms', '--overwrite'];
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (!allowed.includes(flag) || flags.has(flag)) throw new EmbeddingError('Unknown or repeated argument; use --help.');
    const value = flag === '--overwrite' ? true : args[++i];
    if (typeof value !== 'boolean' && (typeof value !== 'string' || value.startsWith('--') || (!value && !flag.endsWith('-prefix')))) {
      throw new EmbeddingError('Missing argument value; use --help.');
    }
    flags.set(flag, value);
  }
  for (const flag of ['--input', '--query', '--base-url', '--model', '--output']) {
    if (!flags.get(flag)) throw new EmbeddingError('Supply --input, --query, --base-url, --model, and --output.');
  }
  const number = (flag, fallback, maximum) => {
    const value = flags.get(flag) ?? String(fallback);
    if (!/^[1-9]\d*$/.test(value) || Number(value) > maximum) throw new EmbeddingError(`${flag} must be 1–${maximum}.`);
    return Number(value);
  };
  const options = {
    input: resolve(flags.get('--input')), output: resolve(flags.get('--output')),
    cacheFile: flags.has('--cache') ? resolve(flags.get('--cache')) : undefined,
    query: flags.get('--query'), baseUrl: flags.get('--base-url'), model: flags.get('--model'),
    documentPrefix: flags.get('--document-prefix') ?? '', queryPrefix: flags.get('--query-prefix') ?? '',
    batchSize: number('--batch-size', 8, 64), timeoutMs: number('--timeout-ms', 30000, 120000), overwrite: flags.has('--overwrite'),
  };
  if (options.output === options.input || options.output === options.cacheFile) throw new EmbeddingError('Choose an output separate from the input and existing cache.');
  return options;
}

async function protectSources(options) {
  let output;
  try { output = await realpath(options.output); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const source of [options.input, options.cacheFile].filter(Boolean)) {
    if (await realpath(source) === output) throw new EmbeddingError('Output resolves to the input or cache; choose a separate destination.');
  }
}

export async function main(args, { rank = rankPapers, env = process.env, signal, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const options = parseArgs(args);
    if (options.help) { stdout.write(USAGE); return 0; }
    signal?.throwIfAborted();
    if (!options.overwrite) {
      try { await lstat(options.output); throw Object.assign(new Error(), { code: 'EEXIST' }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await protectSources(options);
    let dataset, cache;
    try {
      dataset = JSON.parse(await readText(options.input, { signal }));
      if (options.cacheFile) cache = JSON.parse(await readText(options.cacheFile, { signal, maxBytes: 256 * 1024 * 1024 }));
    } catch { throw new EmbeddingError('Cannot read valid bounded JSON input/cache files; no request was made.'); }
    const result = await rank(dataset, { ...options, cache, apiKey: env.EMBEDDINGS_API_KEY || undefined, signal });
    // Compact vectors keep large reusable caches within the same bounded read budget.
    const output = `${JSON.stringify(result)}\n`;
    if (Buffer.byteLength(output) > 256 * 1024 * 1024) throw new EmbeddingError('Ranking output exceeds the 256 MiB cache limit; use a smaller corpus.');
    await protectSources(options);
    await writeOutput(options.output, output, { overwrite: options.overwrite, signal });
    stdout.write(`Ranked ${result.ranking.length} papers by cosine similarity; no exclusions. Embedded ${result.provenance.embeddedCount} texts; reused ${result.provenance.reusedCount}.\n`);
    return 0;
  } catch (error) {
    const message = signal?.aborted ? 'Ranking cancelled; output was not published.'
      : error?.code === 'EEXIST' ? 'Output exists; use a new path or --overwrite.'
      : error instanceof EmbeddingError ? error.message : 'Ranking or output failed; private details were not logged.';
    stderr.write(`Embeddings: ${message}\n`);
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
