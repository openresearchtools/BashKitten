#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Build a replaceable native extension from its owners' actual sources.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
export async function packageExtension(destination) {
  if (!path.isAbsolute(destination)) throw Error('Use an absolute extension output directory');
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(path.join(root, 'extension'), destination, { recursive: true });
  // Released FileServer assigns the JavaScript MIME type to .js, not .mjs.
  // Keep Node's source module suffix; deploy normal browser modules to native COOL.
  for (const name of await fs.readdir(destination)) {
    if (!/\.(mjs|html)$/.test(name)) continue;
    const original = path.join(destination, name), deployed = path.join(destination, name.replace(/\.mjs$/, '.js'));
    const source = (await fs.readFile(original, 'utf8')).replace(/\.mjs(['"])/g, '.js$1');
    await fs.writeFile(deployed, source);
    if (deployed !== original) await fs.unlink(original);
  }
  const shared = path.join(destination, 'shared'); await fs.mkdir(shared, { recursive: true });
  for (const name of ['shared-citation-dialog.js', 'common.js', 'virtual-list.js', 'collections.js', 'references.css']) await fs.copyFile(path.join(root, '..', 'references', 'web', name), path.join(shared, name));
  await fs.writeFile(path.join(destination, 'bashkitten-extension.json'), JSON.stringify({ version: '1.0.0', nativeApi: 1, sourceRevision: '42745e44dd8530fac7acd5f46cb7571ceea63c6a', sharedChooser: 'References web', capabilities: ['Writer', 'Calc', 'Impress'], requiredPatches: ['native-extensions-small-screen-dialog', 'native-extension-dialog-commands', 'native-extension-short-dialog-frame', 'native-extension-overflow-group-id', 'native-document-property-undo', 'native-field-command-undo', 'native-ooxml-user-attributes', 'native-uno-undo-view', 'native-uno-shape-undo', 'native-text-edit-state', 'native-attribute-undo-text', 'native-product-branding'] }, null, 2) + '\n');
  return destination;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await packageExtension(path.resolve(process.argv[2] || '')));
