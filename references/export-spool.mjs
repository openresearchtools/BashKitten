// SPDX-License-Identifier: AGPL-3.0-or-later
// Paged project reads feed the unchanged native export ItemGetter through a private spool.
import fs from "node:fs/promises";
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
export function exportSelection(body) {
  const input = body.selection || { scope: "selected", keys: body.keys };
  if (
    !input ||
    !["selected", "library", "search"].includes(input.scope)
  )
    fail("Choose an explicit export selection");
  const allowed = [
    "scope",
    "keys",
    "q",
    "sort",
    "direction",
    "deleted",
    "version",
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    fail("Unknown export selection field");
  const selection = {
    scope: input.scope,
    sort: input.sort || "title",
    direction: input.direction || "asc",
    deleted:
      input.deleted === true || input.deleted === 1 || input.deleted === "1",
  };
  if (
    input.deleted !== undefined &&
    ![false, true, 0, 1, "0", "1"].includes(input.deleted)
  )
    fail("Invalid deleted-items filter");
  if (
    !["title", "creator", "year", "itemType", "dateModified"].includes(
      selection.sort,
    ) ||
    !["asc", "desc"].includes(selection.direction)
  )
    fail("Invalid export sort");
  if (input.version !== undefined) {
    if (!Number.isSafeInteger(input.version) || input.version < 0)
      fail("Invalid library version");
    selection.version = input.version;
  }
  if (selection.scope === "selected") {
    if (
      !Array.isArray(input.keys) ||
      !input.keys.length ||
      input.keys.some(
        (key) => typeof key !== "string" || !/^[A-Z0-9]+$/.test(key),
      )
    )
      fail("Select reference keys to export");
    selection.keys = [...new Set(input.keys)];
  } else {
    if (selection.scope === "search") {
      if (
        input.q !== undefined &&
        (typeof input.q !== "string" || input.q.length > 2048)
      )
        fail("Invalid export search");
      selection.q = input.q || "";
    }
  }
  return selection;
}
export async function writeExportInput({
  p,
  call,
  file,
  selection,
  backendId,
  signal,
  onProgress,
}) {
  const version = await call(p, "libraryVersion", {}, signal);
  if (selection.version !== undefined && selection.version !== version)
    fail("Library changed; reload the export selection", 409);
  const assertVersion = (current) => {
    if (current !== version)
      fail("Library changed during export; reload before retrying", 409);
  };
  const output = await fs.open(file, "wx", 0o600);
  let count = 0,
    total = selection.keys?.length;
  const write = (value) => {
    signal?.throwIfAborted();
    return output.writeFile(value, "utf8");
  };
  const record = async (item) => {
    const value = {
      ...item.data,
      key: item.key,
      uri: `bkref:${backendId}/${p.id}/${item.key}`,
    };
    delete value.notes;
    delete value.attachments;
    await write(JSON.stringify(value).slice(0, -1));
    for (const [name, type] of [
      ["notes", "note"],
      ["attachments", "attachment"],
    ]) {
      await write(',"' + name + '":[');
      let cursor,
        first = true;
      do {
        const page = await call(
          p,
          "list",
          { parent: item.key, top: false, itemType: type, limit: 100, cursor },
          signal,
        );
        assertVersion(page.version);
        for (const child of page.items) {
          const data =
            type === "attachment"
              ? {
                  ...child.data,
                  key: child.key,
                  uri: `bkref:${backendId}/${p.id}/${child.key}`,
                }
              : child.data;
          await write((first ? "" : ",") + JSON.stringify(data));
          first = false;
        }
        cursor = page.next;
      } while (cursor);
      await write("]");
    }
    await write("}\n");
    count++;
    onProgress?.({
      key: "export",
      phase: "reading",
      completed: count,
      ...(total === undefined ? {} : { total }),
    });
  };
  try {
    if (selection.keys) {
      for (const key of selection.keys)
        await record(await call(p, "get", { key }, signal));
    } else {
      let cursor;
      do {
        const page = await call(
          p,
          "list",
          {
            query: selection.q,
            deleted: selection.deleted,
            sort: selection.sort,
            direction: selection.direction,
            limit: 100,
            cursor,
            count: !cursor,
          },
          signal,
        );
        assertVersion(page.version);
        total ??= page.total;
        for (const item of page.items) await record(item);
        cursor = page.next;
      } while (cursor);
    }
    assertVersion(await call(p, "libraryVersion", {}, signal));
    return { path: file, count, version };
  } finally {
    await output.close();
  }
}
