// SPDX-License-Identifier: AGPL-3.0-only
// One UI adapter for the existing authorized References upload registry.
// File data stays bounded to one chunk; the backend owns decoding and commit.
export async function uploadFile({
  scope,
  file,
  body,
  signal,
  onProgress = () => {},
}) {
  let uploadId,
    committed = false;
  try {
    signal?.throwIfAborted();
    const begin = await scope.request("connector/upload-begin", {
      method: "POST",
      body: {
        ...body,
        source: { name: file.name, lastModified: file.lastModified },
        bodyEncoding: "binary",
        byteLength: file.size,
      },
      signal,
    });
    uploadId = begin.uploadId;
    if (begin.receipt) {
      committed = true;
      onProgress({ loaded: file.size, total: file.size });
      return begin.receipt;
    }
    const start = begin.sealed ? file.size : (begin.offset ?? 0);
    if (!Number.isSafeInteger(start) || start < 0 || start > file.size)
      throw Error("The saved upload offset is outside this file.");
    onProgress({ loaded: start, total: file.size });
    for (let offset = start; offset < file.size; offset += 262144) {
      signal?.throwIfAborted();
      const bytes = new Uint8Array(
        await file.slice(offset, offset + 262144).arrayBuffer(),
      );
      signal?.throwIfAborted();
      let binary = "";
      for (let start = 0; start < bytes.length; start += 16384)
        binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
      await scope.request("connector/upload-chunk", {
        method: "POST",
        body: { uploadId, offset, data: btoa(binary) },
        signal,
      });
      onProgress({ loaded: offset + bytes.length, total: file.size });
    }
    const result = await scope.request("connector/upload-commit", {
      method: "POST",
      body: { uploadId },
      signal,
    });
    committed = true;
    return result;
  } finally {
    if (uploadId && !committed)
      await scope
        .request("connector/upload-cancel", {
          method: "POST",
          body: { uploadId },
          signal: AbortSignal.timeout(5000),
        })
        .catch(() => {});
  }
}
