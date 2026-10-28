// SPDX-License-Identifier: AGPL-3.0-or-later
// Project-qualified module: existing backend authentication/lifetime owns the only entry point.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Store } from "./store/index.mjs";
import { extractPDF } from "./extract.mjs";
import { NativeComponents } from "./native.mjs";
import { decodeRFC2047 } from "./headers.mjs";
import {
  normalizeIdentifier,
  resolveIdentifiers,
} from "./adapted/identifiers.mjs";
import { requestText } from "./adapted/metadata-http.mjs";
import {
  harvestOpenAlex,
  selectAbstract,
  openAlexRecord,
} from "./adapted/openalex.mjs";
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
const bounded = (value, max = 200) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > max)
    fail("Expected 1–" + max + " records");
  return value;
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const cleanFilename = (name) =>
  String(name || "attachment")
    .replace(/[\\/\u0000-\u001f]/g, "_")
    .slice(0, 180);
export async function createReferencesService({
  dataDir,
  backendId,
  authorizeProject,
  listProjects,
  translator,
  resolver,
} = {}) {
  if (
    !path.isAbsolute(dataDir || "") ||
    !backendId ||
    typeof authorizeProject !== "function"
  )
    throw Error(
      "References needs its existing backend data root, identity and project authorization",
    );
  const root = path.join(dataDir, "references");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const store = new Store(),
    native = new NativeComponents(),
    jobs = new Map(),
    jobStates = new Map(),
    operations = new Map(),
    resolutionFlights = new Map(),
    uploads = new Map();
  const settingsFile = path.join(root, "settings.json");
  let settings = await fs
    .readFile(settingsFile, "utf8")
    .then(JSON.parse)
    .catch((e) => {
      if (e.code === "ENOENT") return {};
      throw e;
    });
  const project = async (authority, id) => {
    const p = await authorizeProject(authority, id);
    if (!p || p.id !== id || !path.isAbsolute(p.cwd || ""))
      fail("Project is not authorized", 403);
    return { ...p, file: path.join(root, digest(p.id), "library.sqlite") };
  };
  const call = (p, op, args, signal) => {
    const mutation =
      [
        "put",
        "batch",
        "remove",
        "putCollection",
        "deleteCollection",
        "putSearch",
        "deleteSearch",
      ].includes(op) ||
      (["record", "fulltext"].includes(op) && args.data !== undefined);
    if (!mutation) return store.call(p.file, op, args, signal);
    const commit = async (ownerSignal) => {
      signal?.throwIfAborted();
      ownerSignal?.throwIfAborted();
      return store.call(p.file, op, args);
    };
    return p.runAuthorized ? p.runAuthorized(commit) : commit(signal);
  };
  const identity = (p, key) => `bkref:${backendId}/${p.id}/${key}`;
  const decorate = (p, item) => ({
    ...item,
    id: identity(p, item.key),
    library: { id: p.id, backendId },
    meta: {
      attachmentCount: item.data.attachmentCount || 0,
      creatorSummary: (item.data.creators || [])
        .map((c) => c.name || c.lastName || c.firstName)
        .join("; "),
    },
  });
  const nativeValues = (metadata) => {
    const mapping = new Map(
      metadata
        .filter((x) => x.key)
        .map((x) => [
          x.key,
          randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase(),
        ]),
    );
    return metadata.map((original) => {
      const data = { ...original };
      delete data.key;
      delete data.version;
      if (data.parentItem)
        data.parentItem = mapping.get(data.parentItem) || data.parentItem;
      return { createKey: mapping.get(original.key), data };
    });
  };
  const itemKey = (p, id) => {
    const prefix = `bkref:${backendId}/${p.id}/`;
    if (!id?.startsWith(prefix) || !/^[A-Z0-9]+$/.test(id.slice(prefix.length)))
      fail("Reference belongs to another library");
    return id.slice(prefix.length);
  };
  const privateWrite = async (file, value) => {
    const temp = file + "." + randomUUID();
    await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(temp, file);
  };
  function pendingResolvers(value) {
    if (!value || typeof value !== "object") return [];
    if (value.status === "challenge-required" && value.requestId)
      return [value];
    return Object.values(value).flatMap(pendingResolvers);
  }
  function finishJobStatus(status) {
    status.status = pendingResolvers(status.results).length
      ? "waiting-for-browser"
      : status.results.some((x) => x.status === "error")
        ? "partial"
        : "complete";
  }
  async function completeResolver(p, request, receipt) {
    const completed = {
      ...request,
      status: "complete",
      receipt,
      completedAt: new Date().toISOString(),
    };
    await call(p, "record", {
      id: "resolver:" + request.requestId,
      data: completed,
    });
    for (const jobId of new Set(
      [request.jobId, ...(request.jobIds || [])].filter(Boolean),
    )) {
      const jobKey = p.id + ":" + jobId;
      const status =
        jobStates.get(jobKey) ||
        (await call(p, "record", { id: "job:" + jobId }));
      if (status) {
        for (const pending of pendingResolvers(status.results)) {
          if (pending.requestId === request.requestId) {
            pending.status = "complete";
            pending.attachment = receipt;
            pending.completedAt = completed.completedAt;
          }
        }
        if (!jobs.has(jobKey)) finishJobStatus(status);
        await call(p, "record", { id: "job:" + jobId, data: status });
      }
    }
    return receipt;
  }
  async function job(
    p,
    authority,
    kind,
    values,
    execute,
    requestId,
    options = {},
  ) {
    const id = requestId || randomUUID();
    const previous = await call(p, "record", { id: "job:" + id });
    const inputDigest = digest(JSON.stringify({ kind, values }));
    if (previous) {
      if (
        previous.kind !== kind ||
        (previous.inputDigest && previous.inputDigest !== inputDigest)
      )
        fail("Job request ID was reused with different input", 409);
      if (
        !options.resume ||
        jobs.has(p.id + ":" + id) ||
        ["complete", "waiting-for-browser"].includes(previous.status)
      )
        return previous;
    }
    if (jobs.size >= 32) fail("Too many queued jobs", 429);
    const controller = new AbortController();
    const status = previous || {
      id,
      kind,
      inputDigest,
      status: "queued",
      completed: 0,
      total: values.length,
      results: [],
      createdAt: new Date().toISOString(),
    };
    status.status = "queued";
    delete status.error;
    delete status.finishedAt;
    let progressTimer;
    const progress = (value) => {
      status.progress ||= {};
      status.progress[value.key || value.id] = value;
      if (options.batch)
        status.completed = Object.values(status.progress).filter((value) =>
          [
            "complete",
            "unavailable",
            "already-available",
            "challenge-required",
          ].includes(value.status),
        ).length;
      if (!progressTimer) {
        progressTimer = setTimeout(() => {
          progressTimer = undefined;
          void call(p, "record", { id: "job:" + id, data: status }).catch(
            (error) => controller.abort(error),
          );
        }, 100);
        progressTimer.unref();
      }
    };
    await call(p, "record", { id: "job:" + id, data: status });
    jobs.set(p.id + ":" + id, controller);
    jobStates.set(p.id + ":" + id, status);
    void (async () => {
      try {
        status.status = "running";
        if (options.batch) {
          const results = await execute(values, controller.signal, id, {
            jobId: id,
            onProgress: progress,
          });
          status.results = results.map((result, index) => ({
            index,
            status: "complete",
            result: [result],
          }));
          status.completed = values.length;
        } else
          for (let i = 0; i < values.length; i++) {
            controller.signal.throwIfAborted();
            await project(authority, p.id);
            if (status.results[i]?.status === "complete") continue;
            try {
              status.results[i] = {
                index: i,
                status: "complete",
                result: await execute(
                  values[i],
                  controller.signal,
                  id + ":" + i,
                  { jobId: id, jobIndex: i, onProgress: progress },
                ),
              };
            } catch (e) {
              if (controller.signal.aborted) throw e;
              status.results[i] = {
                index: i,
                status: "error",
                error: e.message,
              };
            }
            status.completed = i + 1;
            await call(p, "record", { id: "job:" + id, data: status });
            await new Promise((resolve) => setImmediate(resolve));
          }
        finishJobStatus(status);
      } catch (e) {
        status.status = controller.signal.aborted ? "cancelled" : "failed";
        status.error = e.message;
      } finally {
        clearTimeout(progressTimer);
        status.finishedAt = new Date().toISOString();
        await call(p, "record", { id: "job:" + id, data: status }).catch(
          () => {},
        );
        jobs.delete(p.id + ":" + id);
        jobStates.delete(p.id + ":" + id);
      }
    })();
    return status;
  }
  async function enrich(p, item, signal, raw) {
    const data = item.data;
    let record;
    if (raw) record = openAlexRecord(raw);
    else {
      const identifiers = {
        DOI: data.DOI,
        PMID:
          data.PMID || String(data.extra || "").match(/^PMID:\s*(\d+)/m)?.[1],
      };
      const query = identifiers.DOI
        ? "doi:" + identifiers.DOI
        : identifiers.PMID
          ? "pmid:" + identifiers.PMID
          : null;
      if (!query) return item;
      const result = await harvestOpenAlex({
        filter: query,
        limit: 2,
        pageSize: 2,
        apiKey: settings.openalexKey,
        signal,
      });
      if (result.records.length !== 1) return item;
      record = result.records[0];
    }
    const actual = {
      DOI: data.DOI?.toLowerCase(),
      PMID: data.PMID || String(data.extra || "").match(/^PMID:\s*(\d+)/m)?.[1],
    };
    const supplied = { DOI: record.doi, PMID: record.pmid };
    let match = false;
    for (const kind of ["DOI", "PMID"]) {
      if (actual[kind] && supplied[kind]) {
        if (actual[kind] !== supplied[kind])
          fail("Conflicting OpenAlex identifier");
        match = true;
      }
    }
    if (!match) return item;
    const chosen = selectAbstract(record.abstract, data.abstractNote || "");
    const provenance = {
      ...(data.provenance || {}),
      abstract: {
        existing: data.abstractNote || "",
        openalex: record.abstract,
        chosenSource: chosen.source === "Zotero" ? "library" : chosen.source,
        openalexId: record.id,
        sourceUrl: record.sourceUrl,
        raw: record.raw,
        warnings: record.abstractIssue || null,
        retrievedAt: new Date().toISOString(),
        priorVersion: item.version,
      },
    };
    return call(
      p,
      "put",
      {
        value: {
          key: item.key,
          data: { ...data, abstractNote: chosen.text, provenance },
        },
        expected: item.version,
      },
      signal,
    );
  }
  async function importIdentifier(
    p,
    input,
    signal,
    receipt,
    authority,
    resolverContext,
    resolveFiles = settings.automaticPDFs,
  ) {
    const normalized = normalizeIdentifier(input);
    const resolution = await resolveIdentifiers({
      identifiers: [input],
      signal,
      mailto: settings.crossrefEmail,
    });
    const resolved = resolution.items[0];
    if (!resolved.zoteroIdentifier)
      return { input, status: "unresolved", resolution: resolved };
    const matches = await call(
      p,
      "find",
      { identifiers: { [normalized.type]: normalized.value } },
      signal,
    );
    if (matches.length > 1)
      fail("Several records match this identifier; reconcile duplicates");
    if (matches.length === 1)
      return { input, status: "skipped", item: decorate(p, matches[0]) };
    const metadata = translator
      ? await translator.resolve(resolved.zoteroIdentifier, {
          signal,
          settings,
        })
      : await native.call(
          "translateIdentifier",
          [resolved.zoteroIdentifier, { settings }],
          signal,
        );
    const items = await call(
      p,
      "batch",
      {
        items: nativeValues(
          metadata.map((data) => ({
            ...data,
            provenance: {
              source: "pinned-translator",
              input,
              resolution: resolved,
              retrievedAt: new Date().toISOString(),
            },
          })),
        ),
        receipt,
      },
      signal,
    );
    const enriched = [];
    for (const item of items) {
      if (["attachment", "note", "annotation"].includes(item.data.itemType)) {
        enriched.push(item);
        continue;
      }
      try {
        enriched.push(await enrich(p, item, signal));
      } catch (error) {
        enriched.push({
          ...item,
          enrichment: { status: "error", error: error.message },
        });
      }
    }
    const pdfs = resolveFiles
      ? await resolvePDFs(
          p,
          authority,
          enriched.filter(
            (x) =>
              !["attachment", "note", "annotation"].includes(x.data.itemType),
          ),
          signal,
          true,
          resolverContext,
        )
      : undefined;
    return {
      input,
      status: "imported",
      items: enriched.map((x) => decorate(p, x)),
      ...(pdfs ? { pdfs } : {}),
    };
  }
  async function saveAttachment(p, authority, meta, body, sessionID) {
    if (p.runAuthorized)
      return p.runAuthorized(async (ownerSignal) => {
        ownerSignal?.throwIfAborted();
        return saveAttachment(
          { ...p, runAuthorized: undefined },
          authority,
          meta,
          body,
          sessionID,
        );
      });
    const session = await call(p, "record", { id: "capture:" + sessionID });
    if (!session) fail("Capture session is unavailable", 409);
    let resolverRequest;
    if (meta.resolverRequestId) {
      resolverRequest = await call(p, "record", {
        id: "resolver:" + meta.resolverRequestId,
      });
      if (
        !resolverRequest ||
        resolverRequest.sessionID !== sessionID ||
        resolverRequest.attachment.id !== meta.id ||
        resolverRequest.attachment.parentItemID !== meta.parentItemID
      )
        fail("Resolver receipt does not match this capture", 403);
      if (resolverRequest.status === "complete") return resolverRequest.receipt;
      if (
        resolverRequest.status !== "challenge-required" ||
        resolverRequest.expiresAt < Date.now()
      )
        fail("Resolver request has expired or was cancelled", 409);
      const currentParent = await call(p, "get", { key: meta.parentItemID });
      if (currentParent.data.deleted)
        fail("Resolver parent is in the trash", 409);
      const signature = body?.tempPath
        ? await fs.open(body.tempPath, "r").then(async (file) => {
            try {
              const bytes = Buffer.alloc(1024);
              const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
              return bytes.subarray(0, bytesRead);
            } finally {
              await file.close();
            }
          })
        : Buffer.from(body).subarray(0, 1024);
      if (!signature.includes(Buffer.from("%PDF-")))
        fail("Browser retrieval did not return a PDF", 415);
      meta = { ...meta, contentType: "application/pdf" };
    }
    const parent = meta.parentItemID
      ? session.items?.[meta.parentItemID]
      : null;
    if (meta.parentItemID && !parent)
      fail("Capture parent is not in this session");
    const receiptId =
      "attachment:" +
      sessionID +
      ":" +
      (meta.id || digest(meta.url || meta.title || ""));
    const previous = await call(p, "record", { id: receiptId });
    if (previous)
      return resolverRequest
        ? completeResolver(p, resolverRequest, previous)
        : previous;
    const key = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
    const mime = meta.contentType || "application/octet-stream",
      ext =
        mime === "application/pdf"
          ? ".pdf"
          : mime === "text/html"
            ? ".html"
            : mime === "application/epub+zip"
              ? ".epub"
              : "";
    const filename =
      key + "-" + cleanFilename(meta.title || "attachment") + ext;
    const directory = path.join(
      p.cwd,
      "Bibliography",
      digest(p.id).slice(0, 24),
      parent || key,
    );
    // Resolve each component after creation; an existing symlink cannot redirect a project write.
    const canonical = await fs.realpath(p.cwd);
    let current = canonical;
    for (const part of [
      "Bibliography",
      digest(p.id).slice(0, 24),
      parent || key,
    ]) {
      current = path.join(current, part);
      await fs.mkdir(current, { mode: 0o700 }).catch((e) => {
        if (e.code !== "EEXIST") throw e;
      });
      if (
        (await fs.lstat(current)).isSymbolicLink() ||
        !(await fs.stat(current)).isDirectory()
      )
        fail("Attachment folder is not a normal project directory");
    }
    await project(authority, p.id);
    const destination = path.join(current, filename);
    const temp = destination + ".partial";
    if (body?.tempPath)
      await fs.copyFile(body.tempPath, temp, fs.constants.COPYFILE_EXCL);
    else await fs.writeFile(temp, body, { flag: "wx", mode: 0o600 });
    await fs.rename(temp, destination);
    try {
      const result = await call(p, "put", {
        value: {
          data: {
            itemType: "attachment",
            title: meta.title || filename,
            parentItem: parent || undefined,
            contentType: mime,
            linkMode: "imported_url",
            url: meta.url || "",
            filename,
            path: path.relative(canonical, destination),
            collections: parent ? [] : session.target ? [session.target] : [],
          },
        },
      });
      const receipt = { ...decorate(p, result), captureID: meta.id };
      await call(p, "record", { id: receiptId, data: receipt });
      return resolverRequest
        ? completeResolver(p, resolverRequest, receipt)
        : receipt;
    } catch (e) {
      await fs.rm(destination, { force: true });
      throw e;
    }
  }
  async function attachmentPath(p, item) {
    const base = await fs.realpath(path.join(p.cwd, "Bibliography"));
    const file = await fs.realpath(path.resolve(p.cwd, item.data.path || ""));
    if (
      !file.startsWith(base + path.sep) ||
      item.data.itemType !== "attachment"
    )
      fail("Attachment is outside its project");
    return file;
  }
  async function recognizePDF(p, authority, attachment, sessionID, signal) {
    let result;
    try {
      const text = await extractPDF(await attachmentPath(p, attachment), {
        signal,
        maxPages: 3,
      });
      const candidates = [
        ...new Set(
          (text.content.match(/10\.\d{4,9}\/[^\s<>"\]]+/g) || []).map((x) =>
            x.replace(/[.,;)]+$/, ""),
          ),
        ),
      ];
      if (candidates.length !== 1)
        result = {
          status: "unresolved",
          reason: candidates.length
            ? "Multiple identifiers require parent selection"
            : "No unambiguous DOI in the initial pages",
          identifiers: candidates,
        };
      else {
        const imported = await importIdentifier(
          p,
          candidates[0],
          signal,
          "recognize:" + sessionID,
          authority,
        );
        const parent =
          imported.item ||
          imported.items?.find(
            (x) =>
              !["attachment", "note", "annotation"].includes(x.data.itemType),
          );
        if (parent) {
          await project(authority, p.id);
          const current = await call(p, "get", { key: attachment.key }, signal);
          await call(
            p,
            "put",
            {
              value: {
                key: current.key,
                data: {
                  ...current.data,
                  parentItem: parent.key,
                  collections: [],
                },
              },
              expected: current.version,
            },
            signal,
          );
          result = {
            status: "recognized",
            confidence: "single-extracted-identifier",
            item: {
              id: parent.key,
              itemType: parent.data.itemType,
              title: parent.data.title,
            },
            provenance: {
              identifier: candidates[0],
              pages: text.indexedPages,
              provider: "References native translators",
            },
          };
        } else
          result = {
            status: "unresolved",
            reason: "Identifier metadata was unavailable",
          };
      }
    } catch (error) {
      result = { status: "unresolved", reason: error.message };
    }
    await call(p, "record", { id: "recognition:" + sessionID, data: result });
    return result;
  }
  async function resolvePDFs(
    p,
    authority,
    items,
    signal,
    automatic = false,
    context = {},
    shared = false,
  ) {
    if (!shared) {
      const fresh = [],
        deferred = [];
      const waiting = items.map((item) => {
        const key = identity(p, item.key);
        if (resolutionFlights.has(key)) return resolutionFlights.get(key);
        let resolve, reject;
        const promise = new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        });
        resolutionFlights.set(key, promise);
        fresh.push(item);
        deferred.push({ key, resolve, reject });
        return promise;
      });
      if (fresh.length)
        void resolvePDFs(p, authority, fresh, signal, automatic, context, true)
          .then(
            (results) =>
              deferred.forEach((entry, index) => entry.resolve(results[index])),
            (error) => deferred.forEach((entry) => entry.reject(error)),
          )
          .finally(() =>
            deferred.forEach((entry) => resolutionFlights.delete(entry.key)),
          );
      const results = await Promise.all(waiting);
      // Several jobs can wait for the same authenticated browser retrieval.
      for (const result of results)
        if (result.status === "challenge-required" && context.jobId) {
          const lock = "resolver-job:" + p.id + ":" + result.requestId;
          const prior = operations.get(lock) || Promise.resolve();
          const work = prior
            .catch(() => {})
            .then(async () => {
              const request = await call(p, "record", {
                id: "resolver:" + result.requestId,
              });
              if (request.status === "complete") {
                result.status = "complete";
                result.attachment = request.receipt;
                return;
              }
              request.jobIds = [
                ...new Set([...(request.jobIds || []), context.jobId]),
              ];
              await call(p, "record", {
                id: "resolver:" + result.requestId,
                data: request,
              });
            });
          operations.set(lock, work);
          try {
            await work;
          } finally {
            if (operations.get(lock) === work) operations.delete(lock);
          }
        }
      return results;
    }
    for (const item of items) {
      item.fileAttachmentCount = await call(
        p,
        "fileAttachmentCount",
        { key: item.key },
        signal,
      );
    }
    const results = resolver
      ? await Promise.all(
          items.map((item) =>
            resolver.resolve({ project: p, item, settings, signal, automatic }),
          ),
        )
      : await native.call(
          "resolveFiles",
          [
            {
              items: items.map((item) => ({
                ...item,
                id: identity(p, item.key),
                libraryID: p.id,
              })),
              settings,
              automatic,
              temporaryRoot: path.join(root, "downloads"),
            },
          ],
          signal,
          context.onProgress,
        );
    const outputs = [];
    for (const result of results) {
      if (!result.file) {
        if (result.status === "challenge-required") {
          const item = items.find(
            (item) =>
              item.key === result.key || identity(p, item.key) === result.id,
          );
          if (!item) fail("Resolver returned an unknown item", 502);
          const requestId = result.requestId || randomUUID();
          const sessionID = "resolver:" + requestId;
          const recipe = {
            status: "challenge-required",
            requestId,
            sessionID,
            attachment: {
              id: requestId,
              url: result.url,
              parentItemID: item.key,
              title: "Full text",
              contentType: "application/pdf",
              resolverRequestId: requestId,
            },
            expiresAt: Date.now() + 30 * 60 * 1000,
          };
          await call(p, "record", {
            id: "capture:" + sessionID,
            data: { items: { [item.key]: item.key }, target: null },
          });
          await call(p, "record", {
            id: "resolver:" + requestId,
            data: {
              ...recipe,
              jobId: context.jobId,
              jobIndex: context.jobIndex,
            },
          });
          outputs.push({ id: identity(p, item.key), ...recipe });
          continue;
        }
        outputs.push(result);
        continue;
      }
      const sessionID = "resolver:" + randomUUID();
      await call(p, "record", {
        id: "capture:" + sessionID,
        data: { items: { [result.key]: result.key }, target: null },
      });
      try {
        const attachment = await saveAttachment(
          p,
          authority,
          {
            id: randomUUID(),
            parentItemID: result.key,
            title: result.file.title,
            url: result.file.url,
            contentType: result.file.contentType,
          },
          { tempPath: result.file.path },
          sessionID,
        );
        outputs.push({ id: result.id, status: "complete", attachment });
      } finally {
        await fs.rm(result.file.directory, { recursive: true, force: true });
      }
    }
    return outputs;
  }
  async function connector(
    p,
    authority,
    method,
    body,
    query,
    headers,
    signal,
    serialized = false,
  ) {
    if (query.get("target") === "L" + p.id) query.delete("target");
    let metadata = {};
    const encodedMetadata = headers["X-Metadata"] || headers["x-metadata"];
    if (encodedMetadata) {
      if (typeof encodedMetadata !== "string" || encodedMetadata.length > 65536) fail("Attachment metadata exceeds its limit");
      try { metadata = JSON.parse(decodeRFC2047(encodedMetadata)); }
      catch { fail("Invalid attachment metadata"); }
    }
    const writes = [
      "upload-begin",
      "upload-chunk",
      "upload-cancel",
      "upload-commit",
      "saveItems",
      "saveAttachment",
      "saveStandaloneAttachment",
      "saveSnapshot",
      "saveSingleFile",
      "import",
      "updateSession",
      "installStyle",
    ];
    if (!serialized && writes.includes(method)) {
      const lock = p.id + ":capture";
      const prior = operations.get(lock) || Promise.resolve();
      const work = prior
        .catch(() => {})
        .then(() => {
          signal?.throwIfAborted();
          return connector(
            p,
            authority,
            method,
            body,
            query,
            headers,
            signal,
            true,
          );
        });
      operations.set(lock, work);
      try {
        return await work;
      } finally {
        if (operations.get(lock) === work) operations.delete(lock);
      }
    }
    if (
      body &&
      typeof body === "object" &&
      !Buffer.isBuffer(body) &&
      body.target === "L" + p.id
    )
      body = { ...body, target: null };
    const sessionID =
      body?.sessionID || metadata.sessionID || query.get("sessionID") || query.get("session");
    if (method === "ping")
      return {
        prefs: {
          automaticSnapshots: true,
          downloadAssociatedFiles: true,
          reportActiveURL: false,
          supportsTagsAutocomplete: false,
          canUserAddNote: true,
        },
        version: "10.0.6",
        connectorAPIVersion: 3,
      };
    if (method === "getTranslators")
      return native.call("translatorMetadata", [body?.url], signal);
    if (method === "getTranslatorCode")
      return native.call("translatorCode", [body.translatorID], signal);
    if (method === "getResolverRequest") {
      const request = await call(
        p,
        "record",
        { id: "resolver:" + body.requestId },
        signal,
      );
      if (!request) fail("Resolver request is unavailable", 404);
      if (request.status === "complete")
        return {
          status: "complete",
          requestId: request.requestId,
          receipt: request.receipt,
          completedAt: request.completedAt,
        };
      if (
        request.status !== "challenge-required" ||
        request.expiresAt < Date.now()
      )
        fail("Resolver request has expired or was cancelled", 409);
      const parent = await call(
        p,
        "get",
        { key: request.attachment.parentItemID },
        signal,
      );
      if (parent.data.deleted) fail("Resolver parent is in the trash", 409);
      const { jobId, jobIndex, ...recipe } = request;
      return recipe;
    }
    if (method === "getSelectedCollection") {
      const list = await call(
        p,
        "collections",
        {
          parent: body?.parent || null,
          start: Number(body?.start) || 0,
          limit: 80,
        },
        signal,
      );
      return {
        libraryID: p.id,
        libraryName: p.name || p.id,
        editable: true,
        libraryEditable: true,
        filesEditable: true,
        target: body?.target || "L" + p.id,
        collectionID: body?.target || null,
        collectionName: body?.target
          ? (await call(p, "collection", { key: body.target }, signal)).data
              .name
          : null,
        id: body?.target || "L" + p.id,
        name: body?.target
          ? (await call(p, "collection", { key: body.target }, signal)).data
              .name
          : p.name || p.id,
        targets: list.items.map((c) => ({
          id: c.key,
          name: c.data.name,
          level: 0,
          libraryID: p.id,
          filesEditable: true,
        })),
        nextStart:
          list.items.length === 80 ? (Number(body?.start) || 0) + 80 : null,
      };
    }
    if (method === "upload-begin") {
      const requestHash = digest(JSON.stringify(body));
      if (body.requestId) {
        const old = await call(p, "record", {
          id: "upload-request:" + body.requestId,
        });
        if (old) {
          if (old.requestHash !== requestHash)
            fail("Upload request ID was reused with different data", 409);
          return { uploadId: old.uploadId };
        }
      }
      if (body.parentKey) {
        await call(p, "get", { key: body.parentKey }, signal);
        const q = new URLSearchParams(body.queryString || "");
        const capture = q.get("sessionID") || body.requestId || randomUUID();
        q.set("sessionID", capture);
        body = { ...body, queryString: q.toString() };
        await call(p, "record", {
          id: "capture:" + capture,
          data: { items: { [body.parentKey]: body.parentKey }, target: null },
        });
      }
      if (
        ![
          "saveAttachment",
          "saveStandaloneAttachment",
          "saveSingleFile",
          "import",
          "installStyle",
        ].includes(body.method) ||
        !Number.isSafeInteger(body.byteLength) ||
        body.byteLength < 0 ||
        body.byteLength > 2 ** 31 ||
        body.bodyEncoding === "json" && body.byteLength > 32 * 1024 * 1024
      )
        fail("Invalid upload");
      for (const upload of uploads.values()) {
        if (upload.expires < Date.now()) {
          await upload.file.close();
          await fs.rm(upload.tempPath, { force: true });
          uploads.delete(upload.id);
        }
      }
      if (uploads.size >= 16) fail("Too many uploads", 429);
      const id = randomUUID(),
        tempPath = path.join(root, "upload-" + id);
      const file = await fs.open(tempPath, "wx", 0o600);
      uploads.set(id, {
        ...body,
        id,
        pid: p.id,
        file,
        tempPath,
        offset: 0,
        expires: Date.now() + 30 * 60 * 1000,
      });
      await call(p, "record", {
        id: "upload:" + id,
        data: {
          ...body,
          id,
          pid: p.id,
          tempPath,
          offset: 0,
          expires: Date.now() + 30 * 60 * 1000,
        },
      });
      if (body.requestId)
        await call(p, "record", {
          id: "upload-request:" + body.requestId,
          data: { uploadId: id, requestHash },
        });
      return { uploadId: id };
    }
    if (method.startsWith("upload-")) {
      let u = uploads.get(body.uploadId);
      if (!u) {
        u = await call(p, "record", { id: "upload:" + body.uploadId });
        if (u?.result) return u.result;
        if (u?.cancelled) fail("Upload was cancelled", 409);
        if (u && u.pid === p.id && u.expires >= Date.now()) {
          u.file = await fs.open(u.tempPath, "r+");
          uploads.set(u.id, u);
        }
      }
      if (!u || u.pid !== p.id || u.expires < Date.now())
        fail("Upload is unavailable", 404);
      if (method === "upload-cancel") {
        await u.file.close();
        await fs.rm(u.tempPath, { force: true });
        uploads.delete(u.id);
        await call(p, "record", {
          id: "upload:" + u.id,
          data: { ...u, file: undefined, cancelled: true },
        });
        return { cancelled: true };
      }
      if (method === "upload-chunk") {
        if (typeof body.data !== "string" || body.data.length > 349528 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) fail("Invalid upload chunk");
        const bytes = Buffer.from(body.data || "", "base64");
        if (
          bytes.length > 262144 ||
          body.offset !== u.offset ||
          u.offset + bytes.length > u.byteLength
        )
          fail("Upload offset or size mismatch", 409);
        await u.file.write(bytes, 0, bytes.length, u.offset);
        u.offset += bytes.length;
        await call(p, "record", {
          id: "upload:" + u.id,
          data: { ...u, file: undefined },
        });
        return { offset: u.offset };
      }
      if (method === "upload-commit") {
        if (u.result) return u.result;
        if (u.offset !== u.byteLength) fail("Upload is incomplete", 409);
        await u.file.sync();
        const q = new URLSearchParams(u.queryString || "");
        const data =
          u.bodyEncoding === "json"
            ? JSON.parse(await fs.readFile(u.tempPath, "utf8"))
            : { tempPath: u.tempPath };
        u.result = await connector(
          p,
          authority,
          u.method,
          data,
          q,
          u.headers || {},
          signal,
          true,
        );
        await call(p, "record", {
          id: "upload:" + u.id,
          data: { ...u, file: undefined },
        });
        await u.file.close();
        await fs.rm(u.tempPath, { force: true });
        uploads.delete(u.id);
        return u.result;
      }
    }
    if (method === "saveItems") {
      if (!sessionID) fail("Capture sessionID required");
      let session = await call(p, "record", { id: "capture:" + sessionID });
      if (session) return session.receipt;
      const capture = await native.call(
        "captureItems",
        [bounded(body.items)],
        signal,
      );
      const values = nativeValues(
        capture.records.map((data) => ({
          ...data,
          collections: data.parentItem ? [] : body.target ? [body.target] : [],
        })),
      );
      const saved = await call(
        p,
        "batch",
        { items: values, receipt: "capture-write:" + sessionID },
        signal,
      );
      session = {
        target: body.target || null,
        items: Object.fromEntries(
          body.items.map((item, i) => [
            item.id,
            saved[capture.parentIndexes[i]].key,
          ]),
        ),
        receipt: {
          items: body.items.map((item, i) => ({
            ...decorate(p, saved[capture.parentIndexes[i]]),
            id: body.items[i].id,
          })),
        },
      };
      await call(p, "record", { id: "capture:" + sessionID, data: session });
      return session.receipt;
    }
    if (method === "saveAttachment" || method === "saveStandaloneAttachment") {
      const meta = metadata;
      if (!sessionID) fail("Capture sessionID required");
      if (
        method === "saveStandaloneAttachment" &&
        !(await call(p, "record", { id: "capture:" + sessionID }))
      )
        await call(p, "record", {
          id: "capture:" + sessionID,
          data: {
            items: {},
            target: meta.target || query.get("target") || null,
          },
        });
      const attachment = await saveAttachment(
        p,
        authority,
        meta,
        body,
        sessionID,
      );
      if (
        method === "saveStandaloneAttachment" &&
        attachment.data.contentType === "application/pdf"
      ) {
        const recognition = await recognizePDF(
          p,
          authority,
          attachment,
          sessionID,
          signal,
        );
        return { ...attachment, canRecognize: !!recognition.item, recognition };
      }
      return { ...attachment, canRecognize: false };
    }
    if (method === "saveSnapshot" || method === "saveSingleFile") {
      if (!sessionID) fail("Capture sessionID required");
      if (!(await call(p, "record", { id: "capture:" + sessionID }))) {
        await connector(
          p,
          authority,
          "saveItems",
          {
            sessionID,
            target: body.target,
            items: [
              {
                id: sessionID,
                itemType: "webpage",
                title: body.title || body.url,
                url: body.url,
              },
            ],
          },
          query,
          headers,
          signal,
          true,
        );
      }
      if (body.snapshotContent)
        return saveAttachment(
          p,
          authority,
          {
            parentItemID: body.items?.[0]?.id || sessionID,
            title: body.title || "Snapshot",
            url: body.url,
            contentType: "text/html",
          },
          Buffer.from(body.snapshotContent),
          sessionID,
        );
      return { saveSingleFile: true };
    }
    if (method === "installStyle") {
      const install = async (ownerSignal) => {
        signal?.throwIfAborted();
        ownerSignal?.throwIfAborted();
        return native.call(
          "installStyle",
          [
            {
              xml: typeof body === "string" ? body : body.data,
              directory: path.join(root, "styles"),
            },
          ],
          undefined,
        );
      };
      return p.runAuthorized ? p.runAuthorized(install) : install(signal);
    }
    if (method === "import") {
      if (!sessionID) fail("Capture sessionID required");
      const text = typeof body === "string" ? body : body.data;
      const parsed = await native.call("translateImport", [text], signal);
      return (
        await call(
          p,
          "batch",
          {
            items: nativeValues(
              parsed.map((data) => ({
                ...data,
                collections: data.parentItem
                  ? []
                  : query.get("target")
                    ? [query.get("target")]
                    : [],
              })),
            ),
            receipt: "import:" + sessionID,
          },
          signal,
        )
      ).map((x) => decorate(p, x));
    }
    if (method === "updateSession") {
      const s = await call(p, "record", { id: "capture:" + sessionID });
      if (!s) fail("Capture session unavailable", 404);
      const hasTarget = Object.hasOwn(body, "target");
      if (hasTarget && body.target)
        await call(p, "collection", { key: body.target }, signal);
      const values = [];
      for (const k of Object.values(s.items || {})) {
        const item = await call(p, "get", { key: k }, signal);
        const data = { ...item.data };
        if (hasTarget) data.collections = body.target ? [body.target] : [];
        if (body.tags !== undefined)
          data.tags = String(body.tags)
            .split(",")
            .map((tag) => ({ tag: tag.trim() }))
            .filter((x) => x.tag);
        values.push({ key: k, version: item.version, data });
      }
      if (values.length) await call(p, "batch", { items: values }, signal);
      if (hasTarget) {
        s.target = body.target || null;
        await call(p, "record", { id: "capture:" + sessionID, data: s });
      }
      if (body.note) {
        const parent = Object.values(s.items || {})[0];
        if (parent)
          await call(
            p,
            "batch",
            {
              items: [
                {
                  data: {
                    itemType: "note",
                    parentItem: parent,
                    note: String(body.note),
                  },
                },
              ],
              receipt:
                "capture-note:" + sessionID + ":" + digest(String(body.note)),
            },
            signal,
          );
      }
      return {};
    }
    if (method === "hasAttachmentResolvers") return { hasResolvers: true };
    if (method === "getRecognizedItem") {
      const r = await call(p, "record", { id: "recognition:" + sessionID });
      return r?.item || false;
    }
    if (method === "saveAttachmentFromResolver") {
      const s = await call(p, "record", { id: "capture:" + sessionID });
      return resolvePDFs(
        p,
        authority,
        [await call(p, "get", { key: s.items[body.itemID] })],
        signal,
      );
    }
    fail("Connector capability is not connected: " + method, 501);
  }
  async function handle(request) {
    try {
      const { method = "GET", authority, signal } = request;
      const body = request.body || {};
      const query =
        request.query instanceof URLSearchParams
          ? request.query
          : new URLSearchParams(request.query || {});
      const headers = request.headers || {};
      const url = new URL(request.path, "http://references.invalid");
      for (const [k, v] of url.searchParams) query.set(k, v);
      let segments = url.pathname
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent);
      if (segments[0] === "projects" && segments.length === 1)
        return { status: 200, body: (await listProjects?.(authority)) || [] };
      if (segments[0] !== "projects" || !segments[1])
        fail("An explicit project library is required");
      const p = await project(authority, segments[1]);
      segments = segments.slice(2);
      let compatibility = false;
      if (segments[0] === "api") {
        if (segments[1] !== "users" || segments[2] !== "0")
          fail("Legacy library alias has no explicit import mapping", 404);
        segments = segments.slice(3);
        compatibility = true;
      }
      let result,
        status = 200,
        responseHeaders = {
          "Zotero-API-Version": "3",
          "Zotero-Server-ID": backendId,
          "X-Zotero-Version": "10.0.6",
          "Cache-Control": "no-store",
        };
      const op = segments[0],
        key = segments[1],
        action = segments[2];
      const expected = Number(
        headers["if-unmodified-since-version"] ||
          headers["If-Unmodified-Since-Version"] ||
          body.version,
      );
      if (op === "connector") {
        result = await connector(
          p,
          authority,
          key,
          request.body,
          query,
          headers,
          signal,
        );
      } else if (op === "citation-options")
        result = await native.call(
          "citationOptions",
          [Object.fromEntries(query)],
          signal,
        );
      else if (op === "schema")
        result = await native.call("schema", [], signal);
      else if (op === "settings") {
        if (method === "PATCH") {
          const allowed = [
            "openalexKey",
            "crossrefEmail",
            "unpaywallEmail",
            "resolvers",
            "automaticPDFs",
          ];
          for (const name of Object.keys(body))
            if (!allowed.includes(name)) fail("Unknown setting");
          if (body.resolvers !== undefined)
            await native.call("validateResolvers", [body.resolvers], signal);
          for (const name of ["crossrefEmail", "unpaywallEmail"])
            if (body[name] && !/^[^@\s<>]+@[^@\s<>]+$/.test(body[name]))
              fail("Invalid contact email");
          const updated = { ...settings, ...body };
          if (p.runAuthorized)
            await p.runAuthorized(async (ownerSignal) => {
              ownerSignal?.throwIfAborted();
              await privateWrite(settingsFile, updated);
              settings = updated;
            });
          else {
            await privateWrite(settingsFile, updated);
            settings = updated;
          }
        } else if (method !== "GET") fail("Method not allowed", 405);
        result = {
          openalexKeyConfigured: !!settings.openalexKey,
          crossrefEmail: settings.crossrefEmail || "",
          unpaywallEmail: settings.unpaywallEmail || "",
          resolvers: settings.resolvers || "[]",
          automaticPDFs: !!settings.automaticPDFs,
        };
      } else if (op === "jobs") {
        if (method === "POST" && action === "resume") {
          const original = await call(
            p,
            "record",
            { id: "job-request:" + key },
            signal,
          );
          if (!original) fail("Job request is unavailable", 404);
          return handle({
            ...request,
            method: "POST",
            path: original.path,
            body: { ...original.body, requestId: key, resume: true },
          });
        }
        if (method === "DELETE") {
          jobs
            .get(p.id + ":" + key)
            ?.abort(new DOMException("Cancelled", "AbortError"));
        }
        result = await call(p, "record", { id: "job:" + key }, signal);
        if (!result) fail("Job not found", 404);
        if (method === "DELETE") {
          for (const pending of pendingResolvers(result.results)) {
            const receipt = await call(
              p,
              "record",
              { id: "resolver:" + pending.requestId },
              signal,
            );
            if (receipt?.status === "challenge-required")
              await call(
                p,
                "record",
                {
                  id: "resolver:" + pending.requestId,
                  data: { ...receipt, status: "cancelled" },
                },
                signal,
              );
          }
          if (!jobs.has(p.id + ":" + key)) {
            result = {
              ...result,
              status: "cancelled",
              finishedAt: new Date().toISOString(),
            };
            await call(p, "record", { id: "job:" + key, data: result }, signal);
          }
        }
        if (
          !jobs.has(p.id + ":" + key) &&
          ["queued", "running"].includes(result.status)
        )
          result = { ...result, status: "interrupted" };
      } else if (op === "identifiers" && key === "import") {
        result = await job(
          p,
          authority,
          "identifier-import",
          bounded(body.identifiers, 1000),
          (input, s, id, context) =>
            importIdentifier(
              p,
              input,
              s,
              id,
              authority,
              context,
              body.resolvePDFs ?? settings.automaticPDFs,
            ),
          body.requestId,
          { resume: body.resume },
        );
        status = 202;
      } else if (op === "crossref" && key === "search") {
        if (!body.query || typeof body.query !== "string")
          fail("Crossref search requires a query");
        const u = new URL("https://api.crossref.org/works");
        u.searchParams.set("query", body.query.slice(0, 4096));
        u.searchParams.set(
          "rows",
          String(Math.min(100, Math.max(1, Number(body.limit) || 50))),
        );
        if (body.cursor) u.searchParams.set("cursor", body.cursor);
        if (settings.crossrefEmail)
          u.searchParams.set("mailto", settings.crossrefEmail);
        const r = JSON.parse(
          await requestText(
            u,
            {
              headers: {
                Accept: "application/json",
                "User-Agent": "BashKitten References/0.1",
              },
            },
            { signal },
          ),
        );
        result = {
          items: r.message.items,
          total: r.message["total-results"],
          next: r.message["next-cursor"] || null,
        };
      } else if (op === "openalex" && key === "search") {
        if (
          body.page !== undefined ||
          body.cursor !== undefined ||
          body.estimate
        ) {
          const u = new URL("https://api.openalex.org/works");
          const queryMode = body.queryMode || "boolean";
          const field = body.field || "all";
          if (
            !["boolean", "semantic"].includes(queryMode) ||
            ![
              "all",
              "title",
              "title_and_abstract",
              "title_abstract_keywords",
            ].includes(field)
          )
            fail("Unsupported OpenAlex search mode or field");
          if (queryMode === "semantic" && field !== "all")
            fail("Semantic search does not support a field restriction");
          if (body.query) {
            const name =
              queryMode === "semantic"
                ? "search.semantic"
                : field === "all"
                  ? "search"
                  : "search." + field;
            u.searchParams.set(
              name + (body.exact && queryMode !== "semantic" ? ".exact" : ""),
              String(body.query),
            );
          }
          if (body.filter)
            u.searchParams.set("filter", String(body.filter).slice(0, 4096));
          if (body.sort)
            u.searchParams.set("sort", String(body.sort).slice(0, 4096));
          const rows = body.estimate
            ? 1
            : Math.min(100, Math.max(1, Number(body.pageSize) || 80));
          u.searchParams.set("per_page", String(rows));
          if (body.cursor) {
            if (body.cursor !== "*" && !settings.openalexKey)
              fail(
                "Cursor paging requires an OpenAlex key in References Settings",
              );
            u.searchParams.set("cursor", body.cursor);
          } else
            u.searchParams.set(
              "page",
              String(Math.max(1, Math.min(10000, Number(body.page) || 1))),
            );
          if (Buffer.byteLength(u.href) > 4094)
            fail(
              "OpenAlex request exceeds its URL limit; split the query into smaller searches",
            );
          const raw = JSON.parse(
            await requestText(
              u,
              {
                headers: {
                  Accept: "application/json",
                  "User-Agent": "BashKitten References/0.1",
                  ...(settings.openalexKey
                    ? { Authorization: "Bearer " + settings.openalexKey }
                    : {}),
                },
              },
              { signal },
            ),
          );
          if (
            !Array.isArray(raw.results) ||
            raw.results.length > rows ||
            !Number.isSafeInteger(raw.meta?.count)
          )
            fail("Malformed OpenAlex page", 502);
          result = {
            records: body.estimate ? [] : raw.results.map(openAlexRecord),
            count: body.estimate ? 0 : raw.results.length,
            totalResultsReported: raw.meta.count,
            nextCursor: raw.meta.next_cursor || null,
            nextPage:
              raw.results.length === rows ? (Number(body.page) || 1) + 1 : null,
            estimate: !!body.estimate,
            provenance: { url: u.href, retrievedAt: new Date().toISOString() },
          };
        } else
          result = await harvestOpenAlex({
            ...body,
            apiKey: settings.openalexKey,
            signal,
          });
      } else if (op === "openalex" && key === "import") {
        result = await job(
          p,
          authority,
          "openalex-import",
          bounded(body.records, 1000),
          async (raw, activeSignal, receipt, context) => {
            const record = openAlexRecord(raw),
              identifier = record.doi
                ? "DOI:" + record.doi
                : record.pmid
                  ? "PMID:" + record.pmid
                  : null;
            if (identifier) {
              const imported = await importIdentifier(
                p,
                identifier,
                activeSignal,
                receipt,
                authority,
                context,
                body.resolvePDFs ?? settings.automaticPDFs,
              );
              const candidates =
                imported.items || (imported.item ? [imported.item] : []);
              for (const item of candidates.filter(
                (x) =>
                  !["attachment", "note", "annotation"].includes(
                    x.data.itemType,
                  ),
              ))
                await enrich(p, item, activeSignal, raw);
              return imported;
            }
            const previous = await call(
              p,
              "find",
              { identifiers: { OpenAlex: record.id } },
              activeSignal,
            );
            if (previous.length > 1)
              fail("Several items share this OpenAlex identity");
            if (previous.length === 1)
              return { status: "skipped", item: decorate(p, previous[0]) };
            const metadata = await native.call(
              "translateOpenAlex",
              [raw],
              activeSignal,
            );
            const values = nativeValues(
              metadata.map((data) => ({
                ...data,
                abstractNote: selectAbstract(
                  record.abstract,
                  data.abstractNote || "",
                ).text,
                provenance: {
                  openalex: {
                    id: record.id,
                    raw,
                    sourceUrl: record.sourceUrl,
                    retrievedAt: new Date().toISOString(),
                  },
                  abstract: {
                    openalex: record.abstract,
                    chosenSource: record.abstract ? "OpenAlex" : null,
                    warnings: record.abstractIssue || null,
                  },
                },
              })),
            );
            const imported = await call(
              p,
              "batch",
              { items: values, receipt },
              activeSignal,
            );
            const pdfs =
              (body.resolvePDFs ?? settings.automaticPDFs)
                ? await resolvePDFs(
                    p,
                    authority,
                    imported.filter(
                      (x) =>
                        !["attachment", "note", "annotation"].includes(
                          x.data.itemType,
                        ),
                    ),
                    activeSignal,
                    true,
                    context,
                  )
                : undefined;
            return {
              status: "imported",
              items: imported.map((x) => decorate(p, x)),
              ...(pdfs ? { pdfs } : {}),
            };
          },
          body.requestId,
          { resume: body.resume },
        );
        status = 202;
      } else if (op === "styles")
        result = await native.call(
          "listStyles",
          [
            {
              ...Object.fromEntries(query),
              customDirectory: path.join(root, "styles"),
            },
          ],
          signal,
        );
      else if (op === "citations" && key === "parse") {
        result = await native.call("parseCitations", [body.text], signal);
        for (const c of result.citations) {
          for (const item of c.cluster.items) {
            const k = itemKey(p, item.id);
            await call(p, "get", { key: k }, signal);
          }
        }
      } else if (op === "citations" && key === "render") {
        const state = structuredClone(body);
        state.styleDirectory = path.join(root, "styles");
        state.embeddedItems =
          body.metadataSource === "snapshot"
            ? structuredClone(body.embeddedItems || {})
            : {};
        for (const c of state.citations || []) {
          for (const source of c.items || []) {
            const k = itemKey(p, source.id);
            if (
              state.embeddedItems[source.id] &&
              (!state.embeddedItems[source.id].type ||
                typeof state.embeddedItems[source.id].title !== "string")
            )
              fail("Invalid embedded CSL snapshot");
            if (!state.embeddedItems[source.id]) {
              const i = await call(p, "get", { key: k }, signal);
              state.embeddedItems[source.id] = await native.call(
                "toCSL",
                [i.data, source.id],
                signal,
              );
            }
          }
        }
        result = await native.call("renderDocument", [state], signal);
      } else if (op === "items" && key === "manage") {
        if (method !== "POST") fail("Method not allowed", 405);
        if (
          ![
            "add-collection",
            "remove-collection",
            "delete",
            "restore",
          ].includes(body.operation)
        )
          fail("Unsupported item operation");
        if (["add-collection", "remove-collection"].includes(body.operation))
          await call(p, "collection", { key: body.collection }, signal);
        result = await job(
          p,
          authority,
          body.operation,
          bounded(body.items, 1000),
          async (selected, activeSignal) => {
            const item = await call(
              p,
              "get",
              { key: selected.key },
              activeSignal,
            );
            if (item.version !== selected.version)
              fail("Record changed; reload before editing", 412);
            if (body.operation === "delete")
              return call(
                p,
                "remove",
                { key: item.key, expected: item.version },
                activeSignal,
              );
            const data =
              body.operation === "restore"
                ? { deleted: 0 }
                : {
                    collections:
                      body.operation === "add-collection"
                        ? [
                            ...new Set([
                              ...(item.data.collections || []),
                              body.collection,
                            ]),
                          ]
                        : (item.data.collections || []).filter(
                            (key) => key !== body.collection,
                          ),
                  };
            return decorate(
              p,
              await call(
                p,
                "put",
                {
                  value: { key: item.key, data },
                  expected: item.version,
                  patch: true,
                },
                activeSignal,
              ),
            );
          },
          body.requestId,
          { resume: body.resume },
        );
        status = 202;
      } else if (op === "items" && ["enrich", "resolve-pdfs"].includes(key)) {
        const batch = key === "resolve-pdfs";
        result = await job(
          p,
          authority,
          key,
          bounded(body.keys, 1000),
          async (value, activeSignal, receipt, context) => {
            if (!batch)
              return decorate(
                p,
                await enrich(
                  p,
                  await call(p, "get", { key: value }, activeSignal),
                  activeSignal,
                ),
              );
            const items = [];
            for (const itemKey of value)
              items.push(await call(p, "get", { key: itemKey }, activeSignal));
            return resolvePDFs(
              p,
              authority,
              items,
              activeSignal,
              false,
              context,
            );
          },
          body.requestId,
          { batch, resume: body.resume },
        );
        status = 202;
      } else if (op === "items") {
        if (!key || key === "top") {
          if (method === "GET") {
            result = await call(
              p,
              "list",
              {
                query: query.get("q") || query.get("query") || "",
                collection: query.get("collection"),
                sort: query.get("sort") || "title",
                direction: query.get("direction"),
                limit: Number(query.get("limit")) || 80,
                summary:
                  !compatibility &&
                  query.get("format") !== "csljson" &&
                  query.get("includeData") !== "true",
                start: Number(query.get("start")) || 0,
                cursor: query.get("cursor"),
                deleted: query.get("deleted") === "1",
                count: compatibility || query.get("count") === "1",
                top: key === "top" || query.get("top") !== "false",
                itemType: query.get("itemType"),
              },
              signal,
            );
            result.items = result.items.map((x) => decorate(p, x));
            if (query.get("format") === "csljson") {
              for (const item of result.items)
                item.itemData = await native.call(
                  "toCSL",
                  [item.data, item.id],
                  signal,
                );
            }
            if (result.total !== undefined)
              responseHeaders["Total-Results"] = String(result.total);
            responseHeaders["Last-Modified-Version"] = String(result.version);
            if (compatibility)
              result =
                query.get("format") === "csljson"
                  ? result.items.map((x) => x.itemData)
                  : result.items;
          } else if (method === "POST") {
            result = (
              await call(
                p,
                "batch",
                {
                  items: bounded(Array.isArray(body) ? body : [body]),
                  receipt: headers["idempotency-key"],
                },
                signal,
              )
            ).map((x) => decorate(p, x));
            status = 201;
          } else fail("Method not allowed", 405);
        } else if (action === "children") {
          result = await call(
            p,
            "list",
            {
              parent: key,
              top: false,
              limit: Number(query.get("limit")) || 80,
              cursor: query.get("cursor"),
            },
            signal,
          );
          result.items = result.items.map((x) => decorate(p, x));
          if (compatibility) result = result.items;
        } else if (action === "fulltext") {
          try {
            result = await call(p, "fulltext", { key }, signal);
          } catch (error) {
            if (error.status !== 404) throw error;
            const item = await call(p, "get", { key }, signal);
            if (item.data.contentType !== "application/pdf") throw error;
            const extracted = await extractPDF(await attachmentPath(p, item), {
              signal,
            });
            await project(authority, p.id);
            result = await call(
              p,
              "fulltext",
              { key, data: extracted },
              signal,
            );
          }
        } else if (action === "file") {
          const item = await call(p, "get", { key }, signal);
          const file = await fs.realpath(
            path.resolve(p.cwd, item.data.path || ""),
          );
          const base = await fs.realpath(path.join(p.cwd, "Bibliography"));
          if (
            !file.startsWith(base + path.sep) ||
            item.data.itemType !== "attachment"
          )
            fail("Attachment file is unavailable", 404);
          return {
            status: 200,
            headers: {
              "Content-Type":
                item.data.contentType || "application/octet-stream",
              "Content-Disposition":
                'inline; filename="' +
                cleanFilename(item.data.filename).replaceAll('"', "_") +
                '"',
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy":
                "sandbox; default-src 'none'; img-src data: https:; style-src 'unsafe-inline'",
            },
            filePath: file,
          };
        } else if (method === "GET") {
          result = decorate(p, await call(p, "get", { key }, signal));
          responseHeaders["Last-Modified-Version"] = String(result.version);
          if (query.get("format") === "csljson") {
            result.itemData = await native.call(
              "toCSL",
              [result.data, result.id],
              signal,
            );
            if (compatibility) result = result.itemData;
          }
        } else if (method === "PUT" || method === "PATCH")
          result = decorate(
            p,
            await call(
              p,
              "put",
              {
                value: { key, data: body.data || body },
                expected,
                patch: method === "PATCH",
              },
              signal,
            ),
          );
        else if (method === "DELETE")
          result = await call(p, "remove", { key, expected }, signal);
        else fail("Method not allowed", 405);
      } else if (op === "searches") {
        if (method === "GET")
          result = key
            ? await call(p, "search", { key }, signal)
            : await call(
                p,
                "searches",
                {
                  start: Number(query.get("start")) || 0,
                  limit: Number(query.get("limit")) || 80,
                },
                signal,
              );
        else if (method === "POST" || method === "PATCH" || method === "PUT")
          result = await call(
            p,
            "putSearch",
            { value: { key, data: body.data || body }, expected },
            signal,
          );
        else if (method === "DELETE")
          result = await call(p, "deleteSearch", { key, expected }, signal);
        else fail("Method not allowed", 405);
      } else if (op === "collections") {
        if (method === "GET")
          result = key
            ? await call(p, "collection", { key }, signal)
            : await call(
                p,
                "collections",
                {
                  parent: query.get("parent"),
                  start: Number(query.get("start")) || 0,
                  limit: Number(query.get("limit")) || 80,
                },
                signal,
              );
        else if (method === "POST" || method === "PATCH" || method === "PUT")
          result = await call(
            p,
            "putCollection",
            { value: { key, data: body.data || body }, expected },
            signal,
          );
        else if (method === "DELETE")
          result = await call(p, "deleteCollection", { key, expected }, signal);
        else fail("Method not allowed", 405);
      } else fail("References endpoint not found", 404);
      if (status === 202 && result?.id)
        await call(
          p,
          "record",
          {
            id: "job-request:" + result.id,
            data: { path: url.pathname, body },
          },
          signal,
        );
      return { status, headers: responseHeaders, body: result };
    } catch (error) {
      return {
        status: error.status || (error.name === "AbortError" ? 499 : 500),
        headers: { "Cache-Control": "no-store" },
        body: { error: error.message },
      };
    }
  }
  return {
    handle,
    parseDocument: async (
      text,
      { authority, identity: identityAuthority, projectId, signal } = {},
    ) => {
      const result = await handle({
        method: "POST",
        path: `/projects/${projectId}/citations/parse`,
        body: { text },
        authority: authority || identityAuthority,
        signal,
      });
      if (result.status !== 200) fail(result.body.error, result.status);
      return result.body;
    },
    renderDocument: async (state, { authority, projectId, signal } = {}) => {
      const result = await handle({
        method: "POST",
        path: `/projects/${projectId}/citations/render`,
        body: state,
        authority,
        signal,
      });
      if (result.status !== 200) fail(result.body.error, result.status);
      return result.body;
    },
    close: async () => {
      for (const c of jobs.values()) c.abort();
      for (const u of uploads.values()) {
        await u.file.close().catch(() => {});
        await fs.rm(u.tempPath, { force: true });
      }
      await Promise.all([store.close(), native.close()]);
    },
  };
}
