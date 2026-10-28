// SPDX-License-Identifier: AGPL-3.0-or-later
import { parentPort } from "node:worker_threads";
import * as translation from "./translation.mjs";
import {
  resolveFiles,
  validateResolvers,
  hasAttachmentResolvers,
} from "./resolvers.mjs";
import * as citations from "./citations.mjs";
import { citationParser } from "./host-paths.mjs";
import requestContext from "./runtime/request-context.js";
const controllers = new Map();
parentPort.on("message", async ({ id, method, args, cancel, cancelBuffer }) => {
  if (cancel) {
    controllers.get(id)?.abort(new DOMException("Cancelled", "AbortError"));
    return;
  }
  const controller = new AbortController();
  controllers.set(id, controller);
  try {
    const result =
      method === "renderDocument"
        ? await citations.renderDocument(args[0], { signal: controller.signal })
        : method === "parseCitations"
          ? await (async () => {
              const { scanDocument } = await import(citationParser.href);
              if (typeof args[0] !== "string" || args[0].length > 1024 * 1024)
                throw Error("Citation parsing accepts at most 1 MiB of text");
              const result = scanDocument(args[0]);
              return {
                citations: result.citations.map(({ start, end, cluster }) => ({
                  start,
                  end,
                  cluster,
                })),
                bibliography: result.bibliography,
              };
            })()
          : method === "installStyle"
            ? await citations.installStyle(args[0])
            : method === "listStyles"
              ? await citations.listStyles(args[0])
              : method === "citationOptions"
                ? await citations.citationOptions(args[0])
                : method === "resolveFiles"
                  ? await requestContext.run(
                      {
                        signal: controller.signal,
                        settings: args[0]?.settings,
                      },
                      () =>
                        resolveFiles(args[0], {
                          signal: controller.signal,
                          onProgress: (progress) =>
                            parentPort.postMessage({ id, progress }),
                        }),
                    )
                  : method === "hasAttachmentResolvers"
                    ? await hasAttachmentResolvers(args[0], {
                        signal: controller.signal,
                      })
                    : method === "validateResolvers"
                      ? validateResolvers(args[0])
                      : await requestContext.run(
                          {
                            signal: controller.signal,
                            settings: args[1]?.settings,
                          },
                          () =>
                            [
                              "translateIdentifier",
                              "translateImport",
                              "translateImportBundle",
                              "translateImportFile",
                              "translateOpenAlex",
                              "translateExport",
                            ].includes(method)
                              ? translation[method](args[0], {
                                  ...args[1],
                                  signal: controller.signal,
                                  cancelBuffer,
                                  onProgress: (progress) =>
                                    parentPort.postMessage({ id, progress }),
                                })
                              : translation[method](...args),
                        );
    parentPort.postMessage({ id, result });
  } catch (e) {
    parentPort.postMessage({
      id,
      error: { message: e.message, status: e.status || 500 },
    });
  } finally {
    controllers.delete(id);
  }
});
