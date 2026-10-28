#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { emitKeypressEvents } from 'node:readline';
import { SERVICES, ConfigError, serviceStatus, saveServiceKey, removeServiceKey } from '../lib/services.mjs';

const USAGE = `Usage: node scripts/setup.mjs COMMAND

  status                      Show configured services, sources and file path
  set openalex                Enter or replace a saved key (hidden terminal input)
  set openalex --stdin        Read one key from stdin, for a password manager
  set openalex --web          Serve a local OpenAlex browser form
  serve [--port PORT]          Serve a local OpenAlex browser form
  remove openalex             Remove its saved key; environment is unchanged
  help                        Show this help and official account links

OpenAlex account/key: ${SERVICES.openalex.accountUrl}
OpenAlex signup:      ${SERVICES.openalex.signupUrl}
Local Zotero uses the running app and needs no API key.

Keys are saved in a private plaintext file outside the project:
$XDG_CONFIG_HOME/pi-systematic-reviewer/credentials.json, or
~/.config/pi-systematic-reviewer/credentials.json. The new directory uses 0700
and the file uses 0600. SYSTEMATIC_REVIEW_CONFIG can select an absolute path.
OPENALEX_API_KEY overrides the saved OpenAlex key.
Never put a key in command arguments, chat, source files or review outputs.

Web setup prints a temporary http://127.0.0.1 URL for you or your agent to open.
It stops after 10 minutes, when you select Done, or on Ctrl-C. No browser is
launched automatically. --web also accepts --port PORT (default: random port).
`;

function webPort(args) {
  if (!args.length) return 0;
  if (args.length !== 2 || args[0] !== '--port' || !/^\d{1,5}$/.test(args[1]) || Number(args[1]) > 65535) {
    throw new ConfigError('Web setup accepts only --port 0–65535; 0 selects an available local port.');
  }
  return Number(args[1]);
}

async function readPipedKey(stdin) {
  let size = 0;
  const chunks = [];
  for await (const chunk of stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 4098) throw new ConfigError('The API key input is too long.');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

function readHiddenKey(stdin, stderr) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') throw new ConfigError('Hidden entry needs an interactive terminal. Run this command in your terminal, or use --stdin with a password manager.');
  return new Promise((resolveKey, reject) => {
    const wasRaw = Boolean(stdin.isRaw);
    const wasFlowing = stdin.readableFlowing;
    let value = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      stdin.removeListener('keypress', onKey);
      stdin.removeListener('end', onEnd);
      stdin.removeListener('error', onError);
      stdin.setRawMode(wasRaw);
      if (!wasFlowing) stdin.pause();
      stderr.write('\n');
      if (error) reject(error); else resolveKey(value);
    };
    const onEnd = () => finish(new ConfigError('Key entry ended before confirmation; nothing was saved.'));
    const onError = () => finish(new ConfigError('Cannot read key input; nothing was saved.'));
    const onKey = (text, key = {}) => {
      if (key.ctrl && ['c', 'd'].includes(key.name)) return finish(new ConfigError('Key entry cancelled; nothing was saved.'));
      if (['return', 'enter'].includes(key.name)) return finish();
      if (key.name === 'backspace') { value = value.slice(0, -1); return; }
      if (key.ctrl || key.meta || !text || !/^[\x20-\x7e]+$/.test(text)) return;
      value += text;
      if (value.length > 4096) finish(new ConfigError('The API key input is too long; nothing was saved.'));
    };
    emitKeypressEvents(stdin);
    stdin.on('keypress', onKey);
    stdin.once('end', onEnd);
    stdin.once('error', onError);
    stdin.setRawMode(true);
    stderr.write('Paste API key (hidden), then press Enter: ');
    stdin.resume();
  });
}

function showStatus(result, stdout) {
  stdout.write(`Credential file: ${result.configPath}\n`);
  for (const details of Object.values(result.services)) {
    stdout.write(`${details.name}: ${details.configured ? `configured (${details.source === 'environment' ? details.environmentVariable : 'saved file'})` : 'not configured'}\n`);
    stdout.write(`  Account/key: ${details.accountUrl}\n`);
  }
  stdout.write('Local Zotero: no key needed; keep the app running with local API access enabled.\n');
}

export async function main(args, { env = process.env, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, signal,
  startServer = async options => (await import('../lib/setup-web.mjs')).startSetupServer(options) } = {}) {
  try {
    const [command, service, inputMode] = args;
    if ((!args.length) || (args.length === 1 && ['help', '--help'].includes(command))) { stdout.write(USAGE); return 0; }
    if (command === 'status' && args.length === 1) { showStatus(await serviceStatus({ env }), stdout); return 0; }
    if (command === 'serve' || (command === 'set' && inputMode === '--web')) {
      if (command === 'set' && !Object.hasOwn(SERVICES, service)) throw new ConfigError('Only openalex uses API-key setup. Local Zotero needs no key.');
      const server = await startServer({ service: command === 'set' ? service : undefined,
        port: webPort(args.slice(command === 'set' ? 3 : 1)), env, signal });
      try {
        stdout.write(`Open this temporary setup page in a browser on this device:\n${server.url}\n`);
        stdout.write('Enter the key in the page yourself. Done, Ctrl-C, or the 10-minute limit stops the server.\n');
        await server.closed;
        stdout.write('Setup server stopped.\n');
      } finally { await server.close(); }
      return 0;
    }
    if (!Object.hasOwn(SERVICES, service) || !['set', 'remove'].includes(command) || args.length > 3 || (inputMode && (command !== 'set' || inputMode !== '--stdin'))) throw new ConfigError('Unknown arguments. Use help; keys are never accepted as command arguments.');
    if (command === 'remove') {
      const result = await removeServiceKey(service, { env });
      stdout.write(`${SERVICES[service].name}: saved key removed.\n`);
      showStatus(result, stdout);
    } else {
      // Validate config before asking the user for a secret.
      await serviceStatus({ env });
      const key = inputMode === '--stdin' ? await readPipedKey(stdin) : await readHiddenKey(stdin, stderr);
      const result = await saveServiceKey(service, key, { env });
      stdout.write(`${SERVICES[service].name}: key saved privately.\n`);
      showStatus(result, stdout);
    }
    return 0;
  } catch (error) {
    stderr.write(`Setup: ${error instanceof ConfigError ? error.message : 'Could not complete service setup; no credential details were logged.'}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args[0] === 'serve' || (args[0] === 'set' && args[2] === '--web')) {
    const controller = new AbortController();
    let interrupted = 0;
    const onInt = () => { interrupted = 130; controller.abort(); };
    const onTerm = () => { interrupted = 143; controller.abort(); };
    process.once('SIGINT', onInt);
    process.once('SIGTERM', onTerm);
    try { process.exitCode = interrupted || await main(args, { signal: controller.signal }); }
    finally {
      process.removeListener('SIGINT', onInt);
      process.removeListener('SIGTERM', onTerm);
      if (interrupted) process.exitCode = interrupted;
    }
  } else process.exitCode = await main(args);
}
