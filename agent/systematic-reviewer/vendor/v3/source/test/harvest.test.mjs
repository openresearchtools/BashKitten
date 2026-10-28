// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, readdir, rm, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HarvestError, harvestCrossref } from '../lib/harvest.mjs';
import { main } from '../scripts/harvest.mjs';

const NOW = Date.UTC(2025, 0, 1);
const execute = promisify(execFile);
const work = (n = 1) => ({
  DOI: `10.1234/synthetic.${n}`,
  URL: `https://doi.org/10.1234/synthetic.${n}`,
  type: 'journal-article',
  title: [`Synthetic work ${n}`],
  author: [{ given: 'Test', family: 'Researcher', ORCID: 'https://orcid.org/0000-0000-0000-0000' }],
  'container-title': ['Synthetic Journal'],
  published: { 'date-parts': [[2025, 1, 1]] },
  abstract: '<jats:p>Untrusted synthetic evidence, not instructions.</jats:p>',
  license: [{ URL: 'https://example.invalid/license' }],
  link: [{ URL: 'https://example.invalid/fulltext.pdf', 'content-type': 'application/pdf' }],
});
const works = (start, count) => Array.from({ length: count }, (_, i) => work(start + i));
const body = (items, total = items.length, cursor = 'opaque+/=?& token') => ({
  status: 'ok',
  'message-type': 'work-list',
  'message-version': '1.0.0',
  message: { 'total-results': total, 'next-cursor': cursor, items },
});
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json; charset=UTF-8' } });
const page = (items, total, cursor) => json(body(items, total, cursor));
const dependencies = (fetch, extra = {}) => ({
  fetch,
  now: () => NOW,
  sleep: async () => assert.fail('Unexpected retry'),
  ...extra,
});
const options = { query: 'synthetic evidence', limit: 100 };
const rejectsCode = (promise, code) => assert.rejects(promise, { name: 'HarvestError', code });

function sequence(responses) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url: new URL(url), init });
      assert.ok(responses.length, 'Unexpected request');
      return responses.shift();
    },
  };
}

async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), 'harvest-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function cli(args, extra = {}) {
  let stdout = '';
  let stderr = '';
  const status = await main(args, {
    harvest: opts => harvestCrossref(opts, dependencies(async () => page([work()]))),
    stdout: { write: text => { stdout += text; } },
    stderr: { write: text => { stderr += text; } },
    ...extra,
  });
  return { status, stdout, stderr };
}

