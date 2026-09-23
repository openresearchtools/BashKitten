import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const DIFF_OPTIONS = ['--no-ext-diff', '--no-textconv', '--no-color', '--find-renames=50%', '--submodule=short'];
const inside = (root, file) => { const rel = path.relative(root, file); return rel !== '..' && !rel.startsWith('../') && !path.isAbsolute(rel); };

// Git owns the comparison. It runs outside the HTTP event loop, never refreshes
// the index, launches a pager, or invokes a configured diff/textconv/fsmonitor.
function git(cwd, args, { signal } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    Object.assign(env, { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' });
    const child = spawn('git', ['--no-optional-locks', '--no-pager', '--literal-pathspecs',
      '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'diff.autoRefreshIndex=false', ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let stderr = '', failure;
    const stop = error => { failure ||= error; child.kill('SIGKILL'); };
    const abort = () => stop(signal.reason || Error('Git request cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => { if (stderr.length < 8192) stderr += chunk.toString().slice(0, 8192 - stderr.length); });
    child.on('error', error => { failure = error.code === 'ENOENT' ? Error('Git is not installed') : error; });
    child.on('close', code => {
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else resolve({ code, output: Buffer.concat(chunks).toString('utf8'), stderr: stderr.trim(), truncated: false });
    });
    if (signal?.aborted) abort();
  });
}

function checked(result) {
  if (result.code !== 0) throw Error(result.stderr || 'Git could not read this repository');
  return result.output;
}

async function repository(input, options) {
  const requested = await fs.realpath(input);
  const result = await git(requested, ['rev-parse', '--show-toplevel'], options);
  if (result.code !== 0 && /not a git repository|must be run in a work tree/i.test(result.stderr)) return null;
  const root = await fs.realpath(checked(result).replace(/\n$/, ''));
  await options.authorizeRoot?.(root);
  const head = await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], options);
  if (head.code !== 0 && head.code !== 1) checked(head);
  // hash-object without -w computes Git's native (SHA-1 or SHA-256) empty tree;
  // it writes neither an object nor an index for a repository without commits.
  const base = head.code === 0 ? head.output.trim() : checked(await git(root, ['hash-object', '-t', 'tree', '--stdin'], options)).trim();
  return { root, base, unborn: head.code !== 0 };
}

function parseChanges(output) {
  const fields = output.split('\0'), files = new Map(), counted = new Set(); let i = 0;
  while (i < fields.length && fields[i].startsWith(':')) {
    const status = fields[i++].split(' ').at(-1)[0], first = fields[i++];
    const renamed = status === 'R' || status === 'C', file = renamed ? fields[i++] : first;
    if (file !== undefined) files.set(file, { path: file, ...(renamed ? { oldPath: first } : {}), status, added: 0, deleted: 0 });
  }
  while (i < fields.length && fields[i]) {
    const field = fields[i++], match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(field);
    if (!match) throw Error('Git returned an unreadable change list');
    let file = match[3];
    if (!file) { i++; file = fields[i++]; }
    const row = files.get(file);
    if (row) { counted.add(file); Object.assign(row, { added: match[1] === '-' ? null : Number(match[1]), deleted: match[2] === '-' ? null : Number(match[2]), binary: match[1] === '-' }); }
  }
  // Without index refresh, raw output can contain stat-only differences whose
  // contents exactly match HEAD. Numstat removes those after comparing bytes.
  for (const file of files.keys()) if (!counted.has(file)) files.delete(file);
  return files;
}

function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || path.isAbsolute(value)
      || value.split('/').some(part => part === '..' || part === '.git') || path.normalize(value) === '.') {
    throw Error('Choose a file inside this repository');
  }
  return path.normalize(value);
}

// Keep symlinks as links, including links pointing outside the repository. Do
// not read their targets; reject paths whose parent traverses an outside link.
async function fileInfo(root, relative) {
  const file = path.join(root, relative), parent = await fs.realpath(path.dirname(file));
  if (!inside(root, parent)) throw Error('File path leaves this repository');
  return { file, stat: await fs.lstat(file) };
}

async function untrackedCounts(root, row, signal) {
  signal?.throwIfAborted();
  try {
    const { file, stat } = await fileInfo(root, row.path);
    let lines = 0, bytes = 0, last = -1;
    const count = chunk => {
      if (bytes < 8000 && chunk.subarray(0, 8000 - bytes).includes(0)) return false;
      bytes += chunk.length;
      for (const byte of chunk) if (byte === 10) lines++;
      if (chunk.length) last = chunk.at(-1);
      return true;
    };
    if (stat.isSymbolicLink()) count(Buffer.from(await fs.readlink(file)));
    else if (stat.isFile()) {
      const handle = await fs.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        for await (const chunk of handle.createReadStream({ signal, autoClose: false })) {
          if (!count(chunk)) return Object.assign(row, { added: null, deleted: null, binary: true });
        }
      } finally { await handle.close(); }
    } else return Object.assign(row, { added: null, countsTruncated: true });
    signal?.throwIfAborted();
    return Object.assign(row, { added: lines + (bytes && last !== 10 ? 1 : 0) });
  } catch (error) {
    signal?.throwIfAborted();
    return Object.assign(row, { added: null, countsTruncated: true, error: error.code === 'ENOENT' ? 'File changed; refresh to update' : error.message });
  }
}

