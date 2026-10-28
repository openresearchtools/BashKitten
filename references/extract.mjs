// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
export function extractPDF(file, { signal, maxPages } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const args = [
      "-I",
      fileURLToPath(new URL("./extract.py", import.meta.url)),
      file,
    ];
    if (maxPages) args.push(String(maxPages));
    const child = spawn("python3", args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    let size = 0,
      parts = [],
      error = "";
    child.stdout.on("data", (part) => {
      size += part.length;
      if (size > 64 * 1024 * 1024) {
        child.kill("SIGTERM");
        reject(
          Error(
            "Extracted text exceeds the bounded 64 MiB response; use the existing source reader directly",
          ),
        );
      } else parts.push(part);
    });
    child.stderr.on("data", (part) => {
      error = (error + part.toString()).slice(-2000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        const result = JSON.parse(Buffer.concat(parts).toString("utf8"));
        if (code !== 0 || result.error)
          throw Error(result.error || error || "PDF extraction failed");
        resolve(result);
      } catch (e) {
        reject(e);
      }
    });
  });
}
