// The private runtime is selected before any Pi SDK import or tool subprocess.
// HOME and cwd remain the user's normal home and chosen project.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const dataDir = path.resolve(process.env.BASHKITTEN_DATA_DIR || path.join(os.homedir(), '.local/share/bashkitten-pi'));
export const piAgentDir = path.join(dataDir, 'pi');
const app = fileURLToPath(new URL('../../', import.meta.url));
const packaged = fs.existsSync(path.join(app, 'build-platform.json')) || fs.existsSync(path.join(app, 'runtime-default.json'));
const bundledNode = path.join(app, 'node/bin/node');
const bundledNpm = path.join(app, 'node/lib/node_modules/npm/bin/npm-cli.js');
if (packaged) {
  if (!fs.existsSync(bundledNode) || !fs.existsSync(bundledNpm) ||
      fs.realpathSync(process.execPath) !== fs.realpathSync(bundledNode)) {
    throw Error('BashKitten requires its bundled Node runtime. Reinstall the package and launch bashkittenctl or bashkitten-pi.');
  }
}
export const npmPrefix = path.join(piAgentDir, 'npm');
const config = path.join(piAgentDir, 'npm-config');
const cache = path.join(piAgentDir, 'npm-cache');
for (const directory of [piAgentDir, npmPrefix, config, cache]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}
const userconfig = path.join(config, 'user.npmrc');
const globalconfig = path.join(config, 'global.npmrc');
for (const file of [userconfig, globalconfig]) {
  try { fs.writeFileSync(file, '', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
// npm also accepts uppercase keys. Clear inherited routing/config (including
// npm lifecycle values) before setting the owned defaults. Project .npmrc and
// explicit CLI options remain normal npm features, not a new sandbox.
for (const key of Object.keys(process.env)) {
  if (/^npm_/i.test(key)) delete process.env[key];
}
Object.assign(process.env, {
  PI_CODING_AGENT_DIR: piAgentDir,
  PI_CODING_AGENT_SESSION_DIR: path.join(piAgentDir, 'sessions'),
  npm_config_prefix: npmPrefix,
  npm_config_cache: cache,
  npm_config_devdir: path.join(cache, 'node-gyp'),
  npm_config_userconfig: userconfig,
  npm_config_globalconfig: globalconfig,
  npm_config_update_notifier: 'false',
});
delete process.env.PI_PACKAGE_DIR;
// Do not inherit standalone Node's module/preload configuration into Pi. The
// product and selected Pi runtime resolve their own modules by absolute paths.
delete process.env.NODE_PATH;
delete process.env.NODE_OPTIONS;
const runtimeBin = packaged ? path.dirname(bundledNode) : path.dirname(process.execPath);
process.env.PATH = [runtimeBin, path.join(npmPrefix, 'bin'), ...(process.env.PATH || '').split(path.delimiter)
  .filter(value => value !== runtimeBin && value !== path.join(npmPrefix, 'bin'))].join(path.delimiter);
process.env.npm_node_execpath = process.execPath;
if (packaged) {
  process.env.OPENSSL_CONF = path.join(app, 'node/etc/openssl.cnf');
  process.env.npm_execpath = bundledNpm;
  process.env.npm_config_nodedir = path.join(app, 'node');
}

// Package controls always select the bundled CLI in installed builds. A source
// checkout deliberately uses the developer's npm and current Node runtime.
export const npmCommand = packaged ? process.execPath : 'npm';
export const npmArgs = args => packaged ? [bundledNpm, ...args] : args;