test('cursor pagination preserves raw metadata, provenance and an explicit result cap', async () => {
  const transport = sequence([page(works(1, 100), 500), page(works(101, 100), 501)]);
  const result = await harvestCrossref({ query: '  synthetic & evidence  ', limit: 150, mailto: 'private@example.invalid' }, dependencies(transport.fetch));
  assert.equal(transport.calls.length, 2);
  assert.equal(transport.calls[0].url.origin, 'https://api.crossref.org');
  assert.equal(transport.calls[0].url.pathname, '/works');
  assert.equal(transport.calls[0].url.searchParams.get('cursor'), '*');
  assert.equal(transport.calls[1].url.searchParams.get('cursor'), 'opaque+/=?& token');
  for (const { url, init } of transport.calls) {
    assert.equal(url.searchParams.get('query'), 'synthetic & evidence');
    assert.equal(url.searchParams.get('rows'), '100');
    assert.equal(url.searchParams.get('mailto'), 'private@example.invalid');
    assert.equal(url.searchParams.get('sort'), 'relevance');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Accept, 'application/json');
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.equal(result.source.name, 'Crossref');
  assert.equal(result.query, 'synthetic & evidence');
  assert.equal(result.startedAt, '2025-01-01T00:00:00.000Z');
  assert.equal(result.completedAt, result.startedAt);
  assert.equal(result.count, 150);
  assert.equal(result.records.length, 150);
  assert.equal(result.limit, 150);
  assert.equal(result.stopReason, 'limit');
  assert.equal(result.totalResultsReported, 500);
  assert.equal(result.fetchedCount, 200);
  assert.equal(result.omittedByLimit, 50);
  assert.deepEqual(result.records[0].raw, work());
  assert.equal(result.records[0].doiUrl, 'https://doi.org/10.1234/synthetic.1');
  assert.equal(result.records[0].sourceUrl, 'https://api.crossref.org/works/10.1234%2Fsynthetic.1');
  assert.equal(result.provenance.pages[1].totalResultsReported, 501);
  assert.equal(result.provenance.pages[0].attempts, 1);
  assert.equal(result.provenance.pages[0].fetchedAt, result.startedAt);
  assert.ok(!JSON.stringify(result).includes('private@example.invalid'));
  assert.ok(result.provenance.pages.every(p => !new URL(p.url).searchParams.has('mailto')));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('a repeated opaque cursor is allowed when works advance; a short page ends the search', async () => {
  const transport = sequence([
    page(works(1, 100), 205, 'same'),
    page(works(101, 100), 205, 'same'),
    page(works(201, 5), 205, 'same'),
  ]);
  const result = await harvestCrossref({ ...options, limit: 300 }, dependencies(transport.fetch));
  assert.equal(result.count, 205);
  assert.equal(result.stopReason, 'exhausted');
  assert.equal(result.omittedByLimit, 0);
  assert.equal(transport.calls[1].url.searchParams.get('cursor'), 'same');
  assert.equal(transport.calls[2].url.searchParams.get('cursor'), 'same');
});

test('zero results and an exact full page followed by zero results are explicit', async () => {
  const empty = await harvestCrossref(options, dependencies(async () => page([])));
  assert.equal(empty.stopReason, 'exhausted');
  assert.equal(empty.count, 0);
  assert.equal(empty.provenance.pages.length, 1);
  const transport = sequence([page(works(1, 100), 100), page([], 100)]);
  const result = await harvestCrossref({ ...options, limit: 101 }, dependencies(transport.fetch));
  assert.equal(result.count, 100);
  assert.equal(result.stopReason, 'exhausted');
  assert.equal(transport.calls.length, 2);
});

test('default limit and 1000-record ceiling have bounded page counts', async () => {
  const one = sequence([page(works(1, 100), 100)]);
  const defaultResult = await harvestCrossref({ query: 'test' }, dependencies(one.fetch));
  assert.equal(defaultResult.limit, 100);
  assert.equal(defaultResult.stopReason, 'limit');
  const ten = sequence(Array.from({ length: 10 }, (_, i) => page(works(1 + i * 100, 100), 10_000)));
  const max = await harvestCrossref({ ...options, limit: 1000 }, dependencies(ten.fetch));
  assert.equal(max.count, 1000);
  assert.equal(ten.calls.length, 10);
});

test('DOI URL special characters are encoded; metadata remains unaltered', async () => {
  const raw = { ...work(), DOI: '10.1234/A#B?C/D' };
  const result = await harvestCrossref(options, dependencies(async () => page([raw])));
  assert.equal(result.records[0].doiUrl, 'https://doi.org/10.1234/A%23B%3FC/D');
  assert.deepEqual(result.records[0].raw, raw);
});

test('invalid inputs fail before any fetch', async () => {
  const invalid = [
    {}, { query: '' }, { query: '   ' }, { query: 12 }, { query: 'x\ny' }, { query: 'x'.repeat(4097) },
    ...[0, -1, 1.5, 1001, Infinity, '5'].map(limit => ({ ...options, limit })),
    ...['bad', 'a@b\r\nInjected: yes', 'a@b c', 'a'.repeat(255) + '@b'].map(mailto => ({ ...options, mailto })),
    ...[0, -1, 1.5, 120001].map(timeoutMs => ({ ...options, timeoutMs })),
    ...[-1, 4, 0.5].map(maxRetries => ({ ...options, maxRetries })),
    { ...options, signal: {} },
  ];
  for (const opts of invalid) {
    await rejectsCode(harvestCrossref(opts, dependencies(() => assert.fail('Must not fetch'))), 'INPUT');
  }
  await rejectsCode(harvestCrossref(options, dependencies(null)), 'INPUT');
  await rejectsCode(harvestCrossref(options, dependencies(() => assert.fail('Must not fetch'), { now: () => NaN })), 'INPUT');
});

test('malformed envelopes, items, counts and premature exhaustion fail closed', async () => {
  const malformed = [
    null,
    {},
    { ...body([]), status: 'error' },
    { ...body([]), 'message-type': 'other' },
    { ...body([]), message: null },
    { ...body([]), message: { items: {}, 'total-results': 1 } },
    body([], '0'),
    body([], -1),
    body([], Number.MAX_SAFE_INTEGER + 1),
    body(works(1, 101)),
    body([null]),
    body([{ title: ['No DOI'] }]),
    body([{ DOI: 'https://doi.org/10.1234/not-a-bare-doi' }]),
    body([{ DOI: '10.1234/\ud800' }]),
    body([{ DOI: '10.1234/a\0b' }]),
    body([work()], 0),
    body([work()], 10),
  ];
  for (const value of malformed) {
    await rejectsCode(harvestCrossref(options, dependencies(async () => json(value))), 'RESPONSE');
  }
});

test('missing cursors and duplicate DOI identities cannot silently truncate or inflate output', async () => {
  for (const cursor of [null, '', 'x'.repeat(16_385), 'bad\ncursor']) {
    await rejectsCode(harvestCrossref({ ...options, limit: 101 }, dependencies(async () => page(works(1, 100), 500, cursor))), 'RESPONSE');
  }
  const duplicate = [work(), { ...work(), DOI: work().DOI.toUpperCase() }];
  await rejectsCode(harvestCrossref(options, dependencies(async () => page(duplicate))), 'RESPONSE');
  const transport = sequence([page(works(1, 100), 200), page(works(1, 100), 200)]);
  await rejectsCode(harvestCrossref({ ...options, limit: 200 }, dependencies(transport.fetch)), 'RESPONSE');
});

test('a failed later page rejects the entire operation, not a partial result', async () => {
  const transport = sequence([page(works(1, 100), 500), new Response('private upstream detail', { status: 500 })]);
  await rejectsCode(harvestCrossref({ ...options, limit: 150 }, dependencies(transport.fetch)), 'HTTP');
  assert.equal(transport.calls.length, 2);
});

test('429/503 retries honor Retry-After seconds and HTTP dates using injected time', async () => {
  const transport = sequence([
    new Response(null, { status: 429, headers: { 'retry-after': '2' } }),
    new Response(null, { status: 503, headers: { 'retry-after': 'Wed, 01 Jan 2025 00:00:03 GMT' } }),
    page([work()]),
  ]);
  const waits = [];
  const result = await harvestCrossref(options, dependencies(transport.fetch, { sleep: async ms => { waits.push(ms); } }));
  assert.deepEqual(waits, [2000, 3000]);
  assert.equal(result.provenance.pages[0].attempts, 3);
});

test('absent Retry-After uses bounded backoff; exhausted retries do not return success', async () => {
  const transport = sequence([429, 503, 503].map(status => new Response(null, { status })).concat(page([work()])));
  const waits = [];
  await harvestCrossref(options, dependencies(transport.fetch, { sleep: async ms => { waits.push(ms); } }));
  assert.deepEqual(waits, [1000, 2000, 4000]);
  const exhausted = sequence(Array.from({ length: 4 }, () => new Response(null, { status: 503, headers: { 'retry-after': '0' } })));
  let sleeps = 0;
  await rejectsCode(harvestCrossref(options, dependencies(exhausted.fetch, { sleep: async () => { sleeps++; } })), 'HTTP');
  assert.equal(exhausted.calls.length, 4);
  assert.equal(sleeps, 3);
  const none = sequence([new Response(null, { status: 429 })]);
  await rejectsCode(harvestCrossref({ ...options, maxRetries: 0 }, dependencies(none.fetch)), 'HTTP');
  assert.equal(none.calls.length, 1);
});

test('invalid or excessive Retry-After fails instead of retrying too early', async () => {
  for (const header of ['31', '999999999999999999999', '1.5', '-1', 'secret', 'Wed, 01 Jan 2025 00:01:00 GMT']) {
    await rejectsCode(harvestCrossref(options, dependencies(async () => new Response(null, {
      status: 429, headers: { 'retry-after': header },
    }))), 'RETRY_AFTER');
  }
  const waits = [];
  const transport = sequence([
    new Response(null, { status: 503, headers: { 'retry-after': 'Tue, 31 Dec 2024 23:59:00 GMT' } }),
    new Response(null, { status: 503, headers: { 'retry-after': '30' } }),
    page([]),
  ]);
  await harvestCrossref(options, dependencies(transport.fetch, { sleep: async ms => { waits.push(ms); } }));
  assert.deepEqual(waits, [0, 30_000]);
});

test('nonretryable status and transport errors are redacted', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(harvestCrossref(options, dependencies(async () => new Response(stream, { status: 401, statusText: 'private-token' }))), error => {
    assert.equal(error.code, 'HTTP');
    assert.ok(!String(error).includes('private-token'));
    return true;
  });
  assert.ok(cancelled);
  await assert.rejects(harvestCrossref(options, dependencies(async () => { throw new Error('private-token https://example.invalid/?mailto=secret'); })), error => {
    assert.equal(error.code, 'NETWORK');
    assert.ok(!String(error).includes('private-token'));
    assert.equal(error.cause, undefined);
    return true;
  });
});

test('JSON content type, UTF-8, declared size and actual streamed size are checked', async () => {
  const invalid = [
    new Response('{}'),
    new Response('not-json', { headers: { 'content-type': 'application/json' } }),
    new Response(null, { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'content-type': 'application/json' } }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(8 * 1024 * 1024 + 1) } }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': 'unknown' } }),
  ];
  for (const response of invalid) {
    await rejectsCode(harvestCrossref(options, dependencies(async () => response)), 'RESPONSE');
  }
  let cancelled = false;
  const chunk = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(chunk); },
    cancel() { cancelled = true; },
  });
  await rejectsCode(harvestCrossref(options, dependencies(async () => new Response(stream, {
    headers: { 'content-type': 'application/json', 'content-length': '1' },
  }))), 'RESPONSE');
  assert.ok(cancelled);
});

