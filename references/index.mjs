// SPDX-License-Identifier: AGPL-3.0-or-later
// Project-qualified module: existing backend authentication/lifetime owns the only entry point.
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Store } from "./store/index.mjs";
import { extractPDF } from "./extract.mjs";
import { NativeComponents } from "./native.mjs";
import { exportSelection, writeExportInput } from "./export-spool.mjs";
import { decodeRFC2047 } from "./headers.mjs";
import { updateCaptureSession } from "./capture-session.mjs";
import { createAttachmentStorage } from "./attachment-storage.mjs";
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
// Only the upload owner can supply a private file to the native import worker.
const nativeImportSource = Symbol("nativeImportSource");
const importEncodings = new Set([
  "utf-8",
  "utf-16le",
  "utf-16be",
  "windows-1252",
  "iso-8859-1",
]);
const cleanFilename = (name) =>
  String(name || "attachment")
    .replace(/[\\/\u0000-\u001f]/g, "_")
    .slice(0, 180);
export async function createReferencesService({
  dataDir,
  backendId,
  authorizeProject,
  authorizeLibraryLifecycle,
  listProjects,
  translator,
  resolver,
  resolveInBrowser,
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
    browserResolutions = new Map(),
    deletedLibraries = new Set(),
    deletingLibraries = new Set(),
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
    const file = path.join(root, digest(p.id), "library.sqlite");
    if (
      await fs.access(path.join(path.dirname(file), "deleted.json")).then(
        () => true,
        () => false,
      )
    )
      deletedLibraries.add(id);
    if (deletedLibraries.has(id))
      fail(
        "This library was deliberately deleted; create a new project library to obtain a new identity",
        410,
      );
    if (deletingLibraries.has(id)) fail("Library deletion is in progress", 409);
    return attachmentStorage.currentProject({ ...p, file });
  };
  const call = async (p, op, args, signal) => {
    if (deletedLibraries.has(p.id) || deletingLibraries.has(p.id))
      fail("Library is no longer available", 410);
    const mutation =
      [
        "put",
        "batch",
        "remove",
        "putCollection",
        "deleteCollection",
        "putSearch",
        "deleteSearch",
        "importCollections",
        "eraseSessionNote",
        "deleteReceipt",
        "beginBibliographyMove",
        "commitBibliographyMove",
        "abortBibliographyMove",
        "finishBibliographyMove",
      ].includes(op) ||
      (["record", "fulltext"].includes(op) && args.data !== undefined);
    if (!mutation) return store.call(p.file, op, args, signal);
    const commit = async (ownerSignal) => {
      signal?.throwIfAborted();
      ownerSignal?.throwIfAborted();
      if (deletedLibraries.has(p.id) || deletingLibraries.has(p.id))
        fail("Library is no longer available", 410);
      return store.call(p.file, op, args);
    };
    return p.runAuthorized ? p.runAuthorized(commit) : commit(signal);
  };
  const attachmentStorage = createAttachmentStorage({ call, fileBaseName: async (p, item, signal) => {
    const parent = item.data.parentItem ? await call(p, "get", { key: item.data.parentItem }, signal) : item;
    return native.call("attachmentFileBaseName", [parent.data, { attachmentTitle: item.data.title }], signal);
  } });
  const identity = (p, key) => `bkref:${backendId}/${p.id}/${key}`;
  async function withOperation(key, work, signal) {
    const prior = operations.get(key) || Promise.resolve();
    const pending = prior
      .catch(() => {})
      .then(() => {
        signal?.throwIfAborted();
        return work();
      });
    operations.set(key, pending);
    try {
      return await pending;
    } finally {
      if (operations.get(key) === pending) operations.delete(key);
    }
  }
  const decorate = (p, item) => ({
    ...item,
    id: identity(p, item.key),
    library: { id: p.id, backendId },
    meta: {
      attachmentCount: item.data.attachmentCount || 0,
      ...(item.truncatedFields ? { truncatedFields: item.truncatedFields } : {}),
      creatorSummary: (item.data.creators || [])
        .map((c) => c.name || c.lastName || c.firstName)
        .join("; "),
    },
  });
  const nativeValues = (metadata, operationId) => {
    const keys = metadata.map((item, index) =>
      operationId
        ? digest(operationId + ":" + index)
            .slice(0, 16)
            .toUpperCase()
        : randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase(),
    );
    const mapping = new Map(
      metadata.map((x, index) => [x.key, keys[index]]).filter(([key]) => key),
    );
    return metadata.map((original, index) => {
      const data = { ...original };
      delete data.key;
      delete data.version;
      if (data.parentItem)
        data.parentItem = mapping.get(data.parentItem) || data.parentItem;
      return { createKey: keys[index], data };
    });
  };
  async function writePages(
    p,
    values,
    receipt,
    signal,
    summary = false,
    onProgress,
  ) {
    const output = [];
    for (let start = 0; start < values.length; start += 200) {
      signal?.throwIfAborted();
      const page = await call(
        p,
        "batch",
        {
          items: values.slice(start, start + 200),
          receipt: receipt + ":" + start,
        },
        signal,
      );
      if (!summary) output.push(...page);
      onProgress?.({
        key: "import",
        status: "writing",
        completed: Math.min(values.length, start + 200),
        total: values.length,
      });
      await new Promise((resolve) => setImmediate(resolve));
    }
    return output;
  }
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
    status.status =
      pendingResolvers(status.results).length ||
      status.results.some((value) => value.result?.pendingBrowserRequests > 0)
        ? "waiting-for-browser"
        : status.results.some(
              (x) => x.status === "error" || x.result?.status === "partial",
            )
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
    if (request.resultReceipt) {
      const outcome = await call(p, "record", { id: request.resultReceipt });
      if (outcome) {
        for (const pending of pendingResolvers(outcome))
          if (pending.requestId === request.requestId) {
            pending.status = "complete";
            pending.attachment = receipt;
          }
        await call(p, "record", {
          id: request.resultReceipt,
          data: outcome,
          revisionPrefix: request.resultReceipt.slice(
            0,
            request.resultReceipt.lastIndexOf(":result:") + 8,
          ),
        });
      }
    }
    for (const jobId of new Set(
      [request.jobId, ...(request.jobIds || [])].filter(Boolean),
    )) {
      const jobKey = p.id + ":" + jobId;
      const status =
        jobStates.get(jobKey) ||
        (await call(p, "record", { id: "job:" + jobId }));
      if (status) {
        if (request.resultReceipt)
          for (const entry of status.results) {
            if (entry.result?.pendingBrowserRequests)
              entry.result.pendingBrowserRequests = Math.max(
                0,
                entry.result.pendingBrowserRequests - 1,
              );
          }
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
  async function assertResolverActive(p, request) {
    const ids = [
      ...new Set([request.jobId, ...(request.jobIds || [])].filter(Boolean)),
    ];
    if (!ids.length) return;
    for (const id of ids) {
      const job = await call(p, "record", { id: "job:" + id });
      if (job && job.status !== "cancelled") return;
    }
    fail("The resolver job was cancelled", 409);
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
    // Reservation alone is serialized, including the existing global admission
    // bound. Long provider/export work starts after this owner releases the gate.
    const reservation = await withOperation("job-reservations", () =>
      reserveJob(p, authority, kind, values, execute, requestId, options),
    );
    reservation.start?.();
    return reservation.status;
  }
  async function reserveJob(
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
        return { status: previous };
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
    // Capture the canonical request before dispatch. A lost HTTP response must
    // not lose the versioned selection needed to recover an acknowledged job.
    if (options.request)
      await call(p, "record", {
        id: "job-request:" + id,
        data: options.request,
      });
    await call(p, "record", { id: "job:" + id, data: status });
    jobs.set(p.id + ":" + id, controller);
    jobStates.set(p.id + ":" + id, status);
    const start = () =>
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
              if (
                status.results[i]?.status === "complete" &&
                status.results[i]?.result?.status !== "partial"
              )
                continue;
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
                  ...(e.status ? { httpStatus: e.status } : {}),
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
    return { status, start };
  }
  async function importJob(p, authority, body, signal) {
    let source;
    let target = body.target;
    let requestId = body.requestId || randomUUID();
    if (body.uploadId) {
      const upload = await call(
        p,
        "record",
        { id: "upload:" + body.uploadId },
        signal,
      );
      if (
        !upload ||
        upload.pid !== p.id ||
        upload.method !== "import" ||
        upload.bodyEncoding !== "binary" ||
        !upload.sealed ||
        upload.cancelled
      )
        fail("A completed reference-file upload is required", 409);
      const expectedPath = path.join(
        path.dirname(p.file),
        "imports",
        upload.id,
      );
      if (upload.tempPath !== expectedPath)
        fail("Import source is outside its library", 403);
      const params = new URLSearchParams(upload.queryString || "");
      requestId = upload.requestId;
      if (body.requestId && body.requestId !== requestId)
        fail("Import request identity differs from its upload", 409);
      target = params.get("target");
      source = {
        path: expectedPath,
        byteLength: upload.byteLength,
        encoding: upload.encoding,
        sha256: upload.sha256,
      };
    } else if (
      typeof body.text !== "string" ||
      Buffer.byteLength(body.text, "utf8") > 32 * 1024 * 1024
    ) {
      fail("Import text must be at most 32 MiB", 413);
    }
    const params = new URLSearchParams({
      sessionID: requestId,
      summary: "true",
    });
    projectTarget(p, target);
    const values = [
      source
        ? {
            uploadId: body.uploadId,
            sha256: source.sha256,
            encoding: source.encoding,
            target,
          }
        : body.text,
    ];
    const result = await job(
      p,
      authority,
      "file-import",
      values,
      async (value, activeSignal, receipt, context) => {
        const result = await connector(
          p,
          authority,
          "import",
          {
            data: source ? undefined : value,
            [nativeImportSource]: source,
            onProgress: context.onProgress,
          },
          params,
          {},
          activeSignal,
        );
        if (source) await fs.rm(source.path, { force: true });
        return result;
      },
      requestId,
      { resume: body.resume },
    );
    // Persist only the sealed upload identity, never its bytes or private path.
    await call(
      p,
      "record",
      {
        id: "job-request:" + result.id,
        data: {
          path: `/projects/${encodeURIComponent(p.id)}/import`,
          body: source
            ? { uploadId: body.uploadId, requestId, summary: true }
            : { text: body.text, target, requestId, summary: true },
        },
      },
      signal,
    );
    return result;
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
    target,
  ) {
    const normalized = normalizeIdentifier(input);
    const resolution = await resolveIdentifiers({
      identifiers: [input],
      signal,
      mailto: settings.crossrefEmail || undefined,
    });
    const resolved = resolution.items[0];
    if (!resolved.zoteroIdentifier)
      return { input, status: "unresolved", resolution: resolved };
    const lookupIdentifiers = Object.fromEntries(
      Object.entries({
        ...resolved.identifiers,
        [normalized.type]: normalized.value,
      }).filter(([, value]) => value),
    );
    const metadataIdentifiers = (data) => ({
      DOI: data.DOI || data.provenance?.identifiers?.DOI,
      PMID:
        data.PMID ||
        String(data.extra || "").match(/^PMID:\s*(\d+)/m)?.[1] ||
        data.provenance?.identifiers?.PMID,
      PMCID:
        data.PMCID ||
        String(data.extra || "").match(/^PMCID:\s*(\S+)/m)?.[1] ||
        data.provenance?.identifiers?.PMCID,
    });
    const checkIdentifiers = (data) => {
      const actual = metadataIdentifiers(data);
      const comparable = (kind, value) =>
        kind === "PMCID"
          ? String(value)
              .trim()
              .toLowerCase()
              .replace(/\.\d+$/, "")
          : String(value).trim().toLowerCase();
      for (const [kind, value] of Object.entries(actual))
        if (
          value &&
          lookupIdentifiers[kind] &&
          comparable(kind, value) !== comparable(kind, lookupIdentifiers[kind])
        )
          fail(
            "Conflicting " +
              kind +
              " in resolved metadata; reconcile the identity before importing",
            409,
          );
    };
    const rememberIdentifiers = async (item) => {
      checkIdentifiers(item.data);
      const prior = item.data.provenance?.identifiers || {};
      const changed = Object.entries(lookupIdentifiers).some(
        ([kind, value]) => prior[kind] !== value,
      );
      if (changed)
        item = await call(
          p,
          "put",
          {
            value: {
              key: item.key,
              data: {
                ...item.data,
                provenance: {
                  ...item.data.provenance,
                  identifiers: { ...prior, ...lookupIdentifiers },
                  identityResolution: resolved,
                },
              },
            },
            expected: item.version,
          },
          signal,
        );
      return addToImportTarget(p, item, target, signal);
    };
    const skipped = async (item) => ({
      input,
      status: "skipped",
      item: decorate(p, item),
      resolution: resolved,
      ...(resolveFiles
        ? {
            pdfs: await resolvePDFs(
              p,
              authority,
              [item],
              signal,
              true,
              resolverContext,
            ),
          }
        : {}),
    });
    const matches = await call(
      p,
      "find",
      { identifiers: lookupIdentifiers },
      signal,
    );
    if (matches.length > 1)
      fail("Several records match this identifier; reconcile duplicates");
    if (matches.length === 1)
      return skipped(await rememberIdentifiers(matches[0]));
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
    const regular = metadata.filter(
      (data) => !["attachment", "note", "annotation"].includes(data.itemType),
    );
    if (!regular.length)
      fail("No reference metadata was returned for this identifier", 502);
    if (regular.length !== 1)
      fail(
        "Identifier translation returned several references; choose one before import",
        422,
      );
    for (const item of regular) checkIdentifiers(item);
    for (const [kind, value] of Object.entries(
      metadataIdentifiers(regular[0]),
    )) {
      if (!value) continue;
      const identifier = normalizeIdentifier(
        kind === "DOI" ? value : kind + ":" + value,
      );
      if (identifier.type === kind) lookupIdentifiers[kind] = identifier.value;
    }
    // PMID/PMCID translations can reveal a DOI absent from the initial input.
    // Recheck all verified identities in the existing per-project commit owner.
    const committed = await withOperation(
      "identifier-commit:" + p.id,
      async () => {
        const found = await call(
          p,
          "find",
          { identifiers: lookupIdentifiers },
          signal,
        );
        if (found.length > 1)
          fail(
            "Several records match the translated identifiers; reconcile duplicates",
            409,
          );
        if (found.length === 1)
          return { reused: await rememberIdentifiers(found[0]) };
        return {
          items: await call(
            p,
            "batch",
            {
              items: nativeValues(
                metadata.map((data) => ({
                  ...data,
                  collections: [],
                  provenance: {
                    source: "pinned-translator",
                    input,
                    resolution: resolved,
                    identifiers: ["attachment", "note", "annotation"].includes(
                      data.itemType,
                    )
                      ? {}
                      : lookupIdentifiers,
                    retrievedAt: new Date().toISOString(),
                  },
                })),
              ),
              receipt,
            },
            signal,
          ),
        };
      },
      signal,
    );
    if (committed.reused) return skipped(committed.reused);
    const items = committed.items;
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
  function projectTarget(p, target) {
    if (target && target !== "L" + p.id)
      fail("Collections are no longer supported. Select a References project.", 410);
    return null;
  }
  async function addToImportTarget(p, item, target, signal) {
    projectTarget(p, target);
    return item;
  }

  async function importOpenAlexRecord(
    p,
    authority,
    raw,
    activeSignal,
    receipt,
    context,
    options = {},
  ) {
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
        options.resolvePDFs ?? settings.automaticPDFs,
        options.target,
      );
      const candidates =
        imported.items || (imported.item ? [imported.item] : []);
      for (const item of candidates.filter(
        (x) => !["attachment", "note", "annotation"].includes(x.data.itemType),
      )) {
        const updated = decorate(p, await enrich(p, item, activeSignal, raw));
        if (imported.item?.key === item.key) imported.item = updated;
        if (imported.items)
          imported.items = imported.items.map((value) =>
            value.key === item.key ? updated : value,
          );
      }
      return imported;
    }
    const previous = await call(
      p,
      "find",
      { identifiers: { OpenAlex: record.id } },
      activeSignal,
    );
    if (previous.length > 1) fail("Several items share this OpenAlex identity");
    if (previous.length === 1) {
      const item = await addToImportTarget(
        p,
        previous[0],
        options.target,
        activeSignal,
      );
      return {
        status: "skipped",
        item: decorate(p, item),
        ...((options.resolvePDFs ?? settings.automaticPDFs)
          ? {
              pdfs: await resolvePDFs(
                p,
                authority,
                [item],
                activeSignal,
                true,
                context,
              ),
            }
          : {}),
      };
    }
    const metadata = await native.call(
      "translateOpenAlex",
      [raw],
      activeSignal,
    );
    const values = nativeValues(
      metadata.map((data) => ({
        ...data,
        collections: [],
        abstractNote: selectAbstract(record.abstract, data.abstractNote || "")
          .text,
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
      (options.resolvePDFs ?? settings.automaticPDFs)
        ? await resolvePDFs(
            p,
            authority,
            imported.filter(
              (x) =>
                !["attachment", "note", "annotation"].includes(x.data.itemType),
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
  }
  async function importOpenAlexSearch(p, authority, body, signal) {
    if (
      !body.search ||
      typeof body.search !== "object" ||
      Array.isArray(body.search) ||
      Object.keys(body.search).some(
        (key) =>
          !["query", "filter", "sort", "queryMode", "field", "exact"].includes(
            key,
          ),
      ) ||
      !Number.isSafeInteger(body.limit) ||
      body.limit < 1
    )
      fail(
        "Search import requires a search specification and a positive explicit result limit",
      );
    if (!body.search.query && !body.search.filter)
      fail("Choose a query or filter for search import");
    if (body.search.queryMode === "semantic" && body.limit > 50)
      fail("OpenAlex semantic search returns at most 50 results per query");
    if (body.limit > 10000 && !settings.openalexKey)
      fail(
        "Importing beyond OpenAlex's first 10,000 results requires a free OpenAlex key for cursor paging in References Settings",
      );
    return job(
      p,
      authority,
      "openalex-search-import",
      [
        {
          search: body.search,
          limit: body.limit,
          target: body.target || null,
          resolvePDFs: body.resolvePDFs ?? settings.automaticPDFs,
        },
      ],
      async (input, activeSignal, receipt, context) => {
        const summary = {
          status: "imported",
          processed: 0,
          imported: 0,
          skipped: 0,
          failed: 0,
          pendingBrowserRequests: 0,
          totalResultsReported: null,
          limit: input.limit,
          stoppedBecause: "end-of-results",
          results: [],
        };
        let pageNumber = 1;
        let cursor =
          settings.openalexKey && input.search.queryMode !== "semantic"
            ? "*"
            : null;
        const seenCursors = new Set();
        const pageSize = Math.min(100, input.limit);
        while (summary.processed < input.limit) {
          activeSignal.throwIfAborted();
          await project(authority, p.id);
          const pageReceipt = receipt + ":page:" + pageNumber;
          let page = await call(p, "record", { id: pageReceipt }, activeSignal);
          if (!page) {
            const response = await handle({
              method: "POST",
              path: `/projects/${encodeURIComponent(p.id)}/openalex/search`,
              body: {
                ...input.search,
                ...(cursor ? { cursor } : { page: pageNumber }),
                pageSize,
              },
              authority,
              signal: activeSignal,
            });
            if (response.status !== 200)
              fail(
                response.body.error || "OpenAlex page failed",
                response.status,
              );
            page = response.body;
            await call(
              p,
              "record",
              { id: pageReceipt, data: page },
              activeSignal,
            );
          }
          summary.totalResultsReported = page.totalResultsReported;
          for (const record of page.records) {
            if (summary.processed >= input.limit) break;
            const recordReceipt = receipt + ":result:" + record.id;
            let outcome = await call(
              p,
              "record",
              { id: recordReceipt },
              activeSignal,
            );
            if (outcome?.pageNumber && outcome.pageNumber !== pageNumber)
              continue;
            if (!outcome || outcome.status === "error") {
              try {
                const imported = await importOpenAlexRecord(
                  p,
                  authority,
                  record.raw,
                  activeSignal,
                  receipt + ":source:" + record.id + ":items",
                  { ...context, resultReceipt: recordReceipt },
                  input,
                );
                outcome = {
                  sourceId: record.id,
                  pageNumber,
                  status: imported.status,
                  itemIds: (
                    imported.items || (imported.item ? [imported.item] : [])
                  ).map((item) => item.id),
                  ...(imported.pdfs ? { pdfs: imported.pdfs } : {}),
                };
              } catch (error) {
                activeSignal.throwIfAborted();
                outcome = {
                  sourceId: record.id,
                  pageNumber,
                  status: "error",
                  error: error.message,
                };
              }
              await call(
                p,
                "record",
                {
                  id: recordReceipt,
                  data: outcome,
                  revisionPrefix: receipt + ":result:",
                },
                activeSignal,
              );
            }
            if (summary.results.length < 80) summary.results.push(outcome);
            summary.pendingBrowserRequests += pendingResolvers(outcome).length;
            summary.processed++;
            if (outcome.status === "imported") summary.imported++;
            else if (outcome.status === "skipped") summary.skipped++;
            else summary.failed++;
            context.onProgress({
              key: "openalex-import",
              status: "importing",
              completed: summary.processed,
              total: Math.min(input.limit, summary.totalResultsReported),
              imported: summary.imported,
              skipped: summary.skipped,
              failed: summary.failed,
            });
            await new Promise((resolve) => setImmediate(resolve));
          }
          if (
            !page.records.length ||
            (cursor ? !page.nextCursor : !page.nextPage)
          )
            break;
          if (cursor) {
            if (seenCursors.has(page.nextCursor))
              fail("OpenAlex returned a repeated page cursor", 502);
            seenCursors.add(page.nextCursor);
            cursor = page.nextCursor;
          }
          if (++pageNumber > Math.ceil(input.limit / pageSize) + 1)
            fail("OpenAlex repeated records prevented bounded paging", 502);
        }
        if (summary.processed >= input.limit) summary.stoppedBecause = "limit";
        if (summary.failed) summary.status = "partial";
        return summary;
      },
      body.requestId,
      { resume: body.resume },
    );
  }
  const readOnlyProject = (p) =>
    p.runAuthorized
      ? {
          ...p,
          runAuthorized: (work) => p.runAuthorized(work, { write: false }),
        }
      : p;
  async function runExport(p, specification, signal, onProgress) {
    if (
      specification.delivery !== undefined &&
      !["file", "inline"].includes(specification.delivery)
    )
      fail("Unknown export delivery");
    const create = async (ownerSignal) => {
      const activeSignal =
        ownerSignal && signal
          ? AbortSignal.any([ownerSignal, signal])
          : ownerSignal || signal;
      activeSignal?.throwIfAborted();
      const guarded = { ...p, runAuthorized: undefined };
      await pruneExports(guarded, activeSignal);
      const exportId = Date.now() + "-" + randomUUID();
      const outputFile = exportFile(p, exportId),
        inputFile = outputFile + ".input";
      await fs.mkdir(path.dirname(outputFile), {
        recursive: true,
        mode: 0o700,
      });
      const expected = path.join(
        await fs.realpath(root),
        digest(p.id),
        "exports",
      );
      if ((await fs.realpath(path.dirname(outputFile))) !== expected)
        fail("Export spool is outside its library", 403);
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
      await call(
        guarded,
        "record",
        {
          id: "export:" + exportId,
          data: { exportId, expiresAt, complete: false },
        },
        activeSignal,
      );
      try {
        const input = await writeExportInput({
          p: guarded,
          call,
          file: inputFile,
          selection: specification.selection,
          backendId,
          signal: activeSignal,
          onProgress,
        });
        const output = await native.call(
          "translateExport",
          [
            {
              input,
              translatorID: specification.translatorID,
              options: specification.options,
            },
            { outputFile, delivery: "file" },
          ],
          activeSignal,
          onProgress,
          { waitForCancellation: true, syncCancellation: true },
        );
        activeSignal?.throwIfAborted();
        if (
          specification.delivery !== "file" &&
          !onProgress &&
          output.byteLength <= 1024 * 1024 &&
          /charset=utf-8$/i.test(output.contentType)
        ) {
          const text = await fs.readFile(outputFile, "utf8");
          await fs.rm(outputFile, { force: true });
          await call(
            guarded,
            "deleteReceipt",
            { id: "export:" + exportId },
            activeSignal,
          );
          const { file, ...metadata } = output;
          return { ...metadata, text };
        }
        const { file, ...metadata } = output;
        const receipt = {
          ...metadata,
          exportId,
          downloadPath: "exports/" + exportId + "/file",
          expiresAt,
          complete: true,
          count: input.count,
          libraryVersion: input.version,
        };
        await call(
          guarded,
          "record",
          { id: "export:" + exportId, data: receipt },
          activeSignal,
        );
        return receipt;
      } catch (error) {
        await fs.rm(outputFile, { force: true });
        await call(guarded, "deleteReceipt", { id: "export:" + exportId });
        throw error;
      } finally {
        await fs.rm(inputFile, { force: true });
      }
    };
    return p.runAuthorized
      ? p.runAuthorized(create, { write: false })
      : create(signal);
  }
  const exportFile = (p, id) => {
    if (!/^\d{13}-[0-9a-f-]{36}$/.test(id || ""))
      fail("Export is unavailable", 404);
    return path.join(path.dirname(p.file), "exports", id);
  };
  async function exportReceipt(p, id, signal) {
    const filePath = exportFile(p, id);
    const receipt = await call(p, "record", { id: "export:" + id }, signal);
    if (!receipt?.complete || receipt.expiresAt < Date.now())
      fail("Export has expired or is unavailable", 410);
    return { ...receipt, filePath };
  }
  async function openExport({ authority, projectId, exportId, signal }) {
    const p = await project(authority, projectId);
    const receipt = await exportReceipt(p, exportId, signal);
    const handle = await fs.open(
      receipt.filePath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    try {
      signal?.throwIfAborted();
      const info = await handle.stat();
      const actual = await fs.realpath("/proc/self/fd/" + handle.fd);
      const expected = path.join(
        await fs.realpath(root),
        digest(p.id),
        "exports",
        exportId,
      );
      if (
        !info.isFile() ||
        info.size !== receipt.byteLength ||
        actual !== expected
      )
        fail("Export file changed", 409);
      return {
        handle,
        name: "references." + receipt.extension,
        contentType: receipt.contentType,
      };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
  async function pruneExports(p, signal) {
    const page = await call(
      p,
      "recordPage",
      { prefix: "export:", limit: 100 },
      signal,
    );
    for (const receipt of page.items) {
      if (receipt.expiresAt >= Date.now()) break;
      await fs.rm(exportFile(p, receipt.exportId), { force: true });
      await fs.rm(exportFile(p, receipt.exportId) + ".input", { force: true });
      await call(
        p,
        "deleteReceipt",
        { id: "export:" + receipt.exportId },
        signal,
      );
    }
  }
  async function saveAttachment(p, authority, meta, body, sessionID, signal) {
    if (p.runAuthorized)
      return p.runAuthorized(async (ownerSignal) => {
        ownerSignal?.throwIfAborted();
        return saveAttachment(
          { ...p, runAuthorized: undefined },
          authority,
          meta,
          body,
          sessionID,
          AbortSignal.any([signal, ownerSignal].filter(Boolean)),
        );
      });
    signal?.throwIfAborted();
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
      await assertResolverActive(p, resolverRequest);
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
    const parentData = parent ? (await call(p, "get", { key: parent })).data : { itemType: "document", title: meta.title || "attachment" };
    const baseName = await native.call("attachmentFileBaseName", [parentData, { attachmentTitle: meta.title }], signal);
    await project(authority, p.id);
    const created = await attachmentStorage.createFile(p, { parentKey: parent, attachmentKey: key, baseName, extension: ext, body, signal });
    const destination = created.destination, filename = created.filename;
    let committedAttachment;
    try {
      const hash = createHash("sha256");
      await pipeline(createReadStream(destination), hash, { signal });
      const sha256 = hash.digest("hex");
      if (resolverRequest) await assertResolverActive(p, resolverRequest);
      const byteLength = (await fs.stat(destination)).size;
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
            sha256,
            byteLength,
            path: created.path,
            pathBase: created.pathBase,
            collections: [],
          },
        },
      }, signal);
      const receipt = committedAttachment = { ...decorate(p, result), captureID: meta.id };
      // Finish the acknowledgement once metadata commits, even if the caller
      // disconnects. Deleting its published file would orphan a durable item.
      await call(p, "record", { id: receiptId, data: receipt });
      return resolverRequest
        ? completeResolver(p, resolverRequest, receipt)
        : receipt;
    } catch (e) {
      if (!committedAttachment) await attachmentStorage.discardFile(created);
      else e.details = { ...e.details, attachment: committedAttachment };
      throw e;
    }
  }
  async function attachmentPath(p, item, signal) {
    return attachmentStorage.attachmentPath(p, item, signal);
  }

  async function lifecycleProject(authority, projectId, operation) {
    const p = authorizeLibraryLifecycle
      ? await authorizeLibraryLifecycle(authority, projectId, operation)
      : await authorizeProject(authority, projectId);
    if (!p || p.id !== projectId || !path.isAbsolute(p.cwd || ""))
      fail("Project lifecycle is not authorized", 403);
    return attachmentStorage.currentProject({ ...p, file: path.join(root, digest(projectId), "library.sqlite") });
  }
  async function moveBibliography({ projectId, bibliographyPath, expectedBibliographyPath, authority, signal, onProgress }) {
    const p = await lifecycleProject(authority, projectId, { operation: "relink", bibliographyPath });
    const move = ownerSignal => {
      const activeSignal = AbortSignal.any([signal, ownerSignal].filter(Boolean));
      return withOperation("bibliography:" + projectId, () => attachmentStorage.moveBibliography({ ...p, runAuthorized: undefined }, {
        bibliographyPath, expectedBibliographyPath, signal: activeSignal, onProgress,
      }), activeSignal);
    };
    return p.runAuthorized ? p.runAuthorized(move) : move(signal);
  }
  async function deleteLibrary({
    projectId,
    confirmProjectId,
    attachments = "keep",
    authority,
    signal,
  }) {
    if (
      projectId !== confirmProjectId ||
      !["keep", "delete"].includes(attachments)
    )
      fail(
        "Deliberate library deletion requires the project identity and attachment choice",
      );
    const p = await lifecycleProject(authority, projectId, {
      operation: "delete",
    });
    const commit = async (ownerSignal) => {
      signal?.throwIfAborted();
      ownerSignal?.throwIfAborted();
      if (deletingLibraries.has(projectId))
        fail("Library deletion is already in progress", 409);
      deletingLibraries.add(projectId);
      try {
        let attachmentDirectory;
        if (attachments === "delete") {
          if (p.bibliographyMove) fail("Finish the Bibliography move before deleting attachment files", 409);
          const base = await fs.realpath(p.bibliographyPath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
          const expected = base && path.join(base, digest(projectId).slice(0, 24));
          if (expected) await p.authorizePath?.(expected, { write: true });
          attachmentDirectory = expected && await fs.realpath(expected).catch((error) => {
            if (error.code === "ENOENT") return null;
            throw error;
          });
          if (attachmentDirectory && attachmentDirectory !== expected)
            fail("Library attachment directory is a symlink", 409);
        }
        for (const [key, controller] of jobs)
          if (key.startsWith(projectId + ":"))
            controller.abort(new DOMException("Library deleted", "AbortError"));
        for (const upload of uploads.values())
          if (upload.pid === projectId) {
            await upload.file?.close().catch(() => {});
            await fs.rm(upload.tempPath, { force: true });
            uploads.delete(upload.id);
          }
        await fs.mkdir(path.dirname(p.file), { recursive: true, mode: 0o700 });
        await privateWrite(path.join(path.dirname(p.file), "deleted.json"), {
          projectId,
          deletedAt: new Date().toISOString(),
          attachments,
        });
        deletedLibraries.add(projectId);
        await store.call(p.file, "closeLibrary", {});
        for (const suffix of ["", "-wal", "-shm"])
          await fs.rm(p.file + suffix, { force: true });
        await fs.rm(path.join(path.dirname(p.file), "exports"), {
          recursive: true,
          force: true,
        });
        await fs.rm(path.join(path.dirname(p.file), "imports"), {
          recursive: true,
          force: true,
        });
        if (attachmentDirectory)
          await fs.rm(attachmentDirectory, { recursive: true, force: true });
        return {
          deleted: projectId,
          attachments,
          attachmentDirectoryRemoved: !!attachmentDirectory,
        };
      } finally {
        deletingLibraries.delete(projectId);
      }
    };
    return p.runAuthorized ? p.runAuthorized(commit) : commit(signal);
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
          undefined,
          false,
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
              methods: context.methods,
              temporaryRoot: path.join(root, "downloads"),
            },
          ],
          signal,
          context.onProgress,
        );
    const outputs = [];
    try {
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
              resultReceipt: context.resultReceipt,
            },
          });
          const output = { id: identity(p, item.key), ...recipe };
          if (resolveInBrowser) {
            const flightKey = p.id + ":" + requestId;
            let flight = browserResolutions.get(flightKey);
            if (!flight) {
              flight = Promise.resolve().then(() =>
                resolveInBrowser({ authority, projectId: p.id, requestId, signal }),
              );
              browserResolutions.set(flightKey, flight);
            }
            try {
              await flight;
              signal?.throwIfAborted();
              // The browser's upload owner is the authority for completion,
              // never a successful command response on its own.
              const completed = await call(p, "record", {
                id: "resolver:" + requestId,
              });
              if (completed?.status === "complete") {
                output.status = "complete";
                output.attachment = completed.receipt;
              }
            } catch (error) {
              signal?.throwIfAborted();
              // A missing/disconnected browser remains an explicit resumable
              // request; metadata import and the native queue still settle.
              output.browserError = String(error.message || error).slice(0, 1024);
              const pending = await call(p, "record", { id: "resolver:" + requestId });
              if (pending?.status === "complete") {
                output.status = "complete";
                output.attachment = pending.receipt;
                delete output.browserError;
              } else if (pending?.browser) output.browser = pending.browser;
            } finally {
              if (browserResolutions.get(flightKey) === flight)
                browserResolutions.delete(flightKey);
            }
          }
          outputs.push(output);
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
          signal,
        );
        outputs.push({ id: result.id, status: "complete", attachment });
      } finally {
        await fs.rm(result.file.directory, { recursive: true, force: true });
      }
    }
    return outputs;
    } finally {
      // Native queue work can finish later files before an earlier browser
      // challenge settles. Cancellation still drains every temporary download.
      await Promise.all(results.filter((result) => result.file?.directory)
        .map((result) => fs.rm(result.file.directory, { recursive: true, force: true })));
    }
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
    projectTarget(p, query.get("target"));
    query.delete("target");
    let metadata = {};
    const encodedMetadata = headers["X-Metadata"] || headers["x-metadata"];
    if (encodedMetadata) {
      if (typeof encodedMetadata !== "string" || encodedMetadata.length > 65536)
        fail("Attachment metadata exceeds its limit");
      try {
        metadata = JSON.parse(decodeRFC2047(encodedMetadata));
      } catch {
        fail("Invalid attachment metadata");
      }
    }
    projectTarget(p, metadata.target);
    metadata.target = null;
    if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
      projectTarget(p, body.target);
      if (body.queryString) projectTarget(p, new URLSearchParams(body.queryString).get("target"));
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
    if (!serialized && (writes.includes(method)
      || (method === "getResolverRequest" && body?.browser !== undefined))) {
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
      body?.sessionID ||
      metadata.sessionID ||
      query.get("sessionID") ||
      query.get("session");
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
      await assertResolverActive(p, request);
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
      if (body.browser !== undefined) {
        const browser = body.browser;
        if (!browser || Object.keys(browser).some((key) => !["tabId", "windowId", "url", "status"].includes(key))
          || !Number.isSafeInteger(browser.tabId) || browser.tabId < 0
          || !Number.isSafeInteger(browser.windowId) || browser.windowId < 0
          || browser.url !== request.attachment.url || !["waiting", "file-found"].includes(browser.status))
          fail("Invalid resolver browser progress");
        request.browser = { ...browser, updatedAt: new Date().toISOString() };
        await call(p, "record", { id: "resolver:" + request.requestId, data: request }, signal);
        for (const jobId of new Set([request.jobId, ...(request.jobIds || [])].filter(Boolean))) {
          const jobKey = p.id + ":" + jobId;
          const job = jobStates.get(jobKey) || await call(p, "record", { id: "job:" + jobId }, signal);
          if (!job) continue;
          const key = identity(p, parent.key);
          job.progress ||= {};
          job.progress[key] = { ...job.progress[key], key, status: "challenge-required",
            requestId: request.requestId, browser: request.browser, url: request.attachment.url };
          for (const pending of pendingResolvers(job.results))
            if (pending.requestId === request.requestId) pending.browser = request.browser;
          await call(p, "record", { id: "job:" + jobId, data: job }, signal);
        }
      }
      const { jobId, jobIndex, jobIds, resultReceipt, ...recipe } = request;
      return recipe;
    }
    if (method === "getSelectedCollection") {
      // Native Connector compatibility: the selected database is the sole destination.
      return {
        libraryID: p.id, libraryName: p.name || p.id,
        editable: !p.archived, libraryEditable: !p.archived, filesEditable: !p.archived,
        target: "L" + p.id, kind: "library", collectionID: null, collectionName: null,
        id: "L" + p.id, name: p.name || p.id,
        targets: [{ id: "L" + p.id, kind: "library", name: p.name || p.id, libraryID: p.id, filesEditable: !p.archived, level: 0 }],
        nextStart: null,
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
          const upload = await call(p, "record", {
            id: "upload:" + old.uploadId,
          });
          if (upload && !upload.cancelled)
            return {
              uploadId: old.uploadId,
              offset: upload.offset,
              ...(upload.sealed ? { sealed: true } : {}),
              ...(upload.result ? { receipt: upload.result } : {}),
            };
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
        (body.bodyEncoding === "json" && body.byteLength > 32 * 1024 * 1024)
      )
        fail("Invalid upload");
      if (body.method === "import" && body.bodyEncoding === "binary") {
        if (
          body.byteLength > 32 * 1024 * 1024 ||
          !body.requestId ||
          !importEncodings.has(body.encoding || "utf-8")
        )
          fail(
            "Reference-file uploads require a request ID, supported encoding and at most 32 MiB",
          );
        const params = new URLSearchParams(body.queryString || "");
        if (params.get("summary") !== "true")
          fail("Reference-file uploads require summary jobs");
        const target = params.get("target");
        projectTarget(p, target);
        body = { ...body, encoding: body.encoding || "utf-8" };
      }
      for (const upload of uploads.values()) {
        if (upload.expires < Date.now()) {
          await upload.file?.close();
          if (upload.sealed) continue;
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
      return { uploadId: id, offset: 0 };
    }
    if (method.startsWith("upload-")) {
      let u = uploads.get(body.uploadId);
      if (!u) {
        u = await call(p, "record", { id: "upload:" + body.uploadId });
        if (u?.result) return u.result;
        if (u?.cancelled) fail("Upload was cancelled", 409);
        if (u && u.pid === p.id && (u.sealed || u.expires >= Date.now())) {
          if (!u.sealed)
            u.file = await fs.open(u.tempPath, "r+").catch(async (error) => {
              if (
                error.code !== "ENOENT" ||
                u.method !== "import" ||
                u.bodyEncoding !== "binary"
              )
                throw error;
              // A crash can occur between the atomic move and its SQLite receipt.
              u.tempPath = path.join(path.dirname(p.file), "imports", u.id);
              return fs.open(u.tempPath, "r+");
            });
          uploads.set(u.id, u);
        }
      }
      if (!u || u.pid !== p.id || (!u.sealed && u.expires < Date.now()))
        fail("Upload is unavailable", 404);
      if (method === "upload-cancel") {
        if (u.sealed)
          return {
            cancelled: false,
            sealed: true,
            uploadId: u.id,
            job: await call(p, "record", { id: "job:" + u.requestId }),
          };
        await u.file?.close();
        await fs.rm(u.tempPath, { force: true });
        uploads.delete(u.id);
        await call(p, "record", {
          id: "upload:" + u.id,
          data: { ...u, file: undefined, cancelled: true },
        });
        return { cancelled: true };
      }
      if (method === "upload-chunk") {
        if (u.sealed) fail("Upload has already been sealed", 409);
        if (
          typeof body.data !== "string" ||
          body.data.length > 349528 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)
        )
          fail("Invalid upload chunk");
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
        if (u.method === "import" && u.bodyEncoding === "binary") {
          if (!u.sealed) {
            await u.file?.sync();
            await u.file?.close();
            u.file = undefined;
            const directory = path.join(path.dirname(p.file), "imports");
            await fs.mkdir(directory, { recursive: true, mode: 0o700 });
            const destination = path.join(directory, u.id);
            if (u.tempPath !== destination)
              await fs.rename(u.tempPath, destination);
            u.tempPath = destination;
            const hash = createHash("sha256");
            await pipeline(createReadStream(destination), hash, { signal });
            u.sha256 = hash.digest("hex");
            u.sealed = true;
            await call(p, "record", {
              id: "upload:" + u.id,
              data: { ...u, file: undefined },
            });
          }
          u.result = await importJob(
            p,
            authority,
            {
              uploadId: u.id,
              requestId: u.requestId,
              summary: true,
            },
            signal,
          );
          await call(p, "record", {
            id: "upload:" + u.id,
            data: { ...u, file: undefined },
          });
          uploads.delete(u.id);
          return u.result;
        }
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
        "capture:" + sessionID,
      );
      const saved = await writePages(
        p,
        values,
        "capture-write:" + sessionID,
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
        signal,
      );
      if (method === "saveStandaloneAttachment") {
        const session = await call(
          p,
          "record",
          { id: "capture:" + sessionID },
          signal,
        );
        session.items[meta.id || sessionID] = attachment.key;
        await call(
          p,
          "record",
          { id: "capture:" + sessionID, data: session },
          signal,
        );
      }
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
          signal,
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
      const source = body?.[nativeImportSource];
      const operationId = "import:" + sessionID;
      const inputHash = digest(
        JSON.stringify({
          ...(source
            ? { sha256: source.sha256, encoding: source.encoding }
            : { text }),
          target: query.get("target"),
        }),
      );
      const previous = await call(p, "record", { id: operationId }, signal);
      if (previous && previous.inputHash !== inputHash)
        fail("Import request ID was reused with different input", 409);
      if (previous?.completed) return previous.result;
      await call(p, "record", { id: operationId, data: { inputHash } }, signal);
      const bundle = await native.call(
        source ? "translateImportFile" : "translateImportBundle",
        [source || text, { target: query.get("target"), operationId }],
        signal,
      );
      const values = nativeValues(
        bundle.items.map((data) => ({ ...data, collections: [] })),
        operationId,
      );
      const summary = query.get("summary") === "true";
      const written = await writePages(
        p,
        values,
        operationId + ":items",
        signal,
        summary,
        body?.onProgress,
      );
      const result = summary
        ? {
            status: "imported",
            count: values.length,
            requestId: sessionID,
          }
        : written.map((item) => decorate(p, item));
      if (summary)
        await call(
          p,
          "record",
          { id: operationId, data: { inputHash, completed: true, result } },
          signal,
        );
      return result;
    }
    if (method === "updateSession")
      return updateCaptureSession(p, sessionID, body, call, signal);
    if (method === "hasAttachmentResolvers") {
      const session = await call(
        p,
        "record",
        { id: "capture:" + sessionID },
        signal,
      );
      if (!session?.items?.[body.itemID])
        fail("Capture item is unavailable", 404);
      const item = await call(
        p,
        "get",
        { key: session.items[body.itemID] },
        signal,
      );
      return native.call(
        "hasAttachmentResolvers",
        [{ data: item.data, settings }],
        signal,
      );
    }
    if (method === "getRecognizedItem") {
      const r = await call(p, "record", { id: "recognition:" + sessionID });
      return r?.item || false;
    }
    if (method === "saveAttachmentFromResolver") {
      const s = await call(p, "record", { id: "capture:" + sessionID });
      if (!s?.items?.[body.itemID]) fail("Capture item is unavailable", 404);
      const result = (
        await resolvePDFs(
          p,
          authority,
          [await call(p, "get", { key: s.items[body.itemID] })],
          signal,
          true,
          { methods: ["oa", "custom"] },
        )
      )[0];
      if (result?.status === "complete" && result.attachment)
        return result.attachment.data.title || "Full text";
      if (result?.status === "challenge-required")
        throw Object.assign(
          Error("Browser assistance is required to save this attachment"),
          {
            status: 409,
            code: "BROWSER_REQUIRED",
            details: { requestId: result.requestId },
          },
        );
      fail("Failed to save an attachment", 502);
    }
    fail("Connector capability is not connected: " + method, 501);
  }
  async function handle(request) {
    try {
      const { method = "GET", authority, signal } = request;
      let body = request.body || {};
      let durableBody = body;
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
      if (segments[0] === "projects" && segments.length === 1) {
        if (method !== "GET") fail("Method not allowed", 405);
        return { status: 200, body: (await listProjects?.(authority)) || [] };
      }
      if (segments[0] !== "projects" || !segments[1])
        fail("An explicit project library is required");
      if (
        segments[2] === "library" &&
        segments.length === 3 &&
        method === "DELETE"
      )
        return {
          status: 200,
          headers: { "Cache-Control": "no-store" },
          body: await deleteLibrary({
            projectId: segments[1],
            confirmProjectId: body.confirmProjectId,
            attachments: body.attachments,
            authority,
            signal,
          }),
        };
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
      if (op === "collections" || query.has("collection") || body.collection)
        fail("Collections are no longer supported. Select a References project.", 410);
      projectTarget(p, body.target);
      projectTarget(p, query.get("target"));
      if (body.target) body = { ...body, target: null };
      durableBody = body;
      query.delete("target");
      if (op === "searches" && ["POST", "PUT", "PATCH"].includes(method) && (body.data || body).collection)
        fail("Collection filters are no longer supported. Save a project search.", 410);
      if (op === "items" && !["manage", "export", "enrich", "resolve-pdfs"].includes(key) && ["POST", "PUT", "PATCH"].includes(method)) {
        for (const value of (Array.isArray(body) ? body : [body])) {
          const data = value.data || value;
          if (!Object.hasOwn(data, "collections")) continue;
          const old = key && key !== "top" ? await call(p, "get", { key }, signal) : null;
          if (JSON.stringify(data.collections || []) !== JSON.stringify(old?.data.collections || []))
            fail("Collection membership is retained only as legacy data and cannot be changed.", 410);
        }
      }
      if (
        [
          "identifiers/import",
          "crossref/search",
          "openalex/search",
          "openalex/import",
          "citations/render",
          "citations/parse",
          "citations/import-snapshots",
          "items/enrich",
          "items/resolve-pdfs",
          "items/manage",
          "items/export",
        ].includes(op + "/" + key) &&
        method !== "POST"
      )
        fail("Method not allowed", 405);
      if (
        ["schema", "styles", "citation-options", "translators"].includes(op) &&
        method !== "GET"
      )
        fail("Method not allowed", 405);
      if (
        op === "connector" &&
        method !== "POST" &&
        !(
          method === "GET" &&
          [
            "ping",
            "getTranslators",
            "getTranslatorCode",
            "getSelectedCollection",
            "getRecognizedItem",
            "hasAttachmentResolvers",
            "getResolverRequest",
          ].includes(key)
        )
      )
        fail("Method not allowed", 405);
      if (
        op === "jobs" &&
        !["GET", "DELETE"].includes(method) &&
        !(method === "POST" && action === "resume")
      )
        fail("Method not allowed", 405);
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
        if (key === "saveAttachmentFromResolver") status = 201;
      } else if (op === "citation-options")
        result = {
          ...(await native.call(
            "citationOptions",
            [Object.fromEntries(query)],
            signal,
          )),
          citationAutoRegenerate: settings.citationAutoRegenerate ?? -1,
        };
      else if (op === "translators" && key === "export")
        result = { items: await native.call("exportTranslators", [], signal) };
      else if (op === "import") {
        if (method !== "POST") fail("Method not allowed", 405);
        const params = new URLSearchParams({
          sessionID: body.requestId || randomUUID(),
        });
        if (body.target) params.set("target", body.target);
        if (body.summary || body.uploadId) {
          result = await importJob(p, authority, body, signal);
          status = 202;
        } else {
          result = await connector(
            p,
            authority,
            "import",
            body.text,
            params,
            {},
            signal,
          );
          status = 201;
        }
      } else if (op === "items" && key === "export") {
        const selection = exportSelection(body);
        const previousRequest = body.requestId
          ? await call(
              p,
              "record",
              { id: "job-request:" + body.requestId },
              signal,
            )
          : null;
        const previousJob = body.requestId
          ? await call(p, "record", { id: "job:" + body.requestId }, signal)
          : null;
        if (
          previousRequest?.path === url.pathname &&
          selection.version === undefined
        )
          selection.version = exportSelection(previousRequest.body).version;
        if (
          selection.version === undefined &&
          previousJob?.kind === "metadata-export"
        )
          selection.version = previousJob.results?.[0]?.result?.libraryVersion;
        const current = await call(p, "libraryVersion", {}, signal);
        if (
          selection.version !== undefined &&
          selection.version !== current &&
          (!previousJob ||
            (body.resume &&
              !["complete", "waiting-for-browser"].includes(
                previousJob.status,
              )))
        )
          fail("Library changed; reload the export selection", 409);
        selection.version ??= current;
        durableBody = { ...body, selection };
        const specification = {
          selection,
          translatorID: body.translatorID,
          options: body.options || {},
          delivery: body.delivery,
        };
        if (body.selection || selection.keys.length > 1000) {
          result = await job(
            readOnlyProject(p),
            authority,
            "metadata-export",
            [specification],
            (value, activeSignal, _id, context) =>
              runExport(p, value, activeSignal, context.onProgress),
            body.requestId,
            {
              resume: body.resume,
              request: { path: url.pathname, body: durableBody },
            },
          );
          status = 202;
        } else result = await runExport(p, specification, signal);
      } else if (
        op === "exports" &&
        key &&
        action === "file" &&
        method === "GET"
      ) {
        const receipt = await exportReceipt(p, key, signal);
        return {
          status: 200,
          headers: { "Cache-Control": "no-store" },
          filePath: receipt.filePath,
          referenceExport: { projectId: p.id, exportId: key },
        };
      } else if (op === "schema")
        result = await native.call("schema", [], signal);
      else if (op === "settings") {
        if (method === "PATCH") {
          const allowed = [
            "openalexKey",
            "crossrefEmail",
            "crossrefKey",
            "unpaywallEmail",
            "resolvers",
            "automaticPDFs",
            "citationAutoRegenerate",
          ];
          for (const name of Object.keys(body))
            if (!allowed.includes(name)) fail("Unknown setting");
          for (const name of ["openalexKey", "crossrefKey"])
            if (
              body[name] != null &&
              (typeof body[name] !== "string" ||
                body[name].length > 4096 ||
                /[\r\n\u0000]/.test(body[name]))
            )
              fail("Invalid service key");
          if (
            body.citationAutoRegenerate !== undefined &&
            ![-1, 0, 1].includes(body.citationAutoRegenerate)
          )
            fail("Citation regeneration preference must be -1, 0 or 1");
          if (body.resolvers !== undefined)
            await native.call("validateResolvers", [body.resolvers], signal);
          for (const name of ["crossrefEmail", "unpaywallEmail"])
            if (body[name] && !/^[^@\s<>]+@[^@\s<>]+$/.test(body[name]))
              fail("Invalid contact email");
          const prior = operations.get("settings") || Promise.resolve();
          const work = prior
            .catch(() => {})
            .then(async () => {
              const updated = { ...settings, ...body };
              for (const name of ["openalexKey", "crossrefKey"])
                if (!updated[name]) delete updated[name];
              if (
                body.resolvers !== undefined &&
                typeof body.resolvers !== "string"
              )
                updated.resolvers = JSON.stringify(body.resolvers);
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
            });
          operations.set("settings", work);
          try {
            await work;
          } finally {
            if (operations.get("settings") === work)
              operations.delete("settings");
          }
        } else if (method !== "GET") fail("Method not allowed", 405);
        result = {
          openalexKeyConfigured: !!settings.openalexKey,
          crossrefKeyConfigured: !!settings.crossrefKey,
          crossrefEmail: settings.crossrefEmail || "",
          unpaywallEmail: settings.unpaywallEmail || "",
          resolvers: settings.resolvers || "[]",
          automaticPDFs: !!settings.automaticPDFs,
          citationAutoRegenerate: settings.citationAutoRegenerate ?? -1,
        };
      } else if (op === "jobs") {
        if (key && action === "results" && method === "GET") {
          const owner = await call(p, "record", { id: "job:" + key }, signal);
          if (!owner || owner.kind !== "openalex-search-import")
            fail("This job has no paged source outcomes", 404);
          return {
            status: 200,
            headers: responseHeaders,
            body: await call(
              p,
              "recordPage",
              {
                prefix: key + ":0:result:",
                cursor: query.get("cursor") || "",
                start: Number(query.get("start")) || 0,
                limit: Number(query.get("limit")) || 80,
                expectedVersion: query.has("version")
                  ? Number(query.get("version"))
                  : undefined,
              },
              signal,
            ),
          };
        }
        if (!key && method === "GET") {
          const page = await call(
            p,
            "jobs",
            {
              start: Number(query.get("start")) || 0,
              limit: Number(query.get("limit")) || 80,
            },
            signal,
          );
          for (const item of page.items)
            if (
              !jobs.has(p.id + ":" + item.id) &&
              ["queued", "running"].includes(item.status)
            )
              item.status = "interrupted";
          return { status: 200, headers: responseHeaders, body: page };
        }
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
          if (!jobs.has(p.id + ":" + key) && result.status !== "complete") {
            result = {
              ...result,
              status: "cancelled",
              finishedAt: new Date().toISOString(),
            };
            await call(
              result.kind === "metadata-export" ? readOnlyProject(p) : p,
              "record",
              { id: "job:" + key, data: result },
              signal,
            );
          }
        }
        if (
          !jobs.has(p.id + ":" + key) &&
          ["queued", "running"].includes(result.status)
        )
          result = { ...result, status: "interrupted" };
      } else if (op === "identifiers" && key === "import") {
        projectTarget(p, body.target);
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
              body.target,
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
                ...(settings.crossrefKey
                  ? {
                      "Crossref-Plus-API-Token":
                        "Bearer " + settings.crossrefKey,
                    }
                  : {}),
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
          if (
            queryMode === "semantic" &&
            String(body.query || "").length > 2000
          )
            fail("OpenAlex semantic search accepts at most 2,000 characters");
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
            : Math.min(
                queryMode === "semantic" ? 50 : 100,
                Math.max(1, Number(body.pageSize) || 80),
              );
          u.searchParams.set("per_page", String(rows));
          const cursor =
            body.cursor ||
            (settings.openalexKey &&
            queryMode !== "semantic" &&
            !body.estimate &&
            Number(body.page || 1) === 1
              ? "*"
              : null);
          if (cursor) {
            if (cursor !== "*" && !settings.openalexKey)
              fail(
                "Cursor paging requires an OpenAlex key in References Settings",
              );
            u.searchParams.set("cursor", cursor);
          } else {
            const page = Math.max(1, Number(body.page) || 1);
            if (!Number.isSafeInteger(page) || page * rows > 10000)
              fail(
                "OpenAlex basic paging covers its first 10,000 results; continue with a returned cursor and configured key",
              );
            if (queryMode === "semantic" && page !== 1)
              fail(
                "OpenAlex semantic search has only one page of at most 50 results",
              );
            u.searchParams.set("page", String(page));
          }
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
              queryMode !== "semantic" && raw.results.length === rows
                ? (Number(body.page) || 1) + 1
                : null,
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
        projectTarget(p, body.target);
        result = body.search
          ? await importOpenAlexSearch(p, authority, body, signal)
          : await job(
              p,
              authority,
              "openalex-import",
              bounded(body.records, 1000),
              (raw, activeSignal, receipt, context) =>
                importOpenAlexRecord(
                  p,
                  authority,
                  raw,
                  activeSignal,
                  receipt,
                  context,
                  body,
                ),
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
      else if (op === "citations" && key === "import-snapshots") {
        if (
          !body.items ||
          typeof body.items !== "object" ||
          Array.isArray(body.items) ||
          !body.requestId ||
          typeof body.requestId !== "string" ||
          body.requestId.length > 128
        )
          fail("Snapshot import requires an item map and stable request ID");
        const entries = Object.entries(body.items);
        bounded(entries, 100);
        if (
          Buffer.byteLength(JSON.stringify(body.items), "utf8") >
          4 * 1024 * 1024
        )
          fail("Snapshot import accepts at most 4 MiB per batch", 413);
        projectTarget(p, body.target);
        result = await withOperation(
          "snapshot-import:" + p.id + ":" + body.requestId,
          async () => {
            const receipt = "snapshot-import:" + body.requestId;
            const inputHash = digest(
              JSON.stringify({
                items: body.items,
                target: body.target || null,
              }),
            );
            const previous = await call(p, "record", { id: receipt }, signal);
            if (previous && previous.inputHash !== inputHash)
              fail(
                "Snapshot import identity was reused with different input",
                409,
              );
            if (previous?.result) result = previous.result;
            else {
              await call(
                p,
                "record",
                { id: receipt, data: { inputHash } },
                signal,
              );
              const mapping = {},
                items = [];
              for (const [original, snapshot] of entries) {
                signal?.throwIfAborted();
                if (
                  !/^bkref:[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+\/[A-Z0-9]+$/.test(
                    original,
                  ) ||
                  !snapshot ||
                  typeof snapshot.type !== "string" ||
                  typeof snapshot.title !== "string" ||
                  (snapshot.id && snapshot.id !== original)
                )
                  fail("Invalid canonical CSL snapshot");
                let item;
                if (original.startsWith(`bkref:${backendId}/${p.id}/`)) {
                  try {
                    item = await call(
                      p,
                      "get",
                      { key: itemKey(p, original) },
                      signal,
                    );
                  } catch (error) {
                    if (error.status !== 404) throw error;
                  }
                }
                if (item)
                  item = await addToImportTarget(p, item, body.target, signal);
                else {
                  const operationId = receipt + ":" + original;
                  const bundle = await native.call(
                    "translateImportBundle",
                    [
                      JSON.stringify([{ ...snapshot, id: original }]),
                      { operationId },
                    ],
                    signal,
                  );
                  const records = nativeValues(
                    bundle.items.map((data) => ({
                      ...data,
                      collections: [],
                      provenance: {
                        importedSnapshot: {
                          id: original,
                          itemData: snapshot,
                          importedAt: new Date().toISOString(),
                        },
                      },
                    })),
                    operationId,
                  );
                  const imported = await call(
                    p,
                    "batch",
                    { items: records, receipt: operationId },
                    signal,
                  );
                  const regular = imported.filter(
                    (value) =>
                      !["attachment", "note", "annotation"].includes(
                        value.data.itemType,
                      ),
                  );
                  if (regular.length !== 1)
                    fail("Native CSL import did not yield one reference", 422);
                  item = regular[0];
                }
                mapping[original] = identity(p, item.key);
                items.push(decorate(p, item));
              }
              result = { mapping, items };
              await call(
                p,
                "record",
                { id: receipt, data: { inputHash, result } },
                signal,
              );
            }
            return result;
          },
          signal,
        );
        status = 201;
      } else if (op === "citations" && key === "parse") {
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
        const unlinkedItems = new Set();
        for (const c of state.citations || []) {
          for (const source of c.items || []) {
            if (
              !/^bkref:[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+\/[A-Z0-9]+$/.test(
                source.id || "",
              )
            )
              fail("Invalid canonical reference identity");
            if (
              state.embeddedItems[source.id] &&
              (!state.embeddedItems[source.id].type ||
                typeof state.embeddedItems[source.id].title !== "string")
            )
              fail("Invalid embedded CSL snapshot");
            if (!state.embeddedItems[source.id]) {
              const k = itemKey(p, source.id);
              const i = await call(p, "get", { key: k }, signal);
              state.embeddedItems[source.id] = await native.call(
                "toCSL",
                [i.data, source.id],
                signal,
              );
            } else if (!source.id.startsWith(`bkref:${backendId}/${p.id}/`))
              unlinkedItems.add(source.id);
          }
        }
        result = await native.call("renderDocument", [state], signal);
        result.unlinkedItems = [...unlinkedItems];
      } else if (op === "items" && key === "manage") {
        if (method !== "POST") fail("Method not allowed", 405);
        if (
          !["delete", "restore"].includes(body.operation)
        )
          fail("Unsupported item operation");
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
            const data = { deleted: 0 };
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
                sort: query.get("sort") || "title",
                direction: query.get("direction"),
                limit: Number(query.get("limit")) || 80,
                summary:
                  !compatibility &&
                  query.get("format") !== "csljson" &&
                  query.get("includeData") !== "true",
                fields: query.has("fields")
                  ? query
                      .get("fields")
                      .split(",")
                      .map((field) => field.trim())
                      .filter(Boolean)
                  : undefined,
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
          const file = await attachmentPath(p, item, signal);
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
      } else fail("References endpoint not found", 404);
      if (status === 202 && result?.id && result.kind !== "metadata-export")
        await call(
          result.kind === "metadata-export" ? readOnlyProject(p) : p,
          "record",
          {
            id: "job-request:" + result.id,
            data: { path: url.pathname, body: durableBody },
          },
          signal,
        );
      return { status, headers: responseHeaders, body: result };
    } catch (error) {
      return {
        status: error.status || (error.name === "AbortError" ? 499 : 500),
        headers: { "Cache-Control": "no-store" },
        body: {
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
          ...(error.details ? { details: error.details } : {}),
        },
      };
    }
  }
  return {
    handle,
    openExport,
    moveBibliography,
    projectInfo: async ({ projectId, authority, signal }) => {
      const p = await project(authority, projectId);
      signal?.throwIfAborted();
      return { bibliographyPath: p.bibliographyPath, ...(p.bibliographyMove ? { bibliographyMove: p.bibliographyMove } : {}) };
    },
    deleteLibrary,
    importSnapshots: async (body, { authority, projectId, signal } = {}) => {
      const result = await handle({
        method: "POST",
        path: `/projects/${projectId}/citations/import-snapshots`,
        body,
        authority,
        signal,
      });
      if (result.status !== 201) fail(result.body.error, result.status);
      return result.body;
    },
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
        await u.file?.close().catch(() => {});
        if (!u.sealed) await fs.rm(u.tempPath, { force: true });
      }
      await Promise.all([store.close(), native.close()]);
    },
  };
}
