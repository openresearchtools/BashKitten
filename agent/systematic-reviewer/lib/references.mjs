// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from the frozen Systematic Reviewer source. See ../NOTICE.
import { normalizeId } from './citation-code.mjs';
export { normalizeId } from './citation-code.mjs';
export function splitIdentity(value) {
  const id = normalizeId(value);
  if (!id.startsWith('bkref:')) throw Error('Legacy identities must first be mapped explicitly by References');
  const [backendId, projectId, itemKey] = id.slice(6).split('/');
  return { id, backendId, projectId, itemKey };
}
export function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.items)) throw Error('Expected a version 1 References snapshot');
  const items = new Map();
  for (const entry of snapshot.items) {
    const id = normalizeId(entry?.id);
    if (items.has(id)) throw Error(`Duplicate reference: ${id}`);
    if (!entry.itemData || typeof entry.itemData !== 'object' || Array.isArray(entry.itemData) || typeof entry.itemData.type !== 'string') throw Error(`Reference ${id} requires complete CSL itemData`);
    items.set(id, { ...entry, id, itemData: { ...entry.itemData, id } });
  }
  return items;
}
