// SPDX-License-Identifier: AGPL-3.0-or-later
// SQLite is synchronous by design; its connection and every query live off the HTTP loop.
import { parentPort } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { readFileSync, mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import {
  workIdentifierFields, workIdentifiers, workIdentifierEntries, normalizeWorkMetadata,
  canonicalWorkIdentifier, workIdentifierKind,
} from "../adapted/work-identity.mjs";
import { selectAbstract } from "../adapted/openalex.mjs";
const itemSchema = JSON.parse(
  readFileSync(
    new URL("../vendor/schema/source/schema.json", import.meta.url),
    "utf8",
  ),
);
const itemTypes = new Map(
  itemSchema.itemTypes.map((type) => [type.itemType, type]),
);
const summaryFields = new Set([
  "itemType",
  "title",
  "creators",
  "date",
  "collections",
  "tags",
  "deleted",
  "attachmentCount",
]);
const projectedFields = new Set([
  ...itemSchema.itemTypes.flatMap((type) =>
    type.fields.flatMap(({ field, baseField }) =>
      baseField ? [field, baseField] : [field],
    ),
  ),
  ...summaryFields,
  "dateAdded",
  "dateModified",
  ...workIdentifierFields,
]);
const connections = new Map();
const key = () => randomBytes(8).toString("hex").toUpperCase();
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
function connection(file) {
  if (connections.has(file)) {
    const db = connections.get(file);
    connections.delete(file);
    connections.set(file, db);
    return db;
  }
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout=5000');
  const priorSchemaVersion = db.prepare("PRAGMA user_version").get().user_version;
  const hasCollectionSearch = db
    .prepare("SELECT name FROM sqlite_master WHERE name='collection_search'")
    .get();
  chmodSync(file, 0o600);
  // SQLite cannot always wait when two fresh connections switch journal mode.
  // Retry this one setup transition in the storage worker; writes themselves use
  // SQLite's native busy timeout and BEGIN IMMEDIATE serialization.
  for (let attempt = 0; ; attempt++) {
    try { db.exec('PRAGMA journal_mode=WAL'); break; }
    catch (error) {
      if (attempt >= 19 || error.message !== 'database is locked') { db.close(); throw error; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
    INSERT OR IGNORE INTO state VALUES(1,0);
    CREATE TABLE IF NOT EXISTS items (key TEXT PRIMARY KEY, version INTEGER NOT NULL, type TEXT NOT NULL,
      title TEXT NOT NULL, creator TEXT NOT NULL, year TEXT NOT NULL, modified TEXT NOT NULL,
      parent TEXT REFERENCES items(key), deleted INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS items_title ON items(deleted,title,key);
    CREATE INDEX IF NOT EXISTS items_creator ON items(deleted,creator,key);
    CREATE INDEX IF NOT EXISTS items_year ON items(deleted,year,key);
    CREATE INDEX IF NOT EXISTS items_type ON items(deleted,type,key);
    CREATE INDEX IF NOT EXISTS items_modified ON items(deleted,modified,key);
    CREATE INDEX IF NOT EXISTS items_parent ON items(parent,key);
    CREATE VIRTUAL TABLE IF NOT EXISTS item_search USING fts5(key UNINDEXED, title, creators, fields, tags, tokenize='unicode61 remove_diacritics 2');
    CREATE TABLE IF NOT EXISTS collections (key TEXT PRIMARY KEY, version INTEGER NOT NULL, name TEXT NOT NULL, parent TEXT REFERENCES collections(key), data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS collections_parent ON collections(parent,name,key);
    CREATE VIRTUAL TABLE IF NOT EXISTS collection_search USING fts5(name,content='collections',content_rowid='rowid',tokenize='unicode61 remove_diacritics 2');
    CREATE TRIGGER IF NOT EXISTS collection_search_insert AFTER INSERT ON collections BEGIN
      INSERT INTO collection_search(rowid,name) VALUES(new.rowid,new.name); END;
    CREATE TRIGGER IF NOT EXISTS collection_search_delete AFTER DELETE ON collections BEGIN
      INSERT INTO collection_search(collection_search,rowid,name) VALUES('delete',old.rowid,old.name); END;
    CREATE TRIGGER IF NOT EXISTS collection_search_update AFTER UPDATE ON collections BEGIN
      INSERT INTO collection_search(collection_search,rowid,name) VALUES('delete',old.rowid,old.name);
      INSERT INTO collection_search(rowid,name) VALUES(new.rowid,new.name); END;
    CREATE TABLE IF NOT EXISTS memberships (item TEXT REFERENCES items(key) ON DELETE CASCADE, collection TEXT REFERENCES collections(key) ON DELETE CASCADE, PRIMARY KEY(collection,item));
    CREATE INDEX IF NOT EXISTS memberships_item ON memberships(item,collection);
    CREATE TABLE IF NOT EXISTS identifiers (kind TEXT NOT NULL, value TEXT NOT NULL, item TEXT REFERENCES items(key) ON DELETE CASCADE, PRIMARY KEY(kind,value,item));
    CREATE INDEX IF NOT EXISTS identifiers_item ON identifiers(item,kind,value);
    CREATE TABLE IF NOT EXISTS item_aliases (alias TEXT PRIMARY KEY, item TEXT NOT NULL REFERENCES items(key), created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS item_aliases_item ON item_aliases(item,alias);
    CREATE TABLE IF NOT EXISTS fulltext (item TEXT PRIMARY KEY REFERENCES items(key) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS receipt_versions (prefix TEXT PRIMARY KEY, version INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS receipts_jobs_created ON receipts(json_extract(data,'$.createdAt') DESC,id) WHERE substr(id,1,4)='job:';
    CREATE TABLE IF NOT EXISTS searches (key TEXT PRIMARY KEY,version INTEGER NOT NULL,name TEXT NOT NULL,data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS searches_name ON searches(name,key);
    CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    `);
  if (priorSchemaVersion < 2) migrateWorkIdentifiers(db);
  connections.set(file, db);
  if (!hasCollectionSearch)
    db.exec(
      "INSERT INTO collection_search(collection_search) VALUES('rebuild')",
    );
  if (connections.size > 8) {
    const [old, value] = connections.entries().next().value;
    value.close();
    connections.delete(old);
  }
  return db;
}
const version = (db) =>
  db.prepare("SELECT version FROM state WHERE id=1").get().version;
function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
const nextVersion = (db) => {
  db.exec("UPDATE state SET version=version+1 WHERE id=1");
  return version(db);
};
const decode = (row) =>
  row
    ? { key: row.key, version: row.version, data: JSON.parse(row.data) }
    : null;
const regularItem = data => !data.parentItem && !['attachment', 'note', 'annotation'].includes(data.itemType);
function canonicalKey(db, itemKey) {
  return db.prepare('SELECT item FROM item_aliases WHERE alias=?').get(itemKey)?.item || itemKey;
}
function getItem(db, itemKey) {
  const canonical = canonicalKey(db, itemKey);
  const item = decode(db.prepare('SELECT * FROM items WHERE key=?').get(canonical));
  if (!item) fail('Item not found', 404);
  if (regularItem(item.data)) {
    try { Object.assign(item.data, workIdentifiers(item.data, { strict: false })); }
    catch { /* A contradictory legacy record remains readable for correction. */ }
  }
  return canonical === itemKey ? item : { ...item, requestedKey: itemKey };
}
function indexIdentifiers(db, itemKey, data, legacy = false) {
  db.prepare('DELETE FROM identifiers WHERE item=?').run(itemKey);
  if (!regularItem(data)) return;
  let identities;
  try { identities = workIdentifierEntries(data, { strict: !legacy }); }
  catch (error) {
    if (!legacy) throw error;
    // Index each valid piece of contradictory old evidence. A future matching
    // import then reports the conflict instead of silently creating a third item.
    const fields = { ...data.provenance?.identifiers, ...data };
    identities = [];
    const add = (kind, value) => {
      if (!value) return;
      try { const id = canonicalWorkIdentifier(kind, value); if (id) identities.push([id.type, id.value]); } catch {}
    };
    for (const [kind, value] of Object.entries(data.provenance?.identifiers || {})) add(kind, value);
    for (const [kind, value] of Object.entries(fields)) add(kind, value);
    add('OpenAlex', data.provenance?.openalex?.id);
    for (const line of String(data.extra || '').split(/\r?\n/)) {
      const match = line.match(/^\s*([^:]+):\s*(.+)$/);
      if (match) add(match[1], match[2]);
    }
  }
  const insert = db.prepare('INSERT OR IGNORE INTO identifiers VALUES(?,?,?)');
  for (const [kind, value] of identities) insert.run(kind, value, itemKey);
}
function migrateWorkIdentifiers(db) {
  transaction(db, () => {
    // Keyset pages bound migration memory; the only synchronous work stays in
    // the existing SQLite worker. Never re-scan a completed migration on open.
    db.exec('DELETE FROM identifiers');
    let cursor = '';
    const page = db.prepare('SELECT key,data FROM items WHERE key>? ORDER BY key LIMIT 200');
    while (true) {
      const rows = page.all(cursor);
      if (!rows.length) break;
      for (const row of rows) indexIdentifiers(db, row.key, JSON.parse(row.data), true);
      cursor = rows.at(-1).key;
    }
    db.exec('PRAGMA user_version=2');
  });
}
function identityMatches(db, identifiers) {
  const found = new Map();
  const query = db.prepare(`SELECT i.* FROM identifiers d JOIN items i ON i.key=d.item
    WHERE d.kind=? AND d.value=? AND i.deleted=0 AND i.parent IS NULL
    AND i.type NOT IN ('attachment','note','annotation') LIMIT 201`);
  for (const [kind, value] of (Array.isArray(identifiers) ? identifiers : Object.entries(identifiers))) {
    for (const row of query.all(kind, value)) found.set(row.key, row);
    if (found.size > 200) fail('More than 200 records share this identity; reconcile them in bounded groups', 409);
  }
  return [...found.values()];
}
const empty = value => value == null || value === '' || (Array.isArray(value) && !value.length);
function mergeTags(first = [], second = []) {
  const tags = new Map();
  for (const value of [...first, ...second]) {
    const name = typeof value === 'string' ? value : value.tag;
    const current = tags.get(name);
    if (!current || (typeof current !== 'string' && current.type === 1)) tags.set(name, value);
  }
  return [...tags.values()];
}
function mergeObject(first = {}, second = {}) {
  const result = { ...first };
  for (const [field, value] of Object.entries(second)) {
    if (empty(result[field])) result[field] = value;
    else if (value && typeof value === 'object' && !Array.isArray(value)
      && typeof result[field] === 'object' && !Array.isArray(result[field]))
      result[field] = mergeObject(result[field], value);
  }
  return result;
}
function enrichMetadata(first, second) {
  const result = { ...first };
  const manual = new Set(first.provenance?.manualFields || []);
  const incomingManual = new Set(second.provenance?.manualFields || []);
  for (const [field, value] of Object.entries(second)) {
    if (['key','version','createKey','parentItem','deleted','dateAdded','dateModified','provenance','relations','extra','tags','collections'].includes(field)) continue;
    if (!manual.has(field) && (empty(result[field]) || incomingManual.has(field))) result[field] = value;
  }
  const incomingAbstract = typeof second.abstractNote === 'string' ? second.abstractNote.trim() : '';
  if (!manual.has('abstractNote') && !incomingManual.has('abstractNote') && incomingAbstract && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(incomingAbstract)) {
    const existing = typeof first.abstractNote === 'string' ? first.abstractNote : '';
    // Retain V3's protection for a good pre-existing/manual abstract. Imported
    // abstracts with recorded source provenance may grow when better metadata
    // arrives; malformed reconstructed OpenAlex abstracts never reach this path.
    result.abstractNote = first.provenance?.source && incomingAbstract.length > existing.trim().length
      ? incomingAbstract : selectAbstract(incomingAbstract, existing).text;
  }
  result.tags = mergeTags(first.tags, second.tags);
  result.collections = [...new Set([...(first.collections || []), ...(second.collections || [])])];
  result.extra = [...new Set([...String(first.extra || '').split('\n'), ...String(second.extra || '').split('\n')].filter(Boolean))].join('\n');
  result.relations = { ...first.relations };
  for (const [predicate, values] of Object.entries(second.relations || {}))
    result.relations[predicate] = [...new Set([].concat(result.relations[predicate] || [], values))];
  result.provenance = mergeObject(first.provenance, second.provenance);
  const primary = {};
  const aliases = {};
  for (const [kind, value] of [...workIdentifierEntries(first), ...workIdentifierEntries(second)]) {
    primary[kind] ||= result[kind] || value;
    aliases[kind] ||= new Set();
    if (value !== primary[kind]) aliases[kind].add(value);
  }
  result.provenance.identifiers = { ...result.provenance.identifiers, ...primary };
  result.provenance.identifierAliases = Object.fromEntries(Object.entries(aliases).filter(([, values]) => values.size).map(([kind, values]) => [kind, [...values]]));
  result.extra = result.extra.split('\n').filter(line => {
    const match = line.match(/^\s*([^:]+):\s*(.+)$/);
    const kind = match && workIdentifierKind(match[1]);
    return !kind || !primary[kind] || canonicalWorkIdentifier(kind, match[2])?.value === primary[kind];
  }).join('\n');
  // Historical source objects are retained in the transaction receipt below;
  // the visible source details describe the newly selected abstract accurately.
  if (second.provenance?.openalex) result.provenance.openalex = second.provenance.openalex;
  if (result.provenance.openalex && primary.OpenAlex)
    result.provenance.openalex = { ...result.provenance.openalex, id: primary.OpenAlex };
  if (second.provenance?.abstract) result.provenance.abstract = { ...result.provenance.abstract, ...second.provenance.abstract };
  result.provenance.manualFields = [...new Set([...(first.provenance?.manualFields || []), ...(second.provenance?.manualFields || [])])];
  if (result.provenance.abstract) {
    const selectedIncoming = result.abstractNote === second.abstractNote && result.abstractNote !== first.abstractNote;
    result.provenance.abstract = { ...result.provenance.abstract,
      chosenSource: result.provenance.manualFields.includes('abstractNote') ? 'manual'
        : selectedIncoming ? second.provenance?.abstract?.chosenSource || second.provenance?.source || 'imported metadata'
          : first.provenance?.abstract?.chosenSource || first.provenance?.source || (result.abstractNote ? 'existing metadata' : null) };
  }
  if (second.dateAdded && (!first.dateAdded || second.dateAdded < first.dateAdded)) result.dateAdded = second.dateAdded;
  return normalizeWorkMetadata(result);
}
function setAlias(db, alias, target) {
  if (alias === target) return;
  // Flatten earlier replacement chains, as native Zotero moves replaced-item
  // relations to the survivor. Citation lookup remains one indexed read.
  db.prepare('UPDATE item_aliases SET item=? WHERE item=?').run(target, alias);
  db.prepare('INSERT INTO item_aliases VALUES(?,?,?) ON CONFLICT(alias) DO UPDATE SET item=excluded.item')
    .run(alias, target, new Date().toISOString());
}
function putIdentity(db, value, expected, patch = false, { manual = false, enrich = false } = {}) {
  const requestedKey = value.key;
  if (requestedKey && canonicalKey(db, requestedKey) !== requestedKey)
    fail('This item was merged; reload its canonical record before editing', 412);
  const previous = requestedKey ? checked(db, 'items', requestedKey, expected) : null;
  const oldData = previous && JSON.parse(previous.data);
  let data = value.data || value;
  const supplied = { ...data };
  if (patch && oldData) data = { ...oldData, ...data };
  if (!regularItem(data) || data.deleted) return writeItem(db, value, expected, patch);
  data = normalizeWorkMetadata(data, enrich ? {} : { previous: oldData });
  if (manual) {
    const fields = Object.keys(supplied).filter(field => !['key','version','itemType','provenance','dateAdded','dateModified'].includes(field)
      && (!oldData || JSON.stringify(oldData[field]) !== JSON.stringify(supplied[field])));
    data.provenance = { ...data.provenance, manualFields: [...new Set([...(oldData?.provenance?.manualFields || []), ...fields])] };
  }
  if (enrich && oldData) data = enrichMetadata(oldData, data);
  const matches = new Map();
  const checkedIDs = new Set();
  let identifiers = new Map(workIdentifierEntries(data).map(([kind, id]) => [kind + ':' + id, [kind, id]]));
  while (true) {
    const pending = [...identifiers.values()].filter(([kind, id]) => !checkedIDs.has(kind + ':' + id));
    if (!pending.length) break;
    for (const [kind, id] of pending) checkedIDs.add(kind + ':' + id);
    for (const row of identityMatches(db, pending)) {
      if (row.key === requestedKey || matches.has(row.key)) continue;
      matches.set(row.key, row);
      if (matches.size > 200) fail('More than 200 records share this identity; reconcile them in bounded groups', 409);
      for (const [kind, id] of workIdentifierEntries(JSON.parse(row.data))) identifiers.set(kind + ':' + id, [kind, id]);
    }
  }
  const candidates = [...matches.values()].sort((a, b) => {
    const first = JSON.parse(a.data).dateAdded || a.modified;
    const second = JSON.parse(b.data).dateAdded || b.modified;
    return first.localeCompare(second) || a.key.localeCompare(b.key);
  });
  const survivor = previous || candidates.shift();
  if (!survivor) return writeItem(db, { ...value, data }, expected);
  const survivorData = JSON.parse(survivor.data);
  let merged = previous ? data : enrichMetadata(survivorData, data);
  for (const row of candidates) merged = enrichMetadata(merged, JSON.parse(row.data));
  // Native mergeItems preserves all attachments/notes, tags, relations and the
  // oldest date. Our adapter changes only parent metadata: file paths, hashes,
  // full-text, attachment IDs and annotated PDF bytes remain exactly intact.
  const mergedFrom = candidates.map(row => row.key);
  const identityCorrection = manual && previous && (workIdentifierFields.some(field => supplied[field] !== undefined && supplied[field] !== oldData[field])
    || JSON.stringify(supplied.provenance?.identifierAliases || {}) !== JSON.stringify(oldData.provenance?.identifierAliases || {}));
  if (mergedFrom.length || !previous || enrich || identityCorrection) {
    const prefix = `identity:${survivor.key}:`;
    db.prepare('INSERT INTO receipts VALUES(?,?)').run(prefix + key(), JSON.stringify({
      survivor: survivor.key, mergedFrom, incoming: data, previous: survivorData, createdAt: new Date().toISOString(),
    }));
    merged.provenance = { ...merged.provenance, identityHistoryPrefix: prefix };
  }
  let result = writeItem(db, { key: survivor.key, data: merged }, survivor.version);
  for (const row of candidates) {
    const childRows = db.prepare('SELECT * FROM items WHERE parent=? ORDER BY key');
    // Iterate the indexed child set: avoid loading a large attachment collection.
    for (const child of childRows.iterate(row.key)) {
      const childData = JSON.parse(child.data);
      writeItem(db, { key: child.key, data: { ...childData, parentItem: survivor.key } }, child.version, false, true, true);
    }
    const loserData = JSON.parse(row.data);
    writeItem(db, { key: row.key, data: { ...loserData, deleted: 1,
      provenance: { ...loserData.provenance, mergedInto: survivor.key } } }, row.version);
    setAlias(db, row.key, survivor.key);
  }
  if (value.createKey && value.createKey !== survivor.key) setAlias(db, value.createKey, survivor.key);
  const identityConflicts = Object.fromEntries(Object.entries(result.data.provenance?.identifierAliases || {}).filter(([, values]) => values.length)
    .map(([kind, values]) => [kind, [result.data[kind], ...values]]));
  return { ...result, reused: !previous, ...(mergedFrom.length ? { mergedFrom } : {}),
    ...(Object.keys(identityConflicts).length ? { identityConflicts } : {}) };
}
function checked(db, table, itemKey, expected) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE key=?`).get(itemKey);
  if (!row) fail("Record not found", 404);
  if (!Number.isInteger(expected) || expected !== row.version)
    fail("Record changed; reload before editing", 412);
  return row;
}
function writeItem(
  db,
  value,
  expected,
  patch = false,
  skipDateModifiedUpdate = false,
  preserveFulltext = false,
) {
  const itemKey = value.createKey || value.key || key();
  let data = value.data || value;
  let previous;
  if (value.key) {
    const old = checked(db, "items", itemKey, expected);
    previous = JSON.parse(old.data);
    if (patch) data = { ...JSON.parse(old.data), ...data };
  }
  data = { ...data };
  delete data.key;
  delete data.version;
  if (!itemTypes.has(data.itemType) || typeof (data.title ?? "") !== "string")
    fail("Invalid native item type or title");
  if (
    data.creators !== undefined &&
    (!Array.isArray(data.creators) ||
      data.creators.some(
        (c) =>
          !c || typeof c !== "object" || !(c.name || c.firstName || c.lastName),
      ))
  )
    fail("Creators must contain names");
  for (const field of ["collections", "tags"])
    if (data[field] !== undefined && !Array.isArray(data[field]))
      fail(field + " must be an array");
  if (JSON.stringify(data).length > 8 * 1024 * 1024)
    fail("Item metadata exceeds 8 MiB");
  if (data.parentItem) data.parentItem = canonicalKey(db, data.parentItem);
  if (data.parentItem === itemKey) fail("An item cannot be its own parent");
  if (
    previous && !preserveFulltext &&
    ["path", "sha256", "contentType"].some(
      (field) => previous[field] !== data[field],
    )
  )
    db.prepare("DELETE FROM fulltext WHERE item=?").run(itemKey);
  if (data.parentItem) {
    const parent = db
      .prepare("SELECT parent,type,deleted,version,data FROM items WHERE key=?")
      .get(data.parentItem);
    if (!parent || parent.parent) fail("Parent must be a top-level item");
    // Native Item.isRegularItem() excludes notes, attachments and annotations.
    // Check a new ordinary attachment/note binding without changing existing
    // trash relationships or the native embedded-image/annotation exceptions.
    if (
      data.parentItem !== previous?.parentItem &&
      (data.itemType === "note" ||
        (data.itemType === "attachment" && data.linkMode !== "embedded_image")) &&
      (parent.deleted || ["attachment", "note", "annotation"].includes(parent.type))
    )
      fail("Choose a regular reference item that is not deleted");
    // Native Item.save replaces an independent item's stored collection
    // memberships with its parent, inside this same transaction. Callers may
    // already have cleared the submitted child collections before this save.
    if (previous && !previous.parentItem) {
      const parentData = JSON.parse(parent.data);
      const existing = parentData.collections || [];
      const collections = [
        ...new Set([...existing, ...(previous.collections || [])]),
      ];
      if (collections.length !== existing.length)
        writeItem(
          db,
          { key: data.parentItem, data: { ...parentData, collections } },
          parent.version,
          false,
          true,
        );
      data.collections = [];
    }
  }
  const creators = (data.creators || [])
    .map((c) => c.name || [c.firstName, c.lastName].filter(Boolean).join(" "))
    .join(" ");
  const creator = (data.creators || [])
    .map((c) => c.name || c.lastName || c.firstName || "")
    .join(" ");
  const now = new Date().toISOString();
  data.dateModified = skipDateModifiedUpdate ? previous.dateModified : now;
  data.dateAdded ??= now;
  const v = nextVersion(db);
  db.prepare(
    "INSERT INTO items VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET version=excluded.version,type=excluded.type,title=excluded.title,creator=excluded.creator,year=excluded.year,modified=excluded.modified,parent=excluded.parent,deleted=excluded.deleted,data=excluded.data",
  ).run(
    itemKey,
    v,
    data.itemType,
    (data.title || "").toLocaleLowerCase(),
    creator.toLocaleLowerCase(),
    String(data.date || "").match(/\d{4}/)?.[0] || "",
    data.dateModified,
    data.parentItem || null,
    data.deleted ? 1 : 0,
    JSON.stringify(data),
  );
  db.prepare("DELETE FROM item_search WHERE key=?").run(itemKey);
  db.prepare(
    "INSERT INTO item_search(key,title,creators,fields,tags) VALUES(?,?,?,?,?)",
  ).run(
    itemKey,
    data.title || "",
    creators,
    Object.values(data)
      .filter((x) => typeof x === "string")
      .join(" "),
    (data.tags || []).map((t) => (typeof t === "string" ? t : t.tag)).join(" "),
  );
  db.prepare("DELETE FROM memberships WHERE item=?").run(itemKey);
  for (const collection of data.collections || [])
    db.prepare("INSERT INTO memberships VALUES(?,?)").run(itemKey, collection);
  indexIdentifiers(db, itemKey, data);

  return { key: itemKey, version: v, data };
}
function list(db, args = {}) {
  if (args.parent) args = { ...args, parent: canonicalKey(db, args.parent) };
  if (
    args.fields !== undefined &&
    (!Array.isArray(args.fields) ||
      args.fields.some((field) => !projectedFields.has(field)))
  )
    fail("Choose native metadata fields for the item page");
  const fields = args.summary
    ? [...new Set(args.fields || [])].filter((field) => !summaryFields.has(field))
    : [];
  // Table cells are excerpts; full records remain available through item GET.
  // Bound additional text per row even when every schema field is selected.
  const fieldCharacters = Math.min(
    2048,
    Math.floor(16384 / (fields.length || 1)),
  );
  const projectionBindings = [];
  const projection = fields.flatMap((field, index) => {
    const jsonPath = "$." + field;
    projectionBindings.push(
      jsonPath,
      jsonPath,
      fieldCharacters,
      jsonPath,
      fieldCharacters,
    );
    return [
      `CASE WHEN json_type(data,?)='text' THEN substr(json_extract(data,?),1,?) END AS projected_${index}`,
      `length(json_extract(data,?))>? AS truncated_${index}`,
    ];
  });
  const allowed = {
    title: "title",
    creator: "creator",
    year: "year",
    itemType: "type",
    dateModified: "modified",
  };
  const sort = allowed[args.sort || "title"];
  if (!sort) fail("Unsupported sort");
  const direction = args.direction === "desc" ? "DESC" : "ASC",
    comparison = direction === "ASC" ? ">" : "<";
  const limit = Math.max(1, Math.min(200, Number(args.limit) || 80));
  const bindings = [];
  const where = ["deleted=?"];
  bindings.push(args.deleted ? 1 : 0);
  if (args.top !== false && !args.parent) where.push("parent IS NULL");
  if (args.parent) {
    where.push("parent=?");
    bindings.push(args.parent);
  }
  if (args.collection) {
    where.push("key IN (SELECT item FROM memberships WHERE collection=?)");
    bindings.push(args.collection);
  }
  if (args.itemType) {
    where.push("type=?");
    bindings.push(args.itemType);
  }
  if (args.query?.trim()) {
    const terms =
      args.query
        .trim()
        .slice(0, 2048)
        .match(/[\p{L}\p{N}]+/gu) || [];
    if (terms.length) {
      where.push(
        "key IN (SELECT key FROM item_search WHERE item_search MATCH ?)",
      );
      bindings.push(
        terms
          .slice(0, 24)
          .map((t) => '"' + t + '"*')
          .join(" AND "),
      );
    }
  }
  const queryScope = JSON.stringify([
    args.query || "",
    args.collection || "",
    args.parent || "",
    args.itemType || "",
    !!args.deleted,
    args.top !== false,
  ]);
  const current = version(db);
  let cursor;
  if (args.cursor) {
    try {
      cursor = JSON.parse(Buffer.from(args.cursor, "base64url").toString());
    } catch {
      fail("Invalid cursor");
    }
    if (cursor.version !== current)
      fail("Library changed; reload this query", 409);
    if (
      cursor.sort !== sort ||
      cursor.direction !== direction ||
      cursor.scope !== queryScope
    )
      fail("Cursor does not match sort");
    where.push(`(${sort},key) ${comparison} (?,?)`);
    bindings.push(cursor.value, cursor.key);
  }
  const offset = Math.max(0, Math.min(100000, Number(args.start) || 0));
  const columns = args.summary
    ? `key,version,type,title,creator,year,modified,parent,deleted,json_object('itemType',type,'title',coalesce(json_extract(data,'$.title'),''),'creators',json(coalesce(json_extract(data,'$.creators'),'[]')),'date',coalesce(json_extract(data,'$.date'),''),'collections',json(coalesce(json_extract(data,'$.collections'),'[]')),'tags',json(coalesce(json_extract(data,'$.tags'),'[]')),'deleted',deleted,'attachmentCount',(SELECT count(*) FROM items child WHERE child.parent=items.key AND child.deleted=0 AND child.type='attachment')) AS data`
    : "*";
  const rows = db
    .prepare(
      `SELECT ${columns}${projection.length ? "," + projection.join(",") : ""} FROM items WHERE ${where.join(" AND ")} ORDER BY ${sort} ${direction},key ${direction} LIMIT ? OFFSET ?`,
    )
    .all(...projectionBindings, ...bindings, limit + 1, cursor ? 0 : offset);
  const more = rows.length > limit;
  if (more) rows.pop();
  const last = rows.at(-1);
  const result = {
    items: rows.map((row) => {
      const item = decode(row),
        truncatedFields = [];
      fields.forEach((field, index) => {
        item.data[field] = row["projected_" + index];
        if (row["truncated_" + index]) truncatedFields.push(field);
      });
      if (truncatedFields.length) item.truncatedFields = truncatedFields;
      return item;
    }),
    version: current,
    next: more
      ? Buffer.from(
          JSON.stringify({
            version: current,
            scope: queryScope,
            sort,
            direction,
            value: last[sort],
            key: last.key,
          }),
        ).toString("base64url")
      : null,
  };
  if (args.count)
    result.total = db
      .prepare(
        `SELECT COUNT(*) AS n FROM items WHERE ${where.slice(0, cursor ? -1 : undefined).join(" AND ")}`,
      )
      .get(...(cursor ? bindings.slice(0, -2) : bindings)).n;
  return result;
}
const operations = {
  bibliographySettings: (db, { initialPath, legacyCwd }) => {
    let row = db.prepare("SELECT data FROM settings WHERE id='bibliography'").get();
    if (!row) {
      if (!path.isAbsolute(initialPath || '') || !path.isAbsolute(legacyCwd || '')) fail('Bibliography needs an explicit initial folder');
      const value = { path: path.resolve(initialPath), legacyCwd: path.resolve(legacyCwd) };
      db.prepare("INSERT OR IGNORE INTO settings VALUES('bibliography',?)").run(JSON.stringify(value));
      row = db.prepare("SELECT data FROM settings WHERE id='bibliography'").get();
    }
    return JSON.parse(row.data);
  },
  beginBibliographyMove: (db, { id, source, target }) => transaction(db, () => {
    const row = db.prepare("SELECT data FROM settings WHERE id='bibliography'").get();
    if (!row) fail('Bibliography folder is not initialized', 409);
    const value = JSON.parse(row.data);
    if (value.move) {
      if (value.move.id !== id || value.move.source !== source || value.move.target !== target) fail('Another Bibliography move needs to finish first', 409);
      return value;
    }
    if (value.path !== source) fail('Bibliography folder changed; reload before moving', 409);
    value.move = { id, source, target, phase: 'copying', startedAt: new Date().toISOString() };
    db.prepare("UPDATE settings SET data=? WHERE id='bibliography'").run(JSON.stringify(value));
    return value;
  }),
  commitBibliographyMove: (db, { id, total }) => transaction(db, () => {
    const value = JSON.parse(db.prepare("SELECT data FROM settings WHERE id='bibliography'").get()?.data || '{}');
    const move = value.move;
    if (!move || move.id !== id) fail('Bibliography move is unavailable', 409);
    if (move.phase === 'cleanup') return value;
    const prefix = 'bibliography-move:' + id + ':file:';
    const count = db.prepare("SELECT count(*) AS n FROM items WHERE type='attachment' AND json_extract(data,'$.path') IS NOT NULL").get().n;
    const plans = db.prepare("SELECT data FROM receipts WHERE id>=? AND id<? ORDER BY id");
    let completed = 0;
    for (const row of plans.iterate(prefix, prefix + '\uffff')) {
      const entry = JSON.parse(row.data);
      if (entry.status !== 'published') fail('An attachment has not finished copying', 409);
      const original = checked(db, 'items', entry.key, entry.version);
      const data = JSON.parse(original.data);
      if (data.path !== entry.oldPath || (data.pathBase || null) !== (entry.oldPathBase || null)) fail('Attachment path changed during the move', 409);
      const unchangedBytes = data.sha256 === entry.sha256 && data.byteLength === entry.byteLength;
      writeItem(db, { key: entry.key, data: { ...data, path: entry.newPath, pathBase: 'bibliography', filename: entry.filename, sha256: entry.sha256, byteLength: entry.byteLength } }, original.version, false, unchangedBytes, unchangedBytes);
      completed++;
    }
    if (completed !== total || count !== total) fail('The attachment list changed during the move', 409);
    value.path = move.target;
    value.move = { ...move, phase: 'cleanup', total, committedAt: new Date().toISOString() };
    db.prepare("UPDATE settings SET data=? WHERE id='bibliography'").run(JSON.stringify(value));
    return value;
  }),
  abortBibliographyMove: (db, { id }) => transaction(db, () => {
    const row = db.prepare("SELECT data FROM settings WHERE id='bibliography'").get();
    if (!row) return null;
    const value = JSON.parse(row.data);
    if (value.move?.id === id && value.move.phase === 'copying') {
      delete value.move;
      db.prepare("UPDATE settings SET data=? WHERE id='bibliography'").run(JSON.stringify(value));
    }
    return value;
  }),
  finishBibliographyMove: (db, { id }) => transaction(db, () => {
    const value = JSON.parse(db.prepare("SELECT data FROM settings WHERE id='bibliography'").get()?.data || '{}');
    if (value.move?.id !== id || value.move.phase !== 'cleanup') fail('Bibliography move is not committed', 409);
    value.lastMove = { ...value.move, phase: 'complete', completedAt: new Date().toISOString() };
    delete value.move;
    db.prepare("UPDATE settings SET data=? WHERE id='bibliography'").run(JSON.stringify(value));
    return value;
  }),
  libraryVersion: (db) => version(db),
  importCollections: (db, { collections, receipt }) =>
    transaction(db, () => {
      if (collections.length > 200) fail("Collection batch exceeds 200");
      if (db.prepare("SELECT id FROM receipts WHERE id=?").get(receipt)) return;
      for (const c of collections) {
        if (typeof c.name !== "string" || !c.name.trim())
          fail("Imported collection needs a name");
        const data = {
          name: c.name,
          parentCollection: c.parentCollection || null,
        };
        db.prepare("INSERT INTO collections VALUES(?,?,?,?,?)").run(
          c.key,
          nextVersion(db),
          c.name,
          c.parentCollection || null,
          JSON.stringify(data),
        );
      }
      db.prepare("INSERT INTO receipts VALUES(?,?)").run(
        receipt,
        JSON.stringify({ complete: true }),
      );
    }),
  jobs: (db, { start = 0, limit = 80 }) => {
    limit = Math.min(200, Math.max(1, limit));
    start = Math.min(100000, Math.max(0, start));
    const rows = db
      .prepare(
        `SELECT json_object('id',json_extract(data,'$.id'),'kind',json_extract(data,'$.kind'),
      'status',json_extract(data,'$.status'),'completed',json_extract(data,'$.completed'),'total',json_extract(data,'$.total'),
      'createdAt',json_extract(data,'$.createdAt'),'finishedAt',json_extract(data,'$.finishedAt'),'error',json_extract(data,'$.error')) AS summary
      FROM receipts WHERE substr(id,1,4)='job:' ORDER BY json_extract(data,'$.createdAt') DESC,id LIMIT ? OFFSET ?`,
      )
      .all(limit + 1, start);
    const more = rows.length > limit;
    if (more) rows.pop();
    return {
      items: rows.map((row) => JSON.parse(row.summary)),
      nextStart: more ? start + limit : null,
    };
  },
  attachmentPaths: (db, { after = "", limit = 100 }) =>
    db
      .prepare(
        "SELECT key,version,json_extract(data,'$.path') AS path,json_extract(data,'$.pathBase') AS pathBase,json_extract(data,'$.filename') AS filename,json_extract(data,'$.sha256') AS sha256,json_extract(data,'$.byteLength') AS byteLength FROM items WHERE type='attachment' AND key>? AND json_extract(data,'$.path') IS NOT NULL ORDER BY key LIMIT ?",
      )
      .all(after, Math.min(100, limit)),
  fileAttachmentCount: (db, { key }) =>
    db
      .prepare(
        "SELECT count(*) AS n FROM items WHERE parent=? AND deleted=0 AND type='attachment' AND json_extract(data,'$.linkMode')<>'linked_url' AND json_extract(data,'$.contentType') IN ('application/pdf','application/epub+zip')",
      )
      .get(key).n,
  searches: (db, { start = 0, limit = 80 }) => ({
    items: db
      .prepare("SELECT * FROM searches ORDER BY name,key LIMIT ? OFFSET ?")
      .all(Math.min(200, Math.max(1, limit)), Math.max(0, start))
      .map(decode),
    version: version(db),
  }),
  search: (db, { key: k }) =>
    decode(db.prepare("SELECT * FROM searches WHERE key=?").get(k)) ||
    fail("Saved search not found", 404),
  putSearch: (db, { value, expected }) =>
    transaction(db, () => {
      const k = value.key || key();
      if (value.key) checked(db, "searches", k, expected);
      const data = value.data || value;
      if (
        typeof data.name !== "string" ||
        !data.name.trim() ||
        typeof data.provider !== "string"
      )
        fail("Saved search needs a name and provider");
      if (JSON.stringify(data).length > 32768)
        fail("Saved search exceeds 32 KiB");
      const v = nextVersion(db);
      db.prepare(
        "INSERT INTO searches VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET version=excluded.version,name=excluded.name,data=excluded.data",
      ).run(k, v, data.name, JSON.stringify(data));
      return { key: k, version: v, data };
    }),
  deleteSearch: (db, { key: k, expected }) =>
    transaction(db, () => {
      checked(db, "searches", k, expected);
      db.prepare("DELETE FROM searches WHERE key=?").run(k);
      return { version: nextVersion(db) };
    }),
  list,
  get: (db, { key: k }) => getItem(db, k),
  put: (db, args) =>
    transaction(db, () => putIdentity(db, args.value, args.expected, args.patch, args)),
  batch: (db, { items, receipt, manual = false }) =>
    transaction(db, () => {
      if (!Array.isArray(items) || items.length > 200)
        fail("A write batch must contain at most 200 items");
      if (receipt) {
        const old = db
          .prepare("SELECT data FROM receipts WHERE id=?")
          .get(receipt);
        if (old) return JSON.parse(old.data);
      }
      const result = items.map((value) => putIdentity(db, value, value.version, false, { manual }));
      // A later entry can join identities returned earlier in this same batch.
      // Resolve the final canonical keys after every write has committed locally.
      for (let i = 0; i < result.length; i++) {
        const current = getItem(db, result[i].key);
        result[i] = { ...result[i], ...current };
      }
      if (receipt)
        db.prepare("INSERT INTO receipts VALUES(?,?)").run(
          receipt,
          JSON.stringify(result),
        );
      return result;
    }),
  remove: (db, { key: k, expected }) =>
    transaction(db, () => {
      const row = checked(db, "items", k, expected);
      return writeItem(
        db,
        { key: k, data: { ...JSON.parse(row.data), deleted: 1 } },
        expected,
      );
    }),
  find: (db, { identifiers }) => {
    const canonical = {};
    for (const [kind, value] of Object.entries(identifiers || {})) {
      if (!value) continue;
      const id = canonicalWorkIdentifier(kind, value);
      if (id) canonical[id.type] = id.value;
    }
    return identityMatches(db, canonical).map(decode);
  },
  eraseSessionNote: (db, { key, expected, sessionID }) =>
    transaction(db, () => {
      const row = checked(db, "items", key, expected);
      const data = JSON.parse(row.data);
      if (
        data.itemType !== "note" ||
        data.provenance?.captureSession !== sessionID
      )
        fail("This note does not belong to the capture session", 403);
      db.prepare("DELETE FROM item_search WHERE key=?").run(key);
      db.prepare("DELETE FROM items WHERE key=?").run(key);
      return { version: nextVersion(db) };
    }),
  collections: (
    db,
    { parent = null, query = "", start = 0, limit = 80 } = {},
  ) => {
    limit = Math.max(1, Math.min(200, Number(limit) || 80));
    if (!Number.isSafeInteger(start) || start < 0)
      fail("Invalid collection offset");
    const terms =
      String(query)
        .slice(0, 2048)
        .match(/[\p{L}\p{N}]+/gu) || [];
    const where = terms.length
      ? "rowid IN (SELECT rowid FROM collection_search WHERE collection_search MATCH ?)"
      : "parent IS ?";
    const value = terms.length
      ? terms
          .slice(0, 24)
          .map((term) => '"' + term + '"*')
          .join(" AND ")
      : parent;
    const rows = db
      .prepare(
        `SELECT * FROM collections WHERE ${where} ORDER BY name,key LIMIT ? OFFSET ?`,
      )
      .all(value, limit + 1, start);
    const more = rows.length > limit;
    if (more) rows.pop();
    return {
      items: rows.map(decode),
      version: version(db),
      nextStart: more ? start + rows.length : null,
    };
  },
  collection: (db, { key: k }) =>
    decode(db.prepare("SELECT * FROM collections WHERE key=?").get(k)) ||
    fail("Collection not found", 404),
  putCollection: (db, { value, expected }) =>
    transaction(db, () => {
      const k = value.key || key();
      if (value.key) checked(db, "collections", k, expected);
      const data = value.data || value;
      if (typeof data.name !== "string" || !data.name.trim())
        fail("Collection name required");
      if (data.parentCollection) {
        let p = data.parentCollection;
        for (let n = 0; p; n++) {
          if (n > 100 || p === k) fail("Collection cycle");
          const row = db
            .prepare("SELECT parent FROM collections WHERE key=?")
            .get(p);
          if (!row) fail("Parent collection unavailable");
          p = row.parent;
        }
      }
      const v = nextVersion(db);
      db.prepare(
        "INSERT INTO collections VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET version=excluded.version,name=excluded.name,parent=excluded.parent,data=excluded.data",
      ).run(
        k,
        v,
        data.name,
        data.parentCollection || null,
        JSON.stringify(data),
      );
      return { key: k, version: v, data };
    }),
  deleteCollection: (db, { key: k, expected }) =>
    transaction(db, () => {
      checked(db, "collections", k, expected);
      if (
        db.prepare("SELECT key FROM collections WHERE parent=? LIMIT 1").get(k)
      )
        fail("Move child collections before deletion", 409);
      // One indexed SQL operation avoids materializing a large collection in JS.
      const v = nextVersion(db),
        now = new Date().toISOString();
      db.prepare(
        `UPDATE items SET version=?, modified=?, data=json_set(data,
        '$.collections', json((SELECT json_group_array(value) FROM json_each(items.data,'$.collections') WHERE value<>?)),
        '$.dateModified',?) WHERE key IN (SELECT item FROM memberships WHERE collection=?)`,
      ).run(v, now, k, now, k);
      db.prepare("DELETE FROM collections WHERE key=?").run(k);
      return { version: v };
    }),
  fulltext: (db, { key: k, data }) => {
    if (data) {
      db.prepare(
        "INSERT INTO fulltext VALUES(?,?) ON CONFLICT(item) DO UPDATE SET data=excluded.data",
      ).run(k, JSON.stringify(data));
      return data;
    }
    const row = db.prepare("SELECT data FROM fulltext WHERE item=?").get(k);
    return row
      ? JSON.parse(row.data)
      : fail("Full text has not been indexed", 404);
  },
  record: (db, { table = "receipts", id, data, revisionPrefix }) => {
    if (!["receipts", "settings"].includes(table)) fail("Invalid record table");
    if (data !== undefined)
      transaction(db, () => {
        db.prepare(
          `INSERT INTO ${table} VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
        ).run(id, JSON.stringify(data));
        if (revisionPrefix)
          db.prepare(
            "INSERT INTO receipt_versions VALUES(?,1) ON CONFLICT(prefix) DO UPDATE SET version=version+1",
          ).run(revisionPrefix);
      });
    const row = db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);
    return row ? JSON.parse(row.data) : null;
  },
  deleteReceipt: (db, { id }) =>
    db.prepare("DELETE FROM receipts WHERE id=?").run(id).changes,
  recordPage: (
    db,
    { prefix, cursor = "", start = 0, limit = 80, expectedVersion },
  ) => {
    limit = Math.min(100, Math.max(1, limit));
    if (typeof prefix !== "string" || (cursor && !cursor.startsWith(prefix)))
      fail("Invalid outcome cursor");
    if (!Number.isSafeInteger(start) || start < 0)
      fail("Invalid outcome offset");
    const version =
      db
        .prepare("SELECT version FROM receipt_versions WHERE prefix=?")
        .get(prefix)?.version || 0;
    if (expectedVersion !== undefined && expectedVersion !== version)
      fail("Job outcomes changed; reload this page", 409);
    const rows = db
      .prepare(
        "SELECT id,data FROM receipts WHERE id>=? AND id<? AND id>? ORDER BY id LIMIT ? OFFSET ?",
      )
      .all(prefix, prefix + "\uffff", cursor, limit + 1, cursor ? 0 : start);
    const more = rows.length > limit;
    if (more) rows.pop();
    return {
      items: rows.map((row) => JSON.parse(row.data)),
      next: more ? rows.at(-1).id : null,
      nextStart: more ? start + rows.length : null,
      hasMore: more,
      version,
    };
  },
};
parentPort.on("message", ({ id, file, operation, args }) => {
  try {
    if (operation === "closeLibrary") {
      connections.get(file)?.close();
      connections.delete(file);
      parentPort.postMessage({ id, result: { closed: true } });
      return;
    }
    if (!operations[operation]) fail("Unknown storage operation");
    parentPort.postMessage({
      id,
      result: operations[operation](connection(file), args),
    });
  } catch (error) {
    parentPort.postMessage({
      id,
      error: { message: error.message, status: error.status || 500 },
    });
  }
});
