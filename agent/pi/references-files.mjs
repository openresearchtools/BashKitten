// SPDX-License-Identifier: AGPL-3.0-only
// A local-file client for the existing project-bound References upload owner.
import { open } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import { applicationRequest } from "./apps-channel.mjs";

export async function importReferenceFile(
  filePath,
  apiPath,
  options = {},
  transport = {},
) {
  const route =
    /^\/projects\/[A-Za-z0-9._~-]+\/(import|connector\/(saveAttachment|saveStandaloneAttachment))$/.exec(
      apiPath,
    );
  if (!route || apiPath.split("/").some((part) => [".", ".."].includes(part))) {
    throw Error(
      "Use the project's import or connector saveAttachment/saveStandaloneAttachment path",
    );
  }
  const isImport = route[1] === "import";
  const allowed = isImport
    ? ["requestId", "encoding", "summary"]
    : ["requestId", "parentKey", "title", "contentType", "url"];
  if (Object.keys(options).some((key) => !allowed.includes(key)))
    throw Error("Unsupported reference-file transfer option");
  if (
    route[2] === "saveAttachment" &&
    !/^[A-Z0-9]+$/.test(options.parentKey || "")
  )
    throw Error("Attachment upload requires its returned parentKey");
  const requestId = options.requestId || randomUUID();
  const prefix =
    apiPath.slice(0, apiPath.indexOf("/", "/projects/".length) + 1) +
    "connector/";
  const call = (method, body, signal = transport.signal) =>
    applicationRequest("references", "POST", prefix + method, body, {
      signal,
      request: transport.request,
    });
  const file = await open(filePath, "r");
  let uploadId;
  let handedOff = false;
  try {
    const before = await file.stat();
    if (
      !before.isFile() ||
      before.size > (isImport ? 32 * 1024 * 1024 : 2 ** 31)
    )
      throw Error(
        isImport
          ? "Choose a regular reference file of at most 32 MiB"
          : "Choose a regular attachment file of at most 2 GiB",
      );
    const query = new URLSearchParams({
      sessionID: requestId,
      summary: "true",
    });
    const begin = await call("upload-begin", {
      method: isImport ? "import" : route[2],
      bodyEncoding: "binary",
      byteLength: before.size,
      requestId,
      ...(isImport
        ? { encoding: options.encoding || "utf-8" }
        : {
            ...(options.parentKey ? { parentKey: options.parentKey } : {}),
            headers: {
              "X-Metadata": JSON.stringify({
                id: requestId,
                parentItemID: options.parentKey,
                title: options.title || basename(filePath),
                filename: basename(filePath),
                url: options.url || "",
                contentType:
                  options.contentType ||
                  {
                    ".pdf": "application/pdf",
                    ".epub": "application/epub+zip",
                    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    ".doc": "application/msword",
                    ".xml": "application/xml",
                    ".odt": "application/vnd.oasis.opendocument.text",
                    ".rtf": "application/rtf",
                    ".html": "text/html",
                    ".txt": "text/plain",
                  }[extname(filePath).toLowerCase()] ||
                  "application/octet-stream",
              }),
            },
          }),
      queryString: query.toString(),
      source: { name: basename(filePath), lastModified: before.mtimeMs },
    });
    uploadId = begin.body.uploadId;
    if (begin.body.receipt) {
      handedOff = true;
      return { ...begin, body: begin.body.receipt };
    }
    let offset = begin.body.offset || 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > before.size)
      throw Error("Upload owner returned an invalid file offset");
    if (!begin.body.sealed) {
      const buffer = Buffer.allocUnsafe(262144);
      while (offset < before.size) {
        transport.signal?.throwIfAborted();
        const { bytesRead } = await file.read(
          buffer,
          0,
          Math.min(buffer.length, before.size - offset),
          offset,
        );
        if (!bytesRead) throw Error("Reference file changed while reading");
        const reply = await call("upload-chunk", {
          uploadId,
          offset,
          data: buffer.subarray(0, bytesRead).toString("base64"),
        });
        offset += bytesRead;
        if (reply.body.offset !== offset)
          throw Error("Upload owner returned a different file offset");
        transport.onProgress?.({
          completed: offset,
          total: before.size,
          requestId,
        });
      }
      const after = await file.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
        throw Error(
          "Reference file changed during upload; retry with a new request ID",
        );
    }
    const reply = await call("upload-commit", { uploadId });
    handedOff = true;
    return reply;
  } catch (error) {
    // Cancellation can race a successful commit. The existing owner retains a
    // sealed job's input; cleanup must never erase bytes already handed to it.
    if (uploadId && !handedOff) {
      try {
        const recovery = await call(
          "upload-cancel",
          { uploadId },
          AbortSignal.timeout(5000),
        );
        error.details = {
          ...(error.details || {}),
          uploadId,
          requestId,
          recovery: recovery.body,
        };
      } catch {
        error.details = {
          ...(error.details || {}),
          uploadId,
          requestId,
          recovery: "Retry the same file and request ID to recover its receipt",
        };
      }
    }
    throw error;
  } finally {
    await file.close();
  }
}
