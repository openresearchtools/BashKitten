// SPDX-License-Identifier: AGPL-3.0-or-later
// One document state enters the native CSL processor, including all retroactive updates.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { toCSL } from "./translation.mjs";
const require = createRequire(import.meta.url),
  CSL = require("citeproc");
const { JSDOM } = require("jsdom"),
  purify = require("dompurify")(new JSDOM("").window);
purify.addHook("afterSanitizeAttributes", (node) => {
  if (!node.hasAttribute?.("style")) return;
  const allowed = new Set([
    "font-style",
    "font-weight",
    "font-variant",
    "text-decoration",
    "vertical-align",
  ]);
  const style = Array.from(node.style)
    .filter((name) => allowed.has(name))
    .map((name) => `${name}:${node.style.getPropertyValue(name)}`)
    .join(";");
  if (style) node.setAttribute("style", style);
  else node.removeAttribute("style");
});
const safeRich = (html) =>
  purify.sanitize(String(html), {
    ALLOWED_TAGS: ["i", "b", "em", "strong", "sup", "sub", "span", "a", "br"],
    ALLOWED_ATTR: ["href", "style"],
    ALLOW_DATA_ATTR: false,
  });
const escapeHTML = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const styleRoot = fileURLToPath(
  new URL("./vendor/styles/source/", import.meta.url),
);
const localeRoot = fileURLToPath(
  new URL("./vendor/locales/source/", import.meta.url),
);
const safeName = (value, kind) => {
  const name = String(value || "").replace(
    /^https?:\/\/www\.zotero\.org\/styles\//,
    "",
  );
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    if (kind === "style" && name.length <= 8192) {
      try {
        const uri = new URL(name);
        if (
          ["https:", "http:", "urn:"].includes(uri.protocol) &&
          !uri.username &&
          !uri.password
        )
          return "custom-" + createHash("sha256").update(name).digest("hex");
      } catch {}
    }
    throw Object.assign(Error("Invalid " + kind), { status: 400 });
  }
  return name;
};
const plain = (html) =>
  String(html)
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
let catalog;
async function getStyle(id, seen = new Set(), customDirectory) {
  const name = safeName(id || "apa", "style");
  if (seen.has(name)) throw Error("Dependent style cycle");
  seen.add(name);
  let xml;
  try {
    xml = customDirectory
      ? await fs
          .readFile(path.join(customDirectory, name + ".csl"), "utf8")
          .catch(() => fs.readFile(path.join(styleRoot, name + ".csl"), "utf8"))
      : await fs.readFile(path.join(styleRoot, name + ".csl"), "utf8");
  } catch {
    xml = await fs
      .readFile(path.join(styleRoot, "dependent", name + ".csl"), "utf8")
      .catch(() => {
        throw Object.assign(Error("Citation style is not installed: " + name), {
          status: 404,
        });
      });
  }
  if (/<!ENTITY|<!DOCTYPE/i.test(xml))
    throw Error("External CSL entities are not allowed");
  const parent =
    xml.match(/<link[^>]+href="([^"]+)"[^>]+rel="independent-parent"/) ||
    xml.match(/<link[^>]+rel="independent-parent"[^>]+href="([^"]+)"/);
  const resolvedParent = parent
    ? await getStyle(parent[1], seen, customDirectory)
    : null;
  return {
    id: name,
    xml: resolvedParent?.xml || xml,
    version: createHash("sha256")
      .update(xml + (resolvedParent?.version || ""))
      .digest("hex"),
  };
}
export async function listStyles({
  query = "",
  start = 0,
  limit = 80,
  customDirectory,
} = {}) {
  if (!catalog)
    catalog = (async () => {
      const list = [];
      for (const sub of ["", "dependent"]) {
        for (const name of await fs.readdir(path.join(styleRoot, sub))) {
          if (!name.endsWith(".csl")) continue;
          const text = await fs.readFile(
            path.join(styleRoot, sub, name),
            "utf8",
          );
          list.push({
            id: name.slice(0, -4),
            title: plain(text.match(/<title>([\s\S]*?)<\/title>/)?.[1] || name),
          });
        }
      }
      return list.sort(
        (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
      );
    })();
  const extra = [];
  if (customDirectory)
    for (const name of await fs.readdir(customDirectory).catch(() => [])) {
      if (!name.endsWith(".csl")) continue;
      const xml = await fs.readFile(path.join(customDirectory, name), "utf8");
      extra.push({
        id: name.slice(0, -4),
        title: plain(xml.match(/<title>([\s\S]*?)<\/title>/)?.[1] || name),
      });
    }
  const overrides = new Set(extra.map((x) => x.id));
  const all = [
    ...extra,
    ...(await catalog).filter((x) => !overrides.has(x.id)),
  ].filter((x) =>
    (x.title + " " + x.id).toLowerCase().includes(query.toLowerCase()),
  );
  limit = Math.min(200, Math.max(1, Number(limit) || 80));
  start = Math.max(0, Number(start) || 0);
  return {
    items: all.slice(start, start + limit),
    total: all.length,
    nextStart: start + limit < all.length ? start + limit : null,
  };
}
export function validateCluster(cluster) {
  if (
    !cluster ||
    !Array.isArray(cluster.items) ||
    !cluster.items.length ||
    cluster.items.length > 1000
  )
    throw Error("A citation requires 1–1000 explicitly selected sources");
  return {
    ...cluster,
    items: cluster.items.map((item) => {
      if (
        typeof item.id !== "string" ||
        !/^bkref:[^/]+\/[^/]+\/[A-Z0-9]+$/.test(item.id)
      )
        throw Error("Invalid reference identity");
      const out = { id: item.id };
      for (const field of ["locator", "label", "prefix", "suffix"]) {
        if (item[field] !== undefined) {
          if (typeof item[field] !== "string" || item[field].length > 2048)
            throw Error("Invalid citation " + field);
          if (item[field]) out[field] = item[field];
        }
      }
      if (item.suppressAuthor || item["suppress-author"])
        out["suppress-author"] = true;
      return out;
    }),
  };
}
export async function renderDocument(state, { signal, resolveItem } = {}) {
  signal?.throwIfAborted();
  if (
    !state ||
    !Array.isArray(state.citations) ||
    state.citations.length > 100000
  )
    throw Error("An ordered document citation state is required");
  const style = await getStyle(
      state.style?.id,
      new Set(),
      state.styleDirectory,
    ),
    locale = safeName(state.style?.locale || "en-US", "locale");
  const localeFiles = await fs.readdir(localeRoot),
    locales = {};
  for (const name of localeFiles.filter((x) =>
    /^locales-[a-zA-Z-]+\.xml$/.test(x),
  ))
    locales[name.slice(8, -4)] = await fs.readFile(
      path.join(localeRoot, name),
      "utf8",
    );
  if (!locales[locale]) throw Error("CSL locale is unavailable");
  const citations = state.citations.map(validateCluster),
    ids = new Set(),
    items = {};
  for (const c of citations) {
    if (!c.id || ids.has(c.id))
      throw Error("Citation occurrences need unique IDs");
    ids.add(c.id);
    for (const item of c.items) {
      if (items[item.id]) continue;
      signal?.throwIfAborted();
      const data = resolveItem
        ? await resolveItem(item.id)
        : state.embeddedItems?.[item.id];
      if (!data) throw Error("Missing item " + item.id);
      items[item.id] = data.itemType
        ? await toCSL(data, item.id)
        : { ...data, id: item.id };
    }
  }
  function engine(format) {
    const p = new CSL.Engine(
      {
        retrieveLocale: (lang) =>
          locales[lang] ||
          locales[lang === "en" ? "en-US" : lang.split("-")[0]] ||
          locales["en-US"],
        retrieveItem: (id) => structuredClone(items[id]),
      },
      style.xml,
      locale,
      true,
    );
    p.setOutputFormat(format);
    return p;
  }
  const html = engine("html"),
    text = engine("text"),
    noteStyle = html.opt.xclass === "note";
  if (
    noteStyle &&
    citations.some((c) => !Number.isInteger(c.noteIndex) || c.noteIndex < 1)
  )
    throw Object.assign(
      Error(
        "This note style needs native footnote/endnote indices or the editor’s explicit note placement",
      ),
      { status: 422 },
    );
  const rendered = citations.map((c) => ({
    id: c.id,
    items: c.items,
    noteIndex: c.noteIndex || 0,
  }));
  for (const [processor, format] of [
    [html, "html"],
    [text, "text"],
  ]) {
    processor.updateItems(Object.keys(items));
    const previous = [];
    for (let index = 0; index < citations.length; index++) {
      signal?.throwIfAborted();
      const c = citations[index],
        noteIndex = c.noteIndex || 0;
      const [status, updates] = processor.processCitationCluster(
        {
          citationID: c.id,
          citationItems: structuredClone(c.items),
          properties: { noteIndex, unsorted: !!c.unsorted },
        },
        previous,
        [],
      );
      if (status.citation_errors?.length)
        throw Error(
          "CSL citation errors: " + JSON.stringify(status.citation_errors),
        );
      for (const [i, value] of updates) rendered[i][format] = value;
      previous.push([c.id, noteIndex]);
      if (index % 32 === 0) await new Promise((r) => setImmediate(r));
    }
  }
  for (let i = 0; i < citations.length; i++) {
    const c = citations[i];
    if (c.customText !== undefined) {
      if (typeof c.customText !== "string" || c.customText.length > 16384)
        throw Error("Custom citation text is too large");
      rendered[i].text = c.customText;
      rendered[i].html = escapeHTML(c.customText);
      rendered[i].customText = c.customText;
    } else if (c.customHTML !== undefined) {
      if (typeof c.customHTML !== "string" || c.customHTML.length > 65536)
        throw Error("Custom citation HTML is too large");
      rendered[i].html = safeRich(c.customHTML);
      rendered[i].text = plain(rendered[i].html);
      rendered[i].customHTML = rendered[i].html;
    }
  }
  const bibliography = html.makeBibliography(),
    textBibliography = text.makeBibliography();
  return {
    stateVersion: state.version,
    style: {
      id: style.id,
      version: style.version,
      locale,
      class: html.opt.xclass,
      sortable: html.citation_sort.tokens.length > 0,
    },
    embeddedItems: items,
    citations: rendered.map((c) => ({
      ...c,
      sortedItems: (
        html.registry.citationreg.citationById[c.id]?.sortedItems || []
      ).map(([, item]) =>
        Object.fromEntries(
          ["id", "locator", "label", "prefix", "suffix", "suppress-author"]
            .filter((k) => item[k] !== undefined)
            .map((k) => [k, item[k]]),
        ),
      ),
    })),
    bibliography: bibliography
      ? {
          html:
            bibliography[0].bibstart +
            bibliography[1].join("") +
            bibliography[0].bibend,
          entries: bibliography[1],
          textEntries: textBibliography?.[1] || [],
          entryIds: bibliography[0].entry_ids,
          parameters: bibliography[0],
        }
      : null,
  };
}

export async function citationOptions({ locale = "en-US" } = {}) {
  const { JSDOM } = require("jsdom");
  const text = await fs.readFile(
    path.join(localeRoot, "locales-" + safeName(locale, "locale") + ".xml"),
    "utf8",
  );
  const doc = new JSDOM(text, { contentType: "text/xml" }).window.document;
  const source = await fs.readFile(
    new URL(
      "./vendor/zotero/source/chrome/content/zotero/xpcom/cite.js",
      import.meta.url,
    ),
    "utf8",
  );
  const labels = JSON.parse(source.match(/"labels":\s*(\[[\s\S]*?\])/)[1]);
  return {
    locales: (await fs.readdir(localeRoot))
      .filter((x) => /^locales-[A-Za-z-]+\.xml$/.test(x))
      .map((x) => x.slice(8, -4)),
    locators: labels.map((id) => ({
      id,
      label:
        doc.querySelector('term[name="' + id + '"]:not([form]) single')
          ?.textContent ||
        doc.querySelector('term[name="' + id + '"]:not([form])')?.textContent ||
        id,
    })),
  };
}

export async function installStyle({ xml, directory }) {
  if (
    typeof xml !== "string" ||
    xml.length > 2 * 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml)
  )
    throw Error("Invalid CSL style source");
  const doc = new JSDOM(xml, { contentType: "text/xml" }).window.document;
  if (doc.documentElement.localName !== "style")
    throw Error("Expected a CSL style");
  const id = doc.querySelector("info > id")?.textContent,
    name = doc.querySelector("info > title")?.textContent;
  if (!id || !name) throw Error("CSL style requires identity and title");
  const slug = safeName(id, "style");
  // The native processor validates the style; dependent styles still resolve their published parent.
  if (!doc.querySelector('link[rel="independent-parent"]'))
    new CSL.Engine(
      {
        retrieveLocale: () =>
          require("node:fs").readFileSync(
            path.join(localeRoot, "locales-en-US.xml"),
            "utf8",
          ),
        retrieveItem: () => ({}),
      },
      xml,
      "en-US",
      true,
    );
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(directory, slug + ".csl"), xml, { mode: 0o600 });
  return { name, id, styleID: slug };
}
