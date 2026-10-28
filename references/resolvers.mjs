// SPDX-License-Identifier: AGPL-3.0-or-later
// Native Zotero queue and resolver methods; adapters replace XPCOM, file storage and private OA mirror.
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { translationRuntime } from "./translation.mjs";
const require = createRequire(import.meta.url),
  scope = new AsyncLocalStorage();
let ready;
export function validateResolvers(input) {
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  const list = Array.isArray(parsed)
    ? parsed
    : parsed?.method
      ? [parsed]
      : null;
  if (!list) throw Error("Resolvers must be an array or one resolver object");
  for (const r of list) {
    if (
      !r.name ||
      !["GET", "POST"].includes(String(r.method).toUpperCase()) ||
      typeof r.url !== "string" ||
      !r.url.includes("{doi}") ||
      !["html", "json"].includes(String(r.mode).toLowerCase()) ||
      typeof r.selector !== "string"
    )
      throw Error("Invalid native resolver definition");
    const u = new URL(r.url.replaceAll("{doi}", "10.1000/example"));
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
      throw Error("Resolver URL must use HTTP(S) without credentials");
    if (
      r.mappings &&
      Object.keys(r.mappings).some((k) => !["url", "pageURL"].includes(k))
    )
      throw Error("Resolver mappings allow url and pageURL");
  }
  return parsed;
}
export async function resolverRuntime() {
  if (ready) return ready;
  return (ready = (async () => {
    const base = await translationRuntime(),
      Z = {
        ...base,
        Prefs: { ...base.Prefs },
        Utilities: {
          ...base.Utilities,
          Internal: { ...base.Utilities.Internal },
        },
      },
      { JSDOM } = require("jsdom");
    const states = new Map(),
      observers = new Map();
    const update = (id, state) => {
      states.set(id, state);
      observers.get(id)?.(state);
    };
    const challengePatterns =
      require("./runtime/browser-challenge-patterns.json").matches;
    const challenge = (url) => {
      const active = scope.getStore();
      if (active) {
        const requestId = randomUUID();
        update(active.id, {
          status: "challenge-required",
          url,
          requestId,
          challenge: { url, requestId },
          message:
            "Authenticated browser retrieval or a human challenge is required",
        });
      }
    };
    class Item {
      constructor(data, options = {}) {
        Object.assign(this, options);
        this.data = data;
        this.id = options.id;
        this.libraryID = options.libraryID;
      }
      getField(k) {
        return this.data[k] || "";
      }
      getExtraField(k) {
        return (
          String(this.data.extra || "")
            .split("\n")
            .find((l) => l.startsWith(k + ":"))
            ?.slice(k.length + 1)
            .trim() || ""
        );
      }
      isRegularItem() {
        return !["attachment", "note", "annotation"].includes(
          this.data.itemType,
        );
      }
      numFileAttachmentsWithContentType() {
        return this.fileAttachmentCount || 0;
      }
    }
    Z.Item = Item;
    Z.getString = (k) =>
      ({
        "attachment.fullText": "Full text",
        "attachment.acceptedVersion": "Accepted version",
        "attachment.submittedVersion": "Submitted version",
      })[k] || k;
    Z.ProgressQueue = { ROW_SUCCEEDED: "complete", ROW_FAILED: "unavailable" };
    const dialog = { showMinimizeButton() {}, open() {}, setStatus() {} };
    const progress = {
      addListener() {},
      addRow(item) {
        update(item.id, { status: "waiting" });
      },
      getDialog: () => dialog,
      updateRow(id, status, message) {
        if (status === "unavailable" && states.get(id)?.challenge) {
          update(id, {
            ...states.get(id),
            ...states.get(id).challenge,
            status: "challenge-required",
          });
          return;
        }
        update(id, { ...(states.get(id) || {}), status, message });
      },
    };
    Z.ProgressQueues = { get: () => progress, create: () => progress };
    Z.ProgressWindow = function () {
      this.changeHeadline = () => {};
      this.ItemProgress = function () {
        this.setProgress = () => {};
      };
      this.show = () => {};
      this.startCloseTimer = () => {};
    };
    const oldGet = Z.Prefs.get;
    Z.Prefs.get = (k) =>
      k === "findPDFs.resolvers"
        ? scope.getStore()?.settings?.resolvers
        : oldGet(k);
    const Services = {
      io: {
        newURI: (value, _charset, base) => {
          const url = new URL(value, base?.spec);
          return {
            spec: url.href,
            host: url.hostname,
            resolve: (p) => new URL(p, url).href,
          };
        },
      },
    };
    const OS = {
      Path: path,
      File: { removeDir: (p) => fs.rm(p, { recursive: true, force: true }) },
    };
    async function mime(file) {
      const h = await fs.open(file, "r");
      try {
        const b = Buffer.alloc(1000);
        const { bytesRead } = await h.read(b, 0, 1000, 0);
        const x = b.subarray(0, bytesRead);
        if (x.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
        if (
          x.subarray(0, 2).toString() === "PK" &&
          x.includes(Buffer.from("application/epub+zip"))
        )
          return "application/epub+zip";
        return "application/octet-stream";
      } finally {
        await h.close();
      }
    }
    async function enforce(file) {
      if (
        !["application/pdf", "application/epub+zip"].includes(await mime(file))
      )
        throw Error("Downloaded data is not a supported PDF or EPUB");
    }
    class StatusError extends Error {
      constructor(url, response) {
        super("HTTP " + response.status + " from " + new URL(url).hostname);
        this.url = url;
        this.status = response.status;
        this.xmlhttp = response;
      }
      is5xx() {
        return this.status >= 500 && this.status < 600;
      }
    }
    const metadataHTTP = Z.HTTP;
    async function request(method, url, options = {}) {
      const active = scope.getStore(),
        signal = active?.signal;
      signal?.throwIfAborted();
      const parsed = new URL(url);
      if (
        !["https:", "http:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password
      )
        throw Error("Invalid resolver URL");
      const response = await fetch(url, {
        method,
        body: options.body || undefined,
        headers: {
          "User-Agent": "BashKitten References/0.1",
          ...options.headers,
        },
        redirect: options.followRedirects === false ? "manual" : "follow",
        signal: signal
          ? AbortSignal.any([
              signal,
              AbortSignal.timeout(options.timeout || 30000),
            ])
          : AbortSignal.timeout(options.timeout || 30000),
      });
      if (response.status >= 400) {
        if (response.status === 403 || response.status === 401) challenge(url);
        await response.body?.cancel();
        throw new StatusError(url, response);
      }
      if (Number(response.headers.get("content-length")) > 32 * 1024 * 1024) {
        await response.body?.cancel();
        throw Error("Resolver page exceeds 32 MiB");
      }
      const reader = response.body?.getReader(),
        parts = [];
      let size = 0;
      if (reader)
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 32 * 1024 * 1024)
              throw Error("Resolver page exceeds 32 MiB");
            parts.push(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      const bytes = Buffer.concat(parts),
        text = bytes.toString("utf8");
      let result =
        options.responseType === "json"
          ? JSON.parse(text)
          : options.responseType === "document"
            ? new JSDOM(text, { url: response.url || url }).window.document
            : options.responseType === "blob"
              ? new Blob([bytes], {
                  type: response.headers.get("content-type") || "",
                })
              : text;
      return {
        response: result,
        responseText: text,
        responseURL: response.url || url,
        status: response.status,
        getResponseHeader: (k) => response.headers.get(k) || "",
      };
    }
    // Keep the released HTTP implementation for translators; resolver reads need native blob/manual-redirect semantics.
    const resolverHTTP = {
      ...metadataHTTP,
      request,
      UnexpectedStatusException: StatusError,
      getHTMLMetaRefreshURL(doc, base) {
        const value = doc
          .querySelector('meta[http-equiv="refresh" i]')
          ?.getAttribute("content");
        const m = value?.match(/;\s*url\s*=\s*['"]?(.+?)['"]?$/i);
        return m ? new URL(m[1], base).href : null;
      },
    };
    Z.HTTP = resolverHTTP;
    Z.MIME = {
      getMIMETypeFromFile: mime,
      getPrimaryExtension: (m) =>
        m === "application/pdf"
          ? "pdf"
          : m === "application/epub+zip"
            ? "epub"
            : "dat",
    };
    Z.File = {
      rename: async (file, name) => {
        await fs.rename(file, path.join(path.dirname(file), name));
        return name;
      },
      putContentsAsync: async (file, blob) =>
        fs.writeFile(file, Buffer.from(await blob.arrayBuffer()), {
          mode: 0o600,
        }),
    };
    Z.BrowserRequest = {
      getEntryForURL: (url) => {
        const candidates = Object.keys(Z.Proxies.getPotentialProxies(url));
        return (
          challengePatterns.find((pattern) =>
            candidates.some((candidate) => candidate.includes(pattern)),
          ) || null
        );
      },
      clearChallenge: async (url) => {
        challenge(url);
        throw Object.assign(Error("A browser challenge is required"), {
          code: "CHALLENGE_REQUIRED",
        });
      },
    };
    Z.Utilities.Internal = {
      ...Z.Utilities.Internal,
      blobToHTMLDocument: async (blob, url) =>
        new JSDOM(await blob.text(), { url }).window.document,
      getOpenAccessPDFURLs: async (doi) => {
        const s = scope.getStore()?.settings || {};
        if (s.unpaywallEmail) {
          const u = new URL(
            "https://api.unpaywall.org/v2/" + encodeURIComponent(doi),
          );
          u.searchParams.set("email", s.unpaywallEmail);
          const r = await request("GET", u.href, { responseType: "json" });
          return (r.response.oa_locations || []).map((x) => ({
            url: x.url_for_pdf,
            pageURL: x.url_for_landing_page,
            version: x.version,
          }));
        }
        const u =
          "https://api.openalex.org/works/https://doi.org/" +
          encodeURIComponent(doi);
        const r = await request("GET", u, {
          responseType: "json",
          headers: s.openalexKey
            ? { Authorization: "Bearer " + s.openalexKey }
            : {},
        });
        return (r.response.locations || [])
          .filter((x) => x.is_oa)
          .map((x) => ({
            url: x.pdf_url,
            pageURL: x.landing_page_url,
            version: x.version,
          }));
      },
    };
    Z.Utilities.Internal.getFileFromDocument =
      require("./runtime/file-from-document.js")(Z);
    const attachments = {
      FIND_AVAILABLE_FILE_TYPES: ["application/pdf", "application/epub+zip"],
      canFindFileForItem: (item) =>
        item.isRegularItem() &&
        !item.numFileAttachmentsWithContentType() &&
        !!(
          item.getField("DOI") ||
          item.getField("url") ||
          item.getExtraField("DOI") ||
          item.getField("PMCID")
        ),
      createTemporaryStorageDirectory: async () => ({
        path: await fs.mkdtemp(
          path.join(scope.getStore().temporaryRoot, "resolver-"),
        ),
      }),
      getFileBaseNameFromItem: (_item, { attachmentTitle }) =>
        String(attachmentTitle || "Full text")
          .replace(/[\\/\u0000-\u001f]/g, "_")
          .slice(0, 100),
      createURLAttachmentFromTemporaryStorageDirectory: async (options) => {
        const result = new Item(
          { title: options.title, contentType: options.contentType },
          { id: options.parentItemID },
        );
        update(options.parentItemID, {
          status: "complete",
          file: {
            ...options,
            path: path.join(options.directory, options.filename),
          },
        });
        return result;
      },
      downloadFile: async (url, file, options) => {
        const active = scope.getStore();
        active.signal?.throwIfAborted();
        const response = await fetch(url, {
          headers: {
            "User-Agent": "BashKitten References/0.1",
            ...(options.referrer ? { Referer: options.referrer } : {}),
          },
          signal: active.signal
            ? AbortSignal.any([active.signal, AbortSignal.timeout(60000)])
            : AbortSignal.timeout(60000),
        });
        if (!response.ok) {
          if (response.status === 403 || response.status === 401)
            challenge(url);
          await response.body?.cancel();
          throw new StatusError(url, response);
        }
        if (!response.body) throw Error("Attachment has no body");
        await pipeline(
          Readable.fromWeb(response.body),
          createWriteStream(file, { mode: 0o600 }),
          { signal: active.signal },
        );
        await enforce(file);
      },
    };
    require("./runtime/resolver-native.js").call(attachments, Z, {
      Services,
      OS,
      _enforceFileType: enforce,
      _getTitleFromVersion: (version) =>
        version?.includes("accepted")
          ? "Accepted version"
          : version?.includes("submitted")
            ? "Submitted version"
            : "Full text",
    });
    const nativeAdd = attachments.addFileFromURLs.bind(attachments);
    attachments.addFileFromURLs = (item, resolvers, options) =>
      scope.run(item, () =>
        nativeAdd(item, resolvers, {
          ...options,
          onBeforeRequest: async (...a) => {
            item.signal?.throwIfAborted();
            update(item.id, {
              ...(states.get(item.id) || {}),
              status: "waiting",
              url: a[0],
            });
            return options.onBeforeRequest?.(...a);
          },
          onRequestError: (error) => {
            const retry = options.onRequestError?.(error);
            if (retry)
              update(item.id, {
                ...(states.get(item.id) || {}),
                status: "retrying",
                message: "Waiting for the provider before retrying",
              });
            return retry;
          },
        }),
      );
    // Resolver functions are created in the item's own scope so settings cannot cross project jobs.
    const nativeResolvers = attachments.getFileResolvers.bind(attachments);
    attachments.getFileResolvers = (item, ...args) =>
      scope.run(item, () =>
        nativeResolvers(item, ...args).map((r) =>
          typeof r === "function" ? () => scope.run(item, r) : r,
        ),
      );
    Z.Attachments = attachments;
    return { Z, states, Item, observers };
  })());
}
export async function resolveFiles(
  { items, temporaryRoot, settings = {}, automatic = false },
  { signal, onProgress } = {},
) {
  const { Z, states, Item, observers } = await resolverRuntime();
  await fs.mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  const nativeItems = items.map(
    (x) =>
      new Item(x.data, {
        id: x.id,
        key: x.key,
        libraryID: x.libraryID,
        signal,
        settings,
        automatic,
        temporaryRoot,
        fileAttachmentCount: x.fileAttachmentCount,
      }),
  );
  for (const item of nativeItems)
    observers.set(item.id, (state) =>
      onProgress?.({
        id: item.id,
        key: item.key,
        status: state.status,
        message: state.message,
        url: state.url,
      }),
    );
  try {
    await Z.Attachments.addAvailableFiles(nativeItems);
    signal?.throwIfAborted();
    return nativeItems.map((item) => ({
      id: item.id,
      key: item.key,
      status: item.fileAttachmentCount ? "already-available" : "unavailable",
      ...states.get(item.id),
    }));
  } finally {
    for (const item of nativeItems) {
      states.delete(item.id);
      observers.delete(item.id);
    }
  }
}
