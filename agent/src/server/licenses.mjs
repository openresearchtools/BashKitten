import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
    else if (/^readme(?:\.[^.]+)?$/i.test(entry.name)) {
      // Some pinned npm distributions (for example assert-plus) put the full
      // license in README instead of a separate LICENSE file.
      const text = await fs.readFile(file, 'utf8');
      const section = text.match(/(?:^|\n)#{1,6}\s+(?:licen[cs]e|copyright)[^\n]*\n([\s\S]*?)(?=\n#{1,6}\s|$)/i)?.[0];
      if (section && /permission is hereby granted|redistribution and use|GNU (?:GENERAL|LESSER|AFFERO)/i.test(section)) result.push(section.trim());
    }
  }
  return result;
}

// Used at packaging time; source installs generate once when Licenses is opened.
export async function bundledLicenses(root = appRoot) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
  const piPin = await fs.readFile(path.join(root, 'PI_UPSTREAM.md'), 'utf8');
  const piVersion = piPin.match(/Release: `v([^`]+)`/)?.[1];
  const piCommit = piPin.match(/Commit: `([a-f0-9]{40})`/)?.[1];
  let version;
  try { version = JSON.parse(await fs.readFile(path.join(root, 'build-platform.json'))).version; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!version) {
    try { version = (await fs.readFile(path.join(root, '../browser/bashkitten/config/version.txt'), 'utf8')).trim(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const records = [{ name: 'BashKitten', version: version || pkg.version, license: 'AGPL-3.0-only',
    source: 'https://github.com/openresearchtools/bashkitten', text: await fs.readFile(path.join(root, 'LICENSE'), 'utf8') }];
  const modelNotices = path.join(root, 'src/server/models/third_party');
  const modelProvenance = await fs.readFile(path.join(modelNotices, 'NOTICE'), 'utf8');
  for (const [name, license, file] of [
    ['BashKitten Rust model downloader', 'Apache-2.0', 'BASHKITTEN-RUST-LICENSE'],
    ['SimpleHF', 'MIT', 'SIMPLEHF-LICENSE'],
    ['rust-hf-downloader', 'MIT', 'RUST-HF-DOWNLOADER-LICENSE'],
    ['Pi Hugging Face client reference', 'MIT', 'PI-LICENSE'],
  ]) {
    const text = await fs.readFile(path.join(modelNotices, file), 'utf8');
    if (!text.trim()) throw Error('Missing model downloader license: ' + name);
    records.push({ name, license, component: 'Model downloads', text: modelProvenance + '\n\n' + text });
  }
  records.push(...await npmLicenses(root, { piVersion, piCommit }));
  return records;
}

// Reuse the same locked production dependency notice owner for independently
// versioned modules installed beside the Agent package.
export async function npmLicenses(root, { piVersion, piCommit, supplementRoot = path.join(root, 'licenses/upstream') } = {}) {
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json')));
  const records = [];
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
        'xml-naming': 'xml-naming', '@nodable/entities': 'entities',
        'proxy-agent-negotiate': 'proxy-agent-negotiate', saxes: 'saxes',
        'quickjs-wasi': 'quickjs-wasi' })[value.name];
    let nativeLicense;
    if (value.name === 'quickjs-wasi') {
      const native = path.join(supplementRoot, supplement);
      const pin = JSON.parse(await fs.readFile(path.join(native, 'source.json'), 'utf8'));
      if (pin.npmName !== value.name || pin.version !== value.version) throw Error('QuickJS native license/source version changed');
      nativeLicense = pin.licenseDescription;
      for (const [base, files] of [[folder, pin.nativeAssets], [native, pin.licenseFiles],
        [native, [{ path: 'NATIVE-NOTICES.txt', sha256: pin.nativeNoticeSha256 }]]]) {
        if (!Array.isArray(files) || !files.length) throw Error('Missing QuickJS native license/source inventory');
        for (const file of files) {
          const relative = file.path;
          if (path.isAbsolute(relative) || relative.split('/').includes('..') ||
              createHash('sha256').update(await fs.readFile(path.join(base, relative))).digest('hex') !== file.sha256) throw Error('QuickJS native artifact or license changed: ' + relative);
        }
      }
    }
    if (supplement) notices.push(...await texts(path.join(supplementRoot, supplement)));
    if (!notices.length) throw Error('Missing license text: ' + key);
    const pinnedPi = ['@earendil-works/chord', '@earendil-works/pi-ai', '@earendil-works/pi-agent-core',
      '@earendil-works/pi-codemode', '@earendil-works/pi-coding-agent', '@earendil-works/pi-mcp',
      '@earendil-works/pi-telemetry', '@earendil-works/pi-tui'].includes(value.name)
      && value.version === piVersion && piCommit;
    records.push({ name: value.name, version: value.version, license: nativeLicense || value.license || item.license || (pinnedPi ? 'MIT' : undefined),
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
