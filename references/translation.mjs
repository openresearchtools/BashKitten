// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
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
  Z.Prefs.set("translators.CrossrefREST.email", settings.crossrefEmail || "");
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
  return items.flatMap((item) => Z.Utilities.Item.itemToAPIJSON(item));
}
export async function toCSL(item, id) {
  const Z = await translationRuntime();
  return { ...Z.Utilities.Item.itemToCSLJSON(item), id };
}
export async function captureItems(items) {
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
        attachment.snapshot !== false ||
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
