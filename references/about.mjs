// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from 'node:fs/promises';

export async function referenceAbout() {
  const [attribution, inventory] = await Promise.all([
    readFile(new URL('./THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'),
    readFile(new URL('../licenses.json', import.meta.url), 'utf8'),
  ]);
  const records = JSON.parse(inventory);
  if (!Array.isArray(records)) throw Error('The packaged References license inventory is invalid');
  const components = records.filter(item => item.component === 'References' ||
    item.component === 'References / npm' || item.name?.startsWith('References capture:'));
  if (!components.length || components.some(item => typeof item.text !== 'string'))
    throw Error('The packaged References license inventory is invalid');
  return {
    name: 'References',
    description: 'BashKitten reference management, page and PDF capture, and document citations. Uses selected Zotero components and the Citation Style Language project; the original authors and licenses are retained below.',
    attribution,
    components,
  };
}
