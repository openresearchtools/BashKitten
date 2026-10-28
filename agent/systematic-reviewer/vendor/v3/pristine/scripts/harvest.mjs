#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, link, copyFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HarvestError, harvestCrossref } from '../lib/harvest.mjs';

const USAGE = `Usage: node scripts/harvest.mjs --query TEXT --output FILE [options]

  --limit N       Maximum records, 1–1000 (default: 100)
  --mailto EMAIL  Optional contact address sent only to Crossref
  --overwrite     Explicitly replace the destination atomically
  --help          Show this help (no network)

JSON is saved only after the whole bounded harvest succeeds.
The output directory must already exist. Existing files are refused by default.
`;

function inputError(message) {
  return new HarvestError('INPUT', message);
}

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const values = new Map();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--query', '--output', '--limit', '--mailto', '--overwrite'].includes(flag)) {
      throw inputError('Unknown argument. Use --help for usage.');
    }
    if (values.has(flag)) throw inputError('Repeated argument. Use --help for usage.');
    if (flag === '--overwrite') {
      values.set(flag, true);
    } else {
      const value = args[++i];
      if (typeof value !== 'string' || !value || value.startsWith('--')) {
        throw inputError('An argument is missing its value. Use --help for usage.');
      }
      values.set(flag, value);
    }
  }
  if (!values.has('--query') || !values.has('--output')) throw inputError('Both --query and --output are required.');
  const limit = values.get('--limit') ?? '100';
  if (!/^[1-9]\d*$/.test(limit) || Number(limit) > 1000) throw inputError('Limit must be an integer from 1 to 1000.');
  const output = values.get('--output');
  if (output.includes('\0')) throw inputError('Invalid output path.');
  return {
    query: values.get('--query'),
    output: resolve(output),
    limit: Number(limit),
    mailto: values.get('--mailto'),
    overwrite: values.get('--overwrite') ?? false,
  };
}

function checkAbort(signal) {
  if (signal?.aborted) throw new HarvestError('ABORTED', 'Harvest cancelled; output was not published.');
}

function errorMessage(error) {
  if (error instanceof HarvestError) return error.message;
  switch (error?.code) {
    case 'EEXIST': return 'Output already exists; choose a new path or explicitly use --overwrite.';
    case 'ENOENT': return 'Output directory does not exist.';
    case 'EISDIR':
    case 'ENOTDIR': return 'Output must name a file in an existing directory.';
    case 'EACCES':
    case 'EPERM': return 'Output operation not permitted; check permissions.';
    case 'ENOSPC': return 'Insufficient space to save the output.';
    case 'ENOTSUP':
    case 'EOPNOTSUPP': return 'The output filesystem does not support the requested file operation.';
    default: return 'Harvest or output operation failed; do not use an incomplete output.';
  }
}

/** Testable CLI entry point. Dependencies never come from flags or environment. */
export async function main(args, {
  harvest = harvestCrossref,
  signal,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let temporary;
  let handle;
  let ownsTemporary = false;
  try {
    const options = parseArgs(args);
    if (options.help) {
      stdout.write(USAGE);
      return 0;
    }
    checkAbort(signal);
    if (!options.overwrite) {
      try {
        await lstat(options.output);
        throw Object.assign(new Error(), { code: 'EEXIST' });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    temporary = join(dirname(options.output), `.crossref-harvest-${randomUUID()}.tmp`);
    handle = await open(temporary, 'wx', 0o600);
    ownsTemporary = true;
    const result = await harvest({ query: options.query, limit: options.limit, mailto: options.mailto, signal });
    checkAbort(signal);
    await handle.writeFile(`${JSON.stringify(result, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    checkAbort(signal);
    if (options.overwrite) {
      await rename(temporary, options.output);
      ownsTemporary = false;
    } else {
      // Both operations refuse a concurrent destination, including a symlink.
      // Prefer atomic publication; some filesystems/Android deny hard links.
      try {
        await link(temporary, options.output);
      } catch (error) {
        if (!['EACCES', 'EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error.code)) throw error;
        await copyFile(temporary, options.output, constants.COPYFILE_EXCL);
      }
    }
    stdout.write(`Saved ${result.count} Crossref records; stop reason: ${result.stopReason}.\n`);
    return 0;
  } catch (error) {
    stderr.write(`Harvest: ${errorMessage(error)}\n`);
    return 1;
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (ownsTemporary) {
      await unlink(temporary).catch(() => {
        stderr.write('Warning: could not remove a private .crossref-harvest-*.tmp file.\n');
      });
    }
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
  } finally {
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
  }
}
