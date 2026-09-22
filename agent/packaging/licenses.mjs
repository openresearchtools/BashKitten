// SPDX-License-Identifier: GPL-3.0-only
// Merge the inventories shipped by the actual target component artifacts.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { bundledLicenses } from '../src/server/licenses.mjs';

const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
async function legalText(file) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(file));
  if (!text.trim() || text.includes('\0')) throw Error('Missing or invalid license text: ' + file);
  return text;
}
async function relativeText(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw Error('Invalid license inventory path');
  const base = await fs.realpath(root), file = await fs.realpath(path.resolve(root, relative));
  const difference = path.relative(base, file);
  if (difference.startsWith('..' + path.sep) || difference === '..' || path.isAbsolute(difference)) throw Error('License inventory leaves its component: ' + relative);
  return legalText(file);
}
function record(value, component, distribution = 'bundled') {
  if (!value || typeof value.name !== 'string' || !value.name.trim() || typeof value.text !== 'string' || !value.text.trim()) throw Error('Missing full license text in ' + component);
  return { ...value, license: value.license || 'See included license text', component, distribution };
}
async function arrayInventory(file, component) {
  const records = await json(file);
  if (!Array.isArray(records) || !records.length) throw Error('Missing bundled license inventory: ' + file);
  return records.map(value => record(value, component));
}
function compatible(values, target) { return !values || (!values.includes('!' + target) && (values.every(value => value.startsWith('!')) || values.includes(target))); }
async function npmInventory(root, target, architecture) {
  const lock = await json(path.join(root, 'package-lock.json'));
  for (const [location, value] of Object.entries(lock.packages)) {
    if (!location || value.dev || value.optional) continue;
    if (!location.startsWith('node_modules/') || location.split('/').includes('..')) throw Error('Invalid locked production dependency path');
    if (!compatible(value.os, target === 'termux' ? 'android' : 'linux') || !compatible(value.cpu, architecture === 'amd64' ? 'x64' : 'arm64')) continue;
    // Missing required modules must not disappear silently from the notice list.
    const installed = await json(path.join(root, location, 'package.json'));
    if (!installed.name || !installed.version) throw Error('Invalid installed dependency: ' + location);
  }
  return (await bundledLicenses(root)).map(value => record(value, 'Agent / npm'));
}
async function sourceNotices(root, component, specifications) {
  const records = [];
  for (const [name, license, files] of specifications) {
    const text = (await Promise.all(files.map(file => relativeText(root, file)))).join('\n\n');
    records.push(record({ name, license, text }, component));
  }
  return records;
}
async function searchInventory(root, expectedTarget) {
  const runtime = path.join(root, 'search/runtime'), manifest = await json(path.join(runtime, 'manifest.json'));
  if (manifest.target !== expectedTarget) throw Error(`Search runtime target ${manifest.target} does not match ${expectedTarget}`);
  const inventory = await json(path.join(runtime, 'licenses.json'));
  if (inventory.format !== 1 || !Array.isArray(inventory.components) || !inventory.components.length) throw Error('Invalid search license inventory');
  const records = [], included = new Set();
  for (const component of inventory.components) {
    if (!Array.isArray(component.licenseFiles) || !component.licenseFiles.length) throw Error('Missing search license text: ' + component.name);
    const text = (await Promise.all(component.licenseFiles.map(file => relativeText(runtime, file)))).join('\n\n');
    const distribution = manifest.distributions?.find(value => value.name === component.name && value.version === component.version);
    records.push(record({ name: component.name, version: component.version, license: component.license,
      source: distribution?.source?.url, text }, 'Search', component.scope === 'primp-build-source' ? 'source' : 'bundled'));
    included.add(component.name + '@' + component.version);
  }
  if (!Array.isArray(manifest.distributions) || !manifest.distributions.length) throw Error('Search runtime has no installed distribution inventory');
  for (const component of manifest.distributions) {
    if (component.scope === 'bundled' && !included.has(component.name + '@' + component.version)) throw Error(`Missing search runtime notices: ${component.name}@${component.version}`);
    if (component.scope === 'system') records.push(record({ name: component.package || component.name, version: component.version,
      license: 'External package', text: `${component.package || component.name} is installed separately by the operating-system package manager. It is not bundled in this search runtime and remains governed by its package licenses and accompanying notices.` }, 'Search', 'external'));
  }
  records.push(...await sourceNotices(path.join(root, 'search'), 'Search', [
    ['BashKitten Search / Buzzard Search / Unsloth Studio', 'AGPL-3.0-only', ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'third_party/unsloth-studio/LICENSE']],
    ['pi-web-access repository reader', 'MIT', ['third_party/pi-web-access/LICENSE']],
    ['youtube-transcript-api', 'MIT', ['third_party/youtube-transcript-api/LICENSE']],
  ]));
  return records;
}

