#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { emitKeypressEvents } from 'node:readline';
import { applicationRequest } from '../../pi/apps-channel.mjs';
import { projectPath } from '../lib/client.mjs';
import { options, requestForSession, run } from '../lib/native-cli.mjs';

async function secretInput(piped, signal) {
  if (piped) {
    let text = '';
    for await (const chunk of process.stdin) { signal.throwIfAborted(); text += chunk.toString('utf8'); if (Buffer.byteLength(text) > 4096) throw Error('Key input exceeds 4096 bytes'); }
    return text.trim();
  }
  if (!process.stdin.isTTY) throw Error('Use an interactive terminal or explicit --stdin for hidden key entry');
  process.stderr.write('OpenAlex API key (hidden): ');
  const previousRaw = process.stdin.isRaw;
  emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let text = '';
    const finish = (error, value) => {
      process.stdin.removeListener('keypress', key); signal.removeEventListener('abort', abort);
      process.stdin.setRawMode(previousRaw); process.stdin.pause(); process.stderr.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(Error('Key entry cancelled'));
    const key = (value, info = {}) => {
      if (info.ctrl && info.name === 'c') return abort();
      if (info.name === 'return') return finish(null, text.trim());
      if (info.name === 'backspace') { text = [...text].slice(0, -1).join(''); return; }
      if (value && /^[\x21-\x7e]+$/.test(value) && Buffer.byteLength(text + value) <= 4096) text += value;
    };
    process.stdin.on('keypress', key); signal.addEventListener('abort', abort, { once: true });
  });
}
await run(async (args, signal) => {
  const action = args.shift();
  if (action === '--help' || !action) { process.stdout.write('Setup status|open --project PROJECT [--session CHAT]; set openalex --project PROJECT [--stdin] [--session CHAT]; remove openalex --project PROJECT [--session CHAT]. Keys use hidden terminal/stdin input and the shared References settings owner, never command arguments or a separate credential store.\n'); return; }
  if (!['status', 'open', 'set', 'remove'].includes(action)) throw Error('Choose status, open, set or remove');
  if (['set', 'remove'].includes(action) && args.shift() !== 'openalex') throw Error('The supported service is openalex');
  const flags = options(args, ['--project', '--session', '--stdin']);
  const projectId = flags['--project'], path = projectPath(projectId, '/settings'), request = requestForSession(flags['--session']);
  if (action === 'open') {
    const reply = await applicationRequest('references', 'POST', '/open', { projectId }, { signal, request });
    process.stdout.write(`${reply.body.url || reply.body.browserUrl || JSON.stringify(reply.body)}\n`); return;
  }
  let body;
  if (action === 'set') {
    const key = await secretInput(flags['--stdin'], signal);
    if (!key || !/^[\x21-\x7e]{1,4096}$/.test(key)) throw Error('No valid key supplied; configuration unchanged');
    body = { openalexKey: key };
  } else if (action === 'remove') body = { openalexKey: null };
  let reply;
  try { reply = await applicationRequest('references', action === 'status' ? 'GET' : 'PATCH', path, body, { signal, request }); }
  catch { throw Error('References setup failed; check project access and service availability. No key value was logged.'); }
  process.stdout.write(`${JSON.stringify(reply.body, null, 2)}\n`);
});
