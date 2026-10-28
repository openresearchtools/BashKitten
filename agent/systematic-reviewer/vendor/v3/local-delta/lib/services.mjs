// SPDX-License-Identifier: AGPL-3.0-or-later
import { constants } from 'node:fs';
import { open, mkdir, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, basename, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const SERVICES = Object.freeze({
  openalex: Object.freeze({ name: 'OpenAlex', environmentVariable: 'OPENALEX_API_KEY', accountUrl: 'https://openalex.org/settings/api-key', signupUrl: 'https://openalex.org/signup' }),
});

export class ConfigError extends Error {
  constructor(message) { super(message); this.name = 'ConfigError'; }
}

const fail = message => new ConfigError(message);
const MAX_BYTES = 64 * 1024;
function descriptor(service) {
  if (!Object.hasOwn(SERVICES, service)) throw fail('Only openalex uses API-key setup. Local Zotero needs no key.');
  return SERVICES[service];
}
function validKey(key) {
  if (typeof key !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(key)) throw fail('The API key must be a nonempty token without spaces or control characters (maximum 4096 characters).');
  return key;
}
function configPath(env) {
  if (env.SYSTEMATIC_REVIEW_CONFIG) {
    if (!isAbsolute(env.SYSTEMATIC_REVIEW_CONFIG)) throw fail('SYSTEMATIC_REVIEW_CONFIG must be an absolute path outside the repository.');
    return env.SYSTEMATIC_REVIEW_CONFIG;
  }
  const base = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(homedir(), '.config');
  return join(base, 'pi-systematic-reviewer', 'credentials.json');
}
function environmentKey(service, env) {
  const key = env[descriptor(service).environmentVariable];
  return key === undefined || key === '' ? undefined : validKey(key);
}

async function readConfig(path) {
  let file;
  try {
    // O_NOFOLLOW refuses symlinks; O_NONBLOCK lets us reject special files
    // without hanging on a FIFO. Neither requires a platform executable.
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_BYTES) throw fail('The credential file must be a regular file no larger than 64 KiB.');
    if (process.platform !== 'win32' && (info.mode & 0o077)) throw fail('The credential file is accessible to other users; restrict its permissions to 0600 before using it.');
    let size = 0;
    const chunks = [];
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      size += chunk.length;
      if (size > MAX_BYTES) throw fail('The credential file exceeds 64 KiB.');
      chunks.push(chunk);
    }
    let data;
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw fail('The credential file is malformed; repair or remove it before continuing.'); }
    if (!data || Array.isArray(data) || data.version !== 1 || Object.keys(data).some(key => !['version', 'keys'].includes(key)) || !data.keys || typeof data.keys !== 'object' || Array.isArray(data.keys)) throw fail('The credential file has an unsupported format.');
    for (const [service, key] of Object.entries(data.keys)) {
      // Old releases saved Zotero Web keys. Leave existing data untouched, but
      // never resolve, validate, display or offer to edit that retired setting.
      if (service === 'zotero') continue;
      descriptor(service);
      validKey(key);
    }
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, keys: {} };
    if (error instanceof ConfigError) throw error;
    throw fail('Cannot read the credential file; check its location and permissions.');
  } finally { await file?.close().catch(() => {}); }
}

function status(path, data, env) {
  return {
    configPath: path,
    services: Object.fromEntries(Object.entries(SERVICES).map(([service, details]) => {
      const source = environmentKey(service, env) ? 'environment' : data.keys[service] ? 'config' : null;
      return [service, { ...details, configured: source !== null, source }];
    })),
  };
}

/** Only internal callers resolving a request need the value. Never log it. */
export async function serviceKey(service, { env = process.env } = {}) {
  return environmentKey(service, env) ?? (await readConfig(configPath(env))).keys[service];
}

/** Safe to show to a user or agent: contains no credential values. */
export async function serviceStatus({ env = process.env } = {}) {
  const path = configPath(env);
  return status(path, await readConfig(path), env);
}

async function writeConfig(path, data) {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(`${JSON.stringify(data, null, 2)}\n`);
    await file.sync();
    await file.close();
    file = undefined;
    await rename(temporary, path);
  } catch { throw fail('Cannot save the credential file; check its location and permissions.'); }
  finally {
    await file?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

// A rename makes one publication atomic, but the whole read-modify-write must
// also be exclusive so concurrent setup processes cannot discard an update.
async function withMutationLock(path, update) {
  const lockPath = `${path}.lock`;
  let lock;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw fail('Credential update is locked. Wait for another setup command to finish and retry. If no setup is running, manually remove the credential file\'s .lock sidecar before retrying.');
    throw fail('Cannot lock the credential file; check its location and permissions.');
  }
  try { return await update(); }
  finally {
    await lock.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
  }
}

/** Explicitly replace the active service's key, preserving legacy settings. */
export async function saveServiceKey(service, key, { env = process.env } = {}) {
  descriptor(service);
  validKey(key);
  const path = configPath(env);
  // Validate environment/status before changing anything on disk.
  status(path, { keys: {} }, env);
  return withMutationLock(path, async () => {
    const data = await readConfig(path);
    data.keys[service] = key;
    await writeConfig(path, data);
    return status(path, data, env);
  });
}

export async function removeServiceKey(service, { env = process.env } = {}) {
  descriptor(service);
  const path = configPath(env);
  const data = await readConfig(path);
  const current = status(path, data, env);
  // An absent key is a read-only no-op. If it exists, re-read under the lock.
  if (!Object.hasOwn(data.keys, service)) return current;
  return withMutationLock(path, async () => {
    const latest = await readConfig(path);
    if (Object.hasOwn(latest.keys, service)) {
      delete latest.keys[service];
      await writeConfig(path, latest);
    }
    return status(path, latest, env);
  });
}