export async function collectLicenses(root, { target, version, browser } = {}) {
  root = path.resolve(root);
  if (!['linux', 'termux'].includes(target)) throw Error('Choose the linux or termux package target');
  const auth = await json(path.join(root, 'auth/share/metadata/runtime.json'));
  if (!auth.target?.startsWith(target === 'termux' ? 'termux-' : 'linux-') || !['amd64', 'arm64', 'aarch64'].includes(auth.architecture)) throw Error('Native access stack does not match the package target');
  const components = new Set(auth.components?.map(value => value.name));
  for (const name of ['authelia', 'caddy', 'tor']) {
    if (!components.has(name)) throw Error('Missing native access component: ' + name);
    await fs.access(path.join(root, 'auth/bin', name));
    await legalText(path.join(root, 'auth/share/licenses', name, 'LICENSE'));
  }
  const records = await npmInventory(root, target, auth.architecture);
  if (version) records[0].version = version;
  records.push(...await arrayInventory(path.join(root, 'auth/licenses.json'), 'Access stack'));
  records.push(...await searchInventory(root, auth.target));
  const integration = await json(path.join(root, 'pi/package.json'));
  records.push(...await sourceNotices(path.join(root, 'pi'), 'Pi integration', [
    [integration.name, integration.license, ['LICENSE', 'NOTICE']],
  ]));
  if (target === 'linux') {
    if (!browser) throw Error('The complete Linux package requires its built browser license inventory');
    records.push(...await arrayInventory(path.join(path.resolve(browser), 'notices/licenses.json'), 'Browser'));
  } else if (browser) throw Error('The Termux package does not bundle the Android browser');
  const external = target === 'termux'
    ? 'Termux, Node.js, Python, Git, GitHub CLI and the declared Termux packages are installed separately, not embedded in this package. Each is governed by its own package license and accompanying notices. The Android BashKitten browser is a separate APK with its own offline About and licenses.'
    : 'Node.js, Python, GTK, operating-system graphics/audio libraries, Git, GitHub CLI and other declared system dependencies are installed separately. They retain their own package licenses and notices. Optional llama.cpp is installed as its own APT package, with its own native dependency notices; GPU drivers and model weights are not bundled here.';
  records.push(record({ name: 'External platform packages', license: 'Separate package licenses', text: external }, 'Platform', 'external'));
  // Keep distinct versions and changed texts even when names coincide across modules.
  const unique = new Map();
  for (const value of records) {
    const key = [value.component, value.name, value.version || '', value.distribution, createHash('sha256').update(value.text).digest('hex')].join('\0');
    unique.set(key, value);
  }
  const result = [...unique.values()];
  await fs.writeFile(path.join(root, 'licenses.json'), JSON.stringify(result) + '\n');
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { target: { type: 'string' }, version: { type: 'string' }, browser: { type: 'string' } } });
  if (positionals.length !== 1) throw Error('Usage: licenses.mjs APP_ROOT --target linux|termux [--browser BUILT_BROWSER] [--version VERSION]');
  const records = await collectLicenses(positionals[0], values);
  console.log(`Collected ${records.length} full component notices for ${values.target}`);
}
