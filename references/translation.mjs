// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRequire } from "node:module";
import { readFile, stat, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { FORMATS, CONTENT_TYPES } = require("./runtime/formats.js");
let loaded;
export async function translationRuntime() {
  if (!loaded)
    loaded = (async () => {
      const Z = require("./runtime/zotero.js");
      await Z.Translators.init();
      return Z;
    })().catch((e) => {
      loaded = null;
      throw e;
    });
  return loaded;
}
export async function translateIdentifier(
  identifier,
  { signal, settings = {} } = {},
) {
  signal?.throwIfAborted();
  const Z = await translationRuntime();
  Z.Prefs.set(
    "translators.CrossrefREST.email",
    encodeURIComponent(settings.crossrefEmail || ""),
  );
  const t = new Z.Translate.Search();
  t.setIdentifier(identifier);
  const candidates = await t.getTranslators();
  if (!candidates.length)
    throw Error("No pinned metadata translator supports this identifier");
  t.setTranslator(candidates);
  const items = await t.translate({ libraryID: false });
  signal?.throwIfAborted();
  return items.flatMap((item) => Z.Utilities.Item.itemToAPIJSON(item));
}
export async function translateImport(text, { signal } = {}) {
  return (await translateImportBundle(text, { signal })).items;
}
export async function translateImportFile(source, options = {}) {
  options.signal?.throwIfAborted();
  const file = await stat(source.path);
  if (
    !file.isFile() ||
    file.size > 32 * 1024 * 1024 ||
    file.size !== source.byteLength
  )
    throw Error("Import file size changed or exceeds 32 MiB");
  const bytes = await readFile(source.path, { signal: options.signal });
  if (createHash("sha256").update(bytes).digest("hex") !== source.sha256)
    throw Error("Import file changed after upload");
  const text = new TextDecoder(source.encoding, { fatal: true }).decode(bytes);
  if (Buffer.byteLength(text, "utf8") > 32 * 1024 * 1024)
    throw Error("Decoded import data exceeds 32 MiB of UTF-8 text");
  return translateImportBundle(text, options);
}
export async function translateImportBundle(
  text,
  { signal, target, operationId = "native-import" } = {},
) {
  signal?.throwIfAborted();
  if (typeof text !== "string" || text.length > 32 * 1024 * 1024)
    throw Error("Import text must be at most 32 MiB");
  const Z = await translationRuntime();
  const t = new Z.Translate.Import();
  t.setString(text);
  const candidates = await t.getTranslators();
  if (!candidates.length)
    throw Error("No pinned import translator recognizes this data");
  t.setTranslator(candidates[0]);
  const items = await t.translate({ libraryID: false });
  signal?.throwIfAborted();
  const captured = await captureItems(items, { importLinks: true });
  const collections = [];
  const IDMap = Object.fromEntries(
    items.map((item, index) => [
      item.itemID || item.id || item.key,
      captured.records[captured.parentIndexes[index]].key,
    ]),
  );
  class Collection {
    async save() {
      signal?.throwIfAborted();
      this.id = createHash("sha256")
        .update(operationId + ":collection:" + collections.length)
        .digest("hex")
        .slice(0, 16)
        .toUpperCase();
      collections.push({
        key: this.id,
        name: this.name,
        parentCollection: this.parentID || null,
        members: [],
      });
    }
    async addItems(keys) {
      collections
        .find((collection) => collection.key === this.id)
        .members.push(...keys);
    }
  }
  const saveCollections = require("./runtime/import-collections-native.js")({
    ...Z,
    Collection,
    DB: { executeTransaction: (work) => work() },
  });
  await saveCollections.call(
    { _collections: target ? [target] : [], _IDMap: IDMap },
    t.newCollections || [],
  );
  return { items: captured.records, collections };
}
export async function toCSL(item, id) {
  const Z = await translationRuntime();
  return { ...Z.Utilities.Item.itemToCSLJSON(item), id };
}
export async function captureItems(items, { importLinks = false } = {}) {
  const Z = await translationRuntime();
  const records = [],
    parentIndexes = [];
  for (const item of items) {
    parentIndexes.push(records.length);
    const normalized = {
      ...item,
      creators: (item.creators || []).map((creator) =>
        creator.name
          ? { ...creator, lastName: creator.name, fieldMode: 1 }
          : creator,
      ),
    };
    const converted = Z.Utilities.Item.itemToAPIJSON(normalized);
    records.push(...converted);
    for (const attachment of item.attachments || []) {
      if (
        (!importLinks && attachment.snapshot !== false) ||
        !/^https?:\/\//i.test(attachment.url || "")
      )
        continue;
      records.push({
        itemType: "attachment",
        parentItem: converted[0].key,
        title: attachment.title || attachment.url,
        url: attachment.url,
        contentType: attachment.mimeType || attachment.contentType || "",
        linkMode: "linked_url",
        accessDate: new Date().toISOString(),
      });
    }
  }
  return { records, parentIndexes };
}
export async function exportTranslators() {
  const Z = await translationRuntime();
  return (await Z.Translators.getAllForType("export")).map((translator) => ({
    id: translator.translatorID,
    label: translator.label,
    target: translator.target,
    displayOptions:
      translator.displayOptions || translator.metadata?.displayOptions || {},
  }));
}
// Adapted from the pinned translation-server ExportEndpoint; native ItemGetter owns field conversion.
export async function translateExport(
  { items, translatorID, options = {} },
  { signal, outputFile, delivery } = {},
) {
  signal?.throwIfAborted();
  if (options.exportFileData)
    throw Object.assign(
      Error(
        "Metadata export does not copy attachment files; export their Bibliography folder through Files",
      ),
      { status: 422 },
    );
  const Z = await translationRuntime();
  const translator = Z.Translators.get(translatorID);
  if (!translator || !(translator.translatorType & 2))
    throw Object.assign(Error("Export translator is unavailable"), {
      status: 400,
    });
  if (
    !Array.isArray(items) ||
    items.length > 1000 ||
    Buffer.byteLength(JSON.stringify(items)) > 32 * 1024 * 1024
  )
    throw Object.assign(
      Error(
        "Export accepts at most 1000 selected items and 32 MiB of metadata per operation",
      ),
      { status: 413 },
    );
  const legacy = Z.Utilities.semverCompare("4.0.27", translator.minVersion) > 0;
  items = structuredClone(items);
  for (const item of items) {
    item.creators ||= [];
    item.tags ||= [];
    item.relations ||= {};
    item.uri ||= item.key;
    delete item.key;
    if (legacy)
      for (const field of ["dateAdded", "dateModified", "accessDate"])
        if (item[field]) item[field] = Z.Date.isoToSQL(item[field]);
  }
  const translate = new Z.Translate.Export();
  translate.setTranslator(translatorID);
  translate.setDisplayOptions({ ...options, exportFileData: false });
  translate.setItems(items);
  await translate.translate({ libraryID: false });
  signal?.throwIfAborted();
  if (Buffer.byteLength(translate.string) > 32 * 1024 * 1024)
    throw Object.assign(Error("Export exceeds 32 MiB"), { status: 413 });
  const format = Object.keys(FORMATS).find(
    (name) => FORMATS[name] === translatorID,
  );
  const metadata = {
    contentType: (CONTENT_TYPES[format] || "text/plain") + "; charset=utf-8",
    extension: /^[a-z0-9]+$/i.test(translator.target)
      ? translator.target
      : "txt",
    translatorID,
  };
  // Native Node translation uses IO.String. Native IO.Write depends on XPCOM;
  // materialize its unchanged output in this worker, never over the UI/agent JSON channel.
  if (
    outputFile &&
    (delivery === "file" ||
      Buffer.byteLength(JSON.stringify(translate.string)) > 1024 * 1024)
  ) {
    try {
      await writeFile(outputFile, translate.string, {
        flag: "wx",
        mode: 0o600,
        signal,
      });
      signal?.throwIfAborted();
    } catch (error) {
      await rm(outputFile, { force: true });
      throw error;
    }
    return {
      ...metadata,
      byteLength: Buffer.byteLength(translate.string),
      sha256: createHash("sha256").update(translate.string).digest("hex"),
      file: true,
    };
  }
  return { ...metadata, text: translate.string };
}
export async function translatorMetadata(url) {
  const Z = await translationRuntime();
  const list = url
    ? (await Z.Translators.getWebTranslatorsForLocation(url, url))[0]
    : await Z.Translators.getAllForType("web");
  return list.map((t) =>
    Object.fromEntries(
      [
        "translatorID",
        "translatorType",
        "label",
        "creator",
        "target",
        "targetAll",
        "minVersion",
        "maxVersion",
        "priority",
        "browserSupport",
        "inRepository",
        "lastUpdated",
      ].map((k) => [k, t[k]]),
    ),
  );
}
export async function translatorCode(id) {
  const Z = await translationRuntime();
  const t = Z.Translators.get(id);
  if (!t) throw Object.assign(Error("Translator not found"), { status: 404 });
  return Z.Translators.getCodeForTranslator(t);
}
export const schema = () =>
  readFile(
    new URL("./vendor/schema/source/schema.json", import.meta.url),
    "utf8",
  ).then(JSON.parse);

/** Released OpenAlex JSON translator owns full metadata mapping, including records without DOI/PMID. */
export async function translateOpenAlex(raw, { signal } = {}) {
  signal?.throwIfAborted();
  const Z = await translationRuntime();
  const t = new Z.Translate.Import();
  const data = {
    ...raw,
    ids: { openalex: raw.id, ...raw.ids },
    primary_location: raw.primary_location || {},
    biblio: raw.biblio || {},
    authorships: raw.authorships || [],
    keywords: raw.keywords || [],
  };
  t.setString(JSON.stringify(data));
  t.setTranslator("faa53754-fb55-4658-9094-ae8a7e0409a2");
  const items = await t.translate({ libraryID: false });
  signal?.throwIfAborted();
  return items.flatMap((item) => Z.Utilities.Item.itemToAPIJSON(item));
}
