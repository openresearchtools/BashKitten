// Citation interchange only: this is not a review/extraction database.
const ID = /^(?:users\/[1-9]\d*|groups\/[1-9]\d*|users\/local\/[A-Za-z0-9]+)\/items\/[A-Z0-9]{8}$/;

export function normalizeId(value) {
  if (typeof value !== 'string' || value.length > 256) throw new Error('A Zotero item identity must be a string of at most 256 characters');
  const id = value.replace(/^https?:\/\/(?:www\.)?zotero\.org\//, '');
  if (!ID.test(id)) {
    throw new Error(`Invalid Zotero identity: ${value}. Use users/<userID>/items/<KEY>, groups/<groupID>/items/<KEY>, or a real users/local/<localUserKey>/items/<KEY>; not a database library ID or users/0.`);
  }
  return id;
}

export function zoteroUri(id) {
  // Zotero's integration URI parser uses this historical http URI, not https.
  return `http://zotero.org/${normalizeId(id)}`;
}

export function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.items)) {
    throw new Error('Expected a reference snapshot {version: 1, items: [{id, itemData}]}');
  }
  const items = new Map();
  for (const entry of snapshot.items) {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid reference entry');
    const id = normalizeId(entry.id);
    if (items.has(id)) throw new Error(`Duplicate reference: ${id}`);
    if (!entry.itemData || typeof entry.itemData !== 'object' || Array.isArray(entry.itemData)
        || typeof entry.itemData.type !== 'string' || !entry.itemData.type) {
      throw new Error(`Reference ${id} requires CSL-JSON itemData with a type`);
    }
    const uri = zoteroUri(id);
    items.set(id, { ...entry, id, uri, itemData: { ...entry.itemData, id: uri } });
  }
  return items;
}