export async function gitChanges(input, { signal, authorizeRoot } = {}) {
  const context = await repository(input, { signal, authorizeRoot });
  if (!context) return { repository: false };
  const { root, base, unborn } = context;
  const [tracked, status] = await Promise.all([
    git(root, ['diff', ...DIFF_OPTIONS, '--raw', '--numstat', '-z', base, '--'], { signal }),
    git(root, ['status', '--porcelain=v1', '--untracked-files=all', '-z'], { signal }),
  ]);
  const rows = parseChanges(checked(tracked));
  const fields = checked(status).split('\0');
  for (let i = 0; i < fields.length && fields[i];) {
    const field = fields[i++], xy = field.slice(0, 2), file = field.slice(3);
    const oldPath = /[RC]/.test(xy) ? fields[i++] : undefined;
    const untracked = xy === '??', staged = !untracked && xy[0] !== ' ', unstaged = !untracked && xy[1] !== ' ';
    if (!rows.has(file)) rows.set(file, { path: file, ...(oldPath ? { oldPath } : {}),
      status: untracked ? '?' : xy.trim()[0], added: 0, deleted: 0, ...(!untracked ? { netUnchanged: true } : {}) });
    Object.assign(rows.get(file), { staged, unstaged });
  }
  const files = [...rows.values()].sort((a, b) => a.path.localeCompare(b.path));
  const pending = files.filter(row => row.status === '?');
  // Four bounded asynchronous readers; never spawn one Git process per file.
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    for (;;) { const row = pending.shift(); if (!row) return; await untrackedCounts(root, row, signal); }
  }));
  return { repository: true, root, unborn, files, total: files.length, truncated: false };
}

export async function gitDiff(input, value, { signal, authorizeRoot } = {}) {
  const relative = relativePath(value), context = await repository(input, { signal, authorizeRoot });
  if (!context) return { repository: false };
  const { root, base } = context;
  // Resolve rename pairs from Git's combined HEAD→worktree comparison, not the
  // index alone, so staged and unstaged edits appear in one truthful view.
  const names = checked(await git(root, ['diff', ...DIFF_OPTIONS, '--name-status', '-z', base, '--'], { signal }));
  const fields = names.split('\0'); let oldPath, tracked = false;
  for (let i = 0; i < fields.length && fields[i];) {
    const status = fields[i++], first = fields[i++], renamed = /^[RC]/.test(status), file = renamed ? fields[i++] : first;
    if (file === relative) { tracked = true; if (renamed) oldPath = first; break; }
  }
  const options = { signal };
  let result, comparison;
  if (tracked) {
    result = await git(root, ['diff', ...DIFF_OPTIONS, '--unified=3', base, '--', ...(oldPath ? [oldPath] : []), relative], options);
    // A staged edit can be undone only in the worktree. Its combined diff is
    // empty, but committing would still change HEAD: show both native patches.
    if (!result.output && result.code === 0) {
      const heading = 'Staged changes (HEAD → index)\n', middle = '\nUnstaged changes (index → working tree)\n';
      const staged = await git(root, ['diff', ...DIFF_OPTIONS, '--cached', '--unified=3', base, '--', ...(oldPath ? [oldPath] : []), relative], options);
      if (!staged.truncated && staged.code !== 0) checked(staged);
      if (staged.output) {
        const unstaged = await git(root, ['diff', ...DIFF_OPTIONS, '--unified=3', '--', ...(oldPath ? [oldPath] : []), relative], options);
        if (unstaged && !unstaged.truncated && unstaged.code !== 0) checked(unstaged);
        result = { code: 0, output: heading + staged.output + (unstaged ? middle + unstaged.output : ''), truncated: staged.truncated || !unstaged || unstaged.truncated };
        comparison = 'staged-and-unstaged';
      }
    }
  } else {
    const other = checked(await git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', relative], { signal }));
    if (!other.split('\0').includes(relative)) return { repository: true, root, path: relative, diff: '', binary: false, truncated: false };
    const { stat } = await fileInfo(root, relative);
    if (!stat.isFile() && !stat.isSymbolicLink()) throw Error('Choose a regular file or link');
    result = await git(root, ['diff', ...DIFF_OPTIONS, '--no-index', '--unified=3', '--', '/dev/null', relative], options);
  }
  if (!result.truncated && result.code !== 0 && result.code !== 1) checked(result);
  return { repository: true, root, path: relative, ...(oldPath ? { oldPath } : {}),
    ...(comparison ? { comparison } : {}), diff: result.output, binary: /(?:^|\n)Binary files .+ differ(?:\n|$)/.test(result.output), truncated: result.truncated };
}
