// SPDX-License-Identifier: AGPL-3.0-or-later
import { normalizeId } from './references.mjs';
import { ZoteroClient, ZoteroError } from './zotero.mjs';

const fail = message => new ZoteroError(message);
const scope = id => id.slice(0, id.lastIndexOf('/items/'));
const key = id => id.slice(id.lastIndexOf('/') + 1);
const route = id => id.replace(/^users\/local\/[^/]+/, 'users/0');
function identity(value) {
  try { return normalizeId(value); }
  catch { throw fail('Use a verified library-qualified Zotero identity; bare keys and users/0 are not citation identities.'); }
}

function checkItem(raw, id) {
  if (raw?.key !== key(id) || raw?.data?.key !== key(id)) throw fail('Zotero attachment/item identity mismatch.');
  const library = raw.library;
  const expected = scope(id);
  const returned = library?.type === 'user' ? `users/${library.id}` : library?.type === 'group' ? `groups/${library.id}` : null;
  if (expected.startsWith('users/local/')) {
    if (returned !== 'users/0') throw fail('Zotero returned a different library for this local identity.');
  } else if (returned !== expected) throw fail('Zotero returned a different library for this identity.');
  return raw.data;
}

async function verifyParent(client, id, signal) {
  const result = await client.get(route(id), { format: 'json', include: 'data,csljson' }, signal);
  const data = checkItem(result.data, id);
  if (typeof data.itemType !== 'string' || ['attachment', 'note', 'annotation'].includes(data.itemType)) throw fail('Expected a bibliographic parent item, not an attachment, note or annotation.');
  // users/0 is only a route. The parent's CSL export supplies the actual local
  // user key; never qualify attachment keys using a caller's unverified alias.
  if (scope(id).startsWith('users/local/')) {
    let csl = result.data.csljson;
    if (typeof csl === 'string') { try { csl = JSON.parse(csl); } catch { throw fail('Invalid parent CSL identity.'); } }
    if (Array.isArray(csl)) csl = csl.length === 1 ? csl[0] : null;
    if (identity(csl?.id) !== id) throw fail('Zotero returned a different local parent identity.');
  }
  return result;
}

function describe(raw, id, parentId) {
  const data = checkItem(raw, id);
  if (data.itemType !== 'attachment' || (parentId && data.parentItem !== key(parentId))) throw fail('Zotero returned an item outside the requested attachment relationship.');
  return { id, parentId: parentId ?? null, itemVersion: raw.version ?? null, title: data.title ?? '',
    contentType: data.contentType ?? null, linkMode: data.linkMode ?? null,
    filename: data.filename ?? null, sourceUrl: data.url ?? null };
}

function provenance(result) {
  return { source: result.url, serverId: result.serverId ?? null, retrievedAt: new Date().toISOString(), mode: 'local' };
}

/** One explicit page of child attachments; does not fetch files or indexed text. */
export async function listAttachments({ id, limit = 100, start = 0, localUrl, signal } = {}, { client = new ZoteroClient({ localUrl }) } = {}) {
  id = identity(id);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(start) || start < 0) throw fail('Attachment limit must be 1–100 and start a nonnegative safe integer.');
  await verifyParent(client, id, signal);
  const result = await client.get(`${route(id)}/children`, { format: 'json', itemType: 'attachment', limit, start }, signal);
  if (!Array.isArray(result.data) || result.data.length > limit) throw fail('Zotero returned an invalid attachment page.');
  const seen = new Set();
  const items = result.data.map(raw => {
    if (!/^[A-Z0-9]{8}$/.test(raw?.key) || seen.has(raw.key)) throw fail('Zotero returned duplicate or invalid attachment keys.');
    seen.add(raw.key);
    // This scope was verified above against the API; the children endpoint and
    // parentItem check establish the child key belongs to this parent/library.
    return describe(raw, `${scope(id)}/items/${raw.key}`, id);
  });
  const total = result.total !== null && /^\d+$/.test(result.total) ? Number(result.total) : null;
  if (total !== null && (!Number.isSafeInteger(total) || (items.length === 0 && start < total) || (items.length > 0 && start + items.length > total))) throw fail('Zotero returned incomplete attachment pagination.');
  return { version: 1, parentId: id, items, provenance: provenance(result),
    page: { start, limit, total, nextStart: (total !== null ? start + items.length < total : items.length === limit) && items.length ? start + items.length : null } };
}

function coverage(data) {
  const values = {};
  const states = [];
  for (const unit of ['Pages', 'Chars']) {
    const indexed = data[`indexed${unit}`] ?? null;
    const total = data[`total${unit}`] ?? null;
    if ([indexed, total].some(value => value !== null && (!Number.isSafeInteger(value) || value < 0)) || (indexed !== null && total !== null && indexed > total)) throw fail('Zotero returned invalid full-text coverage counters.');
    values[`indexed${unit}`] = indexed;
    values[`total${unit}`] = total;
    if (indexed !== null && total !== null && total > 0) states.push(indexed < total ? 'partial' : 'complete');
  }
  return { ...values, status: states.includes('partial') ? 'partial' : states.includes('complete') ? 'complete' : 'unknown' };
}

/** Return the complete cached response and its indexing coverage; never infer
 * that indexed text contains every figure, table, page or OCR character. */
export async function attachmentText({ id, localUrl, signal } = {}, { client = new ZoteroClient({ localUrl }) } = {}) {
  id = identity(id);
  const metadata = await client.get(route(id), { format: 'json' }, signal);
  const data = checkItem(metadata.data, id);
  if (data.itemType !== 'attachment') throw fail('The requested item is not an attachment.');
  let parentId;
  if (data.parentItem) {
    if (!/^[A-Z0-9]{8}$/.test(data.parentItem)) throw fail('Zotero returned an invalid attachment parent key.');
    parentId = `${scope(id)}/items/${data.parentItem}`;
    await verifyParent(client, parentId, signal);
  } else if (scope(id).startsWith('users/local/')) throw fail('Cannot verify a standalone unsynced attachment identity through this API; use an attachment linked to a verified bibliographic parent.');
  const item = describe(metadata.data, id, parentId);
  let result;
  try { result = await client.get(`${route(id)}/fulltext`, {}, signal); }
  catch (error) {
    // The existing read client exposes sanitized HTTP status messages.
    if (!(error instanceof ZoteroError) || error.message !== 'Zotero HTTP 404') throw error;
    return { version: 1, item, status: 'missing', content: null, coverage: coverage({}), provenance: provenance({ ...metadata, url: metadata.url.split('?')[0] + '/fulltext' }),
      note: 'Zotero has no cached text for this attachment or its format is not indexed. No source text was read; inspect the attachment in Zotero or use an explicit extraction tool.' };
  }
  if (typeof result.data?.content !== 'string') throw fail('Zotero returned invalid cached full text.');
  return { version: 1, item, status: result.data.content.length ? 'available' : 'empty', content: result.data.content,
    coverage: coverage(result.data), provenance: provenance(result),
    note: 'Coverage describes Zotero indexing, not proof of complete source reading or accurate OCR. Review partial/unknown coverage and inspect figures/tables in the source as needed.' };
}
