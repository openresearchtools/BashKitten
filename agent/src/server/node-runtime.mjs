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
if (process.platform === 'android') {
  // Launchers set this before Node starts. Retain it for tool and worker
  // descendants; using Android's linker as the executable breaks execPath and
  // native process ownership. Do not spoof process.execPath or remove the check.
  process.env.TERMUX_EXEC__SYSTEM_LINKER_EXEC__MODE = 'disable';
}
if (packaged) {
  if (!fs.existsSync(bundledNode) || !fs.existsSync(bundledNpm) || !fs.existsSync(path.join(app, 'node/bin/pi')) ||
      fs.realpathSync(process.execPath) !== fs.realpathSync(bundledNode)) {
    const termux = process.platform === 'android' ? ' Termux must support direct native execution (the GitHub/F-Droid app targeting SDK 28); system-linker execution is unsupported.' : '';
    throw Error('BashKitten requires its bundled Node runtime. Reinstall the package and launch bashkittenctl or bashkitten-pi.' + termux);
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
  npm_package_config_node_gyp_devdir: path.join(cache, 'node-gyp'),
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
// Installed builds ship an immutable pi launcher beside Node. Checkouts need
// their own shim before the developer Node's bin, which may contain another Pi.
let developmentBin;
if (!packaged) {
  developmentBin = path.join(piAgentDir, 'bin');
  fs.mkdirSync(developmentBin, { recursive: true, mode: 0o700 });
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const shell = process.platform === 'android' ? '/data/data/com.termux/files/usr/bin/sh' : '/bin/sh';
  const contents = `#!${shell}\nexec ${quote(process.execPath)} ${quote(path.join(app, 'src/server/rpc/launcher.mjs'))} "$@"\n`;
  const file = path.join(developmentBin, 'pi');
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== contents) {
    const temporary = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(temporary, contents, { mode: 0o700 }); fs.renameSync(temporary, file);
  }
}
const ownedBins = [...(developmentBin ? [developmentBin] : []), runtimeBin, path.join(npmPrefix, 'bin')];
process.env.PATH = [...ownedBins, ...(process.env.PATH || '').split(path.delimiter)
  .filter(value => !ownedBins.includes(value))].join(path.delimiter);
process.env.npm_node_execpath = process.execPath;
if (packaged) {
  process.env.OPENSSL_CONF = path.join(app, 'node/etc/openssl.cnf');
  process.env.npm_execpath = bundledNpm;
  process.env.npm_package_config_node_gyp_nodedir = path.join(app, 'node');
}

// Package controls always select the bundled CLI in installed builds. A source
// checkout deliberately uses the developer's npm and current Node runtime.
export const npmCommand = packaged ? process.execPath : 'npm';
export const npmArgs = args => packaged ? [bundledNpm, ...args] : args;
