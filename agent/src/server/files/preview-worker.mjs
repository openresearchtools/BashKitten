// SPDX-License-Identifier: AGPL-3.0-only
// Parsing and office conversion run outside the HTTP process. The existing
// runtime guard owns this worker and every converter descendant through exit.
import fs from 'node:fs/promises';
import { constants, readFileSync, closeSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { withManagerContext, authorizeManagerPath, canonicalManagerPath } from './access.mjs';
import { containsPath } from './files.mjs';
import { decodePreviewText, previewKind } from './preview-types.mjs';
import { renderPreview } from './preview-render.mjs';

process.umask(0o077);
const abort = new AbortController();
process.on('SIGTERM', () => abort.abort());
process.on('SIGINT', () => abort.abort());

async function snapshot(job) {
  await authorizeManagerPath(job.file);
  const handle = await fs.open(job.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const input = path.join(job.directory, 'input' + path.extname(job.name));
  let output;
  try {
    const descriptor = '/proc/self/fd/' + handle.fd;
    await authorizeManagerPath(descriptor);
    const real = canonicalManagerPath(await fs.realpath(descriptor));
    if (!containsPath(job.scopeRoot, real)) throw Error('Path leaves the available files');
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw Error('Choose a regular file');
    output = await fs.open(input, 'wx', 0o600);
    await pipeline(handle.createReadStream({ autoClose: false }), output.createWriteStream({ autoClose: false }), { signal: abort.signal });
    const after = await handle.stat({ bigint: true });
    if (before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.size !== after.size) throw Error('The file changed while opening; choose View again');
    await authorizeManagerPath(descriptor);
    // Classification is repeated against the private snapshot, not a path that
    // another process could exchange while the background request was starting.
    return input;
  } finally { await handle.close(); await output?.close(); }
}

async function officePDF(job, input) {
  const profile = path.join(job.directory, 'office-profile'), temporary = path.join(job.directory, 'tmp');
  await fs.mkdir(path.join(profile, 'user'), { recursive: true, mode: 0o700 });
  await fs.mkdir(temporary, { mode: 0o700 });
  // Headless is not a macro policy. Use an isolated profile with macros, OLE,
  // DDE and untrusted external links disabled, never the user's office profile.
  const properties = { DisableMacrosExecution: true, DisableActiveContent: true,
    BlockUntrustedRefererLinks: true, DisablePythonRuntime: true, DisableOLEAutomation: true, MacroSecurityLevel: 3 };
  const values = Object.entries(properties).map(([name, value]) => '<prop oor:name="' + name + '" oor:op="fuse"><value>' + value + '</value></prop>').join('');
  await fs.writeFile(path.join(profile, 'user/registrymodifications.xcu'),
    '<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting">' + values + '<prop oor:name="SecureURL" oor:op="fuse"><value/></prop></item></oor:items>', { mode: 0o600 });
  const executable = process.env.BASHKITTEN_TERMUX === '1' ? '/data/data/com.termux/files/usr/bin/libreoffice' : '/usr/bin/libreoffice';
  try { await fs.access(executable, constants.X_OK); }
  catch { throw Error('LibreOffice is not installed on this host. Install the declared BashKitten package dependencies to preview office files.'); }
  const args = ['-env:UserInstallation=' + pathToFileURL(profile).href, '--headless', '--nologo', '--nodefault', '--norestore', '--nofirststartwizard', '--convert-to', 'pdf', '--outdir', job.directory, input];
  // Do not pass Agent tokens, provider credentials, custom loader settings or
  // the user's office/Python profile to the document converter.
  const prefix = process.env.BASHKITTEN_TERMUX === '1' ? '/data/data/com.termux/files/usr' : '/usr';
  const child = spawn(executable, args, { cwd: job.directory, stdio: ['ignore', 'ignore', 'pipe'],
    env: { PATH: prefix + '/bin:/bin', PREFIX: prefix, HOME: profile, TMPDIR: temporary,
      XDG_CACHE_HOME: path.join(profile, 'cache'), XDG_CONFIG_HOME: path.join(profile, 'config'),
      XDG_DATA_HOME: path.join(profile, 'data'), SAL_USE_VCLPLUGIN: 'svp', LANG: 'C.UTF-8' } });
  let errorText = '', failure;
  const cancel = () => child.kill('SIGTERM');
  abort.signal.addEventListener('abort', cancel, { once: true });
  if (abort.signal.aborted) cancel();
  child.stderr.on('data', bytes => { errorText = (errorText + bytes.toString('utf8')).slice(-2000); });
  child.once('error', error => { failure = error; });
  try {
    const code = await new Promise(resolve => child.once('close', resolve));
    abort.signal.throwIfAborted();
    if (failure || code !== 0) throw Error(failure?.message || 'LibreOffice could not convert this document' + (errorText.trim() ? ': ' + errorText.trim() : ''));
    const converted = path.join(job.directory, 'input.pdf');
    const handle = await fs.open(converted, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => { throw Error('LibreOffice did not produce a PDF. The document may be unsupported, damaged or password-protected.'); });
    try {
      const bytes = Buffer.alloc(5); await handle.read(bytes, 0, bytes.length, 0);
      if (bytes.toString('ascii') !== '%PDF-') throw Error('LibreOffice returned an invalid PDF');
    } finally { await handle.close(); }
    await fs.rename(converted, job.output);
  } finally { abort.signal.removeEventListener('abort', cancel); }
}

async function run(job) {
  const input = await snapshot(job);
  try {
    abort.signal.throwIfAborted();
    // The snapshot is private generated data. The original descriptor was
    // checked in the remote manager context both before and after copying.
    const kind = await withManagerContext({ remote: false, signal: abort.signal }, () => previewKind(input, job.name));
    if (kind !== job.kind) throw Error('The file type changed; choose View again');
    if (kind === 'office') await officePDF(job, input);
    else if (kind === 'pdf' || kind === 'image') await fs.rename(input, job.output);
    else if (kind === 'sheet') {
      const { default: XLSX } = await import('xlsx');
      const workbook = XLSX.read(await fs.readFile(input), { type: 'buffer', dense: true, cellHTML: false, cellText: true, bookVBA: false });
      abort.signal.throwIfAborted();
      await renderPreview({ kind, name: job.name, workbook }, job.output);
    } else {
      const text = decodePreviewText(await fs.readFile(input));
      if (text === null) throw Error('This file is not supported text; use Download');
      await renderPreview({ kind, name: job.name, text }, job.output);
    }
    abort.signal.throwIfAborted();
  } finally {
    await fs.rm(input, { force: true });
    await fs.rm(path.join(job.directory, 'office-profile'), { recursive: true, force: true });
    await fs.rm(path.join(job.directory, 'tmp'), { recursive: true, force: true });
  }
}

try {
  if (process.argv.at(-1) !== 'serve' || process.env.BASHKITTEN_GUARDED !== '1' || Number(process.env.BASHKITTEN_GUARD_PID) !== process.ppid) throw Error('Private preview worker only');
  const bytes = readFileSync(3); closeSync(3);
  let job;
  try { job = JSON.parse(bytes.toString('utf8')); } finally { bytes.fill(0); }
  await withManagerContext({ remote: job.remote === true, signal: abort.signal }, () => run(job));
  process.stdout.write(JSON.stringify({ status: 'ready' }));
} catch (error) {
  process.stdout.write(JSON.stringify({ status: 'failed', error: abort.signal.aborted ? 'Preview cancelled' : String(error.message).slice(0, 1000) }));
  process.exitCode = 1;
}