test('timeout bounds fetch and body reads, including injected non-cooperative transports', async () => {
  let activeSignal;
  await rejectsCode(harvestCrossref({ ...options, timeoutMs: 10 }, dependencies((_url, init) => {
    activeSignal = init.signal;
    return new Promise(() => {});
  })), 'TIMEOUT');
  assert.ok(activeSignal.aborted);
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  await rejectsCode(harvestCrossref({ ...options, timeoutMs: 10 }, dependencies(async () => new Response(stream, {
    headers: { 'content-type': 'application/json' },
  }))), 'TIMEOUT');
  assert.ok(cancelled);
});

test('cancellation works before fetching, during fetch, during body reads and during retry sleep', async () => {
  const pre = AbortSignal.abort('private reason');
  await rejectsCode(harvestCrossref({ ...options, signal: pre }, dependencies(() => assert.fail('Must not fetch'))), 'ABORTED');
  const during = new AbortController();
  await assert.rejects(harvestCrossref({ ...options, signal: during.signal }, dependencies(() => {
    during.abort('private reason');
    return new Promise(() => {});
  })), error => error.code === 'ABORTED' && !String(error).includes('private reason'));
  const bodyAbort = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream({
    pull() { bodyAbort.abort(); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  await rejectsCode(harvestCrossref({ ...options, signal: bodyAbort.signal }, dependencies(async () => new Response(stream, {
    headers: { 'content-type': 'application/json' },
  }))), 'ABORTED');
  assert.ok(cancelled);
  const waiting = new AbortController();
  const transport = sequence([new Response(null, { status: 503, headers: { 'retry-after': '1' } })]);
  await rejectsCode(harvestCrossref({ ...options, signal: waiting.signal }, dependencies(transport.fetch, {
    sleep: async (_ms, signal) => {
      assert.equal(signal, waiting.signal);
      waiting.abort('private reason');
      return new Promise(() => {});
    },
  })), 'ABORTED');
  assert.equal(transport.calls.length, 1);
});

test('CLI writes complete ordinary JSON to a path with spaces without shell interpolation', async t => {
  const directory = await temp(t);
  const output = join(directory, 'review metadata.json');
  const query = 'literal $(not-a-command); & evidence';
  const result = await cli(['--query', query, '--output', output, '--limit', '1']);
  assert.equal(result.status, 0, result.stderr);
  const saved = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(saved.query, query);
  assert.equal(saved.count, 1);
  assert.equal(saved.stopReason, 'limit');
  assert.deepEqual(await readdir(directory), ['review metadata.json']);
  assert.match(result.stdout, /Saved 1 Crossref records/);
});

test('CLI refuses existing files and dangling symlinks before harvesting', async t => {
  const directory = await temp(t);
  const output = join(directory, 'existing.json');
  await writeFile(output, 'keep me');
  const noHarvest = { harvest: () => assert.fail('Must not harvest') };
  const result = await cli(['--query', 'test', '--output', output], noHarvest);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /already exists/);
  assert.equal(await readFile(output, 'utf8'), 'keep me');
  const dangling = join(directory, 'dangling.json');
  await symlink(join(directory, 'missing.json'), dangling);
  assert.equal((await cli(['--query', 'test', '--output', dangling], noHarvest)).status, 1);
  assert.ok((await lstat(dangling)).isSymbolicLink());
});

test('CLI create-only publication does not overwrite a file created during harvesting', async t => {
  const directory = await temp(t);
  const output = join(directory, 'race.json');
  const result = await cli(['--query', 'test', '--output', output], {
    harvest: async () => {
      await writeFile(output, 'other writer');
      return { count: 0, stopReason: 'exhausted', records: [] };
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /already exists/);
  assert.equal(await readFile(output, 'utf8'), 'other writer');
  assert.deepEqual(await readdir(directory), ['race.json']);
});

test('all hard-link fallback errors use exclusive copying and preserve a racing writer', async t => {
  const directory = await temp(t);
  const script = new URL('../scripts/harvest.mjs', import.meta.url).href;
  // Isolate built-in mocks in a child; normal suite filesystem operations stay real.
  await execute(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises';
    import { constants } from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { join } from 'node:path';
    const directory = ${JSON.stringify(directory)};
    const originalCopy = fs.copyFile;
    let errorCode;
    let race;
    let copies = 0;
    fs.link = async (_source, destination) => {
      if (race) await fs.writeFile(destination, 'competing writer', { flag: 'wx' });
      throw Object.assign(new Error('simulated link restriction'), { code: errorCode });
    };
    fs.copyFile = async (source, destination, flags) => {
      assert.equal(flags, constants.COPYFILE_EXCL);
      copies++;
      return originalCopy(source, destination, flags);
    };
    syncBuiltinESMExports();
    const { main } = await import(${JSON.stringify(script)});
    for (errorCode of ['EACCES', 'EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV']) {
      for (race of [false, true]) {
        const output = join(directory, errorCode + '-' + race + '.json');
        const status = await main(['--query', 'test', '--output', output], {
          harvest: async () => ({ count: 0, stopReason: 'exhausted', records: [] }),
          stdout: { write() {} },
          stderr: { write() {} },
        });
        assert.equal(status, race ? 1 : 0, errorCode + ' race=' + race);
        const saved = await fs.readFile(output, 'utf8');
        if (race) assert.equal(saved, 'competing writer');
        else assert.equal(JSON.parse(saved).count, 0);
      }
    }
    assert.equal(copies, 12);
    const names = await fs.readdir(directory);
    assert.equal(names.length, 12);
    assert.ok(names.every(name => name.endsWith('.json')), 'temporary files cleaned up');
  `]);
});

test('explicit overwrite replaces a symlink, not its target', async t => {
  const directory = await temp(t);
  const target = join(directory, 'keep.txt');
  const output = join(directory, 'review.json');
  await writeFile(target, 'original');
  await symlink(target, output);
  const result = await cli(['--query', 'test', '--output', output, '--overwrite']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!(await lstat(output)).isSymbolicLink());
  assert.equal(JSON.parse(await readFile(output, 'utf8')).count, 1);
  assert.equal(await readFile(target, 'utf8'), 'original');
});

test('failed and cancelled CLI harvests clean up temporary files and preserve existing output', async t => {
  const directory = await temp(t);
  const output = join(directory, 'review.json');
  await writeFile(output, 'original');
  const result = await cli(['--query', 'test', '--output', output, '--overwrite'], {
    harvest: async () => { throw new Error('private-token'); },
  });
  assert.equal(result.status, 1);
  assert.ok(!result.stderr.includes('private-token'));
  assert.equal(await readFile(output, 'utf8'), 'original');
  const controller = new AbortController();
  const cancelled = await cli(['--query', 'test', '--output', join(directory, 'cancelled.json')], {
    signal: controller.signal,
    harvest: async () => {
      controller.abort();
      return { count: 0, stopReason: 'exhausted' };
    },
  });
  assert.equal(cancelled.status, 1);
  assert.match(cancelled.stderr, /cancelled/);
  assert.deepEqual(await readdir(directory), ['review.json']);
});

test('CLI argument errors and missing output directories never start a harvest', async t => {
  const directory = await temp(t);
  const base = ['--query', 'test', '--output', join(directory, 'result.json')];
  const invalid = [
    [], ['--query'], ['--query', 'test'],
    [...base, '--unknown'], [...base, '--query', 'again'],
    [...base, '--overwrite', '--overwrite'], [...base, '--mailto'],
    ...['0', '1001', '1.5', '1x', '-1'].map(n => [...base, '--limit', n]),
    ['--query', 'test', '--output', join(directory, 'missing', 'result.json')],
  ];
  for (const args of invalid) {
    const result = await cli(args, { harvest: () => assert.fail('Must not harvest') });
    assert.equal(result.status, 1);
  }
  assert.deepEqual(await readdir(directory), []);
});

test('real CLI SIGINT cancels an injected fetch and removes its temporary file', async t => {
  const directory = await temp(t);
  const output = join(directory, 'interrupted.json');
  const preload = 'data:text/javascript,' + encodeURIComponent(`
    globalThis.fetch = async () => {
      process.stdout.write('FETCHING\\n');
      return new Promise(() => {});
    };
  `);
  const script = fileURLToPath(new URL('../scripts/harvest.mjs', import.meta.url));
  const child = spawn(process.execPath, ['--import', preload, script, '--query', 'test', '--output', output], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let stderr = '';
  let stdout = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const status = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI did not exit')); }, 10_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    let sent = false;
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!sent && stdout.includes('FETCHING')) {
        sent = true;
        child.kill('SIGINT');
      }
    });
  });
  assert.deepEqual(status, { code: 130, signal: null });
  assert.match(stderr, /cancelled/);
  assert.deepEqual(await readdir(directory), []);
});

test('imports and real CLI help have no network side effects', async () => {
  const library = new URL('../lib/harvest.mjs', import.meta.url).href;
  const script = new URL('../scripts/harvest.mjs', import.meta.url);
  const { stdout } = await execute(process.execPath, ['--input-type=module', '--eval', `
    globalThis.fetch = () => { throw new Error('Network forbidden'); };
    await import(${JSON.stringify(library)});
    const { main } = await import(${JSON.stringify(script.href)});
    process.exitCode = await main(['--help']);
  `]);
  assert.match(stdout, /Usage:/);
  const help = await execute(process.execPath, [fileURLToPath(script), '--help']);
  assert.match(help.stdout, /--limit/);
  assert.equal(help.stderr, '');
});
