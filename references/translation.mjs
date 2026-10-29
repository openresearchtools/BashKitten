// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
import { runNativeExport, exportMemoryNotice } from "./native-export.mjs";
import { createNativeAttachmentNamer } from "./attachment-names.mjs";
import { openAlexRecord } from "./adapted/openalex.mjs";
import { normalizeWorkMetadata } from "./adapted/work-identity.mjs";
let loaded;
const extraConverters = new WeakMap();
function translatedAPIItems(Z, item) {
  const converted = Z.Utilities.Item.itemToAPIJSON(item);
  let preserveExtra = extraConverters.get(Z);
  if (!preserveExtra) {
    preserveExtra = require("./runtime/item-extra-native.js")(Z);
    extraConverters.set(Z, preserveExtra);
  }
  if (converted[0]) preserveExtra(item, converted[0]);
  return converted;
}
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
export async function attachmentFileBaseName(data, options = {}) {
  return createNativeAttachmentNamer(await translationRuntime())(data, options);
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
  return items.flatMap((item) => translatedAPIItems(Z, item));
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
    const converted = translatedAPIItems(Z, normalized);
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
    memoryNotice: exportMemoryNotice(translator),
  }));
}
// One native Translate.Export invocation, with its native ItemGetter and IO.Write.
export async function translateExport(args, options = {}) {
  options.signal?.throwIfAborted();
  return runNativeExport(await translationRuntime(), args, options);
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

/** Keep the native translator's mapping; fill only its missing input/identity seams. */
export async function translateOpenAlex(raw, { signal } = {}) {
  signal?.throwIfAborted();
  const record = openAlexRecord(raw);
  const Z = await translationRuntime();
  const t = new Z.Translate.Import();
  const text = (value) => typeof value === "string"
    ? Z.Utilities.trimInternal(Z.Utilities.unescapeHTML(value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")))
    : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  const source = raw.primary_location?.source;
  const title = text(raw.title) || text(raw.display_name);
  if (!title) throw Object.assign(Error("OpenAlex returned a work without a title"), { status: 400 });
  const displayName = ({ author, raw_author_name }) => text(author?.display_name)
    || text(raw_author_name) || text(author?.name) || [
      text(author?.firstName || author?.first_name || author?.given || author?.given_name),
      text(author?.lastName || author?.last_name || author?.family || author?.family_name),
    ].filter(Boolean).join(" ");
  const authorships = (Array.isArray(raw.authorships) ? raw.authorships : []).filter(
    (authorship) => authorship?.author && displayName(authorship),
  );
  const data = {
    ...raw,
    title,
    doi: record.doi || undefined,
    publication_date: text(raw.publication_date) || text(raw.publication_year),
    language: text(raw.language),
    ids: { ...raw.ids, openalex: record.id },
    primary_location: {
      ...raw.primary_location,
      source: source && typeof source === "object" ? {
        ...source,
        display_name: text(source.display_name),
        host_organization_name: text(source.host_organization_name),
        issn: Array.isArray(source.issn) ? source.issn.map(text).filter(Boolean) : text(source.issn || source.issn_l),
      } : null,
    },
    biblio: Object.fromEntries(["issue", "volume", "first_page", "last_page"].map(
      (field) => [field, text(raw.biblio?.[field])],
    )),
    authorships: authorships.map((authorship) => ({
      ...authorship,
      author: { ...authorship.author, display_name: displayName(authorship) },
    })),
    keywords: (Array.isArray(raw.keywords) ? raw.keywords : []).map(
      (keyword) => ({ display_name: text(keyword?.display_name || keyword?.keyword || keyword) }),
    ).filter((keyword) => keyword.display_name),
  };
  t.setString(JSON.stringify(data));
  t.setTranslator("faa53754-fb55-4658-9094-ae8a7e0409a2");
  const items = await t.translate({ libraryID: false });
  signal?.throwIfAborted();
  return items.flatMap((item) => {
    // Retain native cleanAuthor for ordinary OpenAlex display names. The main
    // reviewer's structured/single-field input behavior only overrides that
    // parser when the source explicitly supplies a name boundary or mode.
    item.creators = authorships.map((authorship) => {
      const { author } = authorship;
      const firstName = text(author.firstName || author.first_name || author.given || author.given_name);
      const lastName = text(author.lastName || author.last_name || author.family || author.family_name);
      const name = text(author.name) || displayName(authorship);
      const creatorType = text(author.creatorType || author.creator_type) || "author";
      if (String(author.fieldMode) === "1" || author.type === "organization"
          || (text(author.name) && !firstName && !lastName))
        return { lastName: name, fieldMode: 1, creatorType };
      if (firstName || lastName) return { firstName, lastName, creatorType };
      return Z.Utilities.cleanAuthor(name, creatorType, false);
    });
    return translatedAPIItems(Z, item).map((converted) => {
      // Native API JSON has no creator-identity slots. Keep these editable
      // alongside its native name/type fields, and retain the complete raw work
      // in import provenance for affiliations and other provider-only metadata.
      converted.creators = (converted.creators || []).map((creator, index) => {
        const author = authorships[index]?.author;
        return { ...creator,
          ...(text(author?.id) ? { OpenAlex: text(author.id) } : {}),
          ...(text(author?.orcid) ? { ORCID: text(author.orcid) } : {}),
        };
      });
      const landingPage = text(raw.primary_location?.landing_page_url || raw.best_oa_location?.landing_page_url);
      if (!converted.url && landingPage) converted.url = landingPage;
      if (!converted.rights && text(raw.primary_location?.license)) converted.rights = text(raw.primary_location.license);
      return normalizeWorkMetadata({ ...converted, ...record.identifiers });
    });
  });
}
