import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const legal = /^(licen[cs]e|copying|notice|copyright)([._-]|$)/i;
async function texts(folder) {
  const result = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) result.push(...await texts(file));
    else if (legal.test(entry.name) || entry.name.endsWith('-NOTICES.txt')) result.push(await fs.readFile(file, 'utf8'));
  }
  return result;
}

// Used at packaging time; source installs generate once when Licenses is opened.
export async function bundledLicenses(root = appRoot) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json')));
  let version;
  try { version = JSON.parse(await fs.readFile(path.join(root, 'build-platform.json'))).version; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!version) {
    try { version = (await fs.readFile(path.join(root, '../browser/bashkitten/config/version.txt'), 'utf8')).trim(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const records = [{ name: 'BashKitten', version: version || pkg.version, license: 'GPL-3.0-only',
    source: 'https://github.com/openresearchtools/bashkitten', text: await fs.readFile(path.join(root, 'LICENSE'), 'utf8') }];
  const seen = new Set();
  for (const [location, item] of Object.entries(lock.packages)) {
    if (!location || item.dev) continue;
    if (!location.startsWith('node_modules/') || location.split('/').includes('..')) throw Error('Invalid package location');
    const folder = path.join(root, location);
    let value;
    try { value = JSON.parse(await fs.readFile(path.join(folder, 'package.json'))); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const key = value.name + '@' + value.version;
    if (seen.has(key)) continue;
    seen.add(key);
    const notices = await texts(folder);
    const supplement = value.name.startsWith('@earendil-works/') ? 'pi'
      : value.name.startsWith('@mariozechner/clipboard') ? 'clipboard'
      : value.name.startsWith('@esbuild/') || value.name === 'esbuild' ? 'esbuild'
      : value.name.startsWith('@aws-sdk/') ? 'aws'
      : ({ 'data-uri-to-buffer': 'data-uri-to-buffer', standardwebhooks: 'standardwebhooks',
        'xml-naming': 'xml-naming', '@nodable/entities': 'entities', 'hash-wasm': 'hash-wasm',
        'proxy-agent-negotiate': 'proxy-agent-negotiate' })[value.name];
    if (supplement) notices.push(...await texts(path.join(root, 'licenses/upstream', supplement)));
    if (!notices.length) throw Error('Missing license text: ' + key);
    records.push({ name: value.name, version: value.version, license: value.license || item.license,
      source: typeof value.repository === 'string' ? value.repository : value.repository?.url,
      text: [...new Set(notices)].join('\n\n') });
  }
  return records;
}

let cached;
export function licenses() {
  return cached ||= fs.readFile(path.join(appRoot, 'licenses.json'), 'utf8').then(JSON.parse)
    .catch(error => { if (error.code === 'ENOENT') return bundledLicenses(); throw error; });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || appRoot);
  const records = await bundledLicenses(root);
  await fs.writeFile(path.join(root, 'licenses.json'), JSON.stringify(records) + '\n');
  console.log('Collected full notices for', records.length - 1, 'bundled npm dependencies');
}
