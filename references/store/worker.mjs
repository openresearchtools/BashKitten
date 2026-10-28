// SPDX-License-Identifier: AGPL-3.0-or-later
// SQLite is synchronous by design; its connection and every query live off the HTTP loop.
import { parentPort } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { readFileSync, mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
const itemSchema = JSON.parse(
  readFileSync(
    new URL("../vendor/schema/source/schema.json", import.meta.url),
    "utf8",
  ),
);
const itemTypes = new Map(
  itemSchema.itemTypes.map((type) => [type.itemType, type]),
);
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
  const hasCollectionSearch = db
    .prepare("SELECT name FROM sqlite_master WHERE name='collection_search'")
    .get();
  chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
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
    CREATE TABLE IF NOT EXISTS fulltext (item TEXT PRIMARY KEY REFERENCES items(key) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS receipt_versions (prefix TEXT PRIMARY KEY, version INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS receipts_jobs_created ON receipts(json_extract(data,'$.createdAt') DESC,id) WHERE substr(id,1,4)='job:';
    CREATE TABLE IF NOT EXISTS searches (key TEXT PRIMARY KEY,version INTEGER NOT NULL,name TEXT NOT NULL,data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS searches_name ON searches(name,key);
    CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    PRAGMA user_version=1;`);
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
function checked(db, table, itemKey, expected) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE key=?`).get(itemKey);
  if (!row) fail("Record not found", 404);
  if (!Number.isInteger(expected) || expected !== row.version)
    fail("Record changed; reload before editing", 412);
  return row;
}
function putItem(db, value, expected, patch = false) {
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
  if (data.parentItem === itemKey) fail("An item cannot be its own parent");
  if (
    previous &&
    ["path", "sha256", "contentType"].some(
      (field) => previous[field] !== data[field],
    )
  )
    db.prepare("DELETE FROM fulltext WHERE item=?").run(itemKey);
  if (data.parentItem) {
    const parent = db
      .prepare("SELECT parent FROM items WHERE key=?")
      .get(data.parentItem);
    if (!parent || parent.parent) fail("Parent must be a top-level item");
  }
  const creators = (data.creators || [])
    .map((c) => c.name || [c.firstName, c.lastName].filter(Boolean).join(" "))
    .join(" ");
  const creator = (data.creators || [])
    .map((c) => c.name || c.lastName || c.firstName || "")
    .join(" ");
  const now = new Date().toISOString();
  data.dateModified = now;
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
    now,
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
  db.prepare("DELETE FROM identifiers WHERE item=?").run(itemKey);
  for (const [kind, val] of Object.entries({
    ...data.provenance?.identifiers,
    ...(data.DOI ? { DOI: data.DOI } : {}),
    ...(data.PMID ? { PMID: data.PMID } : {}),
    ...(data.PMCID ? { PMCID: data.PMCID } : {}),
    OpenAlex: data.provenance?.openalex?.id,
    ...Object.fromEntries(
      (data.extra || "")
        .split("\n")
        .map((l) => l.match(/^(PMID|PMCID):\s*(\S+)/))
        .filter(Boolean)
        .map((m) => [m[1], m[2]]),
    ),
  })) {
    if (val)
      db.prepare("INSERT OR IGNORE INTO identifiers VALUES(?,?,?)").run(
        kind,
        String(val).trim().toLowerCase(),
        itemKey,
      );
  }
  return { key: itemKey, version: v, data };
}
function list(db, args = {}) {
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
      `SELECT ${columns} FROM items WHERE ${where.join(" AND ")} ORDER BY ${sort} ${direction},key ${direction} LIMIT ? OFFSET ?`,
    )
    .all(...bindings, limit + 1, cursor ? 0 : offset);
  const more = rows.length > limit;
  if (more) rows.pop();
  const last = rows.at(-1);
  const result = {
    items: rows.map(decode),
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
        "SELECT key,json_extract(data,'$.path') AS path,json_extract(data,'$.sha256') AS sha256,json_extract(data,'$.byteLength') AS byteLength FROM items WHERE type='attachment' AND key>? AND json_extract(data,'$.path') IS NOT NULL ORDER BY key LIMIT ?",
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
  get: (db, { key: k }) =>
    decode(db.prepare("SELECT * FROM items WHERE key=?").get(k)) ||
    fail("Item not found", 404),
  put: (db, args) =>
    transaction(db, () => putItem(db, args.value, args.expected, args.patch)),
  batch: (db, { items, receipt }) =>
    transaction(db, () => {
      if (!Array.isArray(items) || items.length > 200)
        fail("A write batch must contain at most 200 items");
      if (receipt) {
        const old = db
          .prepare("SELECT data FROM receipts WHERE id=?")
          .get(receipt);
        if (old) return JSON.parse(old.data);
      }
      const result = items.map((value) => putItem(db, value, value.version));
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
      return putItem(
        db,
        { key: k, data: { ...JSON.parse(row.data), deleted: 1 } },
        expected,
      );
    }),
  find: (db, { identifiers }) => {
    const found = new Map();
    for (const [kind, value] of Object.entries(identifiers)) {
      for (const row of db
        .prepare(
          "SELECT i.* FROM items i JOIN identifiers d ON d.item=i.key WHERE d.kind=? AND d.value=? AND i.deleted=0 LIMIT 3",
        )
        .all(kind, String(value).toLowerCase()))
        found.set(row.key, decode(row));
    }
    return [...found.values()];
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
