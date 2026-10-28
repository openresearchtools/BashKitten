// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';
const keyPair = promisify(generateKeyPair);
const defaultRoot = fileURLToPath(new URL('../runtime/', import.meta.url));
const unavailable = message => Object.assign(new Error('Office unavailable: ' + message), { status: 503, code: 'office_runtime_unavailable' });
const exact = '42745e44dd8530fac7acd5f46cb7571ceea63c6a';
const requiredPatches = ['native-locked-light-theme', 'native-extensions-small-screen-dialog', 'native-proof-key-path', 'native-document-property-undo', 'native-field-command-undo', 'native-ooxml-user-attributes'];
function relative(root, value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split(/[\\/]/).some(part => part === '..') || value.includes('\0')) throw unavailable('invalid native artifact path');
  return path.join(root, value);
}
export async function prepareOffice({ dataRoot, componentRoot = defaultRoot, port, wopiURL, publicOrigins = [], serviceRoot = '', signal } = {}) {
  if (!path.isAbsolute(dataRoot || '')) throw unavailable('an environment data root is required');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw unavailable('the existing service owner must allocate the Office loopback port');
  if (!/^\/(?:[A-Za-z0-9_-]+\/?)*$/.test(serviceRoot) && serviceRoot !== '') throw unavailable('invalid native service prefix');
  const callback = new URL(wopiURL);
  if (!['http:', 'https:'].includes(callback.protocol) || callback.username || callback.password) throw unavailable('invalid owned WOPI callback URL');
  const origins = publicOrigins.map(value => { const url = new URL(value); if (url.protocol !== 'https:' || url.origin !== value) throw unavailable('public Office host origins must use HTTPS'); return url.origin; });
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(componentRoot, 'manifest.json'), 'utf8')); }
  catch { throw unavailable('the native component artifact is not installed'); }
  if (manifest.schema !== 1 || manifest.revision !== exact || manifest.apiVersion !== 1 || requiredPatches.some(id => !manifest.patches?.includes(id))) throw unavailable('the native component does not match the pinned API, field/attribute persistence, undo and UI policy contracts');
  const paths = Object.fromEntries(['coolwsd', 'engine', 'web', 'config', 'systemplateSetup'].map(key => [key, relative(componentRoot, manifest.paths?.[key])]));
  for (const [name, value] of Object.entries(paths)) {
    try { await fs.access(value, ['coolwsd', 'systemplateSetup'].includes(name) ? fs.constants.X_OK : fs.constants.R_OK); }
    catch { throw unavailable('the native component is incomplete: ' + name); }
  }
  const extensionPath = path.join(componentRoot, 'share', 'bashkitten', 'org.bashkitten.references.zip');
  let extensionBytes;
  try { const stat = await fs.stat(extensionPath); if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw Error('Invalid plugin size'); extensionBytes = await fs.readFile(extensionPath); }
  catch { throw unavailable('the replaceable References extension package is missing'); }
  const extension = { path: extensionPath, sha256: createHash('sha256').update(extensionBytes).digest('hex') };
  signal?.throwIfAborted();
  const directory = path.join(dataRoot, 'services', 'office', 'native');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const proof = path.join(directory, 'proof_key');
  try { await fs.access(proof); }
  catch {
    const { privateKey } = await keyPair('rsa', { modulusLength: 4096, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    signal?.throwIfAborted();
    try { await fs.writeFile(proof, privateKey, { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  await fs.chmod(proof, 0o600);
  const template = await fs.readFile(paths.config, 'utf8');
  if (/@[A-Z][A-Z_]+@/.test(template)) throw unavailable('the installed native configuration still contains build placeholders');
  const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapeXML = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const callbackHost = callback.protocol + '//' + escapeRegex(callback.hostname) + ':' + (callback.port || (callback.protocol === 'https:' ? '443' : '80'));
  if (!/<alias_groups\b[^>]*>[\s\S]*?<\/alias_groups>/.test(template)) throw unavailable('the pinned native WOPI alias configuration is missing');
  // HostUtil requires the parent XML <group> to exist. A leaf --o override
  // alone does not create that node in Poco's layered configuration.
  const configuration = template.replace(/<alias_groups\b[^>]*>[\s\S]*?<\/alias_groups>/, '<alias_groups mode="groups"><group><host allow="true">' + escapeXML(callbackHost) + '</host></group></alias_groups>');
  const config = path.join(directory, 'coolwsd.xml');
  await fs.writeFile(config + '.new', configuration, { mode: 0o600 }); await fs.rename(config + '.new', config);
  const systemplate = path.join(directory, 'systemplate'), children = path.join(directory, 'jails'), cache = path.join(directory, 'cache');
  await Promise.all([children, cache].map(value => fs.mkdir(value, { recursive: true, mode: 0o700 })));
  const options = {
    'proof_key.path': proof, 'sys_template_path': systemplate, 'child_root_path': children,
    'file_server_root_path': paths.web,
    'cache_files.path': cache, 'net.proto': 'IPv4', 'net.listen': 'loopback',
    'net.service_root': serviceRoot, 'net.content_security_policy': origins.length ? 'frame-ancestors ' + origins.join(' ') + ';' : '',
    'ssl.enable': 'false', 'ssl.termination': 'true', 'experimental_features': 'true',
    'storage.wopi[@allow]': 'true',
    'admin_console.enable': 'false', 'zotero.enable': 'false',
    'fetch_update_check': '0', 'allow_update_popup': 'false',
    'remote_config.remote_url': '', 'remote_font_config.url': '',
    'logging.level': 'warning', 'logging.level_startup': 'warning', 'logging.protocol': 'false',
    'browser_logging': 'false', 'stop_on_config_change': 'true',
  };
  const nativeArgv = [paths.coolwsd, '--disable-cool-user-checking', '--config-file=' + config, '--lo-template-path=' + paths.engine, '--port=' + port, ...Object.entries(options).map(([key, value]) => '--o:' + key + '=' + value)];
  const termux = (manifest.target || manifest.platform) === 'termux';
  // Native ForKit correctly rejects a non-cool user inheriting capabilities.
  // Drop the parent's unrelated Linux capability inheritance before native
  // startup; preserve ForKit's checks, namespace selection and seccomp policy.
  if (!termux) { try { await fs.access('/usr/bin/setpriv', fs.constants.X_OK); } catch { throw unavailable('the packaged Linux util-linux dependency is missing'); } }
  const argv = termux ? nativeArgv : ['/usr/bin/setpriv', '--inh-caps=-all', '--ambient-caps=-all', '--', ...nativeArgv];
  const launch = path.join(directory, 'launch.json');
  const artifactRevision = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  await fs.writeFile(launch + '.new', JSON.stringify({ schema: 1, revision: artifactRevision, argv, cwd: directory, systemplateSetup: paths.systemplateSetup, systemplate, engine: paths.engine }), { mode: 0o600 });
  await fs.rename(launch + '.new', launch);
  const configRevision = createHash('sha256').update(JSON.stringify({ manifest, configuration, argv })).digest('hex');
  const service = { id: 'office', name: 'Office', enabled: false, startup: false, configRevision, kind: 'web', scheme: 'http', openPath: serviceRoot + '/', target: { network: 'tcp', address: '127.0.0.1:' + port }, command: { argv: [process.execPath, fileURLToPath(new URL('./launch.mjs', import.meta.url)), launch], cwd: directory, env: { BASHKITTEN_OFFICE_CONFIG_REVISION: configRevision, ...((manifest.target || manifest.platform) === 'termux' ? { COOL_FORCE_LANDLOCK: '1', PREFIX: '/data/data/com.termux/files/usr', LD_LIBRARY_PATH: path.join(paths.engine, 'program') } : {}) } } };
  return { service, collaboraInternalURL: 'http://127.0.0.1:' + port + serviceRoot, editorBasePath: serviceRoot, wopiURL, extension };
}
